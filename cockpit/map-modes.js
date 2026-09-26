(() => {
  "use strict";

  const MODE_IDS = ["inspect", "topology", "dma", "acoustic", "prv", "air"];
  let summary = {};

  function selectedLayer() {
    return state.selected?.leaflet || window.AquaInvestigationContext?.current?.selectedAsset?.leaflet || null;
  }

  function modeStyle(kind, feature, base) {
    const mode = state.mapMode || "inspect";
    if (mode === "inspect") return base;
    if (mode === "topology") return { ...base, opacity: Math.min(base.opacity ?? 1, .2), fillOpacity: Math.min(base.fillOpacity ?? .2, .06) };
    if (mode === "dma") return kind === "dma"
      ? { ...base, weight: Math.max(4, base.weight || 0), opacity: 1, fillOpacity: Math.max(.24, base.fillOpacity || 0) }
      : { ...base, opacity: Math.min(base.opacity ?? 1, .28), fillOpacity: Math.min(base.fillOpacity ?? .2, .12) };
    if (mode === "acoustic") return { ...base, opacity: Math.min(base.opacity ?? 1, kind === "pipe" ? .34 : .18), fillOpacity: Math.min(base.fillOpacity ?? .2, .08) };
    if (mode === "prv" || mode === "air") {
      const match = window.AquaMapModeCore?.operationalAssetType(feature) === mode;
      return match
        ? { ...base, color: mode === "prv" ? "#ffbe55" : "#63d8ef", fillColor: mode === "prv" ? "#ffbe55" : "#63d8ef", weight: 5, opacity: 1, fillOpacity: .95 }
        : { ...base, opacity: Math.min(base.opacity ?? 1, .16), fillOpacity: Math.min(base.fillOpacity ?? .2, .06) };
    }
    return base;
  }

  function restyleNetwork() {
    Object.entries(state.kindLayers || {}).forEach(([kind, group]) => group.eachLayer?.(wrapper => wrapper.eachLayer?.(layer => {
      if (layer.__aquaFeature && layer.setStyle) layer.setStyle(aquaFeatureStyle(kind, layer.__aquaFeature));
    })));
    const selected = selectedLayer();
    selected?.setStyle?.({ color: "#ffffff", weight: 5, fillOpacity: .35, opacity: 1 });
    selected?.bringToFront?.();
  }

  function styleOperationalLayers() {
    const acoustic = state.mapMode === "acoustic";
    const dma = state.mapMode === "dma";
    const selectedDma = window.AquaInvestigationContext?.current?.selectedDMA;
    const linkedToDma = entity => {
      if (!selectedDma || !entity) return false;
      const entityCode = entity.dmaCode ?? entity.dma_code ?? entity.dma;
      if (entityCode != null && String(entityCode) === String(selectedDma.code)) return true;
      if (entity.sensor1Id || entity.sensor2Id) {
        const sensorIds = new Set([entity.sensor1Id, entity.sensor2Id].filter(Boolean).map(String));
        return (state.active?.acousticSensor || []).some(sensor => sensorIds.has(String(sensor.sensorId)) && linkedToDma(sensor));
      }
      const coordinate = window.AquaContextualCore?.entityCoordinate("telemetry", entity);
      return Boolean(coordinate && selectedDma.features?.some(feature => window.AquaContextualCore.pointInFeature(coordinate, feature)));
    };
    Object.entries(state.acousticLayers || {}).forEach(([name, group]) => group.eachLayer?.(layer => {
      if (!layer.setStyle) return;
      const linked = dma && linkedToDma(layer.__aquaAcoustic);
      if (name === "sensors") layer.setStyle({ radius: acoustic || linked ? 9 : 7, weight: acoustic || linked ? 3 : 2, opacity: dma ? (linked ? 1 : .18) : acoustic ? 1 : .72, fillOpacity: dma ? (linked ? 1 : .12) : acoustic ? .98 : .82 });
      else layer.setStyle({ weight: acoustic || linked ? (name === "couples" ? 4 : 3) : (name === "couples" ? 3 : 2), opacity: dma ? (linked ? 1 : .14) : acoustic ? 1 : .72, fillOpacity: dma ? (linked ? .96 : .1) : acoustic ? .96 : .72 });
      if (acoustic || linked) layer.bringToFront?.();
    }));
    Object.values(state.telemetryKindLayers || {}).forEach(group => group.eachLayer?.(layer => {
      const linked = dma && linkedToDma(layer.__aquaTelemetry);
      layer.setStyle?.({ radius: linked ? 9 : 7, weight: linked ? 3 : 2, opacity: dma ? (linked ? 1 : .18) : .8, fillOpacity: dma ? (linked ? 1 : .12) : .9 });
      layer.setOpacity?.(dma ? (linked ? 1 : .18) : 1);
      if (linked) layer.bringToFront?.();
    }));
    const selected = selectedLayer();
    selected?.setStyle?.({ color: "#ffffff", weight: 5, fillOpacity: 1, opacity: 1 });
    selected?.bringToFront?.();
  }

  function nodeCoordinate(node) {
    const coordinate = node?.coord || node?.coordinate;
    return Array.isArray(coordinate) && coordinate.length >= 2 ? coordinate : null;
  }

  function renderTopology() {
    state.mapModeLayer ||= L.layerGroup();
    state.mapModeLayer.clearLayers();
    if (state.mapMode !== "topology" || !summary.topology?.topology) {
      if (state.map?.hasLayer(state.mapModeLayer)) state.map.removeLayer(state.mapModeLayer);
      return;
    }
    const topology = summary.topology.topology;
    const nodes = topology.nodes || [];
    (topology.edges || []).forEach(edge => {
      const left = nodeCoordinate(nodes[typeof edge.a === "number" ? edge.a : edge.from]) || edge.start || edge.coordinates?.[0];
      const right = nodeCoordinate(nodes[typeof edge.b === "number" ? edge.b : edge.to]) || edge.end || edge.coordinates?.at?.(-1);
      if (left && right) L.polyline([left, right], { color: "#67d5ea", weight: 2.5, opacity: .82 }).addTo(state.mapModeLayer);
    });
    nodes.forEach(node => {
      const coordinate = nodeCoordinate(node);
      if (!coordinate) return;
      const review = Boolean(node.reviewRequired || node.review_required);
      const degree = Number(node.degree || 0);
      L.circleMarker(coordinate, { radius: review ? 6 : degree >= 3 ? 4.5 : 3, color: review ? "#ffbe55" : degree === 1 ? "#ff7482" : "#67d5ea", fillColor: review ? "#ffbe55" : "#67d5ea", fillOpacity: .95, weight: 2 }).bindTooltip(review ? "Topology review required" : `Topology node · degree ${degree}`).addTo(state.mapModeLayer);
    });
    const reviewItems = Array.isArray(topology.reviewItems) ? topology.reviewItems : Array.isArray(topology.reviewRequired) ? topology.reviewRequired : [];
    reviewItems.forEach(item => {
      const coordinate = nodeCoordinate(item);
      if (coordinate) L.circleMarker(coordinate, { radius: 7, color: "#ffbe55", fillOpacity: 0, weight: 3 }).bindTooltip("Topology review required").addTo(state.mapModeLayer);
    });
    state.mapModeLayer.addTo(state.map);
    state.mapModeLayer.eachLayer(layer => layer.bringToFront?.());
  }

  function updateControls() {
    MODE_IDS.forEach(mode => {
      const button = document.querySelector(`[data-map-mode="${mode}"]`);
      const modeSummary = summary[mode];
      if (!button || !modeSummary) return;
      button.disabled = !modeSummary.enabled;
      button.classList.toggle("active", state.mapMode === mode);
      button.title = modeSummary.detail;
      const count = button.querySelector("[data-mode-count]");
      if (count) count.textContent = mode === "inspect" ? "" : String(modeSummary.count || 0);
    });
    const current = summary[state.mapMode] || summary.inspect;
    const indicator = document.getElementById("mapModeIndicator");
    if (indicator && current) indicator.innerHTML = `<b>Map mode: ${escapeHtml(current.label)}</b><span>${escapeHtml(current.detail)}</span>`;
  }

  function refresh() {
    summary = window.AquaMapModeCore?.mapModeSummary(state.active || {}) || {};
    if (!summary[state.mapMode]?.enabled) state.mapMode = "inspect";
    updateControls();
    renderTopology();
    restyleNetwork();
    styleOperationalLayers();
  }

  function activate(mode) {
    if (!MODE_IDS.includes(mode)) return false;
    summary = window.AquaMapModeCore?.mapModeSummary(state.active || {}) || {};
    if (!summary[mode]?.enabled) return false;
    state.mapMode = mode;
    updateControls();
    renderTopology();
    restyleNetwork();
    styleOperationalLayers();
    window.dispatchEvent(new CustomEvent("aqua:map-mode-changed", { detail: { mode, summary: summary[mode] } }));
    return true;
  }

  const baseUpdateProjectUI = updateProjectUI;
  updateProjectUI = function() {
    baseUpdateProjectUI();
    refresh();
  };

  document.querySelectorAll("[data-map-mode]").forEach(button => button.addEventListener("click", () => activate(button.dataset.mapMode)));
  window.addEventListener("aqua:project-activated", () => setTimeout(refresh, 0));
  window.AquaMapModes = { activate, refresh, style: modeStyle, get summary() { return summary; } };
  window.addEventListener("load", refresh);
})();