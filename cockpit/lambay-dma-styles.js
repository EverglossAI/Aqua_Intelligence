(() => {
  "use strict";

  const DEFAULT_STYLE = Object.freeze({
    fillColor: "#36a3ff",
    fillOpacity: 0.12,
    outlineColor: "#36a3ff",
    outlineWeight: 2.5,
    manuallyEdited: false
  });
  const DISTINCT_PALETTE = ["#2f80ed", "#f59e0b", "#22a06b", "#9b51e0", "#e0565b", "#00a6a6"];
  let selectedLogicalId = null;
  let saveTimer = null;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }

  function property(properties, names) {
    const keys = Object.keys(properties || {});
    for (const name of names) {
      const key = keys.find(candidate => candidate.toLowerCase() === name.toLowerCase());
      if (key && properties[key] !== "" && properties[key] != null) return properties[key];
    }
    return null;
  }

  function activeProject() {
    return state.active?.lambayDemo ? state.active : null;
  }

  function logicalDmas(project = activeProject()) {
    return project?.logicalDmas || project?.lambayDemo?.logicalDmas || [];
  }

  function styleForId(logicalId, project = activeProject()) {
    if (!logicalId) return { ...DEFAULT_STYLE };
    return { ...DEFAULT_STYLE, ...(project?.dmaStyles?.[logicalId] || {}) };
  }

  function logicalForFeature(feature, project = activeProject()) {
    if (!project || !feature) return null;
    const properties = feature.properties || {};
    const mappedId = properties.__aquaLogicalDmaId;
    const uid = property(properties, ["unific_id", "logical_dma_uid", "dma_uid"]);
    const code = property(properties, ["smallare_1", "dma_code"]);
    return logicalDmas(project).find(item => String(item.logical_dma_uid) === String(mappedId || uid || "") || String(item.dma_code) === String(code || "")) || null;
  }

  function featureStyle(feature) {
    const logical = logicalForFeature(feature);
    if (!logical) return null;
    const style = styleForId(logical.logical_dma_uid);
    return {
      color: style.outlineColor,
      weight: Number(style.outlineWeight),
      fillColor: style.fillColor,
      fillOpacity: Number(style.fillOpacity),
      opacity: 0.95
    };
  }

  function featureId(layer, feature, index) {
    const properties = feature.properties || {};
    const sourceId = property(properties, ["gid", "fid", "objectid", "id"]);
    return `${layer.name}:${sourceId == null ? index : sourceId}`;
  }

  function initialize(project, suppliedLogicalDmas) {
    if (!project) return false;
    const previousMappings = JSON.stringify(project.dmaFeatureMappings || []);
    const previousVersion = project.dmaStateVersion || 0;
    project.logicalDmas = Array.isArray(suppliedLogicalDmas) ? suppliedLogicalDmas : logicalDmas(project);
    project.dmaStyles ||= {};
    project.dmaDisplay ||= { visible: true };
    const mappings = [];
    (project.layers || []).filter(layer => layer.kind === "dma").forEach(layer => {
      (layer.geojson?.features || []).forEach((feature, index) => {
        const logical = logicalForFeature(feature, project);
        if (!logical) return;
        const gisFeatureId = featureId(layer, feature, index);
        feature.properties ||= {};
        feature.properties.__aquaGisFeatureId = gisFeatureId;
        feature.properties.__aquaLogicalDmaId = logical.logical_dma_uid;
        mappings.push({
          gisFeatureId,
          logicalDmaId: logical.logical_dma_uid,
          dmaCode: logical.dma_code,
          sourceLayer: layer.name,
          featureIndex: index
        });
        project.dmaStyles[logical.logical_dma_uid] ||= { ...DEFAULT_STYLE };
      });
    });
    project.dmaFeatureMappings = mappings;
    project.dmaStateVersion = 1;
    selectedLogicalId = selectedLogicalId && project.dmaStyles[selectedLogicalId] ? selectedLogicalId : project.logicalDmas[0]?.logical_dma_uid || null;
    renderPanel();
    return previousVersion !== 1 || previousMappings !== JSON.stringify(mappings);
  }

  function accentForCode(dmaCode) {
    const logical = logicalDmas().find(item => String(item.dma_code) === String(dmaCode));
    return styleForId(logical?.logical_dma_uid).fillColor;
  }

  function styleInputs(logicalId, compact = false) {
    const style = styleForId(logicalId);
    const opacity = Math.round(Number(style.fillOpacity) * 100);
    const disabled = window.AquaAuthorization?.canEdit() === false ? " disabled" : "";
    return `<div class="dma-style-fields ${compact ? "is-compact" : ""}" data-dma-style-id="${escape(logicalId)}">
      <label>Fill colour<input type="color" value="${escape(style.fillColor)}" data-dma-field="fillColor" aria-label="Fill colour"${disabled}></label>
      <label class="dma-opacity-control">Fill opacity<input type="range" min="0" max="100" step="1" value="${opacity}" data-dma-field="fillOpacity" aria-label="Fill opacity"${disabled}><output>${opacity}%</output></label>
      <label>Outline colour<input type="color" value="${escape(style.outlineColor)}" data-dma-field="outlineColor" aria-label="Outline colour"${disabled}></label>
      ${compact ? "" : `<label>Outline weight<input type="number" min="0" max="8" step="0.5" value="${Number(style.outlineWeight)}" data-dma-field="outlineWeight" aria-label="Outline weight"${disabled}></label>`}
      <button type="button" class="dma-reset-one" data-logical-id="${escape(logicalId)}"${disabled}>Reset style</button>
    </div>`;
  }

  function renderPanel() {
    const panel = document.getElementById("dmaStylePanel");
    const project = activeProject();
    if (!panel) return;
    if (!project || !logicalDmas(project).length) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    panel.classList.remove("hidden");
    const logicals = logicalDmas(project);
    const disabled = window.AquaAuthorization?.canEdit() === false ? " disabled" : "";
    if (!selectedLogicalId || !project.dmaStyles[selectedLogicalId]) selectedLogicalId = logicals[0].logical_dma_uid;
    const selected = logicals.find(item => item.logical_dma_uid === selectedLogicalId) || logicals[0];
    panel.innerHTML = `<div class="gis-row"><span>Logical DMA styles</span></div>
      <label>DMA<select id="dmaStyleSelect">${logicals.map(item => `<option value="${escape(item.logical_dma_uid)}" ${item.logical_dma_uid === selected.logical_dma_uid ? "selected" : ""}>${escape(item.label || item.dma_code)}</option>`).join("")}</select></label>
      ${styleInputs(selected.logical_dma_uid)}
      <div class="dma-project-actions">
        <button type="button" id="assignDmaColours"${disabled}>Assign distinct DMA colours</button>
        <label>All DMA fill opacity<input id="allDmaOpacity" type="range" min="0" max="100" step="1" value="${Math.round(styleForId(selected.logical_dma_uid).fillOpacity * 100)}"${disabled}><output>${Math.round(styleForId(selected.logical_dma_uid).fillOpacity * 100)}%</output></label>
        <button type="button" id="setAllDmaOpacity"${disabled}>Set all DMA opacity</button>
        <button type="button" id="resetAllDmaStyles"${disabled}>Reset DMA styles</button>
      </div>`;
  }

  function applyStyles() {
    const project = activeProject();
    if (!project) return;
    state.kindLayers?.dma?.eachLayer(wrapper => wrapper.eachLayer?.(polygon => {
      const base = featureStyle(polygon.__aquaFeature);
      if (!base || !polygon.setStyle) return;
      const selected = state.selected?.feature === polygon.__aquaFeature;
      polygon.setStyle(selected ? { ...base, color: "#ffffff", weight: Math.max(4, base.weight) } : base);
    }));
    renderTelemetry();
    if (state.selected?.layer?.kind === "dma") document.getElementById("selectionCard").innerHTML = aquaSelectionMarkup(state.selected.layer, state.selected.feature);
    window.AquaLambayDemo?.renderAnalysis();
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.AquaProjectPersistence?.save(activeProject(), { setActive: true }), 250);
  }

  async function flush() {
    clearTimeout(saveTimer);
    return window.AquaProjectPersistence?.save(activeProject(), { setActive: true });
  }

  function updateStyle(logicalId, field, value, persist = true) {
    if (window.AquaAuthorization?.canEdit() === false) return;
    const project = activeProject();
    if (!project?.dmaStyles?.[logicalId]) return;
    const parsed = field === "fillOpacity" ? Number(value) / 100 : field === "outlineWeight" ? Number(value) : value;
    project.dmaStyles[logicalId] = { ...styleForId(logicalId), [field]: parsed, manuallyEdited: true };
    applyStyles();
    if (persist) saveSoon();
  }

  function resetStyle(logicalId) {
    if (window.AquaAuthorization?.canEdit() === false) return;
    const project = activeProject();
    if (!project) return;
    project.dmaStyles[logicalId] = { ...DEFAULT_STYLE };
    renderPanel();applyStyles();saveSoon();
  }

  function assignDistinctColours() {
    if (window.AquaAuthorization?.canEdit() === false) return;
    const project = activeProject();
    if (!project) return;
    logicalDmas(project).forEach((logical, index) => {
      const current = styleForId(logical.logical_dma_uid, project);
      const colour = DISTINCT_PALETTE[index % DISTINCT_PALETTE.length];
      project.dmaStyles[logical.logical_dma_uid] = { ...current, fillColor: colour, outlineColor: colour, manuallyEdited: false };
    });
    renderPanel();applyStyles();saveSoon();
  }

  function setAllOpacity(percent) {
    if (window.AquaAuthorization?.canEdit() === false) return;
    const project = activeProject();
    if (!project) return;
    logicalDmas(project).forEach(logical => {
      const current = styleForId(logical.logical_dma_uid, project);
      project.dmaStyles[logical.logical_dma_uid] = { ...current, fillOpacity: Number(percent) / 100, manuallyEdited: true };
    });
    renderPanel();applyStyles();saveSoon();
  }

  function resetAllStyles() {
    if (window.AquaAuthorization?.canEdit() === false) return;
    const project = activeProject();
    if (!project) return;
    logicalDmas(project).forEach(logical => { project.dmaStyles[logical.logical_dma_uid] = { ...DEFAULT_STYLE }; });
    renderPanel();applyStyles();saveSoon();
  }

  function dmaSelectionMarkup(layer, feature) {
    const project = activeProject();
    const logical = logicalForFeature(feature, project);
    if (!project || !logical) return null;
    const properties = feature.properties || {};
    const gisFeatureId = properties.__aquaGisFeatureId || "Unknown source feature";
    const mappings = project.dmaFeatureMappings.filter(mapping => mapping.logicalDmaId === logical.logical_dma_uid);
    const assets = project.lambayDemo.assets.filter(asset => asset.dmaCode === logical.dma_code);
    const pressureCount = assets.filter(asset => asset.type === "pressure").length;
    const flowCount = assets.filter(asset => asset.type === "flow").length;
    const style = styleForId(logical.logical_dma_uid, project);
    return `<div class="selection-kicker"><small>SELECTED GIS REGION</small><span>DMA</span></div>
      <b class="selection-title"><i class="dma-colour-swatch" style="background:${escape(style.fillColor)}"></i>${escape(logical.label || logical.dma_code)}</b>
      <p class="selection-source">${escape(layer.name)} layer</p>
      <dl class="selection-grid dma-selection-grid">
        <div><dt>Logical DMA</dt><dd>${escape(logical.label || logical.dma_code)}</dd></div>
        <div><dt>GIS regions</dt><dd>${mappings.length}</dd></div>
        <div class="selection-wide"><dt>Selected feature</dt><dd>${escape(gisFeatureId)}</dd></div>
        <div><dt>Source layer</dt><dd>${escape(layer.name)}</dd></div>
        <div><dt>DMA style</dt><dd>${escape(style.fillColor)} · ${Math.round(style.fillOpacity * 100)}%</dd></div>
        <div><dt>Pressure loggers</dt><dd>${pressureCount}</dd></div>
        <div><dt>DMA inlet meter</dt><dd>${flowCount}</dd></div>
      </dl>
      <div class="selection-dma-style"><b>DMA style</b>${styleInputs(logical.logical_dma_uid, true)}</div>`;
  }

  const baseSelectionMarkup = aquaSelectionMarkup;
  aquaSelectionMarkup = function(layer, feature) {
    if (layer?.kind === "dma") {
      const markup = dmaSelectionMarkup(layer, feature);
      if (markup) return markup;
    }
    return baseSelectionMarkup(layer, feature);
  };

  document.addEventListener("change", event => {
    const target = event.target;
    if (target.id === "dmaStyleSelect") { selectedLogicalId = target.value;renderPanel();return; }
    if (target.matches("[data-dma-field]")) {
      const logicalId = target.closest("[data-dma-style-id]")?.dataset.dmaStyleId;
      if (logicalId) updateStyle(logicalId, target.dataset.dmaField, target.value);
    }
  });

  document.addEventListener("input", event => {
    const target = event.target;
    if (target.matches('[data-dma-field="fillOpacity"]')) {
      target.parentElement.querySelector("output").value = `${target.value}%`;
      const logicalId = target.closest("[data-dma-style-id]")?.dataset.dmaStyleId;
      if (logicalId) updateStyle(logicalId, "fillOpacity", target.value, false);
    }
    if (target.id === "allDmaOpacity") target.parentElement.querySelector("output").value = `${target.value}%`;
  });

  document.addEventListener("click", event => {
    const reset = event.target.closest(".dma-reset-one");
    if (reset) { resetStyle(reset.dataset.logicalId);return; }
    if (event.target.closest("#assignDmaColours")) { assignDistinctColours();return; }
    if (event.target.closest("#setAllDmaOpacity")) { setAllOpacity(document.getElementById("allDmaOpacity").value);return; }
    if (event.target.closest("#resetAllDmaStyles")) resetAllStyles();
  });

  window.AquaDmaStyles = {
    initialize,forFeature:featureStyle,accentForCode,logicalForFeature,apply:applyStyles,flush,render:renderPanel,
    get mappings() { return activeProject()?.dmaFeatureMappings || []; },
    get styles() { return activeProject()?.dmaStyles || {}; }
  };
})();
