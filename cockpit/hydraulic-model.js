const DEFAULT_ROUGHNESS = Object.freeze({ PVC: 145, HDPE: 145, PE: 145, DIP: 130, DI: 130, STEEL: 120, MS: 120, GI: 120, CI: 110, AC: 110, UNKNOWN: 120 });
const SCENARIOS = Object.freeze({
  base: { id: "base", name: "Base", demandMultiplier: 1 },
  peak: { id: "peak", name: "Peak demand", demandMultiplier: 1.5 },
  mnf: { id: "mnf", name: "Minimum night flow", demandMultiplier: null }
});

function property(feature, names) {
  const values = feature?.properties || {};
  const keys = Object.keys(values);
  for (const name of names) {
    const key = keys.find(candidate => candidate.toLowerCase() === name.toLowerCase());
    if (key && values[key] !== "" && values[key] != null) return values[key];
  }
  return null;
}

function material(feature) {
  return String(property(feature, ["pipe_mtr", "material", "mat", "pipe_kind", "pipe_type", "type"]) || "UNKNOWN").toUpperCase();
}

function materialClass(value) {
  return Object.keys(DEFAULT_ROUGHNESS).find(name => name !== "UNKNOWN" && value.includes(name)) || "UNKNOWN";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function connectedComponents(nodeCount, edges) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a]?.push([edge.b, index]);
    adjacency[edge.b]?.push([edge.a, index]);
  });
  const seen = new Set();
  const groups = [];
  for (let node = 0; node < nodeCount; node++) {
    if (seen.has(node)) continue;
    const queue = [node];
    const nodes = [];
    const edgeIds = new Set();
    seen.add(node);
    while (queue.length) {
      const current = queue.shift();
      nodes.push(current);
      adjacency[current].forEach(([next, edge]) => {
        edgeIds.add(edge);
        if (!seen.has(next)) { seen.add(next);queue.push(next); }
      });
    }
    groups.push({ nodes, edges: [...edgeIds] });
  }
  return groups.sort((left, right) => right.edges.length - left.edges.length);
}

function componentsForEdges(nodeCount, edges, edgeIndexes) {
  return connectedComponents(nodeCount, edgeIndexes.map(index => edges[index]))
    .filter(component => component.edges.length)
    .map(component => ({ nodes: component.nodes, edges: component.edges.map(index => edgeIndexes[index]) }));
}

function telemetryCoordinate(asset) {
  const latitude = finiteNumber(asset.lat ?? asset.latitude);
  const longitude = finiteNumber(asset.lng ?? asset.lon ?? asset.longitude);
  return latitude == null || longitude == null ? null : [latitude, longitude];
}

function distanceSquared(left, right) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((left[0] + right[0]) * Math.PI / 360);
  return ((left[0] - right[0]) * latitudeScale) ** 2 + ((left[1] - right[1]) * longitudeScale) ** 2;
}

function flowStatistics(project) {
  const byDma = new Map();
  (project.telemetry || []).filter(asset => asset.type === "flow").forEach(asset => {
    const values = (asset.readings || []).map(reading => finiteNumber(reading.flow ?? reading.value ?? reading.flow_lps)).filter(value => value != null);
    if (!values.length) return;
    const dmaCode = String(asset.dmaCode || asset.dma_code || asset.dma || "unassigned");
    const meanLps = values.reduce((sum, value) => sum + value, 0) / values.length;
    const minimumLps = Math.min(...values);
    const row = byDma.get(dmaCode) || { dmaCode, meters: [], inlets: [], meanLps: 0, minimumLps: 0, sources: [] };
    row.meters.push(asset);
    row.inlets.push({ asset, meanLps, minimumLps });
    if (asset.source && !row.sources.includes(asset.source)) row.sources.push(asset.source);
    row.meanLps += meanLps;
    row.minimumLps += minimumLps;
    byDma.set(dmaCode, row);
  });
  const rows = [...byDma.values()];
  return {
    assetCount: rows.reduce((sum, row) => sum + row.meters.length, 0),
    meanTotalLps: rows.reduce((sum, row) => sum + row.meanLps, 0),
    minimumTotalLps: rows.reduce((sum, row) => sum + row.minimumLps, 0),
    sources: [...new Set(rows.flatMap(row => row.sources))],
    byDma: rows
  };
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
    return feature ? { dmaCode: String(mapping.dmaCode), logicalDmaId: mapping.logicalDmaId, feature } : null;
  }).filter(Boolean);
}

function dmaForCoordinate(areas, coordinate) {
  return areas.find(area => pointInFeature([coordinate[1], coordinate[0]], area.feature))?.dmaCode || null;
}

function nearestNode(nodeIndexes, graph, coordinate) {
  return nodeIndexes.reduce((best, node) => distanceSquared(graph.nodes[node].coord, coordinate) < distanceSquared(graph.nodes[best].coord, coordinate) ? node : best, nodeIndexes[0]);
}

function format(value, decimals = 6) {
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}

function buildInp(model) {
  const lines = [
    "[TITLE]",
    `; Aqua Intelligence ${model.scenario.name} scenario`,
    "",
    "[JUNCTIONS]",
    ";ID Elevation Demand Pattern",
    ...model.nodes.filter(node => node.type === "junction").map(node => `${node.id} ${format(node.elevation)} ${format(node.demand)}`),
    "",
    "[RESERVOIRS]",
    ";ID Head Pattern",
    ...model.nodes.filter(node => node.type === "reservoir").map(node => `${node.id} ${format(node.head)}`),
    "",
    "[PIPES]",
    ";ID Node1 Node2 Length Diameter Roughness MinorLoss Status",
    ...model.pipes.map(pipe => `${pipe.id} ${pipe.from} ${pipe.to} ${format(pipe.length)} ${format(pipe.diameter)} ${format(pipe.roughness)} 0 Open`),
    "",
    "[OPTIONS]",
    "UNITS LPS",
    "HEADLOSS H-W",
    "",
    "[COORDINATES]",
    ...model.nodes.map(node => `${node.id} ${format(node.coord[1], 8)} ${format(node.coord[0], 8)}`),
    "",
    "[END]",
    ""
  ];
  return lines.join("\n");
}

export function buildHydraulicModel(project, topology, options = {}) {
  if (!topology?.derived?.nodes?.length || !topology?.derived?.edges?.length) throw new Error("Build the derived hydraulic topology first");
  const scenarioTemplate = SCENARIOS[options.scenarioId || "base"];
  if (!scenarioTemplate) throw new Error("Unknown hydraulic scenario");
  const modelVariant = options.modelVariant || "full-network";
  if (!["full-network", "distribution-main"].includes(modelVariant)) throw new Error("Unknown hydraulic model variant");
  const assumptions = {
    sourceHeadMetres: finiteNumber(options.sourceHeadMetres ?? project.hydraulicAssumptions?.sourceHeadMetres) ?? 55,
    sourceHeadSource: options.sourceHeadSource || project.hydraulicAssumptions?.sourceHeadSource || "demo_assumption",
    elevationMetres: finiteNumber(options.elevationMetres ?? project.hydraulicAssumptions?.elevationMetres) ?? 0,
    elevationSource: options.elevationSource || project.hydraulicAssumptions?.elevationSource || "demo_flat_datum",
    fallbackDiameterMm: finiteNumber(options.fallbackDiameterMm ?? project.hydraulicAssumptions?.fallbackDiameterMm) ?? 100,
    fallbackServiceDiameterMm: finiteNumber(options.fallbackServiceDiameterMm ?? project.hydraulicAssumptions?.fallbackServiceDiameterMm) ?? 20,
    minimumMainDiameterMm: finiteNumber(options.minimumMainDiameterMm ?? project.hydraulicAssumptions?.minimumMainDiameterMm) ?? 40,
    minimumServiceDiameterMm: finiteNumber(options.minimumServiceDiameterMm ?? project.hydraulicAssumptions?.minimumServiceDiameterMm) ?? 15,
    roughnessByMaterial: { ...DEFAULT_ROUGHNESS, ...(project.hydraulicAssumptions?.roughnessByMaterial || {}), ...(options.roughnessByMaterial || {}) },
    peakDemandMultiplier: finiteNumber(options.peakDemandMultiplier ?? project.hydraulicAssumptions?.peakDemandMultiplier) ?? 1.5
  };
  const graph = topology.derived;
  const components = connectedComponents(graph.nodes.length, graph.edges);
  const componentByNode = new Map();
  components.forEach((component, componentIndex) => component.nodes.forEach(node => componentByNode.set(node, componentIndex)));
  const flows = flowStatistics(project);
  const requestedDmas = new Set((options.dmaCodes || []).map(String));
  const selectedFlows = requestedDmas.size ? flows.byDma.filter(flow => requestedDmas.has(flow.dmaCode)) : flows.byDma;
  if (requestedDmas.size && selectedFlows.length !== requestedDmas.size) throw new Error("One or more requested DMAs do not have inlet flow telemetry");
  const areas = dmaAreas(project);
  const allNodes = graph.nodes.map((_, index) => index);
  const allDegree = new Map(allNodes.map(node => [node, 0]));
  graph.edges.forEach(edge => {
    allDegree.set(edge.a, (allDegree.get(edge.a) || 0) + 1);
    allDegree.set(edge.b, (allDegree.get(edge.b) || 0) + 1);
  });
  const globalServiceTerminalNodes = allNodes.filter(node => allDegree.get(node) === 1 && graph.edges.some(edge => edge.service && (edge.a === node || edge.b === node)));
  const globalMainNodes = new Set(graph.edges.filter(edge => !edge.service).flatMap(edge => [edge.a, edge.b]));
  const globalDistributionDemandNodes = [...new Set(graph.edges.filter(edge => edge.service).flatMap(edge => [edge.a, edge.b]).filter(node => globalMainNodes.has(node)))];
  const globalDemandCandidates = modelVariant === "distribution-main" ? globalDistributionDemandNodes : globalServiceTerminalNodes;
  let boundaryIndex = 0;
  let boundaryRows = selectedFlows.flatMap(flow => flow.inlets.map(inlet => {
    const coordinate = telemetryCoordinate(inlet.asset);
    if (!coordinate) return null;
    const hasMappedArea = areas.some(area => area.dmaCode === flow.dmaCode);
    const eligibleDemandNodes = globalDemandCandidates.filter(node => !hasMappedArea || dmaForCoordinate(areas, graph.nodes[node].coord) === flow.dmaCode);
    if (!eligibleDemandNodes.length) throw new Error(`DMA ${flow.dmaCode} has no eligible service demand nodes inside its mapped area`);
    const eligibleComponents = new Set(eligibleDemandNodes.map(node => componentByNode.get(node)));
    let candidates = allNodes.filter(node => eligibleComponents.has(componentByNode.get(node)) && (!hasMappedArea || dmaForCoordinate(areas, graph.nodes[node].coord) === flow.dmaCode));
    if (modelVariant === "distribution-main") candidates = candidates.filter(node => globalMainNodes.has(node));
    const topologyNode = nearestNode(candidates.length ? candidates : eligibleDemandNodes, graph, coordinate);
    const logical = (project.logicalDmas || []).find(dma => String(dma.dma_code) === flow.dmaCode);
    boundaryIndex++;
    return { id: `B${boundaryIndex}`, dmaCode: flow.dmaCode, logicalDmaId: logical?.logical_dma_uid || null, label: logical?.label || logical?.dma_name || flow.dmaCode, coordinate, topologyNode, meterIds: [inlet.asset.id || inlet.asset._id], meanLps: inlet.meanLps, minimumLps: inlet.minimumLps, flowConstraint: "validation_target_only" };
  })).filter(Boolean);
  if (!boundaryRows.length) {
    const component = components.find(candidate => candidate.edges.length);
    if (!component) throw new Error("No connected hydraulic component is available");
    boundaryRows = [{ id: "B1", dmaCode: "unassigned", logicalDmaId: null, label: "Unassigned", coordinate: graph.nodes[component.nodes[0]].coord, topologyNode: component.nodes[0], meterIds: [], meanLps: 0, minimumLps: 0 }];
  }
  const includedComponentIndexes = new Set(boundaryRows.map(boundary => componentByNode.get(boundary.topologyNode)));
  const fullComponentEdges = [...new Set([...includedComponentIndexes].flatMap(index => components[index]?.edges || []))];
  const variantEdgeCandidates = fullComponentEdges.filter(edgeIndex => modelVariant === "full-network" || !graph.edges[edgeIndex].service);
  const variantComponents = componentsForEdges(graph.nodes.length, graph.edges, variantEdgeCandidates);
  const variantComponentByNode = new Map();
  variantComponents.forEach((component, componentIndex) => component.nodes.forEach(node => variantComponentByNode.set(node, componentIndex)));
  const reachableVariantComponents = new Set(boundaryRows.map(boundary => variantComponentByNode.get(boundary.topologyNode)).filter(index => index != null));
  const componentEdges = [...new Set([...reachableVariantComponents].flatMap(index => variantComponents[index]?.edges || []))];
  const componentNodes = [...new Set(componentEdges.flatMap(edgeIndex => [graph.edges[edgeIndex].a, graph.edges[edgeIndex].b]))];
  if (!componentEdges.length) throw new Error("No connected hydraulic component is available");

  const degree = new Map([...new Set(fullComponentEdges.flatMap(edgeIndex => [graph.edges[edgeIndex].a, graph.edges[edgeIndex].b]))].map(node => [node, 0]));
  fullComponentEdges.forEach(edgeIndex => {
    const edge = graph.edges[edgeIndex];
    degree.set(edge.a, (degree.get(edge.a) || 0) + 1);
    degree.set(edge.b, (degree.get(edge.b) || 0) + 1);
  });
  const serviceTerminalNodes = globalServiceTerminalNodes.filter(node => componentNodes.includes(node));
  const distributionServiceNodes = globalDistributionDemandNodes.filter(node => componentNodes.includes(node));
  const demandCandidateNodes = modelVariant === "distribution-main" ? distributionServiceNodes : serviceTerminalNodes;
  const nodeId = new Map(componentNodes.map((node, index) => [node, `J${index + 1}`]));
  const demandAssignments = new Map();
  const demandByDma = selectedFlows.map(flow => {
    const dmaBoundaries = boundaryRows.filter(boundary => boundary.dmaCode === flow.dmaCode);
    const dmaComponents = new Set(dmaBoundaries.map(boundary => componentByNode.get(boundary.topologyNode)));
    const hasMappedArea = areas.some(area => area.dmaCode === flow.dmaCode);
    let candidates = demandCandidateNodes.filter(node => dmaComponents.has(componentByNode.get(node)) && (!hasMappedArea || dmaForCoordinate(areas, graph.nodes[node].coord) === flow.dmaCode));
    if (!candidates.length && hasMappedArea) throw new Error(`DMA ${flow.dmaCode} has no eligible service demand nodes inside its mapped area`);
    if (!candidates.length) candidates = componentNodes.filter(node => dmaComponents.has(componentByNode.get(node)) && !dmaBoundaries.some(boundary => boundary.topologyNode === node));
    if (!candidates.length) throw new Error(`DMA ${flow.dmaCode} has no eligible demand nodes`);
    const mnfMultiplier = flow.meanLps > 0 ? flow.minimumLps / flow.meanLps : 0.35;
    const demandMultiplier = scenarioTemplate.id === "peak" ? assumptions.peakDemandMultiplier : scenarioTemplate.id === "mnf" ? mnfMultiplier : 1;
    const targetLps = flow.meanLps * demandMultiplier;
    const demandPerNode = targetLps / candidates.length;
    candidates.forEach(node => {
      const assignment = demandAssignments.get(node) || { demand: 0, dmaCodes: [], byDma: {} };
      assignment.demand += demandPerNode;
      assignment.dmaCodes.push(flow.dmaCode);
      assignment.byDma[flow.dmaCode] = (assignment.byDma[flow.dmaCode] || 0) + demandPerNode;
      demandAssignments.set(node, assignment);
    });
    return { dmaCode: flow.dmaCode, logicalDmaId: dmaBoundaries[0]?.logicalDmaId || null, label: dmaBoundaries[0]?.label || flow.dmaCode, inletMeters: dmaBoundaries.flatMap(boundary => boundary.meterIds), targetLps, modelDemandLps: demandPerNode * candidates.length, differenceLps: demandPerNode * candidates.length - targetLps, demandNodes: candidates.length };
  });
  const totalDemand = demandByDma.reduce((sum, row) => sum + row.targetLps, 0);
  const nodes = componentNodes.map(node => {
    const assignment = demandAssignments.get(node);
    const topologyNodeId = graph.nodes[node].nodeId;
    const explicitElevation = finiteNumber(options.nodeElevations?.[topologyNodeId] ?? project.hydraulicNodeElevations?.[topologyNodeId]);
    return {
    id: nodeId.get(node),
    topologyNodeId: graph.nodes[node].nodeId,
    type: "junction",
    coord: graph.nodes[node].coord,
    elevation: explicitElevation ?? assumptions.elevationMetres,
    elevationSource: explicitElevation == null ? assumptions.elevationSource : "hydraulic_node_elevation",
    head: null,
    demand: assignment?.demand || 0,
    demandDmaCode: assignment?.dmaCodes.length === 1 ? assignment.dmaCodes[0] : assignment?.dmaCodes.join(",") || null,
    demandAllocations: assignment?.byDma || {},
    demandRepresentation: assignment ? (modelVariant === "distribution-main" ? "service_connection_on_distribution_main" : "service_terminal") : null,
    demandSource: assignment ? "dma_inlet_target_service_allocation" : "none"
  }; });
  const boundaries = boundaryRows.map((boundary, index) => {
    const mnfMultiplier = boundary.meanLps > 0 ? boundary.minimumLps / boundary.meanLps : 0.35;
    const boundaryMultiplier = scenarioTemplate.id === "peak" ? assumptions.peakDemandMultiplier : scenarioTemplate.id === "mnf" ? mnfMultiplier : 1;
    return { ...boundary, nodeId: boundary.id, linkId: `BV${index + 1}`, attachedNodeId: nodeId.get(boundary.topologyNode), headMetres: assumptions.sourceHeadMetres, headSource: assumptions.sourceHeadSource, targetFlowLps: boundary.meanLps * boundaryMultiplier };
  });
  nodes.push(...boundaries.map(boundary => ({ id: boundary.nodeId, topologyNodeId: null, type: "reservoir", coord: boundary.coordinate, elevation: null, elevationSource: null, head: boundary.headMetres, demand: 0, demandDmaCode: boundary.dmaCode, demandSource: "none" })));
  const diameterAuditRows = (topology.pipeCatalog || []).map(pipe => {
    const rawDiameter = finiteNumber(property({ properties: pipe.properties || {} }, ["pipe_size", "diameter", "dia", "size"]));
    const minimumDiameter = pipe.service ? assumptions.minimumServiceDiameterMm : assumptions.minimumMainDiameterMm;
    const reason = rawDiameter == null ? "missing_or_non_numeric" : rawDiameter <= 0 ? "non_positive" : rawDiameter < minimumDiameter ? "below_modeling_minimum" : null;
    return reason ? {
      sourcePipeId: pipe.sourcePipeId,
      service: Boolean(pipe.service),
      rawDiameter,
      sourceDiameter: rawDiameter,
      minimumDiameter,
      modeledDiameter: pipe.service ? assumptions.fallbackServiceDiameterMm : assumptions.fallbackDiameterMm,
      modelDiameter: pipe.service ? assumptions.fallbackServiceDiameterMm : assumptions.fallbackDiameterMm,
      reason,
      substitutionReason: reason,
      confidence: "low",
      modeled: false
    } : null;
  }).filter(Boolean);
  const diameterAuditByPipe = new Map(diameterAuditRows.map(row => [row.sourcePipeId, row]));
  const sourceCounts = { diameterFromGis: 0, diameterAssumed: 0, diameterSuspicious: 0, roughnessAssumedByMaterial: 0 };
  const pipes = componentEdges.map((edgeIndex, index) => {
    const edge = graph.edges[edgeIndex];
    const catalogPipe = topology.pipeCatalog?.[edge.sourcePipeIndex] || {};
    const feature = { properties: catalogPipe.properties || {} };
    const gisDiameter = finiteNumber(property(feature, ["pipe_size", "diameter", "dia", "size"]));
    const audit = diameterAuditByPipe.get(edge.sourcePipeId);
    if (audit) audit.modeled = true;
    const pipeMaterial = material(feature);
    const materialKey = materialClass(pipeMaterial);
    const fallbackDiameter = edge.service ? assumptions.fallbackServiceDiameterMm : assumptions.fallbackDiameterMm;
    const diameter = audit?.modeledDiameter ?? (gisDiameter > 0 ? gisDiameter : fallbackDiameter);
    if (audit) sourceCounts.diameterSuspicious++;
    if (gisDiameter > 0 && !audit) sourceCounts.diameterFromGis++; else sourceCounts.diameterAssumed++;
    sourceCounts.roughnessAssumedByMaterial++;
    return {
      id: `P${index + 1}`,
      topologyEdgeId: edge.id,
      sourcePipeId: edge.sourcePipeId,
      service: Boolean(edge.service),
      from: nodeId.get(edge.a),
      to: nodeId.get(edge.b),
      length: Math.max(0.01, finiteNumber(edge.length) || 0.01),
      lengthSource: "derived_gis_geometry",
      rawDiameter: gisDiameter,
      sourceDiameter: gisDiameter,
      diameter,
      modelDiameter: diameter,
      diameterSource: audit ? "audit_fallback" : gisDiameter > 0 ? "GIS" : "demo_assumption",
      substitutionReason: audit?.substitutionReason || null,
      diameterConfidence: audit ? "low" : gisDiameter > 0 ? "high" : "low",
      material: pipeMaterial,
      roughness: finiteNumber(assumptions.roughnessByMaterial[materialKey]) ?? assumptions.roughnessByMaterial.UNKNOWN,
      roughnessSource: "assumed_by_material"
    };
  });
  pipes.push(...boundaries.map(boundary => ({ id: boundary.linkId, topologyEdgeId: null, sourcePipeId: null, from: boundary.nodeId, to: boundary.attachedNodeId, length: 0.1, lengthSource: "logical_dma_boundary", diameter: Math.max(assumptions.fallbackDiameterMm, 300), diameterSource: "boundary_assumption", material: "BOUNDARY", roughness: 120, roughnessSource: "boundary_assumption", boundary: true, dmaCode: boundary.dmaCode, targetFlowLps: boundary.targetFlowLps, flowConstraint: boundary.flowConstraint })));
  const selectedMeanTotalLps = selectedFlows.reduce((sum, flow) => sum + flow.meanLps, 0);
  const demandMultiplier = selectedMeanTotalLps > 0 ? totalDemand / selectedMeanTotalLps : 1;
  const scenario = {
    id: scenarioTemplate.id,
    name: scenarioTemplate.name,
    modelVariant,
    assumptions: { demandMultiplier, demandMethod: "Each logical DMA inlet target allocated to service demand nodes in that DMA" },
    inputRevision: Number(project.cloudRevision || project.projectVersion || 0),
    solverVersion: "epanet-js@0.9.0 / OWA EPANET WASM",
    timestamp: options.timestamp || new Date().toISOString()
  };
  const model = {
    schemaVersion: 1,
    projectId: project.id,
    topologySchemaVersion: topology.schemaVersion,
    scenario,
    assumptions,
    provenance: {
      geometry: "derived hydraulic topology",
      elevation: assumptions.elevationSource,
      terrain: project.elevationData || project.demElevation || project.dem ? "separate_context_only" : "unavailable",
      demand: [...new Set(selectedFlows.flatMap(flow => flow.sources))].join(", ") || "unidentified DMA inlet telemetry",
      boundaryFlow: flows.assetCount ? "logical DMA inlet meters" : "unavailable",
      sourceHead: assumptions.sourceHeadSource
    },
    statistics: {
      sourceTopologyComponents: topology.source.components,
      derivedTopologyComponents: topology.derived.components,
      modelComponentNodes: componentNodes.length,
      modelComponentPipes: pipes.length,
      modelVariant,
      excludedServicePipes: fullComponentEdges.length - componentEdges.length,
      variantDisconnectedComponentsExcluded: variantComponents.length - reachableVariantComponents.size,
      modeledComponents: includedComponentIndexes.size,
      excludedComponents: Math.max(0, topology.derived.components - includedComponentIndexes.size),
      demandNodes: demandAssignments.size,
      baseSyntheticInletFlowLps: selectedMeanTotalLps,
      scenarioDemandLps: totalDemand,
      demandByDma,
      diameterAudit: { suspicious: diameterAuditRows.length, rows: diameterAuditRows },
      ...sourceCounts
    },
    boundaries,
    reviewRequired: { connections: topology.reviewRequiredConnections || 0, unresolvedCrossings: topology.unresolvedCrossings || [] },
    nodes,
    pipes
  };
  model.inp = buildInp(model);
  return model;
}

export { DEFAULT_ROUGHNESS, SCENARIOS };

if (typeof window !== "undefined") window.AquaHydraulicModel = { build: buildHydraulicModel, DEFAULT_ROUGHNESS, SCENARIOS };