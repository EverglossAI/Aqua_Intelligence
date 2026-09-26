const DEFAULT_LIMITS = Object.freeze({ minimumPressureMetres: 0, maximumVelocityMetresPerSecond: 3, maximumHeadlossMetresPerKilometre: 10 });

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function quantiles(values) {
  const sorted = values.map(finite).filter(value => value != null).sort((left, right) => left - right);
  const at = fraction => sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
  return { count: sorted.length, min: at(0), median: at(0.5), p95: at(0.95), max: at(1) };
}

function telemetryCoordinate(asset) {
  const latitude = finite(asset?.lat ?? asset?.latitude);
  const longitude = finite(asset?.lng ?? asset?.lon ?? asset?.longitude);
  return latitude == null || longitude == null ? null : [latitude, longitude];
}

function coordinateDistance(left, right) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((left[0] + right[0]) * Math.PI / 360);
  return Math.hypot((left[0] - right[0]) * latitudeScale, (left[1] - right[1]) * longitudeScale);
}

function observedPressure(asset) {
  return mean((asset.readings || []).map(reading => finite(reading.pressure ?? reading.value ?? reading.pressure_m)).filter(value => value != null));
}

function observedFlow(asset) {
  return asset ? mean((asset.readings || []).map(reading => finite(reading.flow ?? reading.value ?? reading.flow_lps)).filter(value => value != null)) : null;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[1]) !== (previousY > point[1]) && point[0] < (previousX - x) * (point[1] - y) / (previousY - y + 1e-12) + x) inside = !inside;
  }
  return inside;
}

function pointInFeature(point, feature) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some(polygon => polygon[0] && pointInRing(point, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(point, ring)));
}

function dmaAreas(project) {
  return (project.dmaFeatureMappings || []).map(mapping => {
    const layer = (project.layers || []).find(candidate => candidate.name === mapping.sourceLayer);
    const feature = layer?.geojson?.features?.[mapping.featureIndex];
    return feature ? { dmaCode: mapping.dmaCode, logicalDmaId: mapping.logicalDmaId, feature } : null;
  }).filter(Boolean);
}

function dmaForCoordinate(project, coordinate) {
  const match = dmaAreas(project).find(area => pointInFeature([coordinate[1], coordinate[0]], area.feature));
  return match?.dmaCode || "unassigned";
}

export function loggerComparison(project, model, result) {
  const resultByNode = new Map(result.nodes.map(node => [node.id, node]));
  const comparisonNodes = model.nodes.filter(node => node.type === "junction");
  if (!comparisonNodes.length) return { rows: [], mae: null, rmse: null, bias: null, maximumAbsoluteResidual: null };
  const rows = (project.telemetry || []).filter(asset => asset.type === "pressure" && telemetryCoordinate(asset) && observedPressure(asset) != null).map(asset => {
    const assetCoordinate = telemetryCoordinate(asset);
    const dmaCode = asset.dmaCode || asset.dma_code || dmaForCoordinate(project, assetCoordinate);
    const dmaNodes = comparisonNodes.filter(node => String(node.demandDmaCode || dmaForCoordinate(project, node.coord)).split(",").includes(String(dmaCode)));
    const hasDmaBasis = comparisonNodes.some(node => node.demandDmaCode) || dmaAreas(project).some(area => area.dmaCode === dmaCode);
    if (dmaCode && hasDmaBasis && !dmaNodes.length) return null;
    const candidates = hasDmaBasis ? dmaNodes : comparisonNodes;
    const nearest = candidates.reduce((best, node) => coordinateDistance(node.coord, assetCoordinate) < coordinateDistance(best.coord, assetCoordinate) ? node : best, candidates[0]);
    const observed = observedPressure(asset);
    const simulated = finite(resultByNode.get(nearest.id)?.pressure);
    const snapDistanceMetres = coordinateDistance(nearest.coord, assetCoordinate);
    if (snapDistanceMetres > Number(project.hydraulicAssumptions?.maximumLoggerSnapDistanceMetres ?? 1000)) return null;
    return {
      logger: asset.id || asset._id,
      dmaCode,
      dmaLabel: asset.dmaLabel || asset.dma_label || null,
      observed,
      simulated,
      residual: simulated == null ? null : simulated - observed,
      difference: simulated == null ? null : simulated - observed,
      modelNode: nearest.id,
      snapDistanceMetres,
      source: asset.source || "unknown"
    };
  }).filter(row => row?.residual != null);
  const residuals = rows.map(row => row.residual);
  return {
    rows,
    mae: residuals.length ? mean(residuals.map(Math.abs)) : null,
    rmse: residuals.length ? Math.sqrt(mean(residuals.map(value => value * value))) : null,
    bias: mean(residuals),
    maximumAbsoluteResidual: residuals.length ? Math.max(...residuals.map(Math.abs)) : null,
    maximumError: residuals.length ? Math.max(...residuals.map(Math.abs)) : null
  };
}

function demandByDma(project, model, result) {
  if (model.statistics?.demandByDma?.length) {
    const solvedByNode = new Map((result?.nodes || []).map(node => [node.id, finite(node.demand)]));
    const solvedByDma = new Map();
    model.nodes.filter(node => node.type === "junction" && node.demand > 0).forEach(node => {
      const solvedDemand = solvedByNode.get(node.id);
      if (solvedDemand == null) return;
      const allocations = Object.entries(node.demandAllocations || (node.demandDmaCode ? { [node.demandDmaCode]: node.demand } : {}));
      allocations.forEach(([dmaCode, requested]) => {
        const share = node.demand > 0 ? requested / node.demand : 0;
        solvedByDma.set(dmaCode, (solvedByDma.get(dmaCode) || 0) + solvedDemand * share);
      });
    });
    return model.statistics.demandByDma.map(row => {
      const solvedDemandLps = solvedByDma.get(row.dmaCode) ?? null;
      return {
        ...row,
        inletMeanLps: row.targetLps,
        inletMeter: row.inletMeters?.join(", ") || null,
        solvedDemandLps,
        modelDifferenceLps: row.modelDemandLps - row.targetLps,
        solvedDifferenceLps: solvedDemandLps == null ? null : solvedDemandLps - row.targetLps,
        differenceLps: solvedDemandLps == null ? row.modelDemandLps - row.targetLps : solvedDemandLps - row.targetLps
      };
    });
  }
  const rows = new Map((project.logicalDmas || []).map(dma => [dma.dma_code, {
    dmaCode: dma.dma_code,
    dmaLabel: dma.label || dma.dma_name,
    modelDemandLps: 0,
    demandNodes: 0,
    inletMeanLps: finite(dma.flow_summary?.mean_lps),
    inletMeter: dma.flow_summary?.meter_id || null,
    provenance: dma.source || "unknown"
  }]));
  model.nodes.filter(node => node.type === "junction" && node.demand > 0).forEach(node => {
    const dmaCode = dmaForCoordinate(project, node.coord);
    if (!rows.has(dmaCode)) rows.set(dmaCode, { dmaCode, dmaLabel: dmaCode, modelDemandLps: 0, demandNodes: 0, inletMeanLps: null, inletMeter: null, provenance: "spatial_assignment" });
    const row = rows.get(dmaCode);
    row.modelDemandLps += node.demand;
    row.demandNodes++;
  });
  const telemetryByDma = new Map((project.telemetry || []).filter(asset => asset.type === "flow").map(asset => [asset.dmaCode || asset.dma_code, asset]));
  rows.forEach(row => {
    const telemetry = telemetryByDma.get(row.dmaCode);
    row.inletMeanLps = observedFlow(telemetry) ?? row.inletMeanLps;
    row.inletMeter = telemetry?.id || row.inletMeter;
    row.differenceLps = row.inletMeanLps == null ? null : row.modelDemandLps - row.inletMeanLps;
  });
  return [...rows.values()];
}

function shortestPaths(model, sourceIds) {
  const adjacency = new Map(model.nodes.map(node => [node.id, []]));
  model.pipes.forEach(pipe => {
    adjacency.get(pipe.from)?.push({ node: pipe.to, length: pipe.length });
    adjacency.get(pipe.to)?.push({ node: pipe.from, length: pipe.length });
  });
  const distances = new Map(model.nodes.map(node => [node.id, Infinity]));
  sourceIds.forEach(sourceId => distances.set(sourceId, 0));
  const visited = new Set();
  while (visited.size < model.nodes.length) {
    let current = null;
    distances.forEach((value, node) => { if (!visited.has(node) && (current == null || value < distances.get(current))) current = node; });
    if (current == null || !Number.isFinite(distances.get(current))) break;
    visited.add(current);
    adjacency.get(current).forEach(edge => {
      const candidate = distances.get(current) + edge.length;
      if (candidate < distances.get(edge.node)) distances.set(edge.node, candidate);
    });
  }
  return distances;
}

export function analyzeHydraulicRun(project, topology, model, result, comparison = loggerComparison(project, model, result), options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const resultByNode = new Map(result.nodes.map(node => [node.id, node]));
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const sources = model.nodes.filter(node => node.type === "reservoir");
  const pathLengths = shortestPaths(model, sources.map(source => source.id));
  const worstPressureNodes = model.nodes.filter(node => node.type === "junction").map(node => {
    const solved = resultByNode.get(node.id) || {};
    return {
      id: node.id,
      topologyNodeId: node.topologyNodeId,
      pressureMetres: finite(solved.pressure),
      headMetres: finite(solved.head),
      elevationMetres: node.elevation,
      demandLps: node.demand,
      dmaCode: dmaForCoordinate(project, node.coord),
      distanceFromSourceMetres: pathLengths.get(node.id),
      coord: node.coord
    };
  }).filter(node => node.pressureMetres != null).sort((left, right) => left.pressureMetres - right.pressureMetres).slice(0, 20);
  const pressures = result.nodes.filter(node => nodeById.get(node.id)?.type === "junction").map(node => finite(node.pressure)).filter(value => value != null);
  const pipeById = new Map(model.pipes.map(pipe => [pipe.id, pipe]));
  const physicalLinks = result.links.filter(link => !pipeById.get(link.id)?.boundary);
  const velocities = physicalLinks.map(link => Math.abs(finite(link.velocity) ?? 0));
  const headlosses = physicalLinks.map(link => Math.abs(finite(link.headloss) ?? 0));
  const headlossGradients = physicalLinks.map(link => {
    const length = finite(pipeById.get(link.id)?.length);
    return length > 0 ? Math.abs(finite(link.headloss) ?? 0) / length * 1000 : 0;
  });
  const requestedDemand = model.nodes.reduce((sum, node) => sum + (finite(node.demand) || 0), 0);
  const solvedDemand = result.nodes.filter(node => nodeById.get(node.id)?.type === "junction").reduce((sum, node) => sum + (finite(node.demand) || 0), 0);
  const demandDifference = solvedDemand - requestedDemand;
  const resultByLink = new Map(result.links.map(link => [link.id, link]));
  const sourceBoundaries = (model.boundaries || sources.map(source => ({ nodeId: source.id, headMetres: source.head, headSource: model.assumptions.sourceHeadSource }))).map(boundary => {
    const solvedFlowLps = boundary.linkId ? Math.abs(finite(resultByLink.get(boundary.linkId)?.flow) ?? 0) : null;
    return { id: boundary.nodeId, linkId: boundary.linkId || null, dmaCode: boundary.dmaCode || null, meterIds: boundary.meterIds || [], headMetres: boundary.headMetres, provenance: boundary.headSource, targetFlowLps: finite(boundary.targetFlowLps), solvedFlowLps, differenceLps: solvedFlowLps == null || finite(boundary.targetFlowLps) == null ? null : solvedFlowLps - boundary.targetFlowLps, constraint: boundary.flowConstraint || "unavailable", coord: boundary.coordinate };
  });
  const flags = [];
  const addFlag = (code, severity, message, value = null, limit = null) => flags.push({ code, severity, message, value, limit });
  if (result.nodes.length !== model.nodes.length || result.links.length !== model.pipes.length) addFlag("solver_result_count_mismatch", "error", "Solver output counts do not match model counts.");
  const negativePressureCount = pressures.filter(value => value < limits.minimumPressureMetres).length;
  if (negativePressureCount) addFlag("negative_pressure", "error", `${negativePressureCount} junctions are below ${limits.minimumPressureMetres} m pressure.`, Math.min(...pressures), limits.minimumPressureMetres);
  const excessiveVelocityCount = velocities.filter(value => value > limits.maximumVelocityMetresPerSecond).length;
  if (excessiveVelocityCount) addFlag("excessive_velocity", "warning", `${excessiveVelocityCount} pipes exceed ${limits.maximumVelocityMetresPerSecond} m/s.`, Math.max(...velocities), limits.maximumVelocityMetresPerSecond);
  const extremeHeadlossCount = headlossGradients.filter(value => value > limits.maximumHeadlossMetresPerKilometre).length;
  if (extremeHeadlossCount) addFlag("extreme_headloss", "warning", `${extremeHeadlossCount} pipes exceed ${limits.maximumHeadlossMetresPerKilometre} m/km.`, Math.max(...headlossGradients), limits.maximumHeadlossMetresPerKilometre);
  if (topology.reviewRequiredConnections) addFlag("unresolved_topology", "warning", `${topology.reviewRequiredConnections} geometric crossings require review.`, topology.reviewRequiredConnections, 0);
  if (model.assumptions.elevationSource !== "surveyed" && model.assumptions.elevationSource !== "dem") addFlag("assumed_elevation", "warning", `Elevation source is ${model.assumptions.elevationSource}.`);
  if (model.assumptions.sourceHeadSource !== "measured") addFlag("assumed_source_head", "warning", `Source head is ${model.assumptions.sourceHeadSource}.`, model.assumptions.sourceHeadMetres);
  if (model.statistics.excludedComponents > 0) addFlag("excluded_components", "warning", `${model.statistics.excludedComponents} derived components are excluded from the model.`, model.statistics.excludedComponents, 0);
  const modeledInletMeters = new Set((model.statistics.demandByDma || []).flatMap(row => row.inletMeters || []).filter(Boolean));
  const expectedBoundaryCount = modeledInletMeters.size || new Set((project.telemetry || []).filter(asset => asset.type === "flow").map(asset => asset.dmaCode || asset.dma_code || asset.id || asset._id)).size;
  if (expectedBoundaryCount > sources.length) addFlag("combined_inlets_single_source", "warning", "One or more modeled inlet meters do not have a corresponding model boundary.");
  const inletFlowMismatches = sourceBoundaries.filter(boundary => boundary.differenceLps != null && Math.abs(boundary.differenceLps) > Math.max(0.001, boundary.targetFlowLps * 0.01));
  if (inletFlowMismatches.length) addFlag("inlet_flow_balance", "warning", `${inletFlowMismatches.length} source boundaries differ from inlet validation targets. Fixed-head boundaries do not constrain flow.`, Math.max(...inletFlowMismatches.map(boundary => Math.abs(boundary.differenceLps))));
  if (Math.abs(demandDifference) > Math.max(0.001, requestedDemand * 0.001)) addFlag("demand_balance", "error", "Solved demand does not match requested model demand.", demandDifference, Math.max(0.001, requestedDemand * 0.001));
  return {
    solver: {
      completed: true,
      version: result.solverVersion,
      units: { flow: "L/s", diameter: "mm", length: "m", pressure: "m", velocity: "m/s", headloss: "m", headlossGradient: "m/km" },
      configuration: { flowUnits: "LPS", headlossFormula: "H-W", durationHours: 0, demandModel: "demand-driven", hydraulicTimestep: "EPANET default (1 hour, not exercised at duration 0)" }
    },
    engineeringGate: { status: flags.length ? "requires_review" : "usable", usable: flags.length === 0, flags, limits },
    network: {
      nodes: model.nodes.length,
      junctions: model.nodes.filter(node => node.type === "junction").length,
      reservoirs: model.nodes.filter(node => node.type === "reservoir").length,
      pipes: model.pipes.length,
      pipeLengthMetres: quantiles(model.pipes.map(pipe => pipe.length)),
      pipeDiameterMillimetres: quantiles(model.pipes.map(pipe => pipe.diameter)),
      pressureMetres: quantiles(pressures),
      velocityMetresPerSecond: quantiles(velocities),
      headlossMetres: quantiles(headlosses),
      headlossMetresPerKilometre: quantiles(headlossGradients),
      checks: { negativePressureCount, excessiveVelocityCount, extremeHeadlossCount }
    },
    sourceBoundaries,
    elevations: { source: model.assumptions.elevationSource, valueMetres: model.assumptions.elevationMetres, uniqueValues: [...new Set(model.nodes.map(node => node.elevation))] },
    demand: { requestedLps: requestedDemand, solvedLps: solvedDemand, differenceLps: demandDifference, byDma: demandByDma(project, model, result) },
    worstPressureNodes,
    loggerComparison: comparison
  };
}

export { DEFAULT_LIMITS };

if (typeof window !== "undefined") window.AquaHydraulicDiagnostics = { analyze: analyzeHydraulicRun, loggerComparison, DEFAULT_LIMITS };