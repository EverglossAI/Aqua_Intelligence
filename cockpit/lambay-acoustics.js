(() => {
  "use strict";

  const DATA_URL = "../projects/lambay-island/acoustic/lambay-acoustic-operational-data.json";
  const LAYER_NAMES = ["sensors", "couples", "active", "located", "closed"];
  const COLORS = { sensor: "#48d5ad", couple: "#58a6d8", active: "#ff5d6c", located: "#f2cf5b", closed: "#8999a5" };
  let loadingProjectId = null;
  let highlightedPipes = [];

  function acousticProject() {
    const project = state.active;
    return project && /lambay/i.test(`${project.id || ""} ${project.name || ""}`) ? project : null;
  }

  function escape(value) {
    return escapeHtml(value == null || value === "" ? "-" : value);
  }

  function formatNumber(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "-";
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function ensureLayers() {
    if (state.acousticLayers || !state.map) return;
    state.acousticLayers = Object.fromEntries(LAYER_NAMES.map(name => [name, L.layerGroup()]));
    state.acousticMarkers = { sensors: new Map(), couples: new Map(), alerts: new Map() };
    state.acousticVisibility ||= { sensors: true, couples: true, active: true, located: true, closed: false };
  }

  function syncControls() {
    LAYER_NAMES.forEach(name => {
      const checkbox = document.querySelector(`[data-acoustic-toggle="${name}"]`);
      if (checkbox) checkbox.checked = state.acousticVisibility?.[name] !== false;
    });
  }

  function applyVisibility() {
    ensureLayers();
    LAYER_NAMES.forEach(name => {
      const layer = state.acousticLayers?.[name];
      if (!layer) return;
      const visible = state.acousticVisibility[name] !== false;
      if (visible && !state.map.hasLayer(layer)) layer.addTo(state.map);
      if (!visible && state.map.hasLayer(layer)) state.map.removeLayer(layer);
      if (visible) layer.eachLayer(item => item.bringToFront?.());
    });
    syncControls();
  }

  function bindControls() {
    document.querySelectorAll("[data-acoustic-toggle]").forEach(checkbox => {
      if (checkbox.dataset.acousticBound) return;
      checkbox.dataset.acousticBound = "true";
      checkbox.onchange = () => {
        ensureLayers();
        state.acousticVisibility[checkbox.dataset.acousticToggle] = checkbox.checked;
        applyVisibility();
      };
    });
  }

  function sensors() { return acousticProject()?.acousticSensor || []; }
  function couples() { return acousticProject()?.acousticCouple || []; }
  function alerts() { return acousticProject()?.acousticAlert || []; }
  function sensorById(id) { return sensors().find(item => item.sensorId === String(id)); }
  function coupleById(id) { return couples().find(item => item.coupleId === String(id)); }

  function pipeId(feature) {
    const properties = feature?.properties || {};
    return String(properties.unific_id || properties.gid || properties.fid || properties.pipe_id || "");
  }

  function pipeForId(id) {
    for (const layer of acousticProject()?.layers || []) {
      if (layer.kind !== "pipe") continue;
      const feature = (layer.geojson?.features || []).find(item => pipeId(item) === String(id));
      if (feature) return feature;
    }
    return null;
  }

  function pipeProperties(id) {
    return pipeForId(id)?.properties || {};
  }

  function resetHighlights() {
    for (const marker of state.acousticMarkers?.sensors?.values() || []) marker.setStyle({ radius: 7, weight: 2, color: "#d9fff5", fillColor: COLORS.sensor, fillOpacity: .92 });
    for (const line of state.acousticMarkers?.couples?.values() || []) line.setStyle({ color: COLORS.couple, weight: 3, opacity: .72 });
    for (const layer of highlightedPipes) {
      try { layer.setStyle(aquaFeatureStyle("pipe", layer.__aquaFeature)); } catch {}
    }
    highlightedPipes = [];
  }

  function highlightSensors(ids) {
    ids.filter(Boolean).forEach(id => state.acousticMarkers?.sensors?.get(String(id))?.setStyle({ radius: 10, weight: 4, color: "#ffffff", fillColor: COLORS.sensor, fillOpacity: 1 }));
  }

  function highlightCouples(ids) {
    ids.filter(Boolean).forEach(id => state.acousticMarkers?.couples?.get(String(id))?.setStyle({ color: "#ffffff", weight: 6, opacity: 1 }));
  }

  function highlightPipes(ids) {
    const wanted = new Set(ids.filter(Boolean).map(String));
    state.kindLayers?.pipe?.eachLayer(wrapper => wrapper.eachLayer?.(layer => {
      if (!wanted.has(pipeId(layer.__aquaFeature))) return;
      layer.setStyle?.({ color: "#fff06a", weight: 7, opacity: 1 });
      layer.bringToFront?.();
      highlightedPipes.push(layer);
    }));
  }

  function evidence(entity) {
    const properties = pipeProperties(entity.matchedPipeId);
    const material = properties.pipe_mtr || properties.material || "-";
    const diameter = properties.pipe_size || properties.diameter || "-";
    const nearestPressure = (acousticProject()?.telemetry || []).filter(item => item.type === "pressure").map(item => ({
      item,
      distance: V23?.dist ? V23.dist([entity.lat, entity.lng], [Number(item.lat), Number(item.lng)]) : Infinity
    })).sort((left, right) => left.distance - right.distance)[0];
    let dma = "-";
    for (const layer of acousticProject()?.layers || []) {
      if (layer.kind !== "dma") continue;
      const feature = (layer.geojson?.features || []).find(item => aquaPointInPolygon([entity.lat, entity.lng], item));
      if (feature) {
        dma = aquaSelectionValue(feature.properties || {}, ["smallare_1", "dma_code", "name"])?.value || layer.name;
        break;
      }
    }
    return `<div class="acoustic-evidence"><b>Cross-analysis context</b><dl class="selection-grid">
      <div><dt>DMA</dt><dd>${escape(dma)}</dd></div>
      <div><dt>Pipe material</dt><dd>${escape(material)}</dd></div>
      <div><dt>Pipe diameter</dt><dd>${escape(diameter)} mm</dd></div>
      <div><dt>Nearest pressure</dt><dd>${nearestPressure ? `${escape(nearestPressure.item.id)} (${formatNumber(nearestPressure.distance, 0)} m)` : "-"}</dd></div>
      <div><dt>Hydraulic context</dt><dd>${acousticProject()?.latestHydraulicModel ? escape(acousticProject().latestHydraulicModel.scenarioId) : "No retained run"}</dd></div>
      <div><dt>Historical alerts</dt><dd>${alerts().filter(item => item.stateGroup === "historical" && item.matchedPipeId === entity.matchedPipeId).length}</dd></div>
    </dl><p>Evidence for review only. Acoustic records are not hydraulic calibration data or automatic proof of leakage.</p></div>`;
  }

  function sourceMarkup(entity) {
    return `<p class="selection-source">Imported operational data | ${escape(entity.source?.filename)} | row ${escape(entity.source?.sourceRow)}</p>`;
  }

  function selectSensor(sensor) {
    resetHighlights();
    const connected = couples().filter(item => item.sensor1Id === sensor.sensorId || item.sensor2Id === sensor.sensorId);
    highlightSensors([sensor.sensorId]);
    highlightCouples(connected.map(item => item.coupleId));
    highlightPipes([sensor.matchedPipeId]);
    $("selectionCard").innerHTML = `<div class="selection-kicker"><small>ACOUSTIC SENSOR</small><span>${escape(sensor.status)}</span></div>
      <b class="selection-title">${escape(sensor.sensorId)}</b>${sourceMarkup(sensor)}
      <dl class="selection-grid">
        <div><dt>Device</dt><dd>${escape(sensor.deviceId)}</dd></div><div><dt>Type</dt><dd>${escape(sensor.deviceType)}</dd></div>
        <div><dt>Asset / SOP</dt><dd>${escape(sensor.assetId)} / ${escape(sensor.sopId)}</dd></div><div><dt>Battery</dt><dd>${formatNumber(sensor.battery, 2)} V</dd></div>
        <div><dt>Signal RSRP / RSRQ</dt><dd>${formatNumber(sensor.signals?.g5Rsrp, 0)} / ${formatNumber(sensor.signals?.g5Rsrq, 1)}</dd></div><div><dt>Intensity F / min / sampled</dt><dd>${formatNumber(sensor.intensity?.filtered, 0)} / ${formatNumber(sensor.intensity?.minimal, 0)} / ${formatNumber(sensor.intensity?.sampled, 0)}</dd></div>
        <div><dt>Installed</dt><dd>${escape(formatDate(sensor.installationDate))}</dd></div><div><dt>Last active</dt><dd>${escape(formatDate(sensor.lastActive))}</dd></div>
        <div><dt>Last communication</dt><dd>${escape(formatDate(sensor.lastCommunication))}</dd></div><div><dt>Coordinates</dt><dd>${formatNumber(sensor.lat, 6)}, ${formatNumber(sensor.lng, 6)}</dd></div>
        <div><dt>Matched pipe</dt><dd>${escape(sensor.matchedPipeId)}</dd></div><div><dt>GIS match</dt><dd>${formatNumber(sensor.matchDistance)} m | ${Math.round(sensor.confidence * 100)}%${sensor.reviewRequired ? " | Review" : ""}</dd></div>
        <div class="selection-wide"><dt>Connected couples</dt><dd>${escape(connected.map(item => item.coupleId).join(", "))}</dd></div>
        <div class="selection-wide"><dt>Address</dt><dd>${escape(sensor.address)}</dd></div>
      </dl>${evidence(sensor)}`;
    window.dispatchEvent(new CustomEvent("aqua:selection", { detail: { kind: "acoustic-sensor", entity: sensor, leaflet: state.acousticMarkers?.sensors?.get(sensor.sensorId) } }));
  }

  function selectCouple(couple) {
    resetHighlights();
    const linkedAlerts = alerts().filter(item => item.coupleId === couple.coupleId || item.relationships?.some(link => link.coupleId === couple.coupleId));
    const first = sensorById(couple.sensor1Id), second = sensorById(couple.sensor2Id);
    highlightSensors([couple.sensor1Id, couple.sensor2Id]);
    highlightCouples([couple.coupleId]);
    highlightPipes([first?.matchedPipeId, second?.matchedPipeId, ...linkedAlerts.map(item => item.matchedPipeId)]);
    $("selectionCard").innerHTML = `<div class="selection-kicker"><small>SENSOR COUPLE</small><span>${couple.overlapping ? "OVERLAP" : "CURRENT"}</span></div>
      <b class="selection-title">${escape(couple.coupleId)}</b>${sourceMarkup(couple)}
      <dl class="selection-grid"><div><dt>Sensor 1</dt><dd>${escape(couple.sensor1Id)}</dd></div><div><dt>Sensor 2</dt><dd>${escape(couple.sensor2Id)}</dd></div>
        <div><dt>Material</dt><dd>${escape(couple.material)}</dd></div><div><dt>Path length</dt><dd>${formatNumber(couple.pathLength, 0)} m</dd></div>
        <div><dt>Last activity</dt><dd>${escape(formatDate(couple.lastActivity))}</dd></div><div><dt>Related alerts</dt><dd>${linkedAlerts.length}</dd></div>
        <div class="selection-wide"><dt>Alert IDs</dt><dd>${escape(linkedAlerts.map(item => `${item.alertId} (${item.status})`).join(", "))}</dd></div></dl>`;
  }

  function selectAlert(alert) {
    resetHighlights();
    const couple = coupleById(alert.coupleId);
    const sensorIds = couple ? [couple.sensor1Id, couple.sensor2Id] : [alert.sensor1Id, alert.sensor2Id];
    highlightSensors(sensorIds);
    highlightCouples([alert.coupleId]);
    highlightPipes([alert.matchedPipeId]);
    $("selectionCard").innerHTML = `<div class="selection-kicker"><small>ACOUSTIC ALERT</small><span>${escape(alert.status)}</span></div>
      <b class="selection-title">${escape(alert.alertId)} | ${escape(alert.alertType)}</b>${sourceMarkup(alert)}
      <dl class="selection-grid"><div><dt>Probability</dt><dd>${formatNumber(alert.probability, 0)}%</dd></div><div><dt>Priority / status</dt><dd>${escape(alert.priority)} / ${escape(alert.status)}</dd></div>
        <div><dt>Detection age</dt><dd>${formatNumber(alert.daysDetected, 0)} days</dd></div><div><dt>Detected / closed</dt><dd>${escape(formatDate(alert.detectionDate))} / ${escape(formatDate(alert.closureDate))}</dd></div>
        <div><dt>Couple</dt><dd>${escape(alert.coupleId)}</dd></div><div><dt>Sensors</dt><dd>${sensorIds.some(Boolean) ? escape(sensorIds.filter(Boolean).join(" / ")) : "Unavailable in report"}</dd></div>
        <div><dt>Matched pipe</dt><dd>${escape(alert.matchedPipeId)}</dd></div><div><dt>GIS match</dt><dd>${formatNumber(alert.matchDistance)} m | ${Math.round(alert.confidence * 100)}%${alert.reviewRequired ? " | Review" : ""}</dd></div>
        <div><dt>Distances M / F</dt><dd>${formatNumber(alert.distances?.metres, 1)} / ${formatNumber(alert.distances?.feet, 1)}</dd></div><div><dt>Repair evidence</dt><dd>${escape(alert.repair?.essence)}</dd></div>
        <div class="selection-wide"><dt>Comments</dt><dd>${escape(alert.comments)}</dd></div><div class="selection-wide"><dt>Duplicate / shadow links</dt><dd>${escape((alert.relationships || []).map(item => `${item.type} ${item.alertId}${item.coupleId ? ` (couple ${item.coupleId})` : ""}`).join(", "))}</dd></div>
      </dl>${evidence(alert)}`;
    window.dispatchEvent(new CustomEvent("aqua:selection", { detail: { kind: "acoustic-alert", entity: alert, leaflet: state.acousticMarkers?.alerts?.get(alert.alertId) } }));
  }

  function renderMap() {
    ensureLayers();
    if (!state.acousticLayers) return;
    Object.values(state.acousticLayers).forEach(layer => layer.clearLayers());
    state.acousticMarkers = { sensors: new Map(), couples: new Map(), alerts: new Map() };
    if (!acousticProject()?.acousticSensor?.length) return applyVisibility();
    const byId = new Map(sensors().map(sensor => [sensor.sensorId, sensor]));
    sensors().forEach(sensor => {
      const marker = L.circleMarker([sensor.lat, sensor.lng], { radius: 7, weight: 2, color: "#d9fff5", fillColor: COLORS.sensor, fillOpacity: .92 })
        .bindTooltip(`Sensor ${sensor.sensorId} | ${sensor.status}`);
      marker.on("click", () => selectSensor(sensor));
      marker.addTo(state.acousticLayers.sensors);
      state.acousticMarkers.sensors.set(sensor.sensorId, marker);
    });
    couples().forEach(couple => {
      const first = byId.get(couple.sensor1Id), second = byId.get(couple.sensor2Id);
      if (!first || !second) return;
      const line = L.polyline([[first.lat, first.lng], [second.lat, second.lng]], { color: COLORS.couple, weight: 3, opacity: .72, dashArray: "7 5" })
        .bindTooltip(`Couple ${couple.coupleId} | ${couple.pathLength} m | ${couple.material}`);
      line.on("click", () => selectCouple(couple));
      line.addTo(state.acousticLayers.couples);
      state.acousticMarkers.couples.set(couple.coupleId, line);
    });
    alerts().forEach(alert => {
      const layerName = alert.status === "Located" ? "located" : alert.stateGroup === "historical" ? "closed" : "active";
      const marker = L.circleMarker([alert.lat, alert.lng], { radius: layerName === "closed" ? 5 : 8, weight: 2, color: "#07131b", fillColor: COLORS[layerName], fillOpacity: layerName === "closed" ? .68 : .96 })
        .bindTooltip(`Alert ${alert.alertId} | ${alert.alertType} | ${alert.status} | ${alert.probability}%`);
      marker.on("click", () => selectAlert(alert));
      marker.addTo(state.acousticLayers[layerName]);
      state.acousticMarkers.alerts.set(alert.alertId, marker);
    });
    applyVisibility();
  }

  function renderAnalytics() {
    const panel = $("acousticOperationsResults");
    if (!panel) return;
    const project = acousticProject();
    if (!project?.acousticSummary) {
      panel.innerHTML = '<div class="empty-row">Open Lambay Island to load imported acoustic operations.</div>';
      return;
    }
    const summary = project.acousticSummary;
    const metrics = [
      ["Sensors", summary.totalLambaySensors], ["Active sensors", summary.activeSensors], ["Couples", summary.couples],
      ["Active alerts", summary.activeAlerts], ["Historical", summary.historicalAlerts], ["Leak alerts", summary.leakAlerts],
      ["Consumption", summary.consumptionAlerts], ["Repeat couples", summary.repeatAlertCouples], ["High intensity", summary.highIntensitySensors],
      ["Comms / battery", summary.communicationBatteryWarnings]
    ];
    panel.innerHTML = `<div class="operational-notice"><b>Imported operational acoustic data</b><span>Report date 2026-09-26 | source files and row provenance retained</span></div>
      <div class="metric-cards acoustic-metrics">${metrics.map(([label, count]) => `<div><span>${label}</span><b>${count}</b></div>`).join("")}</div>
      <p class="analysis-method">Active includes New, Reopen and Located. Closed records remain historical. Consumption, duplicate and shadow alerts are retained. No false-positive or confirmed-leak rate is inferred.</p>
      <table class="telemetry-table"><thead><tr><th>Alert</th><th>Type</th><th>Status</th><th>Probability</th><th>Couple</th><th>GIS match</th></tr></thead><tbody>${alerts().map(alert => `<tr data-acoustic-alert="${escape(alert.alertId)}" tabindex="0"><td>${escape(alert.alertId)}</td><td>${escape(alert.alertType)}</td><td>${escape(alert.status)}</td><td>${formatNumber(alert.probability, 0)}%</td><td>${escape(alert.coupleId)}</td><td>${formatNumber(alert.matchDistance)} m | ${Math.round(alert.confidence * 100)}%${alert.reviewRequired ? " review" : ""}</td></tr>`).join("")}</tbody></table>`;
    panel.querySelectorAll("[data-acoustic-alert]").forEach(row => {
      const activate = () => selectAlert(alerts().find(item => item.alertId === row.dataset.acousticAlert));
      row.onclick = activate;
      row.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } };
    });
  }

  function updateCounts() {
    const project = acousticProject();
    const count = project?.acousticSensor?.length || 0;
    if ($("acousticCount")) $("acousticCount").textContent = count;
    if ($("acousticStatus")) $("acousticStatus").textContent = count ? `${count} operational` : "No stream";
  }

  async function load(project) {
    if (!project || !/lambay/i.test(`${project.id || ""} ${project.name || ""}`)) return;
    if (project.acousticSensor?.length) return;
    if (loadingProjectId === project.id) return;
    loadingProjectId = project.id;
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error("Operational acoustic data could not be loaded");
      Object.assign(project, await response.json());
      if (state.active === project) {
        renderMap();
        renderAnalytics();
        updateCounts();
        window.AquaComparison?.render();
        window.AquaLeakRisk?.render();
      }
    } catch (error) {
      console.warn(error.message);
    } finally {
      loadingProjectId = null;
    }
  }

  const baseRenderProject = renderProject;
  renderProject = function() {
    baseRenderProject();
    bindControls();
    if (!acousticProject()) {
      Object.values(state.acousticLayers || {}).forEach(layer => { layer.clearLayers(); state.map?.removeLayer(layer); });
      renderAnalytics();
      updateCounts();
      return;
    }
    if (acousticProject().acousticSensor?.length) {
      renderMap();
      renderAnalytics();
      updateCounts();
    } else {
      load(acousticProject());
    }
  };

  window.AquaAcoustics = { renderMap, renderAnalytics, selectSensor, selectCouple, selectAlert };
  bindControls();
})();