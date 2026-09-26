import test from "node:test";
import assert from "node:assert/strict";
import { routeElevationRequest } from "../worker/routes/elevation.js";

function request(points) {
  return new Request("https://aqua.test/api/elevation/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ points })
  });
}

const points = [
  { lat: 53.49, lng: -6.02, distance: 0 },
  { lat: 53.491, lng: -6.021, distance: 100 }
];

test("elevation provider is honestly unavailable without server configuration", async () => {
  const response = await routeElevationRequest(request(points), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Elevation data unavailable" });
});

test("elevation provider returns numerical Mapbox terrain samples without exposing its token", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const stored = new Map();
  globalThis.caches = { default: {
    async match(key) { return stored.get(key.url)?.clone() || null; },
    async put(key, value) { stored.set(key.url, value.clone()); }
  } };
  globalThis.fetch = async url => {
    assert.match(String(url), /mapbox\.mapbox-terrain-v2/);
    assert.match(String(url), /access_token=secret-token/);
    return Response.json({ features: [{ properties: { ele: 42 } }] });
  };
  try {
    const response = await routeElevationRequest(request(points), { MAPBOX_ACCESS_TOKEN: "secret-token" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.points.map(point => point.elevation), [42, 42]);
    assert.equal(body.provenance.source, "Mapbox Terrain DEM");
    assert.doesNotMatch(JSON.stringify(body), /secret-token/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});

test("elevation provider retains unavailable fallback on upstream failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  globalThis.caches = { default: { async match() { return null; }, async put() {} } };
  globalThis.fetch = async () => new Response("denied", { status: 401 });
  try {
    const response = await routeElevationRequest(request(points), { MAPBOX_ACCESS_TOKEN: "invalid" });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Elevation data unavailable" });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});