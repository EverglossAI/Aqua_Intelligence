export const REASONING_THRESHOLDS = Object.freeze({
  pressureMetres: Object.freeze({ low: 15, high: 80 }),
  velocityMetresPerSecond: Object.freeze({ low: 0.05, high: 2 }),
  headlossMetresPerKilometre: Object.freeze({ high: 10 }),
  loggerResidualMetres: Object.freeze({ screening: 5, unreliable: 10 }),
  boundaryFlow: Object.freeze({ absoluteToleranceLps: 0.1, relativeTolerance: 0.1 }),
  diameterMillimetres: Object.freeze({ smallMain: 40 }),
  shortSegmentMetres: 1,
  demandConcentrationFraction: 0.5,
  loggerSnapDistanceMetres: 100
});

const QUALITY_RANK = Object.freeze({ NOT_USABLE: 0, PRELIMINARY: 1, USABLE_FOR_SCREENING: 2, CALIBRATED: 3 });
const CONFIDENCE_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 2) {
  const number = finite(value);
  return number == null ? null : Number(number.toFixed(decimals));
}

function unique(values) {
  return [...new Set(values.filter(value => value != null && value !== ""))];
}

function qualityDimension(status, evidence) {
  return { status, evidence };
}

function sourceHeadQuality(model) {
  const source = String(model.assumptions?.sourceHeadSource || "unknown").toLowerCase();
  return qualityDimension(source.includes("measured") || source.includes("surveyed") ? "HIGH" : source.includes("model") ? "MEDIUM" : "LOW", source);
}

function elevationQuality(model) {
  const source = String(model.assumptions?.elevationSource || "unknown").toLowerCase();
  return qualityDimension(source.includes("surveyed") ? "HIGH" : /(^|_)dem($|_)/.test(source) ? "MEDIUM" : "LOW", source);
}

function demandQuality(model) {
  const source = String(model.provenance?.demand || "unknown").toLowerCase();
  const balances = model.statistics?.demandByDma || [];
  const balanced = balances.length > 0 && balances.every(row => Math.abs((finite(row.modelDemandLps) || 0) - (finite(row.targetLps) || 0)) <= 0.001);
  const sourceStatus = /synthetic|demo|unidentified|unknown/.test(source) ? "LOW" : /meter|telemetry|operational/.test(source) ? "HIGH" : "MEDIUM";
  return qualityDimension(!balanced ? "LOW" : sourceStatus, `${source}; ${balanced ? "DMA targets balanced" : "DMA targets not balanced"}`);
}

function diameterQuality(model) {
  const audit = model.statistics?.diameterAudit || { suspicious: 0, rows: [] };
  const total = (model.pipes || []).filter(pipe => !pipe.boundary).length + (audit.rows || []).filter(row => !row.modeled).length;
  const ratio = total ? audit.suspicious / total : 0;
  return qualityDimension(audit.suspicious === 0 ? "HIGH" : ratio <= 0.05 ? "MEDIUM" : "LOW", `${audit.suspicious || 0} suspicious records (${round(ratio * 100, 1)}%)`);
}

function roughnessQuality(model) {
  const source = String(model.assumptions?.roughnessSource || "").toLowerCase();
  const assumed = Number(model.statistics?.roughnessAssumedByMaterial || 0);
  return qualityDimension(source.includes("calibrated") && assumed === 0 ? "HIGH" : assumed > 0 || !source ? "LOW" : "MEDIUM", assumed > 0 ? `${assumed} pipes use assumed material roughness` : source || "unknown");
}

function residualQuality(comparison, thresholds) {
  const mae = finite(comparison?.mae);
  if (mae == null) return qualityDimension("LOW", "No mapped logger residuals");
  return qualityDimension(mae > thresholds.loggerResidualMetres.unreliable ? "LOW" : mae > thresholds.loggerResidualMetres.screening ? "MEDIUM" : "HIGH", `Logger MAE ${round(mae)} m`);
}

function boundaryQuality(diagnostics, thresholds) {
  const rows = diagnostics.sourceBoundaries || [];
  if (!rows.length) return qualityDimension("LOW", "No source-boundary validation");
  const mismatches = rows.filter(row => {
    const difference = finite(row.differenceLps);
    const target = Math.abs(finite(row.targetFlowLps) || 0);
    return difference == null || Math.abs(difference) > Math.max(thresholds.boundaryFlow.absoluteToleranceLps, target * thresholds.boundaryFlow.relativeTolerance);
  });
  return qualityDimension(mismatches.length ? "LOW" : "HIGH", mismatches.length ? `${mismatches.length} inlet boundaries outside tolerance` : "All inlet boundaries within tolerance");
}

export function assessModelQuality({ topology = {}, model = {}, diagnostics = {} }, options = {}) {
  const thresholds = { ...REASONING_THRESHOLDS, ...(options.thresholds || {}) };
  const unresolved = Number(topology.reviewRequiredConnections ?? model.reviewRequired?.connections ?? 0);
  const excluded = Number(model.statistics?.excludedComponents || 0);
  const derived = Number(model.statistics?.derivedTopologyComponents || 0);
  const excludedRatio = derived ? excluded / derived : excluded ? 1 : 0;
  const topologyStatus = unresolved === 0 && excluded === 0 ? "HIGH" : unresolved === 0 && excludedRatio <= 0.05 ? "MEDIUM" : "LOW";
  const dimensions = {
    topologyCompleteness: qualityDimension(topologyStatus, `${excluded} excluded of ${derived || "unknown"} derived components`),
    unresolvedConnections: qualityDimension(unresolved === 0 ? "HIGH" : "LOW", `${unresolved} unresolved connections`),
    sourceHead: sourceHeadQuality(model),
    elevation: elevationQuality(model),
    demand: demandQuality(model),
    diameterData: diameterQuality(model),
    roughness: roughnessQuality(model),
    loggerAgreement: residualQuality(diagnostics.loggerComparison, thresholds),
    boundaryFlow: boundaryQuality(diagnostics, thresholds)
  };
  const limitations = [];
  if (!diagnostics.solver?.completed) limitations.push("Hydraulic solver did not complete");
  if (dimensions.elevation.status === "LOW") limitations.push("Flat assumed node elevations");
  if (dimensions.sourceHead.status === "LOW") limitations.push(`${round(model.assumptions?.sourceHeadMetres, 1)} m assumed source heads`);
  if (unresolved) limitations.push(`${unresolved} unresolved connections`);
  if (excluded) limitations.push(`${excluded} excluded topology components`);
  if (dimensions.diameterData.status !== "HIGH") limitations.push(`${model.statistics?.diameterAudit?.suspicious || 0} suspicious diameter records`);
  if (dimensions.roughness.status !== "HIGH") limitations.push("Uncalibrated roughness basis");
  if (finite(diagnostics.loggerComparison?.mae) != null && dimensions.loggerAgreement.status !== "HIGH") limitations.push(`Logger MAE ${round(diagnostics.loggerComparison.mae)} m`);
  if (dimensions.boundaryFlow.status !== "HIGH") limitations.push(dimensions.boundaryFlow.evidence);
  const reservoirs = (model.nodes || []).filter(node => node.type === "reservoir").length;
  let status;
  if (!diagnostics.solver?.completed || reservoirs === 0 || !(model.nodes || []).some(node => node.type === "junction")) status = "NOT_USABLE";
  else if (Object.values(dimensions).some(dimension => dimension.status === "LOW")) status = "PRELIMINARY";
  else if (Object.values(dimensions).some(dimension => dimension.status === "MEDIUM")) status = "USABLE_FOR_SCREENING";
  else status = "CALIBRATED";
  return { status, rank: QUALITY_RANK[status], dimensions, limitations, strongDiagnosisAllowed: QUALITY_RANK[status] >= QUALITY_RANK.USABLE_FOR_SCREENING };
}

function pipeDma(pipe, nodeById) {
  if (pipe.dmaCode) return pipe.dmaCode;
  const values = unique([nodeById.get(pipe.from)?.demandDmaCode, nodeById.get(pipe.to)?.demandDmaCode]);
  return values.length === 1 ? values[0] : null;
}

function linkRows(model, result) {
  const resultById = new Map((result.links || []).map(link => [link.id, link]));
  const nodeById = new Map((model.nodes || []).map(node => [node.id, node]));
  return (model.pipes || []).filter(pipe => !pipe.boundary).map(pipe => {
    const solved = resultById.get(pipe.id) || {};
    const length = finite(pipe.length);
    const headloss = Math.abs(finite(solved.headloss) || 0);
    return {
      ...pipe,
      assetId: pipe.sourcePipeId || pipe.id,
      dmaCode: pipeDma(pipe, nodeById),
      flowLps: finite(solved.flow),
      velocityMetresPerSecond: Math.abs(finite(solved.velocity) || 0),
      headlossMetres: headloss,
      headlossMetresPerKilometre: length > 0 ? headloss / length * 1000 : null
    };
  });
}

function nodeRows(model, result) {
  const modelById = new Map((model.nodes || []).map(node => [node.id, node]));
  return (result.nodes || []).filter(node => modelById.get(node.id)?.type === "junction").map(node => ({ ...modelById.get(node.id), pressureMetres: finite(node.pressure), headMetres: finite(node.head), solvedDemandLps: finite(node.demand) }));
}

function asset(id, type, dmaCode = null, details = {}) {
  return { id: String(id), type, ...(dmaCode ? { dmaCode } : {}), ...details };
}

function dependency(modelQuality, minimumStatus = "USABLE_FOR_SCREENING") {
  return { minimumStatus, met: modelQuality.rank >= QUALITY_RANK[minimumStatus], limitations: modelQuality.limitations };
}

function capConfidence(confidence, modelQuality, dependsOnHydraulics = true) {
  if (!dependsOnHydraulics || modelQuality.strongDiagnosisAllowed) return confidence;
  return CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK.LOW ? "LOW" : confidence;
}

function finding(modelQuality, values) {
  return {
    code: values.code,
    severity: values.severity || "WARNING",
    confidence: capConfidence(values.confidence || "MEDIUM", modelQuality, values.dependsOnHydraulics !== false),
    affectedAssets: values.affectedAssets || [],
    evidence: values.evidence || { measured: [], modeled: [] },
    threshold: values.threshold || null,
    likelyCauses: values.likelyCauses || [],
    alternativeCauses: values.alternativeCauses || [],
    recommendedChecks: values.recommendedChecks || [],
    scenarioTests: values.scenarioTests || [],
    modelQualityDependency: dependency(modelQuality, values.minimumQuality || "USABLE_FOR_SCREENING"),
    evidenceClassification: values.evidenceClassification || "requires review",
    networkConclusion: values.networkConclusion || (modelQuality.strongDiagnosisAllowed ? "screening indication" : "not currently reliable")
  };
}

function recommendation(code, label, category, assetIds = []) {
  return { code, label, category, affectedAssets: unique(assetIds).sort() };
}

function lowPressureCauses(input, lowNodes, highHeadlossLinks, modelQuality, diagnosticsByCode) {
  const { model, diagnostics } = input;
  const sourceHead = finite(model.assumptions?.sourceHeadMetres);
  const elevationKnown = modelQuality.dimensions.elevation.status !== "LOW";
  const highElevation = elevationKnown && sourceHead != null && lowNodes.some(node => finite(node.elevation) != null && sourceHead - node.elevation < REASONING_THRESHOLDS.pressureMetres.low);
  const loggerMappingConcern = (diagnostics.loggerComparison?.rows || []).some(row => finite(row.snapDistanceMetres) > REASONING_THRESHOLDS.loggerSnapDistanceMetres);
  const causes = [
    { code: "INADEQUATE_SOURCE_HEAD", label: "Insufficient source head", assessment: diagnosticsByCode.has("INADEQUATE_SOURCE_HEAD") ? "supported" : modelQuality.dimensions.sourceHead.status === "LOW" ? "possible" : "unsupported", evidence: modelQuality.dimensions.sourceHead.evidence },
    { code: "HIGH_ELEVATION", label: "High elevation", assessment: !elevationKnown ? "cannot evaluate" : highElevation ? "supported" : "unsupported", evidence: modelQuality.dimensions.elevation.evidence },
    { code: "EXCESSIVE_FRICTION_LOSS", label: "Excessive friction loss", assessment: highHeadlossLinks.length ? "supported" : "unsupported", evidence: `${highHeadlossLinks.length} high-headloss links` },
    { code: "UNDERSIZED_TRUNK_MAIN", label: "Undersized trunk main", assessment: diagnosticsByCode.has("UNDERSIZED_PIPE_INDICATION") ? "possible" : "unsupported", evidence: "Diameter and headloss evidence" },
    { code: "EXCESSIVE_DEMAND", label: "Excessive or concentrated demand", assessment: diagnosticsByCode.has("DEMAND_CONCENTRATION") ? "possible" : modelQuality.dimensions.demand.status === "LOW" ? "cannot evaluate" : "unsupported", evidence: modelQuality.dimensions.demand.evidence },
    { code: "CLOSED_OR_THROTTLED_VALVE", label: "Closed or throttled valve", assessment: "cannot evaluate", evidence: "No verified valve-status input" },
    { code: "BAD_TOPOLOGY", label: "Incorrect topology", assessment: diagnosticsByCode.has("MODEL_TOPOLOGY_UNCERTAINTY") ? "possible" : "unsupported", evidence: modelQuality.dimensions.topologyCompleteness.evidence },
    { code: "INCORRECT_MODEL_ELEVATION", label: "Incorrect model elevation", assessment: elevationKnown ? "unsupported" : "possible", evidence: modelQuality.dimensions.elevation.evidence },
    { code: "LOGGER_NODE_MAPPING", label: "Incorrect logger/node mapping", assessment: loggerMappingConcern ? "possible" : "unsupported", evidence: loggerMappingConcern ? "Logger snap distance exceeds threshold" : "Logger mappings within threshold" }
  ];
  return causes;
}

function diagnosticRecommendations(code, affectedAssets = []) {
  const ids = affectedAssets.map(item => item.id);
  const map = {
    LOW_PRESSURE: [recommendation("VERIFY_PRESSURE", "Verify pressure and elevation at affected locations", "FIELD_VERIFICATION", ids), recommendation("TEST_DEMAND", "Test peak-demand and source-head scenarios", "HYDRAULIC_SCENARIO", ids)],
    HIGH_PRESSURE: [recommendation("VERIFY_HIGH_PRESSURE", "Verify high pressure before operational changes", "FIELD_VERIFICATION", ids), recommendation("REVIEW_PRESSURE_MANAGEMENT", "Review pressure-management operation", "OPERATIONAL_ACTION", ids)],
    EXCESSIVE_HEADLOSS: [recommendation("VERIFY_DIAMETER", "Verify pipe diameter and length", "FIELD_VERIFICATION", ids), recommendation("TEST_LARGER_MAIN", "Test larger trunk-main scenario", "HYDRAULIC_SCENARIO", ids)],
    HIGH_VELOCITY: [recommendation("VERIFY_FLOW", "Verify flow and pipe diameter", "FIELD_VERIFICATION", ids)],
    LOW_VELOCITY: [recommendation("CHECK_LOW_FLOW", "Check demand allocation and low-flow conditions", "DATA_IMPROVEMENT", ids)],
    UNDERSIZED_PIPE_INDICATION: [recommendation("REVIEW_SMALL_DIAMETER", "Review suspicious small diameter", "FIELD_VERIFICATION", ids)],
    INADEQUATE_SOURCE_HEAD: [recommendation("MEASURE_INLET_PRESSURE", "Obtain inlet pressure measurement", "DATA_IMPROVEMENT", ids)],
    DEMAND_CONCENTRATION: [recommendation("REVIEW_DEMAND_ALLOCATION", "Review concentrated demand allocation", "DATA_IMPROVEMENT", ids)],
    DISCONNECTED_NETWORK: [recommendation("CONNECTIVITY_SURVEY", "Resolve disconnected network components", "FIELD_VERIFICATION", ids)],
    DMA_BOUNDARY_ISSUE: [recommendation("VERIFY_DMA_BOUNDARY", "Verify DMA inlet and boundary representation", "FIELD_VERIFICATION", ids), recommendation("TEST_SECOND_INLET", "Test second inlet scenario", "HYDRAULIC_SCENARIO", ids)],
    BOUNDARY_FLOW_IMBALANCE: [recommendation("MEASURE_INLET_PRESSURE", "Obtain inlet pressure measurement", "DATA_IMPROVEMENT", ids), recommendation("VERIFY_BOUNDARY_FLOW", "Verify boundary flow and time alignment", "FIELD_VERIFICATION", ids)],
    LOGGER_MODEL_MISMATCH: [recommendation("VERIFY_LOGGER_ELEVATION", "Verify pressure logger elevation", "FIELD_VERIFICATION", ids), recommendation("VERIFY_LOGGER_MAPPING", "Verify pressure logger/node mapping", "DATA_IMPROVEMENT", ids)],
    SUSPECT_DIAMETER_DATA: [recommendation("REVIEW_DIAMETERS", "Review suspicious diameter records", "DATA_IMPROVEMENT", ids)],
    SUSPECT_ELEVATION_DATA: [recommendation("OBTAIN_ELEVATION", "Obtain or derive hydraulic node elevations", "DATA_IMPROVEMENT", ids)],
    MODEL_TOPOLOGY_UNCERTAINTY: [recommendation("RESOLVE_TOPOLOGY", "Resolve topology connection", "DATA_IMPROVEMENT", ids)]
  };
  return map[code] || [];
}

function buildDmaSummaries(input, modelQuality, diagnostics, links, nodes) {
  const dmas = input.project?.logicalDmas || input.model.statistics?.demandByDma || [];
  return dmas.map(dma => {
    const dmaCode = String(dma.dma_code || dma.dmaCode);
    const label = dma.label || dma.dma_name || dmaCode;
    const boundaryRows = (input.diagnostics.sourceBoundaries || []).filter(row => String(row.dmaCode) === dmaCode);
    const demand = (input.diagnostics.demand?.byDma || []).find(row => String(row.dmaCode) === dmaCode) || null;
    const dmaNodes = nodes.filter(node => String(node.demandDmaCode || "").split(",").includes(dmaCode));
    const dmaLinks = links.filter(link => String(link.dmaCode) === dmaCode);
    const loggerRows = (input.diagnostics.loggerComparison?.rows || []).filter(row => String(row.dmaCode) === dmaCode);
    const relevant = diagnostics.filter(item => !item.affectedAssets.length || item.affectedAssets.some(item => !item.dmaCode || String(item.dmaCode) === dmaCode));
    const residuals = loggerRows.map(row => Math.abs(row.residual));
    const max = values => values.length ? Math.max(...values) : null;
    const min = values => values.length ? Math.min(...values) : null;
    const next = relevant.flatMap(item => item.recommendedChecks).find(Boolean) || recommendation("IMPROVE_MODEL_BASIS", "Obtain elevation and boundary pressure before pipe-sizing conclusions", "DATA_IMPROVEMENT");
    return {
      dmaCode,
      label,
      hydraulicStatus: modelQuality.strongDiagnosisAllowed ? (relevant.some(item => item.severity === "ERROR") ? "Hydraulic issue detected" : "Usable for screening") : "Model requires review",
      supply: { boundaries: boundaryRows.length, targetLps: round(boundaryRows.reduce((sum, row) => sum + (finite(row.targetFlowLps) || 0), 0), 3), solvedLps: round(boundaryRows.reduce((sum, row) => sum + (finite(row.solvedFlowLps) || 0), 0), 3) },
      demand: demand ? { targetLps: round(demand.targetLps, 3), modeledLps: round(demand.modelDemandLps, 3), solvedLps: round(demand.solvedDemandLps, 3), nodes: demand.demandNodes } : null,
      pressure: { minimumMetres: min(dmaNodes.map(node => node.pressureMetres).filter(value => value != null)), maximumMetres: max(dmaNodes.map(node => node.pressureMetres).filter(value => value != null)) },
      velocity: { maximumMetresPerSecond: max(dmaLinks.map(link => link.velocityMetresPerSecond).filter(value => value != null)) },
      headloss: { maximumMetresPerKilometre: max(dmaLinks.map(link => link.headlossMetresPerKilometre).filter(value => value != null)) },
      topology: { unresolvedConnections: Number(input.topology?.reviewRequiredConnections ?? input.model.reviewRequired?.connections ?? 0), excludedComponents: Number(input.model.statistics?.excludedComponents || 0) },
      observedLoggerAgreement: { loggerCount: loggerRows.length, meanAbsoluteResidualMetres: residuals.length ? round(residuals.reduce((sum, value) => sum + value, 0) / residuals.length) : null },
      dataQuality: modelQuality.dimensions,
      overallModelConfidence: modelQuality.status,
      strongEvidence: demand && Math.abs((finite(demand.modelDemandLps) || 0) - (finite(demand.targetLps) || 0)) <= 0.001 ? ["Demand allocation matches inlet target."] : [],
      weakOrInvalidEvidence: modelQuality.strongDiagnosisAllowed ? [] : ["Pressure distribution is not a calibrated field prediction."],
      fieldMismatch: residuals.length ? `Logger mean absolute residual ${round(residuals.reduce((sum, value) => sum + value, 0) / residuals.length)} m.` : "No mapped pressure logger evidence.",
      recommendedNextStep: next
    };
  });
}

export function analyzeHydraulicReasoning(input, options = {}) {
  const thresholds = { ...REASONING_THRESHOLDS, ...(options.thresholds || {}) };
  const modelQuality = assessModelQuality(input, { thresholds });
  const nodes = nodeRows(input.model, input.result);
  const links = linkRows(input.model, input.result);
  const diagnostics = [];
  const add = values => {
    const item = finding(modelQuality, values);
    item.recommendedChecks = values.recommendedChecks || diagnosticRecommendations(item.code, item.affectedAssets);
    diagnostics.push(item);
    return item;
  };
  const lowNodes = nodes.filter(node => node.pressureMetres != null && node.pressureMetres < thresholds.pressureMetres.low);
  const highNodes = nodes.filter(node => node.pressureMetres != null && node.pressureMetres > thresholds.pressureMetres.high);
  const highVelocity = links.filter(link => link.velocityMetresPerSecond > thresholds.velocityMetresPerSecond.high);
  const lowVelocity = links.filter(link => Math.abs(link.flowLps || 0) > 0.001 && link.velocityMetresPerSecond < thresholds.velocityMetresPerSecond.low);
  const highHeadloss = links.filter(link => link.headlossMetresPerKilometre > thresholds.headlossMetresPerKilometre.high);
  const auditRows = input.model.statistics?.diameterAudit?.rows || [];
  const suspectPipeIds = new Set(auditRows.map(row => String(row.sourcePipeId)));
  const undersized = links.filter(link => (link.diameterSource === "audit_fallback" || suspectPipeIds.has(String(link.assetId))) || (!link.service && finite(link.modelDiameter ?? link.diameter) <= thresholds.diameterMillimetres.smallMain));
  const sourceHead = finite(input.model.assumptions?.sourceHeadMetres);
  const maxElevation = Math.max(...nodes.map(node => finite(node.elevation)).filter(value => value != null), -Infinity);
  const inadequateSource = sourceHead != null && maxElevation !== -Infinity && sourceHead - maxElevation < thresholds.pressureMetres.low;
  const demandConcentrations = [];
  (input.diagnostics.demand?.byDma || []).forEach(dma => {
    const dmaNodes = nodes.filter(node => String(node.demandDmaCode || "").split(",").includes(String(dma.dmaCode)) && (finite(node.demand) || 0) > 0);
    const total = dmaNodes.reduce((sum, node) => sum + (finite(node.demand) || 0), 0);
    dmaNodes.filter(node => total > 0 && node.demand / total > thresholds.demandConcentrationFraction).forEach(node => demandConcentrations.push({ node, fraction: node.demand / total }));
  });
  const expectedMeters = unique((input.model.statistics?.demandByDma || []).flatMap(row => row.inletMeters || []));
  const representedMeters = unique((input.model.boundaries || []).flatMap(row => row.meterIds || []));
  const boundaryIssues = expectedMeters.filter(id => !representedMeters.includes(id));
  const boundaryMismatches = (input.diagnostics.sourceBoundaries || []).filter(row => Math.abs(finite(row.differenceLps) || 0) > Math.max(thresholds.boundaryFlow.absoluteToleranceLps, Math.abs(finite(row.targetFlowLps) || 0) * thresholds.boundaryFlow.relativeTolerance));
  const loggerMismatches = (input.diagnostics.loggerComparison?.rows || []).filter(row => Math.abs(finite(row.residual) || 0) > thresholds.loggerResidualMetres.unreliable);
  const excluded = Number(input.model.statistics?.excludedComponents || 0);
  const unresolved = Number(input.topology?.reviewRequiredConnections ?? input.model.reviewRequired?.connections ?? 0);

  if (highHeadloss.length) add({ code: "EXCESSIVE_HEADLOSS", severity: "WARNING", confidence: "HIGH", affectedAssets: highHeadloss.map(link => asset(link.assetId, "pipe", link.dmaCode)), evidence: { measured: [], modeled: highHeadloss.map(link => ({ assetId: link.assetId, headlossMetresPerKilometre: round(link.headlossMetresPerKilometre), service: Boolean(link.service), diameterSource: link.diameterSource })) }, threshold: { metric: "headlossMetresPerKilometre", operator: ">", value: thresholds.headlossMetresPerKilometre.high, unit: "m/km" }, evidenceClassification: highHeadloss.every(link => link.service) ? "service-line artefact" : highHeadloss.some(link => link.diameterSource !== "GIS") ? "suspect-input artefact" : "genuine-network candidate", scenarioTests: ["Test verified diameters", "Test larger trunk-main scenario"] });
  if (highVelocity.length) add({ code: "HIGH_VELOCITY", severity: "WARNING", confidence: "HIGH", affectedAssets: highVelocity.map(link => asset(link.assetId, "pipe", link.dmaCode)), evidence: { measured: [], modeled: highVelocity.map(link => ({ assetId: link.assetId, velocityMetresPerSecond: round(link.velocityMetresPerSecond) })) }, threshold: { metric: "velocityMetresPerSecond", operator: ">", value: thresholds.velocityMetresPerSecond.high, unit: "m/s" } });
  if (lowVelocity.length) add({ code: "LOW_VELOCITY", severity: "INFO", confidence: "MEDIUM", affectedAssets: lowVelocity.map(link => asset(link.assetId, "pipe", link.dmaCode)), evidence: { measured: [], modeled: lowVelocity.map(link => ({ assetId: link.assetId, velocityMetresPerSecond: round(link.velocityMetresPerSecond) })) }, threshold: { metric: "velocityMetresPerSecond", operator: "<", value: thresholds.velocityMetresPerSecond.low, unit: "m/s" } });
  if (undersized.length) add({ code: "UNDERSIZED_PIPE_INDICATION", severity: "WARNING", confidence: undersized.some(link => link.diameterSource === "audit_fallback") ? "LOW" : "MEDIUM", affectedAssets: undersized.map(link => asset(link.assetId, "pipe", link.dmaCode)), evidence: { measured: [], modeled: undersized.map(link => ({ assetId: link.assetId, sourceDiameter: link.sourceDiameter ?? link.rawDiameter, modelDiameter: link.modelDiameter ?? link.diameter, substitutionReason: link.substitutionReason || null })) }, threshold: { metric: "mainDiameterMillimetres", operator: "<=", value: thresholds.diameterMillimetres.smallMain, unit: "mm" }, evidenceClassification: undersized.some(link => link.diameterSource === "audit_fallback") ? "suspect-input artefact" : "requires review", scenarioTests: ["Test verified source diameter", "Test larger trunk-main scenario"] });
  if (inadequateSource) add({ code: "INADEQUATE_SOURCE_HEAD", severity: "ERROR", confidence: input.model.assumptions?.sourceHeadSource === "measured" ? "HIGH" : "LOW", affectedAssets: (input.model.boundaries || []).map(row => asset(row.meterIds?.[0] || row.nodeId, "source", row.dmaCode)), evidence: { measured: input.model.assumptions?.sourceHeadSource === "measured" ? [{ sourceHeadMetres: sourceHead }] : [], modeled: [{ sourceHeadMetres: sourceHead, maximumElevationMetres: maxElevation, availableStaticPressureMetres: round(sourceHead - maxElevation) }] }, threshold: { metric: "availableStaticPressureMetres", operator: "<", value: thresholds.pressureMetres.low, unit: "m" }, scenarioTests: ["Test measured boundary head"] });
  if (demandConcentrations.length) add({ code: "DEMAND_CONCENTRATION", severity: "WARNING", confidence: "MEDIUM", affectedAssets: demandConcentrations.map(row => asset(row.node.id, "node", row.node.demandDmaCode)), evidence: { measured: [], modeled: demandConcentrations.map(row => ({ nodeId: row.node.id, fraction: round(row.fraction, 3) })) }, threshold: { metric: "nodeShareOfDmaDemand", operator: ">", value: thresholds.demandConcentrationFraction, unit: "fraction" }, scenarioTests: ["Redistribute demand using customer or meter evidence"] });
  if (excluded) add({ code: "DISCONNECTED_NETWORK", severity: "ERROR", confidence: "HIGH", dependsOnHydraulics: false, affectedAssets: [], evidence: { measured: [], modeled: [{ excludedComponents: excluded, derivedComponents: input.model.statistics?.derivedTopologyComponents || null }] }, threshold: { metric: "excludedComponents", operator: ">", value: 0, unit: "components" } });
  if (boundaryIssues.length) add({ code: "DMA_BOUNDARY_ISSUE", severity: "ERROR", confidence: "HIGH", dependsOnHydraulics: false, affectedAssets: boundaryIssues.map(id => asset(id, "flow-meter")), evidence: { measured: boundaryIssues.map(id => ({ meterId: id, represented: false })), modeled: [] }, threshold: { metric: "unrepresentedInletMeters", operator: ">", value: 0, unit: "meters" }, scenarioTests: ["Test second inlet scenario"] });
  if (boundaryMismatches.length) add({ code: "BOUNDARY_FLOW_IMBALANCE", severity: "WARNING", confidence: "HIGH", affectedAssets: boundaryMismatches.map(row => asset(row.meterIds?.[0] || row.id, "flow-meter", row.dmaCode)), evidence: { measured: boundaryMismatches.map(row => ({ assetId: row.meterIds?.[0] || row.id, targetFlowLps: round(row.targetFlowLps, 3) })), modeled: boundaryMismatches.map(row => ({ assetId: row.meterIds?.[0] || row.id, solvedFlowLps: round(row.solvedFlowLps, 3), residualLps: round(row.differenceLps, 3) })) }, threshold: { metric: "boundaryFlowResidual", operator: ">", value: `${thresholds.boundaryFlow.absoluteToleranceLps} L/s or ${thresholds.boundaryFlow.relativeTolerance * 100}%`, unit: "mixed" }, scenarioTests: ["Test measured boundary pressure", "Test second inlet scenario"] });
  if (loggerMismatches.length) add({ code: "LOGGER_MODEL_MISMATCH", severity: "WARNING", confidence: "HIGH", dependsOnHydraulics: false, affectedAssets: loggerMismatches.map(row => asset(row.logger, "pressure-logger", row.dmaCode)), evidence: { measured: loggerMismatches.map(row => ({ logger: row.logger, pressureMetres: round(row.observed), modelNode: row.modelNode, snapDistanceMetres: round(row.snapDistanceMetres) })), modeled: loggerMismatches.map(row => ({ logger: row.logger, pressureMetres: round(row.simulated), residualMetres: round(row.residual) })) }, threshold: { metric: "absoluteLoggerResidualMetres", operator: ">", value: thresholds.loggerResidualMetres.unreliable, unit: "m" }, likelyCauses: [{ code: "ASSUMED_ELEVATION", label: "Flat or assumed node elevation", assessment: modelQuality.dimensions.elevation.status === "LOW" ? "possible" : "unsupported", evidence: modelQuality.dimensions.elevation.evidence }, { code: "ASSUMED_SOURCE_HEAD", label: "Assumed source head", assessment: modelQuality.dimensions.sourceHead.status === "LOW" ? "possible" : "unsupported", evidence: modelQuality.dimensions.sourceHead.evidence }, { code: "LOGGER_NODE_MAPPING", label: "Incorrect logger/node mapping", assessment: loggerMismatches.some(row => row.snapDistanceMetres > thresholds.loggerSnapDistanceMetres) ? "possible" : "unsupported", evidence: "Mapped node and snap distance retained per logger" }, { code: "NETWORK_ANOMALY", label: "Physical network anomaly", assessment: modelQuality.strongDiagnosisAllowed ? "possible" : "cannot evaluate", evidence: "Requires an adequate model basis" }], networkConclusion: modelQuality.strongDiagnosisAllowed ? "screening indication only" : "not currently reliable" });
  if (auditRows.length) add({ code: "SUSPECT_DIAMETER_DATA", severity: "WARNING", confidence: "HIGH", dependsOnHydraulics: false, affectedAssets: auditRows.slice(0, 500).map(row => asset(row.sourcePipeId, "pipe")), evidence: { measured: auditRows.map(row => ({ assetId: row.sourcePipeId, sourceDiameter: row.sourceDiameter ?? row.rawDiameter, modelDiameter: row.modelDiameter ?? row.modeledDiameter, substitutionReason: row.substitutionReason || row.reason, confidence: row.confidence || "low" })), modeled: [] }, threshold: { metric: "suspiciousDiameterRecords", operator: ">", value: 0, unit: "records" }, evidenceClassification: "suspect-input artefact" });
  if (modelQuality.dimensions.elevation.status === "LOW") add({ code: "SUSPECT_ELEVATION_DATA", severity: "WARNING", confidence: "HIGH", dependsOnHydraulics: false, affectedAssets: [], evidence: { measured: [], modeled: [{ elevationSource: input.model.assumptions?.elevationSource, assumedElevationMetres: finite(input.model.assumptions?.elevationMetres) }] }, threshold: { metric: "elevationConfidence", operator: "<", value: "MEDIUM", unit: "quality" } });
  if (unresolved) add({ code: "MODEL_TOPOLOGY_UNCERTAINTY", severity: "WARNING", confidence: "HIGH", dependsOnHydraulics: false, affectedAssets: [], evidence: { measured: [], modeled: [{ unresolvedConnections: unresolved }] }, threshold: { metric: "unresolvedConnections", operator: ">", value: 0, unit: "connections" } });

  const byCode = new Map(diagnostics.map(item => [item.code, item]));
  if (lowNodes.length) {
    const causes = lowPressureCauses(input, lowNodes, highHeadloss, modelQuality, byCode);
    add({ code: "LOW_PRESSURE", severity: "ERROR", confidence: "HIGH", affectedAssets: lowNodes.map(node => asset(node.topologyNodeId || node.id, "node", node.demandDmaCode, { coordinate: node.coord })), evidence: { measured: [], modeled: lowNodes.map(node => ({ nodeId: node.id, pressureMetres: round(node.pressureMetres), elevationMetres: round(node.elevation) })) }, threshold: { metric: "pressureMetres", operator: "<", value: thresholds.pressureMetres.low, unit: "m" }, likelyCauses: causes, alternativeCauses: causes.filter(item => item.assessment !== "supported"), scenarioTests: ["Test measured source head", "Test verified elevations", "Test larger trunk-main scenario"] });
  }
  if (highNodes.length) add({ code: "HIGH_PRESSURE", severity: "WARNING", confidence: "HIGH", affectedAssets: highNodes.map(node => asset(node.topologyNodeId || node.id, "node", node.demandDmaCode, { coordinate: node.coord })), evidence: { measured: [], modeled: highNodes.map(node => ({ nodeId: node.id, pressureMetres: round(node.pressureMetres) })) }, threshold: { metric: "pressureMetres", operator: ">", value: thresholds.pressureMetres.high, unit: "m" } });

  diagnostics.sort((left, right) => left.code.localeCompare(right.code));
  const recommendations = [...new Map(diagnostics.flatMap(item => item.recommendedChecks).map(item => [`${item.category}:${item.code}`, item])).values()].sort((left, right) => `${left.category}:${left.code}`.localeCompare(`${right.category}:${right.code}`));
  return {
    schemaVersion: 1,
    modelQuality,
    diagnostics,
    dmaSummaries: buildDmaSummaries(input, modelQuality, diagnostics, links, nodes),
    recommendations,
    provenance: { calculatedBy: "Hydraulic Reasoning Engine v1", hydraulicSolver: input.result?.solverVersion || "unknown", deterministic: true }
  };
}

function classifyHeadlossOutlier(link, thresholds) {
  if (link.boundary) return "modelling connector";
  if (link.service) return "service-line artefact";
  if (link.diameterSource !== "GIS" || link.substitutionReason) return "suspect-input artefact";
  if ((finite(link.length) || 0) < thresholds.shortSegmentMetres) return "requires review";
  return "genuine-network candidate";
}

export function compareHydraulicVariants(fullInput, distributionInput, options = {}) {
  const thresholds = { ...REASONING_THRESHOLDS, ...(options.thresholds || {}) };
  const fullLinks = linkRows(fullInput.model, fullInput.result).filter(link => link.headlossMetresPerKilometre > thresholds.headlossMetresPerKilometre.high);
  const distributionIds = new Set(linkRows(distributionInput.model, distributionInput.result).filter(link => link.headlossMetresPerKilometre > thresholds.headlossMetresPerKilometre.high).map(link => String(link.assetId)));
  const outliers = fullLinks.map(link => ({
    assetId: link.assetId,
    dmaCode: link.dmaCode,
    headlossMetresPerKilometre: round(link.headlossMetresPerKilometre),
    service: Boolean(link.service),
    sourceDiameter: link.sourceDiameter ?? link.rawDiameter ?? null,
    modelDiameter: link.modelDiameter ?? link.diameter ?? null,
    diameterSource: link.diameterSource || "unknown",
    presentInDistributionOutliers: distributionIds.has(String(link.assetId)),
    classification: classifyHeadlossOutlier(link, thresholds)
  })).sort((left, right) => String(left.assetId).localeCompare(String(right.assetId)));
  const counts = rows => Object.fromEntries(["genuine-network candidate", "service-line artefact", "suspect-input artefact", "modelling connector", "requires review"].map(classification => [classification, rows.filter(row => row.classification === classification).length]));
  return {
    fullNetworkOutlierCount: fullLinks.length,
    distributionMainOutlierCount: distributionIds.size,
    outliers,
    classificationCounts: counts(outliers),
    interpretation: outliers.length && outliers.every(row => row.classification === "service-line artefact") ? "Full-network headloss outliers are isolated to service lines and are not demonstrated distribution-main bottlenecks." : outliers.some(row => row.classification === "genuine-network candidate") ? "At least one verified distribution main remains a bottleneck candidate; field data and model quality must support confirmation." : "Outliers require input and topology review before a network bottleneck conclusion."
  };
}

export function reasoningFacts(reasoning, scopeLabel = "network", options = {}) {
  const requestedAssets = new Set((options.assetIds || []).map(String));
  const scoped = reasoning.diagnostics.filter(item => !requestedAssets.size || item.affectedAssets.some(asset => requestedAssets.has(String(asset.id))));
  const focused = options.diagnosticFocus && options.diagnosticFocus !== "DMA_SUMMARY" ? scoped.filter(item => item.code === options.diagnosticFocus) : scoped;
  const active = focused.filter(item => item.severity !== "INFO");
  const issueFacts = active.slice(0, 4).map(item => {
    const supported = item.likelyCauses.filter(cause => cause.assessment === "supported").map(cause => cause.label);
    const possible = item.likelyCauses.filter(cause => cause.assessment === "possible").map(cause => cause.label);
    return `${item.code}: ${item.confidence} confidence; ${item.evidenceClassification}; supported causes: ${supported.join(", ") || "none"}; possible causes: ${possible.join(", ") || "none"}.`;
  });
  if (options.diagnosticFocus && options.diagnosticFocus !== "DMA_SUMMARY" && !focused.length) issueFacts.push(`${options.diagnosticFocus} is not active at the configured threshold.`);
  return [
    `Model confidence for ${scopeLabel}: ${reasoning.modelQuality.status}.`,
    `Active diagnostic issues: ${active.length}.`,
    ...issueFacts,
    ...reasoning.modelQuality.limitations.slice(0, 5),
    reasoning.modelQuality.strongDiagnosisAllowed ? "Hydraulic findings are screening indications, not design conclusions." : "Causal attribution: cannot evaluate reliably until the model basis is improved."
  ];
}

if (typeof window !== "undefined") window.AquaHydraulicReasoning = { analyze: analyzeHydraulicReasoning, assessModelQuality, compareVariants: compareHydraulicVariants, facts: reasoningFacts, REASONING_THRESHOLDS };