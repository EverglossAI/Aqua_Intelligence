const MAX_POINTS = 200;
const UPSTREAM_BATCH_SIZE = 100;
const OPEN_METEO_ELEVATION = "https://api.open-meteo.com/v1/elevation";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function coordinates(point) {
  return {
    latitude: Number(point?.latitude ?? point?.lat),
    longitude: Number(point?.longitude ?? point?.lng)
  };
}

function validPoint(point) {
  const rawLatitude = point?.latitude ?? point?.lat;
  const rawLongitude = point?.longitude ?? point?.lng;
  if (rawLatitude == null || rawLatitude === "" || rawLongitude == null || rawLongitude === "") return false;
  const { latitude, longitude } = coordinates(point);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function cacheKey(request, point) {
  const url = new URL(request.url);
  url.pathname = "/api/elevation/cache";
  url.search = `?latitude=${point.latitude.toFixed(5)}&longitude=${point.longitude.toFixed(5)}`;
  return new Request(url.toString(), { method: "GET" });
}

async function cachedElevation(cache, key) {
  const response = await cache.match(key);
  if (!response) return null;
  const elevation = (await response.json()).elevation;
  return Number.isFinite(elevation) ? elevation : null;
}

async function requestBatch(entries) {
  const url = new URL(OPEN_METEO_ELEVATION);
  url.searchParams.set("latitude", entries.map(entry => entry.point.latitude).join(","));
  url.searchParams.set("longitude", entries.map(entry => entry.point.longitude).join(","));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo elevation request failed (${response.status})`);
  const body = await response.json();
  if (!Array.isArray(body?.elevation) || body.elevation.length !== entries.length || !body.elevation.every(Number.isFinite)) throw new Error("Open-Meteo returned invalid elevation data");
  return body.elevation;
}

export async function routeElevationRequest(request) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/elevation") return null;
  if (request.method.toUpperCase() !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }
  const inputPoints = body?.points;
  if (!Array.isArray(inputPoints) || inputPoints.length < 2 || inputPoints.length > MAX_POINTS || !inputPoints.every(validPoint)) return json({ error: "Provide 2-200 valid WGS84 profile points" }, 400);
  const points = inputPoints.map(coordinates);
  try {
    const cache = caches.default;
    const elevations = new Array(points.length);
    const missing = [];
    for (let index = 0; index < points.length; index++) {
      const key = cacheKey(request, points[index]);
      const elevation = await cachedElevation(cache, key);
      if (elevation == null) missing.push({ index, point: points[index], key });
      else elevations[index] = elevation;
    }
    for (let start = 0; start < missing.length; start += UPSTREAM_BATCH_SIZE) {
      const entries = missing.slice(start, start + UPSTREAM_BATCH_SIZE);
      const batchElevations = await requestBatch(entries);
      await Promise.all(entries.map((entry, index) => {
        const elevation = batchElevations[index];
        elevations[entry.index] = elevation;
        return cache.put(entry.key, json({ elevation }, 200, { "cache-control": "public, max-age=86400" }));
      }));
    }
    return json({
      provider: "open-meteo",
      dataset: "Copernicus DEM GLO-90",
      resolution_m: 90,
      units: "m",
      points: points.map((point, index) => ({ ...point, elevation: elevations[index] }))
    }, 200, { "cache-control": "private, max-age=300" });
  } catch (error) {
    console.error("Elevation provider failed", error);
    return json({ error: "Elevation data unavailable" }, 502);
  }
}