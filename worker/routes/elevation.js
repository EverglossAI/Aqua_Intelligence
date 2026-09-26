const MAX_POINTS = 200;
const MAPBOX_TILEQUERY = "https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function validPoint(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function cacheKey(request, point) {
  const url = new URL(request.url);
  url.pathname = "/api/elevation/mapbox/cache";
  url.search = `?lat=${Number(point.lat).toFixed(5)}&lng=${Number(point.lng).toFixed(5)}`;
  return new Request(url.toString(), { method: "GET" });
}

async function queryElevation(point, token, request, cache) {
  const key = cacheKey(request, point);
  const cached = await cache.match(key);
  if (cached) return (await cached.json()).elevation;
  const url = `${MAPBOX_TILEQUERY}/${encodeURIComponent(point.lng)},${encodeURIComponent(point.lat)}.json?layers=contour&limit=1&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mapbox Terrain request failed (${response.status})`);
  const body = await response.json();
  const elevation = Number(body.features?.[0]?.properties?.ele);
  if (!Number.isFinite(elevation)) throw new Error("Mapbox Terrain returned no elevation");
  await cache.put(key, json({ elevation }, 200, { "cache-control": "public, max-age=86400" }));
  return elevation;
}

export async function routeElevationRequest(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/elevation/profile") return null;
  if (request.method.toUpperCase() !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  if (!env.MAPBOX_ACCESS_TOKEN) return json({ error: "Elevation data unavailable" }, 503);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }
  const points = body?.points;
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS || !points.every(validPoint)) return json({ error: "Provide 2-200 valid profile points" }, 400);
  try {
    const cache = caches.default;
    const elevations = [];
    for (let start = 0; start < points.length; start += 10) {
      const batch = points.slice(start, start + 10);
      elevations.push(...await Promise.all(batch.map(point => queryElevation(point, env.MAPBOX_ACCESS_TOKEN, request, cache))));
    }
    return json({
      points: points.map((point, index) => ({ lat: Number(point.lat), lng: Number(point.lng), distance: Number(point.distance), elevation: elevations[index] })),
      provenance: { source: "Mapbox Terrain DEM", kind: "external DEM", units: "m", dataset: "mapbox.mapbox-terrain-v2" }
    }, 200, { "cache-control": "private, max-age=300" });
  } catch (error) {
    console.error("Elevation provider failed", error);
    return json({ error: "Elevation data unavailable" }, 502);
  }
}