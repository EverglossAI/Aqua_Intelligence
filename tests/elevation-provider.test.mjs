import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { routeElevationRequest } from "../worker/routes/elevation.js";

function request(points) {
  return new Request("https://aqua.test/api/elevation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ points })
  });
}

function points(count = 2) {
  return Array.from({ length: count }, (_item, index) => ({ lat: 53.49 + index / 10000, lng: -6.02 - index / 10000, distance: index * 75 }));
}

function mockRuntime(fetchImplementation) {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const stored = new Map();
  globalThis.caches = { default: {
    async match(key) { return stored.get(key.url)?.clone() || null; },
    async put(key, value) { stored.set(key.url, value.clone()); }
  } };
  globalThis.fetch = fetchImplementation;
  return { stored, restore() { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; } };
}

function elevationsFor(url) {
  const requestUrl = new URL(url);
  const latitudes = requestUrl.searchParams.get("latitude").split(",").map(Number);
  const longitudes = requestUrl.searchParams.get("longitude").split(",").map(Number);
  assert.equal(latitudes.length, longitudes.length);
  assert.ok(latitudes.length <= 100);
  return latitudes.map((latitude, index) => latitude * 10 + longitudes[index]);
}

test("single batch returns normalized Open-Meteo provenance and ordered elevations", async () => {
  let calls = 0;
  const runtime = mockRuntime(async url => { calls++; return Response.json({ elevation: elevationsFor(url) }); });
  try {
    const response = await routeElevationRequest(request(points(20)));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual({ provider: body.provider, dataset: body.dataset, resolution_m: body.resolution_m, units: body.units }, {
      provider: "open-meteo", dataset: "Copernicus DEM GLO-90", resolution_m: 90, units: "m"
    });
    assert.deepEqual(body.points.map(point => point.elevation), points(20).map(point => point.lat * 10 + point.lng));
  } finally { runtime.restore(); }
});

test("profiles over 100 points are batched and restored to original order", async () => {
  const batchSizes = [];
  const runtime = mockRuntime(async url => {
    const elevations = elevationsFor(url);
    batchSizes.push(elevations.length);
    return Response.json({ elevation: elevations });
  });
  try {
    const response = await routeElevationRequest(request(points(175)));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(batchSizes, [100, 75]);
    assert.deepEqual(body.points.map(point => point.elevation), points(175).map(point => point.lat * 10 + point.lng));
  } finally { runtime.restore(); }
});

test("invalid coordinates are rejected without an upstream request", async () => {
  let calls = 0;
  const runtime = mockRuntime(async () => { calls++; return Response.json({ elevation: [1, 2] }); });
  try {
    const response = await routeElevationRequest(request([{ lat: 91, lng: 0 }, { lat: 0, lng: -181 }]));
    assert.equal(response.status, 400);
    assert.equal((await routeElevationRequest(request([{ lat: null, lng: 0 }, { lat: 0, lng: 1 }]))).status, 400);
    assert.equal(calls, 0);
  } finally { runtime.restore(); }
});

for (const status of [400, 503]) test(`upstream ${status} retains unavailable fallback`, async () => {
  const runtime = mockRuntime(async () => new Response("unavailable", { status }));
  try {
    const response = await routeElevationRequest(request(points()));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Elevation data unavailable" });
  } finally { runtime.restore(); }
});

test("malformed and partial elevation responses are rejected without caching", async () => {
  for (const body of [{ wrong: [] }, { elevation: [12] }, { elevation: [12, null] }]) {
    const runtime = mockRuntime(async () => Response.json(body));
    try {
      const response = await routeElevationRequest(request(points()));
      assert.equal(response.status, 502);
      assert.equal(runtime.stored.size, 0);
    } finally { runtime.restore(); }
  }
});

test("cached coordinates avoid repeated upstream requests", async () => {
  let calls = 0;
  const runtime = mockRuntime(async url => { calls++; return Response.json({ elevation: elevationsFor(url) }); });
  try {
    assert.equal((await routeElevationRequest(request(points()))).status, 200);
    assert.equal((await routeElevationRequest(request(points()))).status, 200);
    assert.equal(calls, 1);
    assert.equal(runtime.stored.size, 2);
  } finally { runtime.restore(); }
});

test("browser provider uses the Worker proxy and restores route distances", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const samples = [
    { lat: 53.49, lng: -6.02, distance: 0 },
    { lat: 53.491, lng: -6.021, distance: 125 }
  ];
  globalThis.window = { AquaContextualCore: {
    sampleProfileLine() { return samples; },
    buildSampledElevationProfile(profilePoints, provenance) { return { profilePoints, provenance }; }
  } };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/elevation");
    assert.equal(options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(options.body), { points: samples });
    return Response.json({
      provider: "open-meteo",
      dataset: "Copernicus DEM GLO-90",
      resolution_m: 90,
      units: "m",
      points: [
        { latitude: 53.49, longitude: -6.02, elevation: 17 },
        { latitude: 53.491, longitude: -6.021, elevation: 19 }
      ]
    });
  };
  try {
    await import(`../cockpit/elevation-providers.js?test=${Date.now()}`);
    const profile = await globalThis.window.AquaElevationProviders.fetchProfile([[53.49, -6.02], [53.491, -6.021]]);
    assert.deepEqual(profile.profilePoints.map(point => point.distance), [0, 125]);
    assert.deepEqual(profile.provenance, {
      source: "Open-Meteo",
      dataset: "Copernicus DEM GLO-90",
      resolution: "~90 m",
      units: "m",
      kind: "external DEM",
      attribution: "Elevation: Copernicus DEM / Open-Meteo"
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("legacy provider and token references are absent from release sources", () => {
  const legacyProvider = String.fromCharCode(77, 97, 112, 98, 111, 120);
  const legacyToken = `${legacyProvider.toUpperCase()}_ACCESS_TOKEN`;
  const files = ["README.md", "cockpit/elevation-providers.js", "cockpit/contextual-ui.js", "worker/routes/elevation.js"];
  files.forEach(file => {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.equal(source.includes(legacyProvider), false, file);
    assert.equal(source.includes(legacyToken), false, file);
  });
});