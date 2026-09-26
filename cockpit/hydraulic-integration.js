(() => {
  "use strict";

  let worstPressureLayer = null;
  let latestRun = null;
  let latestDiagnosis = null;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }

  function roughnessAssumptions() {
    const values = Object.fromEntries([...document.querySelectorAll("[data-roughness]")].map(input => [input.dataset.roughness, Number(input.value)]));
    return {
      PVC: values.PVC, HDPE: values.PVC, PE: values.PVC,
      DIP: values.DIP, DI: values.DIP,
      STEEL: values.STEEL, MS: values.STEEL, GI: values.STEEL,
      CI: values.CI, AC: values.CI,
      UNKNOWN: values.UNKNOWN
    };
  }

  function loggerComparison(project, model, result) {
    return window.AquaHydraulicDiagnostics.loggerComparison(project, model, result);
  }

  function renderWorstPressureNodes(diagnostics) {
    const map = window.aquaState?.map;
    if (!map || typeof L === "undefined") return;
    worstPressureLayer ||= L.layerGroup().addTo(map);
    worstPressureLayer.clearLayers();
    diagnostics.worstPressureNodes.forEach((node, index) => {
      L.circleMarker(node.coord, { radius: index < 5 ? 7 : 5, color: "#ff6d7b", weight: 2, fillColor: "#511d2a", fillOpacity: 0.85 })
        .bindTooltip(`${escape(node.id)} · ${node.pressureMetres.toFixed(2)} m`)
        .bindPopup(`<b>${escape(node.id)}</b><br>${node.pressureMetres.toFixed(2)} m pressure<br>${escape(node.dmaCode)}<br>${node.distanceFromSourceMetres.toFixed(1)} m hydraulic path`)
        .addTo(worstPressureLayer);
    });
  }

  function resultMarkup(model, diagnostics) {
    const assumptions = model.assumptions;
    const comparison = diagnostics.loggerComparison;
    const gate = diagnostics.engineeringGate;
    const comparisonRows = comparison.rows.map(row => `<tr><td><b>${escape(row.logger)}</b><small>${escape(row.dmaLabel || row.dmaCode)} · ${escape(row.modelNode)} · ${row.snapDistanceMetres.toFixed(1)} m</small></td><td>${row.observed.toFixed(2)}</td><td>${row.simulated.toFixed(2)}</td><td>${row.residual.toFixed(2)}</td></tr>`).join("");
    const flagRows = gate.flags.map(flag => `<li class="${escape(flag.severity)}"><b>${escape(flag.code.replaceAll("_", " "))}</b><span>${escape(flag.message)}</span></li>`).join("");
    const worstRows = diagnostics.worstPressureNodes.map(node => `<tr><td><b>${escape(node.id)}</b><small>${escape(node.topologyNodeId)} · ${escape(node.dmaCode)}</small></td><td>${node.pressureMetres.toFixed(2)}</td><td>${node.demandLps.toFixed(3)}</td><td>${node.distanceFromSourceMetres.toFixed(1)}</td></tr>`).join("");
    const demandRows = diagnostics.demand.byDma.map(row => `<tr><td><b>${escape(row.label || row.dmaLabel)}</b><small>${escape(row.dmaCode)}</small></td><td>${row.demandNodes}</td><td>${row.modelDemandLps.toFixed(3)}</td><td>${row.solvedDemandLps == null ? "—" : row.solvedDemandLps.toFixed(3)}</td><td>${row.inletMeanLps == null ? "—" : row.inletMeanLps.toFixed(3)}</td><td>${row.differenceLps == null ? "—" : row.differenceLps.toFixed(3)}</td></tr>`).join("");
    const boundaryRows = diagnostics.sourceBoundaries.map(row => `<tr><td><b>${escape(row.meterIds.join(", ") || row.id)}</b><small>${escape(row.dmaCode || "unassigned")}</small></td><td>${row.targetFlowLps == null ? "—" : row.targetFlowLps.toFixed(3)}</td><td>${row.solvedFlowLps == null ? "—" : row.solvedFlowLps.toFixed(3)}</td><td>${row.differenceLps == null ? "—" : row.differenceLps.toFixed(3)}</td></tr>`).join("");
    return `<div class="hydraulic-gate ${gate.usable ? "usable" : "review"}">
      <div><small>EPANET solver</small><b>Simulation completed</b></div>
      <div><small>Engineering gate</small><b>${gate.usable ? "Hydraulic model usable" : "Hydraulic model requires review"}</b></div>
    </div>
    ${flagRows ? `<ul class="hydraulic-flags">${flagRows}</ul>` : ""}
    <div class="hydraulic-model-summary">
      <b>Model provenance</b>
      <span>Geometry: derived hydraulic topology</span>
      <span>Elevation: ${escape(assumptions.elevationSource)} (${assumptions.elevationMetres.toFixed(1)} m)</span>
      <span>Demand: DMA inlet targets allocated across ${model.statistics.demandNodes} service demand nodes</span>
      <span>Model: ${escape(model.statistics.modelVariant)} · ${model.boundaries.length} logical DMA boundaries</span>
      <span>Diameters: ${model.statistics.diameterFromGis} GIS · ${model.statistics.diameterAssumed} fallback · ${model.statistics.diameterAudit.suspicious} suspicious source values</span>
      <span>Roughness: assumed by material for ${model.statistics.roughnessAssumedByMaterial} pipes</span>
      <span>Excluded disconnected components: ${model.statistics.excludedComponents}</span>
      <span>Review-required crossings: ${model.reviewRequired.connections}</span>
    </div>
    <div class="calibration-summary">
      <div><span>Logger MAE</span><b>${comparison.mae == null ? "Unavailable" : comparison.mae.toFixed(2) + " m"}</b></div>
      <div><span>Logger RMSE</span><b>${comparison.rmse == null ? "Unavailable" : comparison.rmse.toFixed(2) + " m"}</b></div>
      <div><span>Bias</span><b>${comparison.bias == null ? "Unavailable" : comparison.bias.toFixed(2) + " m"}</b></div>
      <div><span>Maximum |residual|</span><b>${comparison.maximumAbsoluteResidual == null ? "Unavailable" : comparison.maximumAbsoluteResidual.toFixed(2) + " m"}</b></div>
    </div>
    <details class="hydraulic-detail" open><summary>20 lowest-pressure nodes</summary><div class="calibration-table-wrap"><table class="telemetry-table"><thead><tr><th>Node</th><th>Pressure m</th><th>Demand L/s</th><th>Path m</th></tr></thead><tbody>${worstRows}</tbody></table></div></details>
    <details class="hydraulic-detail"><summary>Demand by DMA</summary><div class="calibration-table-wrap"><table class="telemetry-table"><thead><tr><th>DMA</th><th>Nodes</th><th>Model L/s</th><th>Solved L/s</th><th>Target L/s</th><th>Difference</th></tr></thead><tbody>${demandRows}</tbody></table></div></details>
    <details class="hydraulic-detail"><summary>DMA inlet boundary validation</summary><div class="calibration-table-wrap"><table class="telemetry-table"><thead><tr><th>Meter / DMA</th><th>Target L/s</th><th>Solved L/s</th><th>Difference</th></tr></thead><tbody>${boundaryRows}</tbody></table></div><p class="result-note">Flow is a validation target. Fixed-head source boundaries do not constrain inlet flow.</p></details>
    ${comparisonRows ? `<details class="hydraulic-detail" open><summary>Pressure logger residuals</summary><div class="calibration-table-wrap"><table class="telemetry-table"><thead><tr><th>Logger / DMA</th><th>Observed/demo</th><th>Simulated</th><th>Residual</th></tr></thead><tbody>${comparisonRows}</tbody></table></div></details>` : '<div class="result-note">No pressure logger readings are available for comparison.</div>'}`;
  }

  function resultFacts(model, diagnostics) {
    const pressure = diagnostics.network.pressureMetres;
    const checks = diagnostics.network.checks;
    const comparison = diagnostics.loggerComparison;
    return [
      `Engineering gate: ${diagnostics.engineeringGate.status}`,
      `Review flags: ${diagnostics.engineeringGate.flags.map(flag => flag.code).join(", ") || "none"}`,
      `Pressure range: ${pressure.min?.toFixed(2) ?? "unavailable"} to ${pressure.max?.toFixed(2) ?? "unavailable"} m`,
      `Negative pressures: ${checks.negativePressureCount}`,
      `Excessive velocity pipes: ${checks.excessiveVelocityCount}`,
      `Excessive headloss pipes: ${checks.extremeHeadlossCount}`,
      `Excluded components: ${model.statistics.excludedComponents}`,
      `Logger MAE / RMSE / bias: ${comparison.mae?.toFixed(2) ?? "unavailable"} / ${comparison.rmse?.toFixed(2) ?? "unavailable"} / ${comparison.bias?.toFixed(2) ?? "unavailable"} m`
    ];
  }

  async function runScenario(scenarioId, runOptions = {}) {
    const project = window.aquaState?.active;
    if (!project) throw new Error("Open a GIS project first");
    const readOnly = runOptions.persist === false;
    const topology = project.hydraulicTopology || await window.AquaHydraulicTopology.build({ attach: !readOnly, persist: !readOnly, render: !readOnly && runOptions.render !== false });
    const assumptions = {
      sourceHeadMetres: Number(document.getElementById("gisSourceHead").value),
      sourceHeadSource: "demo_assumption",
      elevationMetres: 0,
      elevationSource: "demo_flat_datum",
      peakDemandMultiplier: Number(document.getElementById("hydScenarioValue").value),
      roughnessByMaterial: roughnessAssumptions()
    };
    const modelVariant = runOptions.modelVariant || document.getElementById("hydModelVariant")?.value || "full-network";
    const model = window.AquaHydraulicModel.build(project, topology, { ...assumptions, scenarioId, modelVariant, dmaCodes: runOptions.dmaCodes });
    const result = await window.AquaEpanetAdapter.runInp(model.inp);
    const comparison = loggerComparison(project, model, result);
    const diagnostics = window.AquaHydraulicDiagnostics.analyze(project, topology, model, result, comparison);
    const reasoning = window.AquaHydraulicReasoning.analyze({ project, topology, model, result, diagnostics });
    const coords = Object.fromEntries(model.nodes.map(node => [node.id, node.coord]));
    const links = model.pipes.map(pipe => ({ id: pipe.id, n1: pipe.from, n2: pipe.to, type: "pipe" }));
    const resultId = `hyd-${scenarioId}-${modelVariant}-${Date.parse(model.scenario.timestamp)}`;
    AquaV4.inpText = model.inp;
    AquaV4.inpName = `${project.id}-${scenarioId}-${modelVariant}.inp`;
    AquaV4.inpModel = { coords, links };
    const normalizedResult = { ...result, scenario: { type: scenarioId === "base" ? "none" : scenarioId }, source: "aqua-derived-topology" };
    if (scenarioId === "base") AquaV4.baseline = normalizedResult;
    AquaV4.scenario = scenarioId === "base" ? null : normalizedResult;
    if (runOptions.render !== false) {
      av4RenderHyd(normalizedResult);
      renderWorstPressureNodes(diagnostics);
      document.getElementById("hydraulicResults")?.insertAdjacentHTML("beforeend", resultMarkup(model, diagnostics));
    }

    const metadata = { ...model.scenario, status: diagnostics.engineeringGate.status, solverStatus: "completed", resultStorage: "IndexedDB", modelStatistics: model.statistics, engineeringGate: diagnostics.engineeringGate, calibration: { mae: comparison.mae, rmse: comparison.rmse, maximumAbsoluteResidual: comparison.maximumAbsoluteResidual, bias: comparison.bias } };
    if (runOptions.persist !== false) {
      project.hydraulicAssumptions = assumptions;
      project.latestHydraulicModel = { scenarioId, inputRevision: model.scenario.inputRevision, solverVersion: result.solverVersion, assumptions, statistics: model.statistics };
      await window.AquaProjectPersistence.cacheHydraulicResult({ projectId: project.id, scenarioId, inputRevision: model.scenario.inputRevision, solverVersion: result.solverVersion, timestamp: model.scenario.timestamp, model: { ...model, inp: undefined }, result, comparison, diagnostics });
      if (window.AquaAuthorization?.canEdit() && project.cloudRevision) {
        const cloudRun = await window.AquaCloudProjects.saveHydraulicRun(project.id, { ...metadata, runId: resultId, scenarioId, assumptions, solverVersion: result.solverVersion }, model.inp, { ...model, inp: undefined }, { result, comparison, diagnostics });
        metadata.resultStorage = "R2";
        metadata.runId = resultId;
        metadata.r2Objects = cloudRun.r2Objects;
      }
      project.hydraulicScenarios = (project.hydraulicScenarios || []).filter(scenario => scenario.id !== scenarioId).concat(metadata);
      if (window.AquaAuthorization?.canEdit()) await window.AquaProjectPersistence.save(project, { setActive: true });
    }
    latestRun = { resultId, project, topology, model, result, comparison, diagnostics, reasoning, facts: resultFacts(model, diagnostics), calculator: "EPANET" };
    window.AquaHydraulicDiagnosisUI?.render?.(reasoning);
    return latestRun;
  }

  function runFromControls() {
    const scenarioId = document.getElementById("hydScenarioType")?.value || "base";
    const output = document.getElementById("hydraulicResults");
    output.innerHTML = '<div class="result-note">Building deterministic model and running EPANET...</div>';
    runScenario(scenarioId).catch(error => {
      console.error(error);
      output.innerHTML = `<div class="result-note"><b>Hydraulic run failed:</b> ${escape(error.message)}</div>`;
    });
  }

  function comparisonMarkup(full, distribution) {
    const row = (label, fullValue, distributionValue) => `<tr><td>${escape(label)}</td><td>${escape(fullValue)}</td><td>${escape(distributionValue)}</td></tr>`;
    const metric = (run, name) => run.diagnostics.network[name];
    return `<div class="hydraulic-model-summary"><b>Full network / distribution main comparison</b><span>Both runs use identical DMA targets, source-head assumptions and roughness values.</span><span>Service demand remains represented in both models.</span></div>
      <div class="calibration-table-wrap"><table class="telemetry-table"><thead><tr><th>Metric</th><th>Full network</th><th>Distribution main</th></tr></thead><tbody>
      ${row("Physical pipes", full.model.pipes.filter(pipe => !pipe.boundary).length, distribution.model.pipes.filter(pipe => !pipe.boundary).length)}
      ${row("Demand nodes", full.model.statistics.demandNodes, distribution.model.statistics.demandNodes)}
      ${row("Pressure range m", `${metric(full, "pressureMetres").min.toFixed(2)}-${metric(full, "pressureMetres").max.toFixed(2)}`, `${metric(distribution, "pressureMetres").min.toFixed(2)}-${metric(distribution, "pressureMetres").max.toFixed(2)}`)}
      ${row("Negative pressures", metric(full, "checks").negativePressureCount, metric(distribution, "checks").negativePressureCount)}
      ${row("Excessive velocity", metric(full, "checks").excessiveVelocityCount, metric(distribution, "checks").excessiveVelocityCount)}
      ${row("Excessive headloss", metric(full, "checks").extremeHeadlossCount, metric(distribution, "checks").extremeHeadlossCount)}
      ${row("Logger MAE m", full.comparison.mae?.toFixed(2) ?? "Unavailable", distribution.comparison.mae?.toFixed(2) ?? "Unavailable")}
      ${row("Logger RMSE m", full.comparison.rmse?.toFixed(2) ?? "Unavailable", distribution.comparison.rmse?.toFixed(2) ?? "Unavailable")}
      ${row("Logger bias m", full.comparison.bias?.toFixed(2) ?? "Unavailable", distribution.comparison.bias?.toFixed(2) ?? "Unavailable")}
      ${row("Engineering gate", full.diagnostics.engineeringGate.status, distribution.diagnostics.engineeringGate.status)}
      </tbody></table></div>`;
  }

  async function compareVariants() {
    const output = document.getElementById("hydraulicResults");
    output.innerHTML = '<div class="result-note">Running full-network and distribution-main EPANET models...</div>';
    const full = await runScenario("base", { modelVariant: "full-network", persist: false, render: false });
    const distribution = await runScenario("base", { modelVariant: "distribution-main", persist: false, render: false });
    output.innerHTML = comparisonMarkup(full, distribution);
    const reasoning = window.AquaHydraulicReasoning.compareVariants(full, distribution);
    window.AquaHydraulicDiagnosisUI?.render?.(full.reasoning, { variantComparison: reasoning });
    return { full, distribution, reasoning };
  }

  async function diagnose(options = {}) {
    const full = await runScenario("base", { modelVariant: "full-network", dmaCodes: options.dmaCodes, persist: false, render: false });
    const distribution = await runScenario("base", { modelVariant: "distribution-main", dmaCodes: options.dmaCodes, persist: false, render: false });
    const variantComparison = window.AquaHydraulicReasoning.compareVariants(full, distribution);
    latestDiagnosis = { ...full.reasoning, variantComparison, scope: { dmaCodes: options.dmaCodes || [], assetIds: options.assetIds || [], diagnosticFocus: options.diagnosticFocus || null } };
    window.AquaHydraulicDiagnosisUI?.render?.(latestDiagnosis, { variantComparison, focus: options.diagnosticFocus, assetIds: options.assetIds });
    window.AquaWindowManager?.restore("hydraulic-diagnosis");
    return {
      resultId: `hydraulic-diagnosis-${Date.now()}`,
      calculator: "Hydraulic Reasoning Engine v1",
      facts: window.AquaHydraulicReasoning.facts(latestDiagnosis, options.dmaCodes?.[0] || "network", options),
      reasoning: latestDiagnosis
    };
  }

  window.AquaHydraulics = { runScenario, compareVariants, diagnose, loggerComparison, resultFacts, get latestRun() { return latestRun; }, get latestDiagnosis() { return latestDiagnosis; } };
  window.addEventListener("load", () => {
    document.getElementById("buildRunGisHydraulics").onclick = () => {
      document.getElementById("hydScenarioType").value = "base";
      runFromControls();
    };
    document.getElementById("runScenario").onclick = runFromControls;
    document.getElementById("compareHydraulicVariants").onclick = () => compareVariants().catch(error => {
      console.error(error);
      document.getElementById("hydraulicResults").innerHTML = `<div class="result-note"><b>Model comparison failed:</b> ${escape(error.message)}</div>`;
    });
  });
})();