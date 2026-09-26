(() => {
  "use strict";

  const DEMO_ROOT = "../projects/lambay-island/demo/";
  const DEMO_SOURCE = "synthetic/demo";
  const DMA_LABELS = {
    "1350-00-01-01": "Baisha",
    "1350-00-01-02": "Danan",
    "1350-00-01-03": "Shangshan",
    "1350-00-01-04": "Tianfu"
  };
  const PRESSURE_COLORS = {
    critical: "#ff5d6c",
    low: "#ff9f43",
    watch: "#f2cf5b",
    normal: "#52c788",
    high: "#4ba3ff"
  };
  let loadingProjectId = null;
  let selectedDmaCode = null;
  let analysisMode = "pressure";

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  function roleLabel(role) {
    if (String(role).includes("inlet")) return "inlet";
    if (String(role).includes("mid")) return "mid-zone";
    return "distal";
  }

  function pressureClass(value) {
    if (value < 20) return "critical";
    if (value < 25) return "low";
    if (value < 30) return "watch";
    if (value <= 40) return "normal";
    return "high";
  }

  function isLambayProject(project) {
    return Boolean(project && /lambay/i.test(project.name || "") && featureCount(project, "pipe") === 3165 && featureCount(project, "dma") === 8);
  }

  function parseTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isNight(row) {
    const date = parseTimestamp(row.timestamp);
    return date && date.getHours() >= 1 && date.getHours() < 5;
  }

  function isPeak(row) {
    const date = parseTimestamp(row.timestamp);
    if (!date) return false;
    const hour = date.getHours();
    return (hour >= 6 && hour < 10) || (hour >= 17 && hour < 21);
  }

  function format(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : "—";
  }

  function demo() {
    return state.active?.lambayDemo || null;
  }

  function telemetryAssets(type) {
    return (demo()?.assets || []).filter(asset => asset.type === type);
  }

  function readingsFor(asset) {
    return Array.isArray(asset?.readings) ? asset.readings : [];
  }

  function summarizePressureAsset(asset) {
    const readings = readingsFor(asset);
    const values = readings.map(row => number(row.pressure)).filter(Number.isFinite);
    const latest = readings[readings.length - 1] || null;
    return {
      id: asset.id,
      dmaCode: asset.dmaCode,
      dmaLabel: asset.dmaLabel,
      role: asset.role,
      latest: latest ? number(latest.pressure) : null,
      latestTimestamp: latest?.timestamp || null,
      min: values.length ? Math.min(...values) : null,
      average: mean(values),
      max: values.length ? Math.max(...values) : null,
      below20: values.filter(value => value < 20).length,
      below25: values.filter(value => value < 25).length,
      count: values.length
    };
  }

  function summarizeFlowAsset(asset) {
    const readings = readingsFor(asset);
    const values = readings.map(row => number(row.flow)).filter(Number.isFinite);
    const nightValues = readings.filter(isNight).map(row => number(row.flow)).filter(Number.isFinite);
    const latest = readings[readings.length - 1] || null;
    const dailyNight = new Map();
    readings.filter(isNight).forEach(row => {
      const day = row.timestamp.slice(0, 10);
      if (!dailyNight.has(day)) dailyNight.set(day, []);
      dailyNight.get(day).push(number(row.flow));
    });
    const nightMeans = [...dailyNight.entries()].map(([day, rows]) => ({ day, value: mean(rows.filter(Number.isFinite)) }));
    const trend = nightMeans.length > 1 ? nightMeans[nightMeans.length - 1].value - nightMeans[0].value : 0;
    const average = mean(values);
    const mnf = nightValues.length ? Math.min(...nightValues) : null;
    return {
      id: asset.id,
      dmaCode: asset.dmaCode,
      dmaLabel: asset.dmaLabel,
      current: latest ? number(latest.flow) : null,
      timestamp: latest?.timestamp || null,
      average,
      max: values.length ? Math.max(...values) : null,
      mnf,
      ratio: average ? mnf / average : null,
      nightMeans,
      nightTrend: trend,
      count: values.length
    };
  }

  function pressureAnalysis() {
    const grouped = new Map();
    telemetryAssets("pressure").forEach(asset => {
      if (!grouped.has(asset.dmaCode)) grouped.set(asset.dmaCode, []);
      grouped.get(asset.dmaCode).push(asset);
    });
    const results = [];
    grouped.forEach((assets, dmaCode) => {
      const byRole = Object.fromEntries(assets.map(asset => [asset.role, asset]));
      const inlet = summarizePressureAsset(byRole.inlet);
      const mid = summarizePressureAsset(byRole["mid-zone"]);
      const distal = summarizePressureAsset(byRole.distal);
      const allRows = assets.flatMap(readingsFor);
      const allValues = allRows.map(row => number(row.pressure)).filter(Number.isFinite);
      const inletByTime = new Map(readingsFor(byRole.inlet).map(row => [row.timestamp, number(row.pressure)]));
      const distalRows = readingsFor(byRole.distal);
      const peakLosses = distalRows.filter(isPeak).map(row => {
        const inletValue = inletByTime.get(row.timestamp);
        const distalValue = number(row.pressure);
        return Number.isFinite(inletValue) && Number.isFinite(distalValue) ? inletValue - distalValue : null;
      }).filter(Number.isFinite);
      const distalPeak = distalRows.filter(isPeak).map(row => number(row.pressure)).filter(Number.isFinite);
      const distalNight = distalRows.filter(isNight).map(row => number(row.pressure)).filter(Number.isFinite);
      const below20 = allValues.filter(value => value < 20).length;
      const below25 = allValues.filter(value => value < 25).length;
      const minimum = allValues.length ? Math.min(...allValues) : null;
      results.push({
        dmaCode,
        dmaLabel: DMA_LABELS[dmaCode] || dmaCode,
        inletAverage: inlet.average,
        midAverage: mid.average,
        distalAverage: distal.average,
        inletMidDifference: inlet.average - mid.average,
        inletDistalDifference: inlet.average - distal.average,
        minimum,
        maximum: allValues.length ? Math.max(...allValues) : null,
        peakPeriodDifference: mean(peakLosses),
        nightPeakDifference: mean(distalNight) - mean(distalPeak),
        below20,
        below25,
        below25Percent: allValues.length ? below25 / allValues.length * 100 : 0,
        below20Percent: allValues.length ? below20 / allValues.length * 100 : 0,
      });
    });
    return results.sort((a, b) => a.minimum - b.minimum || b.below20 - a.below20 || b.below25 - a.below25);
  }

  function flowAnalysis() {
    return telemetryAssets("flow").map(summarizeFlowAsset).sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
  }

  function csv(text) {
    return parseCSV(text).map(row => ({ ...row, source: DEMO_SOURCE }));
  }

  async function fetchText(name) {
    const response = await fetch(DEMO_ROOT + name);
    if (!response.ok) throw new Error(`${name} could not be loaded`);
    return response.text();
  }

  async function loadLambayDemo(project) {
    if (!isLambayProject(project)) return;
    if (project.lambayDemo?.source === DEMO_SOURCE) {
      const migrated = window.AquaDmaStyles?.initialize(project, project.lambayDemo.logicalDmas);
      if (migrated) await window.AquaProjectPersistence?.save(project, { setActive: state.active === project });
      if (state.active === project) {
        renderTelemetry();
        updateProjectUI();
        renderAnalysis("pressure");
      }
      return;
    }
    if (loadingProjectId === project.id) return;
    loadingProjectId = project.id;
    try {
      const [assetText, pressureText, flowText, summaryText] = await Promise.all([
        fetchText("lambay_demo_assets.geojson"),
        fetchText("lambay_pressure_readings_demo.csv"),
        fetchText("lambay_dma_flow_readings_demo.csv"),
        fetchText("lambay_demo_summary.json")
      ]);
      const assetCollection = JSON.parse(assetText);
      const pressureRows = csv(pressureText);
      const flowRows = csv(flowText);
      const summary = JSON.parse(summaryText);
      const pressureById = new Map();
      pressureRows.forEach(row => {
        if (!pressureById.has(row.sensor_id)) pressureById.set(row.sensor_id, []);
        pressureById.get(row.sensor_id).push(row);
      });
      const flowById = new Map();
      flowRows.forEach(row => {
        if (!flowById.has(row.meter_id)) flowById.set(row.meter_id, []);
        flowById.get(row.meter_id).push(row);
      });
      const assets = assetCollection.features.map(feature => {
        const properties = feature.properties || {};
        const id = properties.id;
        const isPressure = properties.asset_type === "pressure_logger";
        return {
          _id: id,
          id,
          type: isPressure ? "pressure" : "flow",
          assetType: properties.asset_type,
          dmaCode: properties.dma_code,
          dmaUid: properties.dma_uid,
          dmaName: properties.dma_name,
          dmaLabel: DMA_LABELS[properties.dma_code] || properties.dma_code,
          role: isPressure ? roleLabel(properties.role) : "DMA inlet",
          lat: number(feature.geometry?.coordinates?.[1]),
          lng: number(feature.geometry?.coordinates?.[0]),
          source: DEMO_SOURCE,
          sourceDetail: properties.source,
          properties: { ...properties, source: DEMO_SOURCE },
          readings: isPressure ? pressureById.get(id) || [] : flowById.get(id) || []
        };
      });
      project.telemetry = (project.telemetry || []).filter(item => item.source !== DEMO_SOURCE).concat(assets);
      project.lambayDemo = {
        source: DEMO_SOURCE,
        assets,
        summary,
        logicalDmas: summary.dmas.map(item => ({
          ...item,
          label: DMA_LABELS[item.dma_code] || item.dma_code,
          source: DEMO_SOURCE
        }))
      };
      window.AquaDmaStyles?.initialize(project, project.lambayDemo.logicalDmas);
      await window.AquaProjectPersistence?.save(project, { setActive: state.active === project });
      if (state.active === project) {
        renderTelemetry();
        updateProjectUI();
        renderAnalysis("pressure");
      }
    } catch (error) {
      console.warn("Lambay synthetic demo telemetry could not be loaded", error);
    } finally {
      loadingProjectId = null;
    }
  }

  function ensureTelemetryGroups() {
    if (state.telemetryKindLayers || !state.map) return;
    state.telemetryKindLayers = {
      pressure: L.layerGroup(),
      flow: L.layerGroup(),
      acoustic: L.layerGroup()
    };
    state.layerVisibility.pressureTelemetry ??= true;
    state.layerVisibility.flowTelemetry ??= true;
    state.layerVisibility.acousticTelemetry ??= false;
  }

  function telemetryBounds(kind) {
    const group = state.telemetryKindLayers?.[kind];
    if (!group) return null;
    const bounds = L.latLngBounds([]);
    group.eachLayer(layer => {
      if (layer.getLatLng) bounds.extend(layer.getLatLng());
      else if (layer.getBounds) bounds.extend(layer.getBounds());
    });
    return bounds.isValid() ? bounds : null;
  }

  function syncTelemetryControls() {
    ["pressure", "flow", "acoustic"].forEach(kind => {
      const visible = state.layerVisibility[`${kind}Telemetry`] !== false;
      const checkbox = document.querySelector(`[data-telemetry-toggle="${kind}"]`);
      if (checkbox) checkbox.checked = visible;
      const row = document.querySelector(`.tree-item[data-filter="${kind}"]`);
      if (!row) return;
      row.classList.toggle("is-active", visible);
      row.classList.toggle("is-inactive", !visible);
      row.setAttribute("aria-pressed", String(visible));
    });
  }

  function applyTelemetryVisibility() {
    ensureTelemetryGroups();
    Object.entries(state.telemetryKindLayers || {}).forEach(([kind, group]) => {
      const visible = state.layerVisibility[`${kind}Telemetry`] !== false;
      if (visible && !state.map.hasLayer(group)) group.addTo(state.map);
      if (!visible && state.map.hasLayer(group)) state.map.removeLayer(group);
      if (visible) group.eachLayer(layer => layer.bringToFront?.());
    });
    syncTelemetryControls();
  }

  function setTelemetryLayer(kind, visible, options = {}) {
    ensureTelemetryGroups();
    if (!state.telemetryKindLayers?.[kind]) return false;
    state.layerVisibility[`${kind}Telemetry`] = Boolean(visible);
    applyTelemetryVisibility();
    if (visible && options.fit !== false) {
      const bounds = telemetryBounds(kind);
      if (bounds) state.map.fitBounds(bounds.pad(.18), { maxZoom: 17 });
    }
    return true;
  }

  function toggleTelemetryLayer(kind) {
    return setTelemetryLayer(kind, state.layerVisibility[`${kind}Telemetry`] === false);
  }

  function pressureMarkerColor(asset) {
    return window.AquaVisualStyles?.color("monitoring.pressure") || PRESSURE_COLORS[pressureClass(summarizePressureAsset(asset).latest ?? 0)];
  }

  function telemetrySelection(asset, marker) {
    state.selected = {
      layer: { name: asset.type === "pressure" ? "Synthetic pressure loggers" : "Synthetic DMA inlet meters", kind: asset.type },
      feature: { type: "Feature", properties: asset.properties, geometry: { type: "Point", coordinates: [asset.lng, asset.lat] } },
      leaflet: marker
    };
    if (asset.type === "pressure") {
      const result = summarizePressureAsset(asset);
      $("selectionCard").innerHTML = `
        <div class="selection-kicker"><small>SELECTED LOGGER</small><span>PRESSURE</span></div>
        <b class="selection-title"><i class="dma-colour-swatch" style="background:${window.AquaDmaStyles?.accentForCode(asset.dmaCode) || "#eef9ff"}"></i>${escapeHtml(asset.id)}</b>
        <p class="selection-source">${escapeHtml(asset.dmaLabel)} · ${escapeHtml(asset.role)}</p>
        <div class="synthetic-badge">Synthetic demo data</div>
        <dl class="selection-grid">
          <div><dt>Latest pressure</dt><dd>${format(result.latest)} m</dd></div>
          <div><dt>Minimum</dt><dd>${format(result.min)} m</dd></div>
          <div><dt>Average</dt><dd>${format(result.average)} m</dd></div>
          <div><dt>Maximum</dt><dd>${format(result.max)} m</dd></div>
          <div><dt>Below 25 m</dt><dd>${result.below25} samples</dd></div>
          <div><dt>Below 20 m</dt><dd>${result.below20} samples</dd></div>
          <div class="selection-wide"><dt>Latest reading</dt><dd>${escapeHtml(result.latestTimestamp || "—")}</dd></div>
        </dl>
        <canvas class="telemetry-chart" id="selectionTelemetryChart" aria-label="Pressure time series"></canvas>`;
      setTimeout(() => drawSeriesChart("selectionTelemetryChart", [{ label: asset.id, color: pressureMarkerColor(asset), values: readingsFor(asset).map(row => number(row.pressure)) }], "m"), 0);
    } else {
      const result = summarizeFlowAsset(asset);
      $("selectionCard").innerHTML = `
        <div class="selection-kicker"><small>SELECTED METER</small><span>FLOW</span></div>
        <b class="selection-title"><i class="dma-colour-swatch" style="background:${window.AquaDmaStyles?.accentForCode(asset.dmaCode) || "#efffff"}"></i>${escapeHtml(asset.id)}</b>
        <p class="selection-source">${escapeHtml(asset.dmaLabel)} · DMA inlet</p>
        <div class="synthetic-badge">Synthetic demo data</div>
        <dl class="selection-grid">
          <div><dt>Current flow</dt><dd>${format(result.current, 2)} L/s</dd></div>
          <div><dt>Average flow</dt><dd>${format(result.average, 2)} L/s</dd></div>
          <div><dt>Minimum night flow</dt><dd>${format(result.mnf, 2)} L/s</dd></div>
          <div><dt>Maximum flow</dt><dd>${format(result.max, 2)} L/s</dd></div>
          <div><dt>MNF / average</dt><dd>${format(result.ratio * 100, 1)}%</dd></div>
          <div class="selection-wide"><dt>Latest reading</dt><dd>${escapeHtml(result.timestamp || "—")}</dd></div>
        </dl>
        <canvas class="telemetry-chart" id="selectionTelemetryChart" aria-label="Average daily flow profile"></canvas>`;
      setTimeout(() => drawSeriesChart("selectionTelemetryChart", [{ label: asset.id, color: window.AquaVisualStyles?.color("monitoring.flow") || "#55d6be", values: averageDailyProfile(asset, "flow") }], "L/s"), 0);
    }
    if (window.innerWidth <= 800) {
      window.AquaWindowManager?.restore("pressure-analysis");
      renderAnalysis(asset.type === "flow" ? "flow" : "pressure", asset.dmaCode);
    }
    window.dispatchEvent(new CustomEvent("aqua:selection", { detail: { kind: "telemetry", entity: asset, leaflet: marker } }));
  }

  function renderTelemetryLayers() {
    ensureTelemetryGroups();
    if (!state.telemetryKindLayers) return;
    state.telemetryLayer?.clearLayers();
    Object.values(state.telemetryKindLayers).forEach(group => group.clearLayers());
    if (!state.active) return;
    (state.active.telemetry || []).forEach(asset => {
      if (!aquaTelemetryInFocus(asset)) return;
      if (!Number.isFinite(number(asset.lat)) || !Number.isFinite(number(asset.lng))) return;
      if (asset.type === "pressure") {
        const color = pressureMarkerColor(asset);
        const dmaAccent = window.AquaDmaStyles?.accentForCode(asset.dmaCode) || "#eef9ff";
        const marker = L.circleMarker([asset.lat, asset.lng], {
          radius: 7,
          color: dmaAccent,
          weight: 2,
          fillColor: color,
          fillOpacity: .95,
          className: "pressure-logger-marker"
        }).bindTooltip(`${asset.id} · ${asset.dmaLabel} · ${asset.role}`);
        marker.on("click", () => telemetrySelection(asset, marker));
        marker.__aquaTelemetry = asset;
        marker.addTo(state.telemetryKindLayers.pressure);
      } else if (asset.type === "flow") {
        const coincident = (state.active.telemetry || []).filter(item => item.type === "flow" && number(item.lat) === number(asset.lat) && number(item.lng) === number(asset.lng));
        const displayOffset = (coincident.indexOf(asset) - (coincident.length - 1) / 2) * 16;
        const dmaAccent = window.AquaDmaStyles?.accentForCode(asset.dmaCode) || "#efffff";
        const flowColor = window.AquaVisualStyles?.color("monitoring.flow") || "#43c59e";
        const icon = L.divIcon({ className: "dma-flow-marker", html: `<span style="--dma-accent:${dmaAccent};--flow-color:${flowColor}"></span>`, iconSize: [18, 18], iconAnchor: [9 - displayOffset, 9] });
        const marker = L.marker([asset.lat, asset.lng], { icon, keyboard: true, title: `${asset.id} · ${asset.dmaLabel}` }).bindTooltip(`${asset.id} · ${asset.dmaLabel} inlet`);
        marker.on("click", () => telemetrySelection(asset, marker));
        marker.__aquaTelemetry = asset;
        marker.addTo(state.telemetryKindLayers.flow);
      } else if (asset.type === "acoustic") {
        const color = window.AquaVisualStyles?.color("monitoring.acoustic") || "#ffad4d";
        const marker = L.circleMarker([asset.lat, asset.lng], { radius: 6, color, fillColor: color, fillOpacity: .9 });
        marker.__aquaTelemetry = asset;
        marker.addTo(state.telemetryKindLayers.acoustic);
      }
    });
    applyTelemetryVisibility();
  }

  function averageDailyProfile(asset, field) {
    const buckets = Array.from({ length: 96 }, () => []);
    readingsFor(asset).forEach(row => {
      const date = parseTimestamp(row.timestamp);
      const value = number(row[field]);
      if (!date || !Number.isFinite(value)) return;
      buckets[date.getHours() * 4 + Math.floor(date.getMinutes() / 15)].push(value);
    });
    return buckets.map(rows => mean(rows));
  }

  function drawSeriesChart(id, series, unit) {
    const canvas = $(id);
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(260, bounds.width || canvas.clientWidth || 320);
    const height = Math.max(130, bounds.height || canvas.clientHeight || 150);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const all = series.flatMap(item => item.values).filter(Number.isFinite);
    if (!all.length) return;
    const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
    const left = 36, right = 10, top = 20, bottom = 24;
    context.strokeStyle = "rgba(153,185,203,.22)";
    context.lineWidth = 1;
    for (let index = 0; index < 4; index++) {
      const y = top + (height - top - bottom) * index / 3;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
    }
    context.font = "10px sans-serif";
    context.fillStyle = "#89a5b7";
    context.fillText(`${max.toFixed(1)} ${unit}`, 2, top + 4);
    context.fillText(`${min.toFixed(1)} ${unit}`, 2, height - bottom + 3);
    series.forEach((item, seriesIndex) => {
      context.strokeStyle = item.color;
      context.lineWidth = series.length > 1 ? 1.5 : 2;
      context.beginPath();
      let started = false;
      item.values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const x = left + (width - left - right) * index / Math.max(1, item.values.length - 1);
        const y = top + (height - top - bottom) * (1 - (value - min) / range);
        if (!started) { context.moveTo(x, y); started = true; }
        else context.lineTo(x, y);
      });
      context.stroke();
      context.fillStyle = item.color;
      context.fillRect(left + seriesIndex * 86, 4, 10, 3);
      context.fillStyle = "#c4d7e2";
      context.fillText(item.label, left + 14 + seriesIndex * 86, 9);
    });
    canvas.dataset.renderedPoints = String(all.length);
  }

  function focusLogicalDma(dmaCode, mode = "pressure") {
    const currentDemo = demo();
    if (!currentDemo) return false;
    selectedDmaCode = dmaCode;
    aquaSetProjectLayer("dma", true, { fit: false, showAllDmas: true });
    const logical = currentDemo.logicalDmas.find(item => item.dma_code === dmaCode);
    const bounds = L.latLngBounds([]);
    state.kindLayers.dma.eachLayer(wrapper => wrapper.eachLayer?.(polygon => {
      const properties = polygon.__aquaFeature?.properties || {};
      const uid = aquaSelectionValue(properties, ["unific_id"])?.value;
      const code = aquaSelectionValue(properties, ["smallare_1", "dma_code"])?.value;
      const match = String(uid || "") === String(logical?.logical_dma_uid || "") || String(code || "") === dmaCode;
      if (polygon.setStyle) polygon.setStyle(match ? { ...aquaFeatureStyle("dma", polygon.__aquaFeature), color: "#ffffff", weight: 4 } : aquaFeatureStyle("dma", polygon.__aquaFeature));
      if (match && polygon.getBounds) bounds.extend(polygon.getBounds());
    }));
    ["pressure", "flow"].forEach(kind => setTelemetryLayer(kind, true, { fit: false }));
    Object.values(state.telemetryKindLayers).forEach(group => group.eachLayer(marker => {
      const asset = marker.__aquaTelemetry;
      if (!asset) return;
      const match = asset.dmaCode === dmaCode;
      if (marker.setStyle) marker.setStyle({ opacity: match ? 1 : .18, fillOpacity: match ? .98 : .12 });
      if (marker.setRadius) marker.setRadius(match ? 8 : 5);
      const element = marker.getElement?.();
      if (element) {
        element.classList.toggle("is-muted", !match);
        element.classList.toggle("is-highlighted", match);
      }
      if (match && marker.getLatLng) bounds.extend(marker.getLatLng());
    }));
    if (bounds.isValid()) state.map.fitBounds(bounds.pad(.22), { maxZoom: 16 });
    window.AquaWindowManager?.restore("pressure-analysis");
    renderAnalysis(mode, dmaCode);
    return true;
  }

  function renderPressureTable(results) {
    return `<table class="telemetry-table"><thead><tr><th>DMA</th><th>Inlet</th><th>Mid</th><th>Distal</th><th>Min</th><th>&lt;25 m</th><th>&lt;20 m</th></tr></thead><tbody>${results.map(item => `
      <tr data-dma-code="${escapeHtml(item.dmaCode)}" tabindex="0">
        <td><b><i class="dma-colour-swatch" style="background:${window.AquaDmaStyles?.accentForCode(item.dmaCode) || "#36a3ff"}"></i>${escapeHtml(item.dmaLabel)}</b><small>${escapeHtml(item.dmaCode)}</small></td>
        <td>${format(item.inletAverage)}</td><td>${format(item.midAverage)}</td><td>${format(item.distalAverage)}</td>
        <td class="pressure-${pressureClass(item.minimum)}">${format(item.minimum)}</td>
        <td>${item.below25} <small>${format(item.below25Percent)}%</small></td>
        <td>${item.below20} <small>${format(item.below20Percent)}%</small></td>
      </tr>`).join("")}</tbody></table>`;
  }

  function renderFlowTable(results) {
    return `<table class="telemetry-table"><thead><tr><th>DMA</th><th>Average</th><th>Maximum</th><th>MNF</th><th>MNF ratio</th><th>Night change</th></tr></thead><tbody>${results.map(item => `
      <tr data-dma-code="${escapeHtml(item.dmaCode)}" tabindex="0">
        <td><b><i class="dma-colour-swatch" style="background:${window.AquaDmaStyles?.accentForCode(item.dmaCode) || "#36a3ff"}"></i>${escapeHtml(item.dmaLabel)}</b><small>${escapeHtml(item.id)}</small></td>
        <td>${format(item.average, 2)}</td><td>${format(item.max, 2)}</td><td>${format(item.mnf, 2)}</td>
        <td class="${item.ratio >= .55 ? "nrw-flag" : ""}">${format(item.ratio * 100, 1)}%</td>
        <td>${item.nightTrend >= 0 ? "+" : ""}${format(item.nightTrend, 2)} L/s</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function renderDmaDetail(mode, dmaCode) {
    const detail = $("telemetryAnalysisDetail");
    if (!detail) return;
    const label = DMA_LABELS[dmaCode] || dmaCode;
    if (mode === "pressure") {
      const assets = telemetryAssets("pressure").filter(asset => asset.dmaCode === dmaCode);
      const result = pressureAnalysis().find(item => item.dmaCode === dmaCode);
      detail.innerHTML = `<div><b>${escapeHtml(label)} pressure profile</b><span>Three days · 15-minute synthetic readings</span></div>
        <div class="telemetry-detail-metrics">
          <span><small>Inlet → mid difference</small><b>${format(result?.inletMidDifference)} m</b></span>
          <span><small>Inlet → distal difference</small><b>${format(result?.inletDistalDifference)} m</b></span>
          <span><small>Observed range</small><b>${format(result?.minimum)}–${format(result?.maximum)} m</b></span>
          <span><small>Peak-period difference</small><b>${format(result?.peakPeriodDifference)} m</b></span>
          <span><small>Night vs peak difference</small><b>${format(result?.nightPeakDifference)} m</b></span>
          <span><small>Threshold samples</small><b>${result?.below25 || 0} &lt;25 · ${result?.below20 || 0} &lt;20</b></span>
        </div>
        <canvas id="dmaTelemetryChart" class="analysis-chart" aria-label="DMA pressure profile"></canvas>`;
      setTimeout(() => drawSeriesChart("dmaTelemetryChart", assets.map(asset => ({
        label: asset.role,
        color: asset.role === "inlet" ? "#4ba3ff" : asset.role === "mid-zone" ? "#52c788" : "#ff9f43",
        values: readingsFor(asset).map(row => number(row.pressure))
      })), "m"), 0);
    } else {
      const asset = telemetryAssets("flow").find(item => item.dmaCode === dmaCode);
      const result = flowAnalysis().find(item => item.dmaCode === dmaCode);
      detail.innerHTML = `<div><b>${escapeHtml(label)} average daily flow profile</b><span>Three-day mean by 15-minute interval</span></div>
        <div class="telemetry-detail-metrics">
          <span><small>Average flow</small><b>${format(result?.average, 2)} L/s</b></span>
          <span><small>Observed maximum</small><b>${format(result?.max, 2)} L/s</b></span>
          <span><small>Minimum night flow</small><b>${format(result?.mnf, 2)} L/s</b></span>
          <span><small>MNF / average</small><b>${format((result?.ratio || 0) * 100)}%</b></span>
          <span><small>Night mean change, day 3 − 1</small><b>${result?.nightTrend >= 0 ? "+" : ""}${format(result?.nightTrend, 2)} L/s</b></span>
        </div>
        <canvas id="dmaTelemetryChart" class="analysis-chart" aria-label="DMA flow profile"></canvas>`;
      setTimeout(() => drawSeriesChart("dmaTelemetryChart", [{ label: asset?.id || label, color: "#55d6be", values: averageDailyProfile(asset, "flow") }], "L/s"), 0);
    }
  }

  function renderAnalysis(mode = analysisMode, requestedDma = null) {
    analysisMode = mode;
    const body = $("pressureAnalysisBody");
    if (!body) return;
    if (!demo()) {
      body.innerHTML = '<div class="empty-row">Open the Lambay Island project to load its synthetic demo telemetry.</div>';
      return;
    }
    const results = mode === "pressure" ? pressureAnalysis() : flowAnalysis();
    const firstCode = requestedDma || selectedDmaCode || results[0]?.dmaCode;
    body.innerHTML = `
      <div class="telemetry-tabs"><button data-telemetry-analysis="pressure" class="${mode === "pressure" ? "active" : ""}">Pressure</button><button data-telemetry-analysis="flow" class="${mode === "flow" ? "active" : ""}">Flow / MNF</button></div>
      <div class="synthetic-notice"><b>Synthetic demo telemetry</b><span>Screening only. No readings are measured field data.</span></div>
      ${mode === "pressure" ? `
        <div class="pressure-key"><span><i class="critical"></i>&lt;20 Critical</span><span><i class="low"></i>20–&lt;25 Low</span><span><i class="watch"></i>25–&lt;30 Watch</span><span><i class="normal"></i>30–40 Normal</span><span><i class="high"></i>&gt;40 High</span></div>
        <p class="analysis-method">Ranked by minimum observed logger reading. Threshold totals pool all three loggers; &lt;20 m samples are included in &lt;25 m. Differences are not modeled head loss, and marker classes do not infer pressure between sensors.</p>
        ${renderPressureTable(results)}` : `
        <p class="analysis-method">Minimum night flow is the lowest observed 15-minute reading from 01:00–05:00. Ratios ≥55% are highlighted for review only and do not prove leakage. Night change is day-3 minus day-1 mean night flow.</p>
        ${renderFlowTable(results)}`}
      <div id="telemetryAnalysisDetail" class="telemetry-analysis-detail"></div>`;
    body.querySelectorAll("[data-telemetry-analysis]").forEach(button => button.onclick = () => renderAnalysis(button.dataset.telemetryAnalysis, firstCode));
    body.querySelectorAll("tr[data-dma-code]").forEach(row => {
      const activate = () => focusLogicalDma(row.dataset.dmaCode, mode);
      row.onclick = activate;
      row.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } };
    });
    if (firstCode) renderDmaDetail(mode, firstCode);
  }

  function telemetryCommandMatches(value) {
    const query = String(value || "").toLowerCase();
    const namedDma = /\b(baisha|danan|shangshan|tianfu)\b/;
    return /pressure loggers?|dma (?:inlet )?meters?|flow meters?|lowest pressure|low pressure areas?|lowest reading|highest night flow/.test(query)
      || (namedDma.test(query) && /\b(pressure|flow)\b/.test(query));
  }

  function telemetryCommand(value) {
    if (!demo()) return null;
    const query = String(value || "").trim().toLowerCase();
    if (!telemetryCommandMatches(query)) return null;
    if (/how many|number of|count/.test(query) && /pressure loggers?/.test(query)) return `<b>${telemetryAssets("pressure").length}</b> synthetic pressure loggers are loaded.`;
    if (/how many|number of|count/.test(query) && /(?:dma (?:inlet )?|flow )meters?/.test(query)) return `<b>${telemetryAssets("flow").length}</b> synthetic DMA inlet meters are loaded.`;
    const action = query.match(/\b(show|hide)\b/);
    if (action && /pressure loggers?/.test(query)) {
      const visible = action[1] === "show";
      setTelemetryLayer("pressure", visible, { fit: visible });
      return `${visible ? "Showing" : "Hiding"} ${telemetryAssets("pressure").length} synthetic pressure loggers.`;
    }
    if (action && /(?:dma (?:inlet )?|flow )meters?/.test(query)) {
      const visible = action[1] === "show";
      setTelemetryLayer("flow", visible, { fit: visible });
      return `${visible ? "Showing" : "Hiding"} ${telemetryAssets("flow").length} synthetic DMA inlet meters.`;
    }
    if (/^\s*pressure loggers?\s*[?.!]*\s*$/.test(query)) return `<b>${telemetryAssets("pressure").length}</b> synthetic pressure loggers are loaded.`;
    if (/^\s*(?:dma (?:inlet )?|flow )meters?\s*[?.!]*\s*$/.test(query)) return `<b>${telemetryAssets("flow").length}</b> synthetic DMA inlet meters are loaded.`;
    const pressures = pressureAnalysis();
    const flows = flowAnalysis();
    if (/which dma has the lowest pressure|lowest pressure/.test(query) && !/logger/.test(query)) {
      const result = [...pressures].sort((a, b) => a.minimum - b.minimum)[0];
      focusLogicalDma(result.dmaCode, "pressure");
      return `<b>${escapeHtml(result.dmaLabel)}</b> has the lowest observed pressure at <b>${format(result.minimum)} m</b> in the synthetic demo.`;
    }
    if (/show low pressure areas?/.test(query)) {
      setTelemetryLayer("pressure", true, { fit: true });
      window.AquaWindowManager?.restore("pressure-analysis");
      renderAnalysis("pressure");
      const flagged = pressures.filter(item => item.below25 > 0).map(item => `${item.dmaLabel} (${item.below25} samples below 25 m)`);
      return `Low-pressure synthetic logger evidence: <b>${escapeHtml(flagged.join("; "))}</b>. No pressure surface is inferred between sensors.`;
    }
    if (/which pressure logger has the lowest reading|lowest reading/.test(query)) {
      const result = telemetryAssets("pressure").map(asset => ({ asset, summary: summarizePressureAsset(asset) })).sort((a, b) => a.summary.min - b.summary.min)[0];
      focusLogicalDma(result.asset.dmaCode, "pressure");
      return `<b>${escapeHtml(result.asset.id)}</b> in ${escapeHtml(result.asset.dmaLabel)} has the lowest reading at <b>${format(result.summary.min)} m</b>.`;
    }
    if (/which dma has the highest night flow|highest night flow/.test(query)) {
      const result = [...flows].sort((a, b) => b.mnf - a.mnf)[0];
      focusLogicalDma(result.dmaCode, "flow");
      return `<b>${escapeHtml(result.dmaLabel)}</b> has the highest synthetic minimum night flow at <b>${format(result.mnf, 2)} L/s</b> (${format(result.ratio * 100)}% of average).`;
    }
    const dmaEntry = Object.entries(DMA_LABELS).find(([, label]) => query.includes(label.toLowerCase()));
    if (dmaEntry && /pressure/.test(query)) {
      focusLogicalDma(dmaEntry[0], "pressure");
      return `Showing ${escapeHtml(dmaEntry[1])} pressure loggers and deterministic pressure summary.`;
    }
    if (dmaEntry && /flow/.test(query)) {
      focusLogicalDma(dmaEntry[0], "flow");
      return `Showing ${escapeHtml(dmaEntry[1])} DMA inlet meter and daily flow profile.`;
    }
    return null;
  }

  function bindTelemetryControls() {
    ["pressure", "flow", "acoustic"].forEach(kind => {
      const row = document.querySelector(`.tree-item[data-filter="${kind}"]`);
      if (row && !row.dataset.telemetryBound) {
        row.dataset.telemetryBound = "true";
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.onclick = () => toggleTelemetryLayer(kind);
        row.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); } };
      }
      const checkbox = document.querySelector(`[data-telemetry-toggle="${kind}"]`);
      if (checkbox) checkbox.onchange = () => setTelemetryLayer(kind, checkbox.checked, { fit: false });
    });
    syncTelemetryControls();
  }

  const baseRenderTelemetry = renderTelemetry;
  renderTelemetry = function() {
    if (demo()) renderTelemetryLayers();
    else {
      Object.values(state.telemetryKindLayers || {}).forEach(group => {
        group.clearLayers();
        if (state.map?.hasLayer(group)) state.map.removeLayer(group);
      });
      baseRenderTelemetry();
    }
  };

  const baseRenderProject = renderProject;
  renderProject = function() {
    baseRenderProject();
    if (!isLambayProject(state.active)) {
      selectedDmaCode = null;
      renderAnalysis("pressure");
    }
    setTimeout(() => loadLambayDemo(state.active), 0);
  };

  const baseQueries = window.AquaProjectQueries;
  window.AquaProjectQueries = {
    matches(value) {
      return telemetryCommandMatches(value) || baseQueries.matches(value);
    },
    run(value) {
      return telemetryCommand(value) || baseQueries.run(value);
    },
    handle(value) {
      const answer = this.run(value);
      if (!answer) return false;
      addUser(value);
      addAi(answer);
      return true;
    }
  };

  const baseAskCopilot = askCopilot;
  askCopilot = async function(question) {
    const answer = telemetryCommand(question);
    if (answer) {
      addUser(question);
      addAi(answer);
      return;
    }
    return baseAskCopilot(question);
  };

  window.AquaLambayDemo = {
    source: DEMO_SOURCE,
    load: () => loadLambayDemo(state.active),
    pressureAnalysis,
    flowAnalysis,
    renderAnalysis,
    focusDma: focusLogicalDma,
    setLayer: setTelemetryLayer,
    command: telemetryCommand
  };

  window.addEventListener("load", () => {
    ensureTelemetryGroups();
    bindTelemetryControls();
    document.addEventListener("click", event => {
      if (event.target.closest('[data-window-id="pressure-analysis"], [data-tool-window-id="pressure-analysis"]')) {
        setTimeout(() => renderAnalysis(analysisMode, selectedDmaCode), 0);
      }
    });
    $("projectSelect")?.addEventListener("change", () => setTimeout(() => loadLambayDemo(state.active), 80));
    setTimeout(() => loadLambayDemo(state.active), 500);
  });
})();
