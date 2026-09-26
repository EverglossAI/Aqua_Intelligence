const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const CACHE_VERSION = "open-meteo-environment-v1";
const MAX_RANGE_DAYS = 92;
const COMMON_VARIABLES = [
  "temperature_2m",
  "precipitation",
  "rain",
  "et0_fao_evapotranspiration"
];

function providerFor(query, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const historical = new Date(`${query.end}T00:00:00Z`) < today;
  return historical
    ? { endpoint: OPEN_METEO_ARCHIVE, dataset: "Open-Meteo ERA5 historical weather reanalysis", model: "era5", soilVariable: "soil_moisture_0_to_7cm", soilDepth: "0-7 cm", variables: [...COMMON_VARIABLES, "soil_moisture_0_to_7cm"] }
    : { endpoint: OPEN_METEO_FORECAST, dataset: "Open-Meteo best-match weather models", model: null, soilVariable: "soil_moisture_0_to_1cm", soilDepth: "0-1 cm", variables: [...COMMON_VARIABLES, "soil_moisture_0_to_1cm"] };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function validSeries(values, length) {
  return Array.isArray(values) && values.length === length && values.every(value => value == null || Number.isFinite(value));
}

async function queryCacheKey(request, query) {
  const provider = providerFor(query);
  const normalized = [CACHE_VERSION, provider.endpoint, provider.model, query.latitude.toFixed(5), query.longitude.toFixed(5), query.start, query.end, provider.variables.join(",")].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  const url = new URL(request.url);
  url.pathname = `/api/environment/cache/${hash}`;
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

function normalize(body, query, provider) {
  const time = body?.hourly?.time;
  if (!Array.isArray(time) || !time.length || !time.every(value => !Number.isNaN(new Date(`${value}Z`).getTime()))) throw new Error("Open-Meteo returned invalid environmental timestamps");
  const variables = {
    temperature: body.hourly.temperature_2m,
    precipitation: body.hourly.precipitation,
    rain: body.hourly.rain,
    soilMoisture: body.hourly[provider.soilVariable],
    evapotranspiration: body.hourly.et0_fao_evapotranspiration
  };
  if (!Object.values(variables).every(values => validSeries(values, time.length))) throw new Error("Open-Meteo returned invalid environmental data");
  return {
    provider: "open-meteo",
    classification: "external model/reanalysis",
    dataset: provider.dataset,
    timezone: "UTC",
    location: {
      requested: { latitude: query.latitude, longitude: query.longitude },
      modelGrid: { latitude: Number(body.latitude), longitude: Number(body.longitude), elevation: Number(body.elevation) }
    },
    period: { start: query.start, end: query.end },
    units: { precipitation: "mm", rain: "mm", temperature: "°C", soilMoisture: "m³/m³", evapotranspiration: "mm" },
    soilMoistureDepth: provider.soilDepth,
    hourly: time.map((timestamp, index) => ({
      timestamp: `${timestamp}Z`,
      precipitation: variables.precipitation[index],
      rain: variables.rain[index],
      temperature: variables.temperature[index],
      soilMoisture: variables.soilMoisture[index],
      evapotranspiration: variables.evapotranspiration[index]
    }))
  };
}

async function fetchEnvironment(query) {
  const provider = providerFor(query);
  const url = new URL(provider.endpoint);
  url.searchParams.set("latitude", query.latitude);
  url.searchParams.set("longitude", query.longitude);
  url.searchParams.set("start_date", query.start);
  url.searchParams.set("end_date", query.end);
  url.searchParams.set("hourly", provider.variables.join(","));
  url.searchParams.set("timezone", "UTC");
  if (provider.model) url.searchParams.set("models", provider.model);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo environmental request failed (${response.status})`);
  return normalize(await response.json(), query, provider);
}

export async function routeEnvironmentRequest(request) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/environment") return null;
  if (request.method.toUpperCase() !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const startDate = parseDate(body?.start);
  const endDate = parseDate(body?.end);
  const rangeDays = startDate && endDate ? Math.round((endDate - startDate) / 86400000) : -1;
  if (body?.latitude == null || body?.longitude == null || !validCoordinate(latitude, longitude) || !startDate || !endDate || rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
    return json({ error: "Provide valid WGS84 coordinates and a 1-93 day UTC date range" }, 400);
  }
  const query = { latitude, longitude, start: body.start, end: body.end };
  try {
    const cache = caches.default;
    const key = await queryCacheKey(request, query);
    const cached = await cache.match(key);
    if (cached) return cached;
    const result = await fetchEnvironment(query);
    const response = json(result, 200, { "cache-control": "public, max-age=3600" });
    await cache.put(key, response.clone());
    return response;
  } catch (error) {
    console.error("Environmental provider failed", error);
    return json({ error: "Environmental data unavailable" }, 502);
  }
}