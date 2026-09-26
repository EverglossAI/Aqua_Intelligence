(() => {
  "use strict";

  const view = { selection: null, contextCoordinate: null, drawing: false, profileLine: [], profileLayer: null, profileMarker: null, profileRequest: 0, savedProfileId: null, profileDmaId: null, savedLayers: new Map(), pipeFilters: { dmaId: null, materials: new Set(), diameters: new Set() } };
  const element = id => document.getElementById(id);
  const escape = value => String(value ?? "-").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const format = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";

  function project() {
    return window.aquaState?.active || null;
  }

  function savedProfiles() {
    const active = project();
    if (!active) return [];
    active.analyses = active.analyses || {};
    active.analyses.elevationProfiles = Array.isArray(active.analyses.elevationProfiles) ? active.analyses.elevationProfiles : [];
    return active.analyses.elevationProfiles;
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
    window.AquaInvestigationContext?.update({
      selectedAsset: { ...selection, coordinate, identity },
      selectedMapPoint: null,
      selectedPipe: selection.layer?.kind === "pipe" ? { feature: selection.entity, id: evidence.pipeId, coordinate } : null
    }, "selection");
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
        <button type="button" data-asset-action="environment"${coordinate ? "" : " disabled"}>Environmental context</button>
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
    body.querySelector('[data-asset-action="environment"]')?.addEventListener("click", () => window.AquaEnvironmental?.open({ coordinate, label: `${identity.type} ${identity.id}`, pipeId: evidence.pipeId, alerts: evidence.alerts }));
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

  function breakdownMarkup(rows, group) {
    if (!group) return rows.length ? rows.map(row => `<span>${escape(row.value)} <b>${row.count}</b></span>`).join("") : '<span class="context-empty">Unavailable</span>';
    const selected = view.pipeFilters[group];
    return rows.length ? rows.map(row => {
      const value = String(row.value).toUpperCase();
      return `<button type="button" class="dma-filter-chip${selected.has(value) ? " active" : ""}" data-pipe-filter-group="${group}" data-pipe-filter-value="${escape(row.value)}" aria-pressed="${selected.has(value)}">${escape(row.value)}${group === "diameters" ? " mm" : ""} <b>${row.count}</b></button>`;
    }).join("") : '<span class="context-empty">Unavailable</span>';
  }

  function filtersActive() {
    return view.pipeFilters.materials.size > 0 || view.pipeFilters.diameters.size > 0;
  }

  function filterSummary(summary) {
    if (!filtersActive()) return "";
    const result = window.AquaContextualCore.filteredPipeSummary(summary.pipes, view.pipeFilters);
    const labels = [...view.pipeFilters.materials, ...[...view.pipeFilters.diameters].map(value => `${value} mm`)];
    return `<div class="dma-filter-summary"><b>${escape(labels.join(" · "))}</b><span>${result.count} pipes · ${format(result.totalLength / 1000, 2)} km</span><button type="button" id="clearDmaPipeFilters">Clear filters</button></div>`;
  }

  function matchesFilteredPipe(feature) {
    if (!filtersActive() || !view.dma) return true;
    if (!view.dma.pipes.includes(feature)) return false;
    return window.AquaContextualCore.filterDmaPipes([feature], view.pipeFilters).length === 1;
  }

  function reapplySelectedPipe() {
    const selected = window.aquaState?.selected;
    if (selected?.layer?.kind === "pipe" && selected.leaflet?.setStyle) {
      selected.leaflet.setStyle({ color: "#ffffff", weight: 5, fillOpacity: 0.35, opacity: 1 });
      selected.leaflet.bringToFront?.();
    }
  }

  function applyPipeFilterStyles() {
    window.aquaState?.kindLayers?.pipe?.eachLayer(wrapper => wrapper.eachLayer?.(layer => {
      const feature = layer.__aquaFeature;
      if (!feature || !layer.setStyle) return;
      const base = window.aquaFeatureStyle?.("pipe", feature) || { color: "#36a3ff", weight: 2.3, opacity: 0.72 };
      layer.setStyle(base);
    }));
    window.AquaLeakRisk?.refreshOverlay?.();
    reapplySelectedPipe();
  }

  function bindDmaFilters(selection) {
    element("dmaDetailsBody")?.querySelectorAll("[data-pipe-filter-group]").forEach(button => button.addEventListener("click", () => {
      const group = button.dataset.pipeFilterGroup;
      const value = String(button.dataset.pipeFilterValue).toUpperCase();
      const selected = view.pipeFilters[group];
      if (selected.has(value)) selected.delete(value); else selected.add(value);
      renderDma(selection);
      applyPipeFilterStyles();
    }));
    element("clearDmaPipeFilters")?.addEventListener("click", () => {
      view.pipeFilters.materials.clear();
      view.pipeFilters.diameters.clear();
      renderDma(selection);
      applyPipeFilterStyles();
    });
  }

  function renderDma(selection) {
    const core = window.AquaContextualCore;
    const body = element("dmaDetailsBody");
    if (!core || !body) return;
    const dmaContext = core.logicalDmaContext(project(), selection.entity);
    const summary = core.summarizeDma(project(), selection.entity, window.AquaLeakRisk?.results || []);
    if (view.pipeFilters.dmaId !== summary.id) {
      view.pipeFilters.dmaId = summary.id;
      view.pipeFilters.materials.clear();
      view.pipeFilters.diameters.clear();
    }
    view.dma = summary;
    window.AquaInvestigationContext?.update({ selectedDMA: { ...dmaContext, summary }, selectedAsset: null, selectedMapPoint: null, selectedPipe: null }, "selection");
    const elevation = summary.elevation ? `${format(summary.elevation.minimum)}-${format(summary.elevation.maximum)} m · ${escape(summary.elevation.provenance.source)}` : "Elevation data unavailable";
    body.innerHTML = `<div class="context-heading"><div><small>DMA ${escape(summary.code)}</small><h3>${escape(summary.name)}</h3></div><span>${summary.pipeCount} mapped pipes</span></div>
      <div class="dma-metrics"><div><span>Pipe length</span><b>${format(summary.totalPipeLength / 1000, 2)} km</b></div><div><span>Pressure loggers</span><b>${summary.pressureLoggers.length}</b></div><div><span>Flow meters</span><b>${summary.flowMeters.length}</b></div><div><span>Acoustic sensors</span><b>${summary.acousticSensors.length}</b></div><div><span>Active alerts</span><b>${summary.activeAlerts.length}</b></div><div><span>Historical alerts</span><b>${summary.historicalAlerts.length}</b></div></div>
      <section class="context-section"><h4>Pipe materials</h4><div class="context-breakdown">${breakdownMarkup(summary.materials, "materials")}</div></section>
      <section class="context-section"><h4>Pipe diameters</h4><div class="context-breakdown">${breakdownMarkup(summary.diameters, "diameters")}</div></section>
      ${filterSummary(summary)}
      <section class="context-section"><h4>Investigation priority</h4><div class="context-breakdown"><span>Critical <b>${summary.priority.critical}</b></span><span>High <b>${summary.priority.high}</b></span><span>Elevated <b>${summary.priority.elevated}</b></span><span>Maximum <b>${summary.priority.maximum ?? "-"}</b></span></div></section>
      <section class="context-section"><h4>Monitoring sources</h4><div class="context-related">${[...summary.inletMeters, ...summary.pressureLoggers.filter(item => !summary.inletMeters.includes(item)), ...summary.flowMeters.filter(item => !summary.inletMeters.includes(item))].map(telemetryButton).join("") || '<p class="context-empty">No linked monitoring sources.</p>'}</div></section>
      <section class="context-section"><h4>Elevation</h4><p>${elevation}</p><button type="button" class="secondary" id="openDmaElevation">Open Elevation Profile</button></section>
      <section class="context-section"><h4>Environmental evidence</h4><p>Review weather-model context and event timing separately from investigation priority.</p><button type="button" class="secondary" id="openDmaEnvironment">Open Environmental Context</button></section>`;
    body.querySelectorAll("[data-dma-telemetry]").forEach(button => button.addEventListener("click", () => selectTelemetry(button.dataset.dmaTelemetry)));
    bindDmaFilters(selection);
    element("openDmaElevation")?.addEventListener("click", () => openDmaProfile(summary));
    element("openDmaEnvironment")?.addEventListener("click", () => window.AquaEnvironmental?.open());
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

  function clearProfileMarker() {
    if (view.profileMarker && window.aquaState?.map) window.aquaState.map.removeLayer(view.profileMarker);
    view.profileMarker = null;
  }

  function clearTemporaryProfile() {
    view.profileRequest++;
    view.drawing = false;
    view.profileLine = [];
    view.profile = null;
    view.savedProfileId = null;
    view.profileDmaId = null;
    ensureProfileLayer()?.setLatLngs([]);
    clearProfileMarker();
  }

  function compactProfileRecord(existing) {
    const profile = view.profile;
    const statistics = profile?.statistics || {};
    const provenance = profile?.provenance || {};
    return {
      profileId: existing?.profileId || `elevation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: existing?.name || (view.profileLabel !== "Drawn map line" ? view.profileLabel : `Elevation profile ${savedProfiles().length + 1}`),
      projectId: project()?.id || null,
      dmaId: view.profileDmaId || existing?.dmaId || null,
      geometry: view.profileLine.map(coordinate => [Number(coordinate[0]), Number(coordinate[1])]),
      source: view.profileLabel || existing?.source || "Drawn map line",
      createdAt: existing?.createdAt || new Date().toISOString(),
      elevationProvider: provenance.source || null,
      dataset: provenance.dataset || null,
      resolution: provenance.resolution || null,
      sampleCount: profile?.samples?.length || 0,
      distance: statistics.totalDistance ?? null,
      minimum: statistics.minimum ?? null,
      maximum: statistics.maximum ?? null,
      gain: statistics.gain ?? null,
      loss: statistics.loss ?? null,
      samples: (profile?.samples || []).map(sample => ({ coordinate: sample.coordinate, distance: sample.distance, elevation: sample.elevation })),
      provenance,
      visible: existing?.visible !== false
    };
  }

  async function persistProfiles() {
    return window.AquaProjectPersistence?.save ? window.AquaProjectPersistence.save(project(), { setActive: true }) : false;
  }

  function renderSavedLayers() {
    view.savedLayers.forEach(layer => window.aquaState?.map?.removeLayer(layer));
    view.savedLayers.clear();
    if (!window.aquaState?.map || typeof L === "undefined") return;
    savedProfiles().filter(profile => profile.visible !== false && profile.geometry?.length > 1).forEach(profile => {
      const layer = L.polyline(profile.geometry, { color: "#55d6be", weight: 4, opacity: 0.9 }).addTo(window.aquaState.map);
      layer.bindTooltip(profile.name || "Saved elevation profile");
      layer.on("click", () => openSavedProfile(profile.profileId));
      view.savedLayers.set(profile.profileId, layer);
    });
  }

  function profileFromRecord(record) {
    const samples = Array.isArray(record.samples) ? record.samples : [];
    return {
      available: samples.length >= 2,
      samples,
      statistics: samples.length >= 2 ? { totalDistance: record.distance, minimum: record.minimum, maximum: record.maximum, gain: record.gain, loss: record.loss, start: samples[0]?.elevation, end: samples.at(-1)?.elevation } : null,
      provenance: record.provenance || null
    };
  }

  async function saveCurrentProfile() {
    if (view.profileLine.length < 2) return false;
    const profiles = savedProfiles();
    const existing = profiles.find(profile => profile.profileId === view.savedProfileId) || profiles.find(profile => JSON.stringify(profile.geometry) === JSON.stringify(view.profileLine));
    const record = compactProfileRecord(existing);
    const index = existing ? profiles.indexOf(existing) : -1;
    if (index >= 0) profiles[index] = record; else profiles.push(record);
    view.savedProfileId = record.profileId;
    view.profileLabel = record.name;
    if (!await persistProfiles()) {
      if (index >= 0) profiles[index] = existing; else profiles.pop();
      view.savedProfileId = existing?.profileId || null;
      return false;
    }
    ensureProfileLayer()?.setLatLngs([]);
    view.profile = profileFromRecord(record);
    renderSavedLayers();
    renderProfile();
    window.dispatchEvent(new CustomEvent("aqua:elevation-profiles-changed"));
    return true;
  }

  function openSavedProfile(profileId) {
    const record = savedProfiles().find(profile => profile.profileId === profileId);
    if (!record) return;
    view.savedProfileId = record.profileId;
    view.profileDmaId = record.dmaId;
    view.profileLine = record.geometry.map(coordinate => [...coordinate]);
    view.profileLabel = record.name;
    view.profile = profileFromRecord(record);
    window.AquaInvestigationContext?.update({ activeProfile: record }, "profile");
    ensureProfileLayer()?.setLatLngs([]);
    renderProfile();
    window.AquaWindowManager?.restore("elevation-profile");
  }

  function setProfileLine(line, label = "Drawn map line") {
    view.savedProfileId = null;
    view.profileLine = line;
    view.profileLabel = label;
    window.AquaInvestigationContext?.update({ activeProfile: line.length > 1 ? { label, geometry: line } : null }, "profile");
    ensureProfileLayer()?.setLatLngs(line);
    if (line.length > 1) window.aquaState.map.fitBounds(L.latLngBounds(line).pad(0.2), { maxZoom: 18 });
    renderProfile();
    window.AquaWindowManager?.restore("elevation-profile");
  }

  function openDmaProfile(summary) {
    const line = longestDmaLine(summary);
    view.profileDmaId = summary.id;
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

  async function renderProfile() {
    const body = element("elevationProfileBody");
    const core = window.AquaContextualCore;
    if (!body || !core) return;
    const source = core.resolveElevationSource(project());
    const sourceDescription = core.describeElevationSource(project());
    const saved = savedProfiles().find(item => item.profileId === view.savedProfileId);
    let profile = saved ? view.profile : core.buildElevationProfile(view.profileLine, source);
    const controls = `<div class="profile-controls"><button type="button" class="primary" id="drawElevationProfile">${view.drawing ? "Drawing..." : "Draw profile"}</button><button type="button" class="secondary" id="finishElevationProfile"${view.drawing ? "" : " disabled"}>Finish</button><button type="button" class="secondary" id="saveElevationProfile"${view.profileLine.length > 1 && !view.drawing ? "" : " disabled"}>${saved ? "Save" : "Save profile"}</button>${saved ? `<button type="button" class="secondary" id="compareElevationProfile">Compare</button><button type="button" class="secondary" id="renameElevationProfile">Rename</button><button type="button" class="secondary" id="toggleElevationProfile">${saved.visible === false ? "Show" : "Hide"}</button>` : ""}<button type="button" class="secondary" id="clearElevationProfile">Clear</button></div>`;
    if (view.profileLine.length < 2) {
      const savedList = savedProfiles().map(item => `<button type="button" class="saved-profile-row" data-saved-profile="${escape(item.profileId)}"><b>${escape(item.name)}</b><span>${format(item.distance)} m · ${item.sampleCount} samples${item.visible === false ? " · hidden" : ""}</span></button>`).join("");
      body.innerHTML = `${controls}<div class="profile-status"><b>${view.drawing ? "Choose at least two points on the map" : "No profile line"}</b><span>${escape(view.profileLabel || "Draw an A-to-B or multi-point line on the map.")}</span></div>${savedList ? `<section class="saved-profiles"><h4>Saved profiles</h4>${savedList}</section>` : ""}`;
    } else if (view.drawing) {
      body.innerHTML = `${controls}<div class="profile-status"><b>Profile line in progress</b><span>Finish the line to request terrain elevations.</span></div>`;
    } else if (!profile.available && window.AquaElevationProviders) {
      const request = ++view.profileRequest;
      body.innerHTML = `${controls}<div class="profile-status"><b>Loading terrain elevation...</b><span>${escape(view.profileLabel || "Drawn map line")}</span></div>`;
      bindProfileControls();
      try { profile = await window.AquaElevationProviders.fetchProfile(view.profileLine); }
      catch (_error) { profile = null; }
      if (request !== view.profileRequest) return;
      renderProfileResult(body, controls, profile, sourceDescription);
      return;
    } else {
      renderProfileResult(body, controls, profile, sourceDescription);
      return;
    }
    view.profile = profile;
    bindProfileControls();
    bindProfileCursor();
  }

  function renderProfileResult(body, controls, profile, sourceDescription) {
    view.profile = profile;
    if (!profile?.available) {
      const rejectedProvenance = sourceDescription ? `<dl class="profile-provenance"><div><dt>Source</dt><dd>${escape(sourceDescription.source)}</dd></div><div><dt>Resolution</dt><dd>${escape(sourceDescription.resolution || "Not stated")}</dd></div><div><dt>Date / version</dt><dd>${escape([sourceDescription.date, sourceDescription.version].filter(Boolean).join(" / ") || "Not stated")}</dd></div><div><dt>Class</dt><dd>${escape(sourceDescription.classification)} · excluded</dd></div></dl>` : "";
      body.innerHTML = `${controls}<div class="profile-unavailable"><b>Elevation data unavailable</b><span>${escape(view.profileLabel || "Drawn map line")}</span><p>The route is retained, but no verified surveyed, DEM, LiDAR, or measured elevations are available. Hydraulic model assumptions are excluded.</p></div>${rejectedProvenance}`;
    } else {
      const statistics = profile.statistics;
      const provenance = profile.provenance;
      const dataset = provenance.dataset ? `<div><dt>Dataset</dt><dd>${escape(provenance.dataset)}</dd></div>` : "";
      const attribution = provenance.attribution ? `<p class="context-provenance">${escape(provenance.attribution)}</p>` : "";
      const terrainWarning = /dem|terrain/i.test(`${provenance.kind || ""} ${provenance.dataset || ""}`) ? `<p class="profile-warning">Terrain DEM — not surveyed engineering level data</p>` : "";
      body.innerHTML = `${controls}<div class="profile-status"><b>${escape(view.profileLabel)}</b><span>${profile.samples.length} real source samples</span></div>
        <div class="profile-metrics"><div><span>Distance</span><b>${format(statistics.totalDistance)} m</b></div><div><span>Min / max</span><b>${format(statistics.minimum)} / ${format(statistics.maximum)} m</b></div><div><span>Start / end</span><b>${format(statistics.start)} / ${format(statistics.end)} m</b></div><div><span>Gain / loss</span><b>+${format(statistics.gain)} / -${format(statistics.loss)} m</b></div></div>
        ${profileChart(profile)}<dl class="profile-provenance"><div><dt>Elevation source</dt><dd>${escape(provenance.source)}</dd></div>${dataset}<div><dt>Data class</dt><dd>${escape(provenance.kind)}</dd></div><div><dt>Resolution</dt><dd>${escape(provenance.resolution || "Not stated")}</dd></div><div><dt>Units</dt><dd>${escape(provenance.units || "m")}</dd></div></dl>${terrainWarning}${attribution}`;
    }
    bindProfileControls();
    bindProfileCursor();
  }

  function bindProfileControls() {
    element("drawElevationProfile")?.addEventListener("click", () => {
      view.profileRequest++;
      view.drawing = true;
      view.profileLine = [];
      view.savedProfileId = null;
      view.profileDmaId = null;
      view.profileLabel = "Drawn map line";
      ensureProfileLayer()?.setLatLngs([]);
      renderProfile();
    });
    element("finishElevationProfile")?.addEventListener("click", () => { view.drawing = false; renderProfile(); });
    element("saveElevationProfile")?.addEventListener("click", saveCurrentProfile);
    element("compareElevationProfile")?.addEventListener("click", () => window.AquaComparison?.openSpatialForSource(`elevation:${view.savedProfileId}`));
    element("renameElevationProfile")?.addEventListener("click", async () => {
      const record = savedProfiles().find(profile => profile.profileId === view.savedProfileId);
      if (!record) return;
      const name = prompt("Profile name", record.name)?.trim();
      if (!name) return;
      record.name = name;
      view.profileLabel = name;
      await persistProfiles();
      renderSavedLayers();
      renderProfile();
      window.dispatchEvent(new CustomEvent("aqua:elevation-profiles-changed"));
    });
    element("toggleElevationProfile")?.addEventListener("click", async () => {
      const record = savedProfiles().find(profile => profile.profileId === view.savedProfileId);
      if (!record) return;
      record.visible = record.visible === false;
      await persistProfiles();
      renderSavedLayers();
      renderProfile();
    });
    element("clearElevationProfile")?.addEventListener("click", async () => {
      const profiles = savedProfiles();
      const index = profiles.findIndex(profile => profile.profileId === view.savedProfileId);
      if (index >= 0) {
        profiles.splice(index, 1);
        await persistProfiles();
        renderSavedLayers();
        window.dispatchEvent(new CustomEvent("aqua:elevation-profiles-changed"));
      }
      clearTemporaryProfile();
      renderProfile();
    });
    element("elevationProfileBody")?.querySelectorAll("[data-saved-profile]").forEach(button => button.addEventListener("click", () => openSavedProfile(button.dataset.savedProfile)));
  }

  function requestProfileClose() {
    if (view.savedProfileId || view.profileLine.length < 2) return Promise.resolve(true);
    const modal = element("elevationCloseModal");
    if (!modal) return Promise.resolve(false);
    modal.classList.remove("hidden");
    return new Promise(resolve => {
      const finish = value => { modal.classList.add("hidden"); resolve(value); };
      modal.querySelectorAll("[data-elevation-close]").forEach(button => button.onclick = async () => {
        if (button.dataset.elevationClose === "cancel") return finish(false);
        if (button.dataset.elevationClose === "clear") { clearTemporaryProfile(); renderProfile(); return finish(true); }
        if (await saveCurrentProfile()) finish(true);
      });
      modal.querySelector('[data-elevation-close="cancel"]')?.focus();
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
      if (action === "environment") window.AquaEnvironmental?.open({ coordinate: view.contextCoordinate, label: "Map location", alerts: [] });
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
      view.pipeFilters.dmaId = null;
      view.pipeFilters.materials.clear();
      view.pipeFilters.diameters.clear();
      clearTemporaryProfile();
      applyPipeFilterStyles();
      setTimeout(() => { renderSavedLayers(); renderProfile(); }, 100);
    });
    bindMap();
    renderSavedLayers();
    renderProfile();
  }

  function handleProjectActivated() {
    clearTemporaryProfile();
    renderSavedLayers();
    renderProfile();
  }

  function dmaSelection(dmaCode) {
    const active = project();
    const mapping = (active?.dmaFeatureMappings || []).find(item => String(item.dmaCode) === String(dmaCode));
    const layer = (active?.layers || []).find(item => item.name === mapping?.sourceLayer);
    const entity = layer?.geojson?.features?.[mapping?.featureIndex];
    return entity ? { kind: "dma", entity, layer } : null;
  }

  function filterPipes(options = {}) {
    const selection = dmaSelection(options.dmaCode);
    if (selection) renderDma(selection);
    view.pipeFilters.materials = new Set((options.materials || []).map(value => String(value).toUpperCase()));
    view.pipeFilters.diameters = new Set((options.diameters || []).map(value => String(Number(value))));
    if (selection) renderDma(selection);
    applyPipeFilterStyles();
    return view.dma ? window.AquaContextualCore.filteredPipeSummary(view.dma.pipes, view.pipeFilters) : { pipes: [], count: 0, totalLength: 0 };
  }

  function openDmaElevation(dmaCode) {
    const selection = dmaSelection(dmaCode);
    if (!selection) return false;
    renderDma(selection);
    openDmaProfile(view.dma);
    return true;
  }

  window.AquaContextual = { renderAsset, renderDma, setProfileLine, savedProfiles, openSavedProfile, selectTelemetry, filterPipes, openDmaElevation, streetViewUrl: coordinate => window.AquaContextualCore.streetViewUrl(coordinate), navigationUrl: coordinate => window.AquaContextualCore.navigationUrl(coordinate) };
  window.AquaDmaPipeFilters = {
    matchesFeature: matchesFilteredPipe,
    style(feature, base) { return filtersActive() ? { ...base, opacity: matchesFilteredPipe(feature) ? 0.95 : 0.08, weight: matchesFilteredPipe(feature) ? Math.max(3.5, base.weight || 0) : 1.2 } : base; },
    reapplySelection: reapplySelectedPipe
  };
  window.addEventListener("aqua:windows-ready", () => window.AquaWindowManager?.setBeforeClose("elevation-profile", requestProfileClose));
  window.addEventListener("aqua:project-activated", handleProjectActivated);
  window.addEventListener("load", bind);
})();