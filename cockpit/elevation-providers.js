(() => {
  "use strict";

  const providers = new Map();
  const profileCache = new Map();

  function profileKey(line) {
    return line.map(coordinate => coordinate.map(value => Number(value).toFixed(5)).join(",")).join(";");
  }

  function register(provider) {
    if (!provider?.id || typeof provider.fetchProfile !== "function") throw new Error("Elevation providers require an id and fetchProfile function.");
    providers.set(provider.id, provider);
  }

  async function fetchProfile(line, options = {}) {
    const core = window.AquaContextualCore;
    if (!core || !Array.isArray(line) || line.length < 2) return null;
    const provider = providers.get(options.provider || "open-meteo");
    if (!provider) return null;
    const key = `${provider.id}:${profileKey(line)}`;
    if (!profileCache.has(key)) profileCache.set(key, provider.fetchProfile(line, core).catch(error => {
      profileCache.delete(key);
      throw error;
    }));
    return profileCache.get(key);
  }

  register({
    id: "open-meteo",
    async fetchProfile(line, core) {
      const points = core.sampleProfileLine(line);
      const response = await fetch("/api/elevation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points })
      });
      if (!response.ok) throw new Error("Elevation data unavailable");
      const result = await response.json();
      if (result.provider !== "open-meteo" || result.dataset !== "Copernicus DEM GLO-90" || !Array.isArray(result.points) || result.points.length !== points.length) throw new Error("Elevation data unavailable");
      const samples = result.points.map((point, index) => ({
        lat: point.latitude,
        lng: point.longitude,
        distance: points[index].distance,
        elevation: point.elevation
      }));
      return core.buildSampledElevationProfile(samples, {
        source: "Open-Meteo",
        dataset: "Copernicus DEM GLO-90",
        resolution: `~${result.resolution_m} m`,
        units: result.units,
        kind: "external DEM",
        attribution: "Elevation: Copernicus DEM / Open-Meteo"
      });
    }
  });

  window.AquaElevationProviders = { fetchProfile, register };
})();