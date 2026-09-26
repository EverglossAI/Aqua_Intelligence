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
    const provider = providers.get(options.provider || "mapbox-terrain");
    if (!provider) return null;
    const key = `${provider.id}:${profileKey(line)}`;
    if (!profileCache.has(key)) profileCache.set(key, provider.fetchProfile(line, core).catch(error => {
      profileCache.delete(key);
      throw error;
    }));
    return profileCache.get(key);
  }

  register({
    id: "mapbox-terrain",
    async fetchProfile(line, core) {
      const points = core.sampleProfileLine(line);
      const response = await fetch("/api/elevation/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points })
      });
      if (!response.ok) throw new Error("Elevation data unavailable");
      const result = await response.json();
      return core.buildSampledElevationProfile(result.points, result.provenance);
    }
  });

  window.AquaElevationProviders = { fetchProfile, register };
})();