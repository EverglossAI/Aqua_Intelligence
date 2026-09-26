(() => {
  "use strict";

  const COLORS = { Critical: "#ff5264", High: "#ff9f43", Elevated: "#f2cf5b", Normal: "#4fc58a", "Insufficient evidence": "#526b7b" };
  let results = [];

  const element = id => document.getElementById(id);
  const escape = value => String(value ?? "-").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const format = value => Number(value || 0).toFixed(1);

  function pipeRecords(project) {
    return (project?.layers || []).filter(layer => layer.kind === "pipe").flatMap(layer => (layer.geojson?.features || []).map(feature => ({ feature, layer })));
  }

  function retainedHydraulicContext(project) {
    const context = project?.retainedHydraulicRisk;
    return {
      retained: Boolean(context?.retained),
      engineeringGate: context?.engineeringGate || { usable: false },
      byPipe: context?.byPipe || {}
    };
  }

  function ensureLayer() {
    const state = window.aquaState;
    if (!state?.map || typeof L === "undefined") return null;
    state.leakRiskLayer ||= L.layerGroup();
    return state.leakRiskLayer;
  }

  function filters() {
    const classification = element("riskClassification")?.value;
    return {
      classifications: classification && classification !== "all" ? [classification] : [],
      minimumConfidence: Number(element("riskMinimumConfidence")?.value || 0),
      activeAlertsOnly: Boolean(element("riskActiveOnly")?.checked)
    };
  }

  function classCounts(rows) {
    return Object.fromEntries(Object.keys(COLORS).map(name => [name, rows.filter(row => row.classification === name).length]));
  }

  function renderDetail(result) {
    const card = element("selectionCard");
    if (!card) return;
    const contributions = result.contributions;
    const evidence = result.evidence;
    const alertRows = [...evidence.activeAlerts, ...evidence.historicalAlerts].map(alert => `<button type="button" data-risk-alert="${escape(alert.alertId)}"><b>${escape(alert.alertId)}</b><span>${escape(alert.status)} · ${format(alert.probability)}% · ${format(alert.matchDistance)} m</span></button>`).join("");
    card.innerHTML = `<div class="selection-kicker"><small>PIPE INVESTIGATION</small><span>${escape(result.classification.toUpperCase())}</span></div>
      <b class="selection-title">${escape(result.pipeId)}</b>
      <div class="risk-score-pair"><div><span>Priority</span><b>${result.investigationPriority}</b></div><div><span>Evidence confidence</span><b>${result.evidenceConfidence.score}%</b><small>${result.evidenceConfidence.label}</small></div></div>
      <dl class="selection-grid risk-contributions">
        <div><dt>Active leak alert</dt><dd>+${format(contributions.activeLeakAlert)}</dd></div><div><dt>Independent repeats</dt><dd>+${format(contributions.repeatIndependentAlerts)}</dd></div>
        <div><dt>Historical alerts</dt><dd>+${format(contributions.historicalLeakAlerts)}</dd></div><div><dt>Acoustic intensity</dt><dd>+${format(contributions.acousticIntensity)}</dd></div>
        <div><dt>Pipe susceptibility</dt><dd>+${format(contributions.pipeSusceptibility)}</dd></div><div><dt>Hydraulic signal</dt><dd>+${format(contributions.hydraulic)}</dd></div>
        <div><dt>Synthetic telemetry</dt><dd>+${format(contributions.syntheticTelemetry)}</dd></div><div><dt>Duplicates collapsed</dt><dd>${evidence.duplicateRecordsCollapsed}</dd></div>
      </dl>
      <p class="selection-source">${escape(evidence.susceptibility.material)}${evidence.susceptibility.diameter == null ? "" : ` · ${escape(evidence.susceptibility.diameter)} mm`} · Hydraulic ${escape(evidence.hydraulicStatus)}</p>
      <div class="risk-linked-evidence"><b>Linked operational evidence</b>${alertRows || '<span class="selection-empty">No linked acoustic alert.</span>'}</div>
      <p class="risk-disclaimer">Investigation priority ranks evidence for field review. It is not a leak confirmation.</p>`;
    card.querySelectorAll("[data-risk-alert]").forEach(button => button.addEventListener("click", () => {
      const alert = (window.aquaState?.active?.acousticAlert || []).find(item => String(item.alertId) === button.dataset.riskAlert);
      if (alert) window.AquaAcoustics?.selectAlert(alert);
    }));
  }

  function focusResult(result) {
    const feature = result.pipe?.feature || result.pipe;
    const bounds = L.geoJSON(feature).getBounds();
    if (bounds.isValid()) window.aquaState.map.fitBounds(bounds.pad(0.8), { maxZoom: 19 });
    const linkedAlert = result.evidence.activeAlerts[0] || result.evidence.historicalAlerts[0];
    const linkedSensor = result.evidence.sensors[0];
    if (linkedAlert) window.AquaAcoustics?.selectAlert(linkedAlert);
    else if (linkedSensor) window.AquaAcoustics?.selectSensor(linkedSensor);
    renderDetail(result);
  }

  function selectBasePipe(feature) {
    let selected = false;
    window.aquaState?.kindLayers?.pipe?.eachLayer(wrapper => wrapper.eachLayer?.(layer => {
      if (!selected && layer.__aquaFeature === feature) { selected = true; layer.fire("click"); }
    }));
    return selected;
  }

  function renderOverlay(rows) {
    const layer = ensureLayer();
    if (!layer) return;
    layer.clearLayers();
    rows.forEach(result => {
      const feature = result.pipe?.feature || result.pipe;
      const filterMatch = window.AquaDmaPipeFilters?.matchesFeature?.(feature) !== false;
      const mapFeature = L.geoJSON(feature, {
        style: {
          color: COLORS[result.classification],
          weight: result.classification === "Critical" ? 7 : result.classification === "High" ? 6 : 4,
          opacity: filterMatch ? result.classification === "Insufficient evidence" ? 0.25 : 0.9 : 0.06
        },
        onEachFeature: (_feature, leaflet) => {
          leaflet.bindTooltip(`${escape(result.pipeId)} · ${result.classification} · priority ${result.investigationPriority} · confidence ${result.evidenceConfidence.score}%`);
          leaflet.on("click", () => { if (!selectBasePipe(feature)) focusResult(result); });
        }
      });
      mapFeature.addTo(layer);
    });
    const visible = element("showLeakRiskOverlay")?.checked !== false;
    if (visible && !window.aquaState.map.hasLayer(layer)) layer.addTo(window.aquaState.map);
    if (!visible && window.aquaState.map.hasLayer(layer)) window.aquaState.map.removeLayer(layer);
    layer.eachLayer(item => item.bringToFront?.());
    window.AquaDmaPipeFilters?.reapplySelection?.();
  }

  function panelMarkup(rows) {
    const counts = classCounts(results);
    const filtered = rows.length !== results.length ? `${rows.length} of ${results.length}` : String(results.length);
    return `<div class="risk-controls">
      <label>Class<select id="riskClassification"><option value="all">All classes</option>${Object.keys(COLORS).map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join("")}</select></label>
      <label>Min confidence<select id="riskMinimumConfidence"><option value="0">Any</option><option value="55">Medium · 55%</option><option value="80">High · 80%</option></select></label>
      <label class="risk-check"><input id="riskActiveOnly" type="checkbox"> Active alerts only</label>
    </div>
    <div class="risk-summary"><div><span>Shown</span><b>${filtered}</b></div><div><span>Critical</span><b>${counts.Critical}</b></div><div><span>High</span><b>${counts.High}</b></div><div><span>Elevated</span><b>${counts.Elevated}</b></div></div>
    <div class="risk-list">${rows.slice(0, 100).map(result => `<button type="button" data-risk-pipe="${escape(result.pipeId)}"><i style="background:${COLORS[result.classification]}"></i><span><b>${escape(result.pipeId)}</b><small>${escape(result.classification)} · ${result.evidence.activeAlerts.length} active · ${result.evidence.historicalAlerts.length} historical</small></span><strong>${result.investigationPriority}<small>${result.evidenceConfidence.score}% conf.</small></strong></button>`).join("") || '<div class="empty-row">No pipes meet these filters.</div>'}</div>
    <p class="risk-method">Priority combines de-duplicated operational acoustic alerts, meaningful matched intensity and separate pipe susceptibility. Synthetic pressure/flow contributes 0. Hydraulics contributes 0 unless an explicitly retained pipe-level result passes its engineering gate.</p>`;
  }

  function bindPanel(previous = {}) {
    const panel = element("eventList");
    if (!panel) return;
    const classification = element("riskClassification");
    const confidence = element("riskMinimumConfidence");
    const active = element("riskActiveOnly");
    if (classification) classification.value = previous.classification || "all";
    if (confidence) confidence.value = String(previous.minimumConfidence || 0);
    if (active) active.checked = Boolean(previous.activeAlertsOnly);
    [classification, confidence, active].filter(Boolean).forEach(control => control.addEventListener("change", applyFilters));
    panel.querySelectorAll("[data-risk-pipe]").forEach(button => button.addEventListener("click", () => {
      const result = results.find(item => item.pipeId === button.dataset.riskPipe);
      if (result) focusResult(result);
    }));
  }

  function applyFilters() {
    const current = filters();
    const filtered = window.AquaLeakRiskCore.filterLeakRisk(results, current);
    element("eventList").innerHTML = panelMarkup(filtered);
    bindPanel(current);
    renderOverlay(filtered);
  }

  function render() {
    const project = window.aquaState?.active;
    const panel = element("eventList");
    if (!panel) return [];
    if (!project) {
      panel.innerHTML = '<div class="empty-row">Open a project to assess pipe investigation priority.</div>';
      renderOverlay([]);
      return [];
    }
    const hydraulicContext = retainedHydraulicContext(project);
    results = window.AquaLeakRiskCore?.analyzeLeakRisk({
      pipes: pipeRecords(project),
      alerts: project.acousticAlert || [],
      sensors: project.acousticSensor || [],
      telemetry: project.telemetry || [],
      includeHydraulics: true,
      hydraulicContext
    }) || [];
    applyFilters();
    return results;
  }

  function bind() {
    element("refreshEvents")?.addEventListener("click", render);
    if (element("runFusion")) element("runFusion").onclick = () => {
      render();
      window.AquaWindowManager?.restore("events");
    };
    element("showLeakRiskOverlay")?.addEventListener("change", () => renderOverlay(window.AquaLeakRiskCore.filterLeakRisk(results, filters())));
    element("projectSelect")?.addEventListener("change", () => setTimeout(render, 120));
    document.addEventListener("click", event => {
      if (event.target.closest('[data-window-id="events"],[data-tool-window-id="events"]')) setTimeout(render, 0);
    });
  }

  window.AquaLeakRisk = { render, focusResult, refreshOverlay() { renderOverlay(window.AquaLeakRiskCore.filterLeakRisk(results, filters())); }, get results() { return results; } };
  window.addEventListener("load", bind);
})();