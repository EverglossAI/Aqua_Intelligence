import test from "node:test";
import assert from "node:assert/strict";
import { routeEnvironmentRequest } from "../worker/routes/environment.js";

function request(overrides = {}) {
  return new Request("https://aqua.test/api/environment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ latitude: 22.35, longitude: 120.37, start: "2024-08-28", end: "2024-09-26", ...overrides })
  });
}

function upstreamBody(hours = 3, soilVariable = "soil_moisture_0_to_7cm") {
  const time = Array.from({ length: hours }, (_item, index) => `2026-09-25T${String(index).padStart(2, "0")}:00`);
  return {
    latitude: 22.35,
    longitude: 120.37,
    elevation: 18,
    hourly: {
      time,
      temperature_2m: time.map((_item, index) => 28 + index),
      precipitation: time.map((_item, index) => index),
      rain: time.map((_item, index) => index),
      [soilVariable]: time.map((_item, index) => 0.2 + index / 100),
      et0_fao_evapotranspiration: time.map((_item, index) => index / 10)
    }
  };
}

function mockRuntime(fetchImplementation) {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const stored = new Map();
  const operations = { matches: 0, puts: 0, fetches: 0 };
  globalThis.caches = { default: {
    async match(key) { operations.matches++; return stored.get(key.url)?.clone() || null; },
    async put(key, value) { operations.puts++; stored.set(key.url, value.clone()); }
  } };
  globalThis.fetch = (...args) => { operations.fetches++; return fetchImplementation(...args); };
  return { stored, operations, restore() { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; } };
}

test("30-day environmental query uses one bounded cache object and normalized contract", async () => {
  const runtime = mockRuntime(async url => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "archive-api.open-meteo.com");
    assert.equal(parsed.searchParams.get("models"), "era5");
    assert.equal(parsed.searchParams.get("timezone"), "UTC");
    assert.match(parsed.searchParams.get("hourly"), /temperature_2m/);
    assert.match(parsed.searchParams.get("hourly"), /soil_moisture_0_to_7cm/);
    return Response.json(upstreamBody());
  });
  try {
    const response = await routeEnvironmentRequest(request());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(runtime.operations, { matches: 1, puts: 1, fetches: 1 });
    assert.equal(runtime.stored.size, 1);
    assert.equal(body.provider, "open-meteo");
    assert.equal(body.classification, "external model/reanalysis");
    assert.equal(body.dataset, "Open-Meteo ERA5 historical weather reanalysis");
    assert.equal(body.hourly.length, 3);
    assert.deepEqual(body.hourly[2], { timestamp: "2026-09-25T02:00Z", precipitation: 2, rain: 2, temperature: 30, soilMoisture: 0.22, evapotranspiration: 0.2 });
  } finally { runtime.restore(); }
});

test("cache hit avoids Open-Meteo and remains constant cost", async () => {
  const runtime = mockRuntime(async () => Response.json(upstreamBody()));
  try {
    assert.equal((await routeEnvironmentRequest(request())).status, 200);
    assert.equal((await routeEnvironmentRequest(request())).status, 200);
    assert.deepEqual(runtime.operations, { matches: 2, puts: 1, fetches: 1 });
  } finally { runtime.restore(); }
});

test("invalid coordinates and date ranges are rejected before subrequests", async () => {
  const runtime = mockRuntime(async () => Response.json(upstreamBody()));
  try {
    assert.equal((await routeEnvironmentRequest(request({ latitude: null }))).status, 400);
    assert.equal((await routeEnvironmentRequest(request({ latitude: 91 }))).status, 400);
    assert.equal((await routeEnvironmentRequest(request({ start: "2024-09-27", end: "2024-09-26" }))).status, 400);
    assert.equal((await routeEnvironmentRequest(request({ start: "2024-01-01" }))).status, 400);
    assert.equal((await routeEnvironmentRequest(request({ start: "2024-02-31" }))).status, 400);
    assert.deepEqual(runtime.operations, { matches: 0, puts: 0, fetches: 0 });
  } finally { runtime.restore(); }
});

test("upstream and malformed responses fail without caching", async () => {
  const cases = [
    () => new Response("unavailable", { status: 503 }),
    () => Response.json({ hourly: { time: [] } }),
    () => Response.json({ ...upstreamBody(), hourly: { ...upstreamBody().hourly, precipitation: [1] } }),
    () => Response.json({ ...upstreamBody(), hourly: { ...upstreamBody().hourly, soil_moisture_0_to_7cm: [0.2, null, "bad"] } })
  ];
  for (const implementation of cases) {
    const runtime = mockRuntime(implementation);
    try {
      const response = await routeEnvironmentRequest(request());
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "Environmental data unavailable" });
      assert.equal(runtime.operations.puts, 0);
      assert.equal(runtime.stored.size, 0);
    } finally { runtime.restore(); }
  }
});

test("a current window uses forecast variables and the same normalized contract", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const runtime = mockRuntime(async url => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "api.open-meteo.com");
    assert.match(parsed.searchParams.get("hourly"), /soil_moisture_0_to_1cm/);
    return Response.json(upstreamBody(3, "soil_moisture_0_to_1cm"));
  });
  try {
    const response = await routeEnvironmentRequest(request({ start: today, end: today }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.soilMoistureDepth, "0-1 cm");
    assert.equal(body.hourly[0].soilMoisture, 0.2);
  } finally { runtime.restore(); }
});