(() => {
  "use strict";

  let topologyLayer = null;
  let fixLayer = null;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }

  function distance(value) {
    return value == null ? "—" : `${Number(value).toFixed(value < 0.001 ? 6 : 3)} m`;
  }

  function activeTopology() {
    return window.aquaState?.active?.hydraulicTopology || null;
  }

  function ensureLayers() {
    const map = window.aquaState?.map;
    if (!map || typeof L === "undefined") return false;
    topologyLayer ||= L.layerGroup();
    fixLayer ||= L.layerGroup();
    return true;
  }

  function setMapLayer(layer, visible) {
    const map = window.aquaState?.map;
    if (!map || !layer) return;
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
  }

  function renderMap() {
    if (!ensureLayers()) return;
    const topology = activeTopology();
    topologyLayer.clearLayers();
    fixLayer.clearLayers();
    if (topology) {
      const nodes = topology.derived.nodes;
      topology.derived.edges.forEach(edge => {
        const start = nodes[edge.a]?.coord;
        const end = nodes[edge.b]?.coord;
        if (!start || !end) return;
        const target = edge.connectionType === "endpoint-to-line" ? fixLayer : topologyLayer;
        L.polyline([start, end], {
          color: edge.connectionType === "endpoint-to-line" ? "#f2cf5b" : "#49d6df",
          weight: edge.connectionType === "endpoint-to-line" ? 4 : 2,
          opacity: edge.connectionType === "endpoint-to-line" ? 0.95 : 0.55,
          dashArray: edge.connectionType === "endpoint-to-line" ? "5 4" : null
        }).bindTooltip(edge.connectionType === "endpoint-to-line" ? `Derived attachment · ${escape(edge.sourcePipeId)}` : `Hydraulic edge · ${escape(edge.sourcePipeId)}`).addTo(target);
      });
    }
    setMapLayer(topologyLayer, Boolean(document.getElementById("showDerivedTopology")?.checked));
    setMapLayer(fixLayer, Boolean(document.getElementById("showConnectionFixes")?.checked));
  }

  function renderDiagnostics(topology = activeTopology()) {
    const panel = document.getElementById("topologyDiagnostics");
    if (!panel) return;
    if (!topology) {
      panel.innerHTML = '<div class="empty-row">Build the derived graph to compare source and hydraulic topology.</div>';
      return;
    }
    const source = topology.source;
    const derived = topology.derived;
    const diagnostics = topology.diagnostics;
    const audit = diagnostics.connectionAudit;
    const accepted = audit?.acceptedEndpointToLine;
    const legacy = audit?.legacyEndpointToLineScreen;
    const reconciliation = audit?.reconciliation;
    panel.innerHTML = `<div class="topology-comparison">
      <div><small>Source topology</small><b>${source.nodes.length} nodes</b><span>${source.edges.length} edges · ${source.components} components · ${source.largestComponentPercent.toFixed(1)}% largest</span><span>${source.isolatedServicePipes} isolated service pipes</span></div>
      <div><small>Derived hydraulic topology</small><b>${derived.nodes.length} nodes</b><span>${derived.edges.length} edges · ${derived.components} components · ${derived.largestComponentPercent.toFixed(1)}% largest</span><span>${derived.isolatedServicePipes} isolated service pipes</span></div>
    </div>
    <div class="topology-diagnostic-list">
      <span><b>${diagnostics.endpointToLineAttachments}</b> accepted service-to-main attachments</span>
      <span><b>${diagnostics.connectedServicePipesBefore} → ${diagnostics.connectedServicePipesAfter}</b> connected service pipes</span>
      <span><b>${diagnostics.unresolvedCrossings}</b> unresolved crossings</span>
      <span><b>${topology.reviewRequiredConnections}</b> review-required connections</span>
    </div>
    ${audit ? `<details class="hydraulic-detail"><summary>Connection provenance audit</summary>
      <div class="calibration-table-wrap"><table class="telemetry-table"><thead><tr><th>Connection set</th><th>Count</th><th>Min</th><th>Median</th><th>P95</th><th>Max</th></tr></thead><tbody>
        <tr><td><b>3 m endpoint merges</b><small>${escape(JSON.stringify(audit.endpointToEndpoint.byType))}</small></td><td>${audit.endpointToEndpoint.count}</td><td>${distance(audit.endpointToEndpoint.distanceMetres.min)}</td><td>${distance(audit.endpointToEndpoint.distanceMetres.median)}</td><td>${distance(audit.endpointToEndpoint.distanceMetres.p95)}</td><td>${distance(audit.endpointToEndpoint.distanceMetres.max)}</td></tr>
        <tr><td><b>Accepted endpoint-to-main</b><small>isolated service source only</small></td><td>${accepted.count}</td><td>${distance(accepted.distanceMetres.min)}</td><td>${distance(accepted.distanceMetres.median)}</td><td>${distance(accepted.distanceMetres.p95)}</td><td>${distance(accepted.distanceMetres.max)}</td></tr>
        <tr><td><b>Historic endpoint-to-line screen</b><small>${escape(JSON.stringify(legacy.byType))}</small></td><td>${legacy.count}</td><td>${distance(legacy.distanceMetres.min)}</td><td>${distance(legacy.distanceMetres.median)}</td><td>${distance(legacy.distanceMetres.p95)}</td><td>${distance(legacy.distanceMetres.max)}</td></tr>
      </tbody></table></div>
      <p class="result-note">Historic screen versus accepted connectors: ${reconciliation.sharedSourceEndpoints} shared endpoints, ${reconciliation.acceptedOnlySourceEndpoints} accepted-only, ${reconciliation.legacyOnlySourceEndpoints} historic-only. Explicit valve/meter connections: ${audit.explicitValveMeterConnections}. Geometric crossing connections created: ${audit.geometricCrossingConnections}.</p>
    </details>` : ""}`;
  }

  async function build(options = {}) {
    const state = window.aquaState;
    if (!state?.active) throw new Error("Open a GIS project first.");
    if (!window.AquaTopologyCore) throw new Error("Topology engine is unavailable.");
    const button = document.getElementById("buildDerivedTopology");
    if (button) { button.disabled = true;button.textContent = "Building..."; }
    try {
      const topology = window.AquaTopologyCore.buildHydraulicTopology(state.active.layers, { endpointTolerance: 3, attachmentTolerance: 0.25 });
      if (options.attach !== false) state.active.hydraulicTopology = topology;
      if (options.render !== false) {
        renderDiagnostics(topology);
        renderMap();
        document.getElementById("topologyStatus").textContent = `${topology.derived.components} derived components`;
      }
      if (options.persist !== false && options.attach !== false && window.AquaAuthorization?.canEdit()) await window.AquaProjectPersistence.save(state.active, { setActive: true });
      return topology;
    } finally {
      if (button) { button.disabled = false;button.textContent = "Build derived topology"; }
    }
  }

  window.AquaHydraulicTopology = { build, render: renderDiagnostics, renderMap, get active() { return activeTopology(); } };

  window.addEventListener("load", () => {
    document.getElementById("buildDerivedTopology")?.addEventListener("click", () => build().catch(error => {
      document.getElementById("topologyDiagnostics").innerHTML = `<div class="result-note"><b>Topology build failed:</b> ${escape(error.message)}</div>`;
    }));
    document.getElementById("showOriginalGis")?.addEventListener("change", event => setMapLayer(window.aquaState.networkLayer, event.target.checked));
    document.getElementById("showDerivedTopology")?.addEventListener("change", renderMap);
    document.getElementById("showConnectionFixes")?.addEventListener("change", renderMap);
  });
})();