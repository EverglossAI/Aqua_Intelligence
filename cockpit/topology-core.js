const EARTH_RADIUS = 6371000;

function property(feature, names, fallback = null) {
  const values = feature?.properties || {};
  const keys = Object.keys(values);
  for (const name of names) {
    const key = keys.find(candidate => candidate.toLowerCase() === name.toLowerCase());
    if (key && values[key] !== "" && values[key] != null) return values[key];
  }
  return fallback;
}

function pipeId(pipe, index) {
  return String(property(pipe.feature, ["id", "pipe_id", "unific_id", "gid", "objectid", "fid"], `${pipe.layerName}:${index + 1}`));
}

function lineParts(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "LineString") return [geometry.coordinates];
  if (geometry?.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function lineCoordinates(feature) {
  return lineParts(feature)[0] || [];
}

function projector(pipes) {
  const first = pipes.flatMap(pipe => lineCoordinates(pipe.feature).slice(0, 1))[0] || [0, 0];
  const latitude = first[1] * Math.PI / 180;
  return coordinate => [
    coordinate[0] * Math.PI / 180 * EARTH_RADIUS * Math.cos(latitude),
    coordinate[1] * Math.PI / 180 * EARTH_RADIUS
  ];
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function closestPointOnLine(point, coordinates, project) {
  let best = null;
  let traversed = 0;
  for (let index = 1; index < coordinates.length; index++) {
    const start = project(coordinates[index - 1]);
    const end = project(coordinates[index]);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const segmentLength = Math.hypot(dx, dy);
    if (!segmentLength) continue;
    const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (segmentLength * segmentLength)));
    const projected = [start[0] + fraction * dx, start[1] + fraction * dy];
    const candidate = {
      distance: distance(point, projected),
      fraction,
      segmentIndex: index - 1,
      along: traversed + segmentLength * fraction,
      coordinate: [
        coordinates[index - 1][0] + (coordinates[index][0] - coordinates[index - 1][0]) * fraction,
        coordinates[index - 1][1] + (coordinates[index][1] - coordinates[index - 1][1]) * fraction
      ]
    };
    if (!best || candidate.distance < best.distance) best = candidate;
    traversed += segmentLength;
  }
  return best;
}

function lineLength(coordinates, project) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index++) total += distance(project(coordinates[index - 1]), project(coordinates[index]));
  return total;
}

function distanceSummary(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const percentile = fraction => sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
  return {
    count: sorted.length,
    min: percentile(0),
    median: percentile(0.5),
    p95: percentile(0.95),
    max: percentile(1)
  };
}

function connectionClass(sourcePipe, targetPipe) {
  if (sourcePipe?.service && targetPipe?.service) return "service-service";
  if (sourcePipe?.service || targetPipe?.service) return "service-main";
  return "main-main";
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function components(nodes, edges) {
  const adjacency = Array.from({ length: nodes.length }, () => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a]?.push([edge.b, index]);
    adjacency[edge.b]?.push([edge.a, index]);
  });
  const seen = new Set();
  const result = [];
  for (let node = 0; node < nodes.length; node++) {
    if (seen.has(node)) continue;
    const queue = [node];
    const nodeIds = [];
    const edgeIds = new Set();
    seen.add(node);
    while (queue.length) {
      const current = queue.shift();
      nodeIds.push(current);
      for (const [next, edge] of adjacency[current]) {
        edgeIds.add(edge);
        if (!seen.has(next)) { seen.add(next);queue.push(next); }
      }
    }
    result.push({ nodes: nodeIds, edges: [...edgeIds] });
  }
  return result.sort((left, right) => right.nodes.length - left.nodes.length);
}

function summarize(nodes, edges) {
  const groups = components(nodes, edges);
  const isolatedServicePipes = groups.filter(group => group.edges.length === 1 && edges[group.edges[0]]?.service).length;
  return {
    nodes: nodes.length,
    edges: edges.length,
    components: groups.length,
    largestComponentPercent: nodes.length ? groups[0].nodes.length / nodes.length * 100 : 0,
    isolatedServicePipes,
    componentGroups: groups
  };
}

function normalizePipes(layers) {
  return (layers || []).filter(layer => layer.kind === "pipe").flatMap(layer =>
    (layer.geojson?.features || []).flatMap((feature, index) => lineParts(feature).map((coordinates, partIndex) => ({
      feature: { ...feature, geometry: { type: "LineString", coordinates } },
      layerName: layer.name,
      sourcePipeId: pipeId({ feature, layerName: layer.name }, index),
      sourcePartIndex: partIndex,
      service: /(^|[^a-z])eupipe([^a-z]|$)|service/i.test(layer.name),
      main: /(^|\/)pipe$/i.test(layer.name)
    })))
  ).filter(pipe => lineCoordinates(pipe.feature).length >= 2);
}

function sourceGraph(pipes, project, tolerance) {
  const nodes = [];
  const edges = [];
  const endpointNodes = [];
  function findOrAdd(coordinate, sourcePipeId, sourcePipeIndex) {
    const point = project(coordinate);
    let id = nodes.findIndex(node => distance(node.xy, point) <= tolerance);
    if (id < 0) {
      id = nodes.length;
      nodes.push({ id, nodeId: `N${id + 1}`, coord: [coordinate[1], coordinate[0]], xy: point, provenance: [] });
    }
    nodes[id].provenance.push({ nodeId: nodes[id].nodeId, sourcePipeId, sourcePipeIndex, connectionType: "source-endpoint", snapDistance: distance(nodes[id].xy, point), derived: false });
    return id;
  }
  pipes.forEach((pipe, index) => {
    const coordinates = lineCoordinates(pipe.feature);
    const ends = [coordinates[0], coordinates[coordinates.length - 1]];
    const endpoint = ends.map(coordinate => findOrAdd(coordinate, pipe.sourcePipeId, index));
    endpointNodes[index] = endpoint;
    edges.push({ id: `E${edges.length + 1}`, a: endpoint[0], b: endpoint[1], sourcePipeId: pipe.sourcePipeId, sourcePipeIndex: index, service: pipe.service, derived: false });
  });
  return { nodes, edges, endpointNodes };
}

function segmentIntersection(a, b, c, d) {
  const denominator = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / denominator;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / denominator;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
}

function unresolvedCrossings(pipes, project, source, endpointTolerance) {
  const segments = [];
  pipes.forEach((pipe, pipeIndex) => {
    const coordinates = lineCoordinates(pipe.feature);
    for (let index = 1; index < coordinates.length; index++) {
      const a = project(coordinates[index - 1]);
      const b = project(coordinates[index]);
      segments.push({ pipeIndex, a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }
  });
  const pairs = new Map();
  for (let left = 0; left < segments.length; left++) {
    const a = segments[left];
    for (let right = left + 1; right < segments.length; right++) {
      const b = segments[right];
      if (a.pipeIndex === b.pipeIndex || a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
      const crossing = segmentIntersection(a.a, a.b, b.a, b.b);
      if (!crossing) continue;
      const endpoints = [
        ...source.endpointNodes[a.pipeIndex].map(node => source.nodes[node].xy),
        ...source.endpointNodes[b.pipeIndex].map(node => source.nodes[node].xy)
      ];
      if (endpoints.some(endpoint => distance(endpoint, crossing) <= endpointTolerance)) continue;
      const key = [a.pipeIndex, b.pipeIndex].sort((x, y) => x - y).join(":");
      if (!pairs.has(key)) pairs.set(key, {
        sourcePipeIds: [pipes[a.pipeIndex].sourcePipeId, pipes[b.pipeIndex].sourcePipeId],
        connectionType: "pipe-crossing",
        status: "review_required",
        serviceMain: pipes[a.pipeIndex].service !== pipes[b.pipeIndex].service
      });
    }
  }
  return [...pairs.values()];
}

function legacyEndpointToLineScreen(pipes, project, source, tolerance, maximumSegmentLength) {
  const componentByNode = new Map();
  source.componentGroups.forEach((group, component) => group.nodes.forEach(node => componentByNode.set(node, component)));
  const degree = Array(source.nodes.length).fill(0);
  source.edges.forEach(edge => { degree[edge.a]++;degree[edge.b]++; });
  const segments = [];
  pipes.forEach((pipe, pipeIndex) => {
    const coordinates = lineCoordinates(pipe.feature);
    for (let index = 1; index < coordinates.length; index++) {
      const a = project(coordinates[index - 1]);
      const b = project(coordinates[index]);
      const length = distance(a, b);
      if (length > maximumSegmentLength) continue;
      segments.push({ pipeIndex, a, b, length, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }
  });
  const records = [];
  source.edges.forEach((edge, pipeIndex) => {
    [edge.a, edge.b].forEach(sourceNode => {
      if (degree[sourceNode] !== 1) return;
      const point = source.nodes[sourceNode].xy;
      let best = null;
      segments.forEach(segment => {
        if (segment.pipeIndex === pipeIndex || componentByNode.get(sourceNode) === componentByNode.get(source.endpointNodes[segment.pipeIndex][0])) return;
        if (point[0] < segment.minX - tolerance || point[0] > segment.maxX + tolerance || point[1] < segment.minY - tolerance || point[1] > segment.maxY + tolerance) return;
        const dx = segment.b[0] - segment.a[0];
        const dy = segment.b[1] - segment.a[1];
        if (!segment.length) return;
        const fraction = ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) / (segment.length * segment.length);
        if (fraction <= 1e-6 || fraction >= 1 - 1e-6) return;
        const projected = [segment.a[0] + fraction * dx, segment.a[1] + fraction * dy];
        const snapDistance = distance(point, projected);
        if (snapDistance > tolerance || (best && snapDistance >= best.snapDistance)) return;
        best = { sourceNode, sourcePipeIndex: pipeIndex, targetPipeIndex: segment.pipeIndex, snapDistance };
      });
      if (best) records.push(best);
    });
  });
  return records;
}

export function buildHydraulicTopology(layers, options = {}) {
  const endpointTolerance = Number(options.endpointTolerance ?? 3);
  const attachmentTolerance = Number(options.attachmentTolerance ?? 0.25);
  const pipes = normalizePipes(layers);
  const project = projector(pipes);
  const source = sourceGraph(pipes, project, endpointTolerance);
  const servicePipeCount = pipes.filter(pipe => pipe.service).length;
  const sourceSummary = summarize(source.nodes, source.edges);
  source.componentGroups = sourceSummary.componentGroups;
  const attachmentsBySourceNode = new Map();
  const isolatedServiceNodes = new Set(sourceSummary.componentGroups.filter(group =>
    group.edges.length === 1 && source.edges[group.edges[0]]?.service
  ).flatMap(group => group.nodes));

  pipes.forEach((pipe, pipeIndex) => {
    if (!pipe.service) return;
    const coordinates = lineCoordinates(pipe.feature);
    const candidates = [];
    [coordinates[0], coordinates[coordinates.length - 1]].forEach((coordinate, endIndex) => {
      const sourceNode = source.endpointNodes[pipeIndex][endIndex];
      if (!isolatedServiceNodes.has(sourceNode)) return;
      const point = project(coordinate);
      let best = null;
      pipes.forEach((main, mainIndex) => {
        if (!main.main) return;
        const candidate = closestPointOnLine(point, lineCoordinates(main.feature), project);
        if (!candidate || candidate.fraction <= 1e-6 || candidate.fraction >= 1 - 1e-6 || candidate.distance > attachmentTolerance) return;
        if (!best || candidate.distance < best.distance) best = { ...candidate, mainIndex };
      });
      if (!best) return;
      candidates.push({ ...best, sourceNode, servicePipeId: pipe.sourcePipeId, servicePipeIndex: pipeIndex });
    });
    candidates.sort((left, right) => left.distance - right.distance);
    if (candidates[0]) attachmentsBySourceNode.set(candidates[0].sourceNode, candidates[0]);
  });

  const nodes = source.nodes.map(node => ({ ...node, provenance: node.provenance.map(item => ({ ...item })) }));
  const attachmentNodeBySource = new Map();
  const cutsByPipe = new Map();
  const sortedAttachments = [...attachmentsBySourceNode.values()].sort((left, right) => left.mainIndex - right.mainIndex || left.along - right.along);
  sortedAttachments.forEach(attachment => {
    const id = nodes.length;
    const main = pipes[attachment.mainIndex];
    const node = {
      id,
      nodeId: `D${id + 1}`,
      coord: [attachment.coordinate[1], attachment.coordinate[0]],
      xy: project(attachment.coordinate),
      provenance: [{
        nodeId: `D${id + 1}`,
        sourcePipeId: attachment.servicePipeId,
        connectionType: "endpoint-to-line",
        snapDistance: attachment.distance,
        derived: true,
        targetPipeId: main.sourcePipeId,
        sourcePipeIndex: attachment.servicePipeIndex,
        targetPipeIndex: attachment.mainIndex
      }]
    };
    nodes.push(node);
    attachmentNodeBySource.set(attachment.sourceNode, id);
    if (!cutsByPipe.has(attachment.mainIndex)) cutsByPipe.set(attachment.mainIndex, []);
    cutsByPipe.get(attachment.mainIndex).push({ along: attachment.along, node: id });
  });

  const edges = [];
  pipes.forEach((pipe, pipeIndex) => {
    const originalEnds = source.endpointNodes[pipeIndex];
    const start = originalEnds[0];
    const end = originalEnds[1];
    const totalLength = lineLength(lineCoordinates(pipe.feature), project);
    const cuts = [{ along: 0, node: start }, ...(cutsByPipe.get(pipeIndex) || []), { along: totalLength, node: end }];
    const deduplicated = cuts.filter((cut, index) => !index || cut.node !== cuts[index - 1].node);
    for (let index = 1; index < deduplicated.length; index++) {
      if (deduplicated[index - 1].node === deduplicated[index].node) continue;
      edges.push({
        id: `H${edges.length + 1}`,
        a: deduplicated[index - 1].node,
        b: deduplicated[index].node,
        sourcePipeId: pipe.sourcePipeId,
        sourcePipeIndex: pipeIndex,
        service: pipe.service,
        derived: deduplicated.length > 2,
        length: Math.max(0.01, deduplicated[index].along - deduplicated[index - 1].along)
      });
    }
  });
  attachmentNodeBySource.forEach((attachmentNode, sourceNode) => {
    const provenance = nodes[attachmentNode].provenance[0];
    edges.push({
      id: `H${edges.length + 1}`,
      a: sourceNode,
      b: attachmentNode,
      sourcePipeId: provenance.sourcePipeId,
      connectionType: "endpoint-to-line",
      sourcePipeIndex: provenance.sourcePipeIndex,
      service: true,
      derived: true,
      length: Math.max(0.01, provenance.snapDistance)
    });
  });

  const crossings = unresolvedCrossings(pipes, project, source, endpointTolerance);
  const legacyScreen = legacyEndpointToLineScreen(pipes, project, source, attachmentTolerance, Number(options.legacyMaximumSegmentLength ?? 1000));
  const acceptedSourceNodes = new Set(sortedAttachments.map(attachment => attachment.sourceNode));
  const legacySourceNodes = new Set(legacyScreen.map(record => record.sourceNode));
  const endpointMergeTypes = {};
  const endpointMergeDistances = [];
  source.nodes.forEach(node => node.provenance.slice(1).forEach(record => {
    const sourcePipe = pipes[node.provenance[0].sourcePipeIndex];
    const mergedPipe = pipes[record.sourcePipeIndex];
    increment(endpointMergeTypes, connectionClass(sourcePipe, mergedPipe));
    endpointMergeDistances.push(record.snapDistance);
  }));
  const legacyTypes = {};
  legacyScreen.forEach(record => increment(legacyTypes, connectionClass(pipes[record.sourcePipeIndex], pipes[record.targetPipeIndex])));
  const derivedSummary = summarize(nodes, edges);
  const { componentGroups: sourceGroups, ...sourceMetrics } = sourceSummary;
  const { componentGroups: derivedGroups, ...derivedMetrics } = derivedSummary;
  return {
    schemaVersion: 1,
    tolerances: { endpointToEndpointMetres: endpointTolerance, endpointToLineMetres: attachmentTolerance },
    pipeCatalog: pipes.map(pipe => ({ sourcePipeId: pipe.sourcePipeId, sourcePartIndex: pipe.sourcePartIndex, layerName: pipe.layerName, properties: { ...(pipe.feature.properties || {}) }, service: pipe.service, main: pipe.main })),
    source: { ...sourceMetrics, nodes: source.nodes, edges: source.edges },
    derived: { ...derivedMetrics, nodes, edges },
    attachments: sortedAttachments.map((attachment, index) => nodes[source.nodes.length + index].provenance[0]),
    unresolvedCrossings: crossings,
    reviewRequiredConnections: crossings.length,
    diagnostics: {
      servicePipes: servicePipeCount,
      connectedServicePipesBefore: servicePipeCount - sourceSummary.isolatedServicePipes,
      connectedServicePipesAfter: servicePipeCount - derivedSummary.isolatedServicePipes,
      endpointToLineAttachments: attachmentsBySourceNode.size,
      unresolvedCrossings: crossings.length,
      serviceMainCrossings: crossings.filter(item => item.serviceMain).length,
      connectionAudit: {
        endpointToEndpoint: {
          count: endpointMergeDistances.length,
          byType: endpointMergeTypes,
          distanceMetres: distanceSummary(endpointMergeDistances),
          toleranceMetres: endpointTolerance
        },
        acceptedEndpointToLine: {
          count: sortedAttachments.length,
          byType: { "service-main": sortedAttachments.length },
          distanceMetres: distanceSummary(sortedAttachments.map(attachment => attachment.distance)),
          toleranceMetres: attachmentTolerance
        },
        legacyEndpointToLineScreen: {
          count: legacyScreen.length,
          byType: legacyTypes,
          distanceMetres: distanceSummary(legacyScreen.map(record => record.snapDistance)),
          maximumSegmentLengthMetres: Number(options.legacyMaximumSegmentLength ?? 1000)
        },
        reconciliation: {
          sharedSourceEndpoints: [...acceptedSourceNodes].filter(node => legacySourceNodes.has(node)).length,
          acceptedOnlySourceEndpoints: [...acceptedSourceNodes].filter(node => !legacySourceNodes.has(node)).length,
          legacyOnlySourceEndpoints: [...legacySourceNodes].filter(node => !acceptedSourceNodes.has(node)).length
        },
        explicitValveMeterConnections: 0,
        geometricCrossingConnections: 0,
        reviewRequiredConnections: crossings.length
      }
    }
  };
}

if (typeof window !== "undefined") window.AquaTopologyCore = { buildHydraulicTopology };