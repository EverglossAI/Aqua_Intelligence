(() => {
  "use strict";

  const view = { selection: null, contextCoordinate: null, drawing: false, profileLine: [], profileLayer: null, profileMarker: null };
  const element = id => document.getElementById(id);
  const escape = value => String(value ?? "-").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const format = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";

  function project() {
    return window.aquaState?.active || null;
  }

  function coordinateText(coordinate) {
    return coordinate ? `${coordinate[0].toFixed(6)}, ${coordinate[1].toFixed(6)}` : "Coordinates unavailable";
  }

  function openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function sourceId(kind, entity) {
    if (kind === "telemetry") return `${entity.type}:${entity.id || entity._id}`;
    if (kind === "acoustic-sensor") return `acoustic:${entity.sensorId}`;
    return null;
  }

  function pipeIdentifier(feature) {
    const properties = feature?.properties || {};
    const key = Object.keys(properties).find(name => ["unific_id", "pipe_id", "id", "gid", "objectid", "fid"].includes(name.toLowerCase()));
    return key ? String(properties[key]) : null;
  }

  function evidenceFor(selection) {
    const active = project();
    if (!active) return { sensors: [], alerts: [] };
    const pipeId = selection.layer?.kind === "pipe" ? pipeIdentifier(selection.entity) : selection.entity?.matchedPipeId || null;
    const sensors = (active.acousticSensor || []).filter(sensor => pipeId && String(sensor.matchedPipeId) === pipeId);
    const alerts = (active.acousticAlert || []).filter(alert => pipeId && String(alert.matchedPipeId) === pipeId);
    return { pipeId, sensors, alerts };
  }

  function provenanceMarkup(selection) {
    const source = selection.entity?.source || selection.entity?.properties?.source;
    if (!source) return "";
    if (typeof source === "string") return `<p class="context-provenance">Source: ${escape(source)}</p>`;
    return `<p class="context-provenance">Source: ${escape(source.filename || source.type || "Imported record")}${source.sourceRow ? ` · row ${escape(source.sourceRow)}` : ""}</p>`;
  }

  function fieldsMarkup(fields) {
    if (!fields.length) return '<p class="context-empty">No mapped attributes are available for this asset.</p>';
    return `<dl class="context-fields">${fields.map(field => `<div><dt>${escape(field.label)}</dt><dd>${escape(field.value)}</dd></div>`).join("")}</dl>`;
  }

  function renderRelated(selection) {
    const container = element("assetRelatedBody");
    if (!container) return;
    const evidence = evidenceFor(selection);
    const relationships = selection.entity?.relationships || selection.entity?.properties?.relationships || [];
    const alerts = evidence.alerts.map(alert => `<button type="button" data-related-alert="${escape(alert.alertId)}"><b>${escape(alert.alertId)}</b><span>${escape(alert.status || alert.stateGroup)}</span></button>`).join("");
    const sensors = evidence.sensors.map(sensor => `<button type="button" data-related-sensor="${escape(sensor.sensorId)}"><b>${escape(sensor.sensorId)}</b><span>Matched to this pipe</span></button>`).join("");
    const explicit = relationships.map(relationship => `<div><b>${escape(relationship.type || "Relationship")}</b><span>${escape(relationship.assetId || relationship.alertId || relationship.coupleId || relationship.id)}</span></div>`).join("");
    container.innerHTML = alerts || sensors || explicit ? `${alerts}${sensors}${explicit}` : '<p class="context-empty">No explicit connected-asset relationships are present in the source data.</p>';
    container.querySelectorAll("[data-related-alert]").forEach(button => button.addEventListener("click", () => {
      const alert = (project()?.acousticAlert || []).find(item => String(item.alertId) === button.dataset.relatedAlert);
      if (alert) window.AquaAcoustics?.selectAlert(alert);
    }));
    container.querySelectorAll("[data-related-sensor]").forEach(button => button.addEventListener("click", () => {
      const sensor = (project()?.acousticSensor || []).find(item => String(item.sensorId) === button.dataset.relatedSensor);
      if (sensor) window.AquaAcoustics?.selectSensor(sensor);
    }));
  }

  function renderAsset(selection) {
    const core = window.AquaContextualCore;
    const body = element("assetDetailsBody");
    if (!core || !body) return;
    view.selection = selection;
    const coordinate = core.entityCoordinate(selection.kind, selection.entity);
    const identity = core.assetIdentity(selection.kind, selection.entity, selection.layer);
    const fields = core.presentAssetFields(selection.entity, { kind: selection.kind });
    const evidence = evidenceFor(selection);
    const comparable = sourceId(selection.kind, selection.entity);
    const hasRisk = evidence.pipeId != null;
    body.innerHTML = `<div class="context-heading"><div><small>${escape(identity.type)}</small><h3>${escape(identity.id)}</h3>${identity.layer ? `<span>${escape(identity.layer)}</span>` : ""}</div><span class="context-coordinate">${escape(coordinateText(coordinate))}</span></div>
      ${provenanceMarkup(selection)}${fieldsMarkup(fields)}
      <div class="context-actions">
        <button type="button" data-asset-action="street"${coordinate ? "" : " disabled"}>Street View</button>
        <button type="button" data-asset-action="navigate"${coordinate ? "" : " disabled"}>Navigate to</button>
        <button type="button" data-asset-action="compare"${comparable ? "" : " disabled"}>Compare with...</button>
        <button type="button" data-asset-action="events"${evidence.alerts.length ? "" : " disabled"}>Related events (${evidence.alerts.length})</button>
        <button type="button" data-asset-action="priority"${hasRisk ? "" : " disabled"}>Investigation priority</button>
        <button type="button" data-asset-action="connected">View connected assets</button>
      </div>
      <div id="assetRelatedBody" class="context-related hidden"></div>`;
    body.querySelector('[data-asset-action="street"]')?.addEventListener("click", () => openExternal(core.streetViewUrl(coordinate)));
    body.querySelector('[data-asset-action="navigate"]')?.addEventListener("click", () => openExternal(core.navigationUrl(coordinate)));
    body.querySelector('[data-asset-action="compare"]')?.addEventListener("click", () => window.AquaComparison?.openForSource(comparable));
    body.querySelector('[data-asset-action="events"]')?.addEventListener("click", () => {
      window.AquaWindowManager?.restore("events");
      window.AquaLeakRisk?.render();
      if (evidence.alerts[0]) window.AquaAcoustics?.selectAlert(evidence.alerts[0]);
    });
    body.querySelector('[data-asset-action="priority"]')?.addEventListener("click", () => {
      window.AquaLeakRisk?.render();
      window.AquaWindowManager?.restore("events");
      const result = window.AquaLeakRisk?.results?.find(item => String(item.pipeId) === String(evidence.pipeId));
      if (result) window.AquaLeakRisk.focusResult(result);
    });
    body.querySelector('[data-asset-action="connected"]')?.addEventListener("click", () => {
      const related = element("assetRelatedBody");
      related.classList.toggle("hidden");
      if (!related.classList.contains("hidden")) renderRelated(selection);
    });
    window.AquaWindowManager?.restore("asset-details");
  }

  function telemetryButton(asset) {
    return `<button type="button" data-dma-telemetry="${escape(asset.id || asset._id)}"><b>${escape(asset.id || asset._id)}</b><span>${escape(asset.role || asset.type)}</span></button>`;
  }

  function breakdownMarkup(rows) {
    return rows.length ? rows.map(row => `<span>${escape(row.value)} <b>${row.count}</b></span>`).join("") : '<span class="context-empty">Unavailable</span>';
  }

  function renderDma(selection) {
    const core = window.AquaContextualCore;
    const body = element("dmaDetailsBody");
    if (!core || !body) return;
    const summary = core.summarizeDma(project(), selection.entity, window.AquaLeakRisk?.results || []);
    view.dma = summary;
    const elevation = summary.elevation ? `${format(summary.elevation.minimum)}-${format(summary.elevation.maximum)} m · ${escape(summary.elevation.provenance.source)}` : "Elevation data unavailable";
    body.innerHTML = `<div class="context-heading"><div><small>DMA ${escape(summary.code)}</small><h3>${escape(summary.name)}</h3></div><span>${summary.pipeCount} mapped pipes</span></div>
      <div class="dma-metrics"><div><span>Pipe length</span><b>${format(summary.totalPipeLength / 1000, 2)} km</b></div><div><span>Pressure loggers</span><b>${summary.pressureLoggers.length}</b></div><div><span>Flow meters</span><b>${summary.flowMeters.length}</b></div><div><span>Acoustic sensors</span><b>${summary.acousticSensors.length}</b></div><div><span>Active alerts</span><b>${summary.activeAlerts.length}</b></div><div><span>Historical alerts</span><b>${summary.historicalAlerts.length}</b></div></div>
      <section class="context-section"><h4>Pipe materials</h4><div class="context-breakdown">${breakdownMarkup(summary.materials)}</div></section>
      <section class="context-section"><h4>Pipe diameters</h4><div class="context-breakdown">${breakdownMarkup(summary.diameters)}</div></section>
      <section class="context-section"><h4>Investigation priority</h4><div class="context-breakdown"><span>Critical <b>${summary.priority.critical}</b></span><span>High <b>${summary.priority.high}</b></span><span>Elevated <b>${summary.priority.elevated}</b></span><span>Maximum <b>${summary.priority.maximum ?? "-"}</b></span></div></section>
      <section class="context-section"><h4>Monitoring sources</h4><div class="context-related">${[...summary.inletMeters, ...summary.pressureLoggers.filter(item => !summary.inletMeters.includes(item)), ...summary.flowMeters.filter(item => !summary.inletMeters.includes(item))].map(telemetryButton).join("") || '<p class="context-empty">No linked monitoring sources.</p>'}</div></section>
      <section class="context-section"><h4>Elevation</h4><p>${elevation}</p><button type="button" class="secondary" id="openDmaElevation">Open Elevation Profile</button></section>`;
    body.querySelectorAll("[data-dma-telemetry]").forEach(button => button.addEventListener("click", () => selectTelemetry(button.dataset.dmaTelemetry)));
    element("openDmaElevation")?.addEventListener("click", () => openDmaProfile(summary));
    window.AquaWindowManager?.restore("dma-details");
  }

  function selectTelemetry(id) {
    const asset = (project()?.telemetry || []).find(item => String(item.id || item._id) === String(id));
    if (!asset) return;
    let marker = null;
    Object.values(window.aquaState?.telemetryKindLayers || {}).forEach(group => group.eachLayer(layer => {
      if (String(layer.__aquaTelemetry?.id || layer.__aquaTelemetry?._id) === String(id)) marker = layer;
    }));
    marker?.fire("click");
    if (!marker) window.dispatchEvent(new CustomEvent("aqua:selection", { detail: { kind: "telemetry", entity: asset } }));
  }

  function longestDmaLine(summary) {
    const core = window.AquaContextualCore;
    const candidates = summary.pipes.flatMap(pipe => {
      const geometry = pipe.geometry;
      const lines = geometry?.type === "LineString" ? [geometry.coordinates] : geometry?.type === "MultiLineString" ? geometry.coordinates : [];
      return lines.map(line => line.map(coordinate => [coordinate[1], coordinate[0]]));
    });
    return candidates.sort((left, right) => lineLength(right, core) - lineLength(left, core))[0] || [];
  }

  function lineLength(line, core = window.AquaContextualCore) {
    return line.slice(1).reduce((sum, coordinate, index) => sum + core.distanceMetres(line[index], coordinate), 0);
  }

  function ensureProfileLayer() {
    if (!window.aquaState?.map || typeof L === "undefined") return null;
    if (!view.profileLayer) view.profileLayer = L.polyline([], { color: "#ffbf59", weight: 4, dashArray: "8 5" }).addTo(window.aquaState.map);
    return view.profileLayer;
  }

  function setProfileLine(line, label = "Drawn map line") {
    view.profileLine = line;
    view.profileLabel = label;
    ensureProfileLayer()?.setLatLngs(line);
    if (line.length > 1) window.aquaState.map.fitBounds(L.latLngBounds(line).pad(0.2), { maxZoom: 18 });
    renderProfile();
    window.AquaWindowManager?.restore("elevation-profile");
  }

  function openDmaProfile(summary) {
    const line = longestDmaLine(summary);
    setProfileLine(line, line.length ? `Longest mapped pipe in ${summary.code}` : summary.code);
  }

  function profileChart(profile) {
    const width = 640;
    const height = 190;
    const minimum = profile.statistics.minimum;
    const spread = profile.statistics.maximum - minimum || 1;
    const points = profile.samples.map(sample => {
      const x = 28 + sample.distance / Math.max(1, profile.statistics.totalDistance) * (width - 44);
      const y = 14 + (profile.statistics.maximum - sample.elevation) / spread * (height - 40);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<div class="profile-chart-wrap"><svg id="elevationChart" class="profile-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Elevation profile"><polyline points="${points}" fill="none" stroke="#55d6be" stroke-width="3"/><line id="elevationCursor" x1="28" x2="28" y1="14" y2="164" stroke="#fff" opacity="0"/></svg><div id="elevationCursorLabel" class="profile-cursor hidden"></div></div>`;
  }

  function renderProfile() {
    const body = element("elevationProfileBody");
    const core = window.AquaContextualCore;
    if (!body || !core) return;
    const source = core.resolveElevationSource(project());
    const sourceDescription = core.describeElevationSource(project());
    const profile = core.buildElevationProfile(view.profileLine, source);
    view.profile = profile;
    const controls = `<div class="profile-controls"><button type="button" class="primary" id="drawElevationProfile">${view.drawing ? "Drawing..." : "Draw profile"}</button><button type="button" class="secondary" id="finishElevationProfile"${view.drawing ? "" : " disabled"}>Finish</button><button type="button" class="secondary" id="clearElevationProfile">Clear</button></div>`;
    if (view.profileLine.length < 2) {
      body.innerHTML = `${controls}<div class="profile-status"><b>${view.drawing ? "Choose at least two points on the map" : "No profile line"}</b><span>${escape(view.profileLabel || "Draw an A-to-B or multi-point line on the map.")}</span></div>`;
    } else if (!source || !profile.available) {
      const rejectedProvenance = sourceDescription ? `<dl class="profile-provenance"><div><dt>Source</dt><dd>${escape(sourceDescription.source)}</dd></div><div><dt>Resolution</dt><dd>${escape(sourceDescription.resolution || "Not stated")}</dd></div><div><dt>Date / version</dt><dd>${escape([sourceDescription.date, sourceDescription.version].filter(Boolean).join(" / ") || "Not stated")}</dd></div><div><dt>Class</dt><dd>${escape(sourceDescription.classification)} · excluded</dd></div></dl>` : "";
      body.innerHTML = `${controls}<div class="profile-unavailable"><b>Elevation data unavailable</b><span>${escape(view.profileLabel || "Drawn map line")}</span><p>The route is retained, but no verified surveyed, DEM, LiDAR, or measured elevations are available. Hydraulic model assumptions are excluded.</p></div>${rejectedProvenance}`;
    } else {
      const statistics = profile.statistics;
      const provenance = profile.provenance;
      body.innerHTML = `${controls}<div class="profile-status"><b>${escape(view.profileLabel)}</b><span>${profile.samples.length} real source samples</span></div>
        <div class="profile-metrics"><div><span>Distance</span><b>${format(statistics.totalDistance)} m</b></div><div><span>Min / max</span><b>${format(statistics.minimum)} / ${format(statistics.maximum)} m</b></div><div><span>Start / end</span><b>${format(statistics.start)} / ${format(statistics.end)} m</b></div><div><span>Gain / loss</span><b>+${format(statistics.gain)} / -${format(statistics.loss)} m</b></div></div>
        ${profileChart(profile)}<dl class="profile-provenance"><div><dt>Source</dt><dd>${escape(provenance.source)}</dd></div><div><dt>Resolution</dt><dd>${escape(provenance.resolution || "Not stated")}</dd></div><div><dt>Date / version</dt><dd>${escape([provenance.date, provenance.version].filter(Boolean).join(" / ") || "Not stated")}</dd></div><div><dt>Class</dt><dd>${escape(provenance.kind)} · real source</dd></div></dl>`;
    }
    bindProfileControls();
    bindProfileCursor();
  }

  function bindProfileControls() {
    element("drawElevationProfile")?.addEventListener("click", () => {
      view.drawing = true;
      view.profileLine = [];
      view.profileLabel = "Drawn map line";
      ensureProfileLayer()?.setLatLngs([]);
      renderProfile();
    });
    element("finishElevationProfile")?.addEventListener("click", () => { view.drawing = false; renderProfile(); });
    element("clearElevationProfile")?.addEventListener("click", () => {
      view.drawing = false;
      view.profileLine = [];
      ensureProfileLayer()?.setLatLngs([]);
      if (view.profileMarker) window.aquaState.map.removeLayer(view.profileMarker);
      view.profileMarker = null;
      renderProfile();
    });
  }

  function bindProfileCursor() {
    const chart = element("elevationChart");
    chart?.addEventListener("pointermove", event => {
      const bounds = chart.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const target = fraction * view.profile.statistics.totalDistance;
      const sample = view.profile.samples.reduce((best, item) => !best || Math.abs(item.distance - target) < Math.abs(best.distance - target) ? item : best, null);
      if (!sample) return;
      const x = 28 + sample.distance / Math.max(1, view.profile.statistics.totalDistance) * 596;
      element("elevationCursor")?.setAttribute("x1", x);
      element("elevationCursor")?.setAttribute("x2", x);
      element("elevationCursor")?.setAttribute("opacity", "0.8");
      const label = element("elevationCursorLabel");
      label.textContent = `${format(sample.distance)} m · ${format(sample.elevation)} m elevation`;
      label.style.left = `${Math.max(4, Math.min(bounds.width - 170, event.clientX - bounds.left + 8))}px`;
      label.classList.remove("hidden");
      if (!view.profileMarker) view.profileMarker = L.circleMarker(sample.coordinate, { radius: 6, color: "#fff", fillColor: "#55d6be", fillOpacity: 1, weight: 2 }).addTo(window.aquaState.map);
      else view.profileMarker.setLatLng(sample.coordinate);
    });
    chart?.addEventListener("pointerleave", () => {
      element("elevationCursor")?.setAttribute("opacity", "0");
      element("elevationCursorLabel")?.classList.add("hidden");
      if (view.profileMarker) window.aquaState.map.removeLayer(view.profileMarker);
      view.profileMarker = null;
    });
  }

  function showContextMenu(coordinate, point) {
    const menu = element("mapContextMenu");
    if (!menu) return;
    view.contextCoordinate = coordinate;
    menu.querySelector(".map-context-coordinate").textContent = coordinateText(coordinate);
    menu.classList.remove("hidden");
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, point.x))}px`;
    menu.style.top = `${Math.max(74, Math.min(innerHeight - bounds.height - 68, point.y))}px`;
    menu.querySelector("button")?.focus();
  }

  function hideContextMenu() {
    element("mapContextMenu")?.classList.add("hidden");
  }

  async function copyCoordinate() {
    const text = coordinateText(view.contextCoordinate);
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      const input = document.createElement("textarea");
      input.value = text;
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    const label = element("mapContextMenu")?.querySelector(".map-context-coordinate");
    if (label) label.textContent = `${text} · Copied`;
  }

  function bindMap() {
    const map = window.aquaState?.map;
    const container = map?.getContainer();
    if (!map || !container) return;
    map.on("contextmenu", event => {
      event.originalEvent?.preventDefault();
      showContextMenu([event.latlng.lat, event.latlng.lng], { x: event.originalEvent?.clientX || event.containerPoint.x, y: event.originalEvent?.clientY || event.containerPoint.y });
    });
    map.on("click", event => {
      hideContextMenu();
      if (!view.drawing) return;
      view.profileLine.push([event.latlng.lat, event.latlng.lng]);
      ensureProfileLayer()?.setLatLngs(view.profileLine);
      renderProfile();
    });
    let longPress = null;
    let start = null;
    container.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch") return;
      start = { x: event.clientX, y: event.clientY };
      longPress = setTimeout(() => {
        const coordinate = map.mouseEventToLatLng(event);
        showContextMenu([coordinate.lat, coordinate.lng], start);
      }, 650);
    });
    container.addEventListener("pointermove", event => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) clearTimeout(longPress);
    });
    ["pointerup", "pointercancel"].forEach(name => container.addEventListener(name, () => { clearTimeout(longPress); start = null; }));
    element("mapActionsButton")?.addEventListener("click", event => {
      const center = map.getCenter();
      const bounds = event.currentTarget.getBoundingClientRect();
      showContextMenu([center.lat, center.lng], { x: bounds.left - 220, y: bounds.top - 190 });
    });
    element("mapContextMenu")?.addEventListener("click", event => {
      const action = event.target.closest("[data-map-action]")?.dataset.mapAction;
      if (!action || !view.contextCoordinate) return;
      if (action === "street-view") openExternal(window.AquaContextualCore.streetViewUrl(view.contextCoordinate));
      if (action === "navigate") openExternal(window.AquaContextualCore.navigationUrl(view.contextCoordinate));
      if (action === "copy") return copyCoordinate();
      if (action === "profile") {
        view.drawing = true;
        setProfileLine([view.contextCoordinate], "Drawn map line");
      }
      hideContextMenu();
    });
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest("#mapContextMenu,#mapActionsButton")) hideContextMenu();
    });
  }

  function handleSelection(event) {
    const detail = event.detail || {};
    if (detail.kind === "network" && detail.layer?.kind === "dma") return renderDma({ kind: "dma", entity: detail.entity, layer: detail.layer, leaflet: detail.leaflet });
    if (["network", "telemetry", "acoustic-sensor"].includes(detail.kind)) renderAsset({ kind: detail.kind, entity: detail.entity, layer: detail.layer || {}, leaflet: detail.leaflet });
  }

  function bind() {
    window.addEventListener("aqua:selection", handleSelection);
    element("projectSelect")?.addEventListener("change", () => {
      view.selection = null;
      view.dma = null;
      view.profileLine = [];
      setTimeout(renderProfile, 100);
    });
    bindMap();
    renderProfile();
  }

  window.AquaContextual = { renderAsset, renderDma, setProfileLine, streetViewUrl: coordinate => window.AquaContextualCore.streetViewUrl(coordinate), navigationUrl: coordinate => window.AquaContextualCore.navigationUrl(coordinate) };
  window.addEventListener("load", bind);
})();