const EARTH_RADIUS = 6371000;
const INTERNAL_FIELD = /^__aqua/i;

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function property(properties, names) {
  const entries = Object.entries(properties || {});
  for (const name of names) {
    const match = entries.find(([key, value]) => key.toLowerCase() === name.toLowerCase() && value !== "" && value != null);
    if (match) return match[1];
  }
  return null;
}

function radians(value) {
  return value * Math.PI / 180;
}

export function distanceMetres(left, right) {
  const latitude = radians(right[0] - left[0]);
  const longitude = radians(right[1] - left[1]);
  const value = Math.sin(latitude / 2) ** 2 + Math.cos(radians(left[0])) * Math.cos(radians(right[0])) * Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(value));
}

function geometryLines(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "LineString") return [geometry.coordinates];
  if (geometry?.type === "MultiLineString") return geometry.coordinates;
  return [];
}

export function featureCoordinate(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "Point") {
    const coordinate = [finite(geometry.coordinates?.[1]), finite(geometry.coordinates?.[0])];
    return coordinate.every(value => value != null) ? coordinate : null;
  }
  const lines = geometryLines(feature);
  if (lines.length) {
    const coordinates = lines.flat();
    const middle = coordinates[Math.floor(coordinates.length / 2)];
    return middle ? [finite(middle[1]), finite(middle[0])] : null;
  }
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  const ring = polygons[0]?.[0] || [];
  if (!ring.length) return null;
  const bounds = ring.reduce((result, coordinate) => ({
    minLat: Math.min(result.minLat, coordinate[1]), maxLat: Math.max(result.maxLat, coordinate[1]),
    minLng: Math.min(result.minLng, coordinate[0]), maxLng: Math.max(result.maxLng, coordinate[0])
  }), { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity });
  return [(bounds.minLat + bounds.maxLat) / 2, (bounds.minLng + bounds.maxLng) / 2];
}

export function entityCoordinate(kind, entity) {
  if (kind === "network" || kind === "dma") return featureCoordinate(entity);
  const latitude = finite(entity?.lat ?? entity?.latitude);
  const longitude = finite(entity?.lng ?? entity?.lon ?? entity?.longitude);
  return latitude == null || longitude == null ? null : [latitude, longitude];
}

export function streetViewUrl(coordinate) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coordinate[0]},${coordinate[1]}`;
}

export function navigationUrl(coordinate) {
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinate[0]},${coordinate[1]}`;
}

function label(key) {
  return String(key).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, character => character.toUpperCase());
}

export function presentAssetFields(entity, options = {}) {
  const properties = options.kind === "network" ? entity?.properties || {} : { ...(entity?.properties || {}), ...(entity || {}) };
  const excluded = new Set(["readings", "source", "geometry", "properties", "relationships", "projectedCoordinates"]);
  return Object.entries(properties).filter(([key, value]) => {
    if (INTERNAL_FIELD.test(key) || excluded.has(key) || value === "" || value == null) return false;
    return ["string", "number", "boolean"].includes(typeof value);
  }).slice(0, options.limit || 16).map(([key, value]) => ({ key, label: label(key), value }));
}

export function assetIdentity(kind, entity, layer = {}) {
  const properties = kind === "network" ? entity?.properties || {} : entity || {};
  const id = kind === "acoustic-sensor"
    ? entity?.sensorId
    : property(properties, ["id", "pipe_id", "unific_id", "valve_id", "meter_id", "hydrant_id", "objectid", "fid", "name"]);
  const assetType = kind === "telemetry" ? entity?.type === "pressure" ? "Pressure logger" : "Flow meter" : kind === "acoustic-sensor" ? "Acoustic sensor" : label(layer.kind || "Asset");
  return { id: String(id || assetType), type: assetType, layer: layer.name || null };
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[0]) !== (previousY > point[0]) && point[1] < (previousX - x) * (point[0] - y) / (previousY - y + 1e-12) + x) inside = !inside;
  }
  return inside;
}

export function pointInFeature(coordinate, feature) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some(polygon => polygon[0] && pointInRing(coordinate, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(coordinate, ring)));
}

function pipeId(feature, index = 0) {
  return String(property(feature?.properties, ["unific_id", "pipe_id", "id", "gid", "objectid", "fid"]) || `pipe-${index + 1}`);
}

function pipeLength(feature) {
  const stored = finite(property(feature?.properties, ["length", "pipe_length", "pipe_len", "shape_leng"]));
  if (stored != null && stored >= 0) return stored;
  return geometryLines(feature).reduce((total, line) => total + line.slice(1).reduce((sum, coordinate, index) => sum + distanceMetres([line[index][1], line[index][0]], [coordinate[1], coordinate[0]]), 0), 0);
}

export function pipeFilterAttributes(feature) {
  const material = property(feature?.properties, ["pipe_mtr", "material", "mat", "pipe_type"]);
  const diameter = finite(property(feature?.properties, ["pipe_size", "diameter", "dia", "size"]));
  return { material: material == null ? null : String(material).trim().toUpperCase(), diameter: diameter == null ? null : String(diameter) };
}

export function filterDmaPipes(features, filters = {}) {
  const materials = new Set([...(filters.materials || [])].map(value => String(value).trim().toUpperCase()));
  const diameters = new Set([...(filters.diameters || [])].map(value => String(Number(value))));
  return (features || []).filter(feature => {
    const attributes = pipeFilterAttributes(feature);
    return (!materials.size || materials.has(attributes.material)) && (!diameters.size || diameters.has(attributes.diameter));
  });
}

export function filteredPipeSummary(features, filters = {}) {
  const pipes = filterDmaPipes(features, filters);
  return { pipes, count: pipes.length, totalLength: pipes.reduce((sum, feature) => sum + pipeLength(feature), 0) };
}

function breakdown(features, fields) {
  const counts = new Map();
  features.forEach(feature => {
    const value = property(feature.properties, fields);
    if (value == null) return;
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function realElevationPoints(candidate) {
  if (!candidate) return [];
  if (Array.isArray(candidate.points)) return candidate.points.map(point => ({ lat: finite(point.lat ?? point.latitude), lng: finite(point.lng ?? point.lon ?? point.longitude), elevation: finite(point.elevation ?? point.height ?? point.z) })).filter(point => point.lat != null && point.lng != null && point.elevation != null);
  const features = candidate.geojson?.features || candidate.features || [];
  return features.map(feature => {
    const coordinate = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    return coordinate ? { lat: finite(coordinate[1]), lng: finite(coordinate[0]), elevation: finite(coordinate[2] ?? feature.properties?.elevation ?? feature.properties?.height) } : null;
  }).filter(point => point?.lat != null && point.lng != null && point.elevation != null);
}

export function describeElevationSource(project = {}) {
  project ||= {};
  const candidate = project.elevationData || project.demElevation || project.dem;
  const hydraulic = project.latestHydraulicModel?.assumptions || project.latestHydraulicModel?.elevations;
  const source = candidate?.provenance?.source || candidate?.source || hydraulic?.elevationSource || hydraulic?.source || null;
  if (!candidate && !source) return null;
  const provenance = candidate?.provenance || {};
  const descriptor = `${candidate?.kind || ""} ${candidate?.type || ""} ${source || ""} ${provenance.kind || ""}`.toLowerCase();
  const classification = /synthetic|demo|flat/.test(descriptor) ? "demo/model-derived" : /model|assum/.test(descriptor) ? "model-derived" : candidate?.real === true || provenance.real === true || /\b(dem|lidar|surveyed|measured|real)\b/.test(descriptor) ? "real" : "unverified";
  return {
    source: source || "Unidentified elevation candidate",
    resolution: provenance.resolution || candidate?.resolution || null,
    date: provenance.date || candidate?.date || null,
    version: provenance.version || candidate?.version || null,
    classification,
    usable: classification === "real" && realElevationPoints(candidate).length > 0
  };
}

export function resolveElevationSource(project = {}) {
  project ||= {};
  const candidate = project.elevationData || project.demElevation || project.dem || null;
  if (!candidate) return null;
  const provenance = candidate.provenance || {};
  const descriptor = `${candidate.kind || ""} ${candidate.type || ""} ${candidate.source || ""} ${provenance.kind || ""} ${provenance.source || ""}`.toLowerCase();
  if (/synthetic|demo|model|assum|flat/.test(descriptor)) return null;
  const verified = candidate.real === true || provenance.real === true || /\b(dem|lidar|surveyed|measured|real)\b/.test(descriptor);
  const points = realElevationPoints(candidate);
  if (!verified || !points.length) return null;
  return {
    points,
    provenance: {
      source: provenance.source || candidate.source || "Elevation dataset",
      resolution: provenance.resolution || candidate.resolution || null,
      date: provenance.date || candidate.date || null,
      version: provenance.version || candidate.version || null,
      kind: provenance.kind || candidate.kind || candidate.type || "real"
    }
  };
}

function elevationStatistics(samples) {
  if (!samples.length) return null;
  const elevations = samples.map(sample => sample.elevation);
  let gain = 0;
  let loss = 0;
  samples.slice(1).forEach((sample, index) => {
    const change = sample.elevation - samples[index].elevation;
    if (change > 0) gain += change;
    else loss += Math.abs(change);
  });
  return {
    minimum: Math.min(...elevations), maximum: Math.max(...elevations),
    start: elevations[0], end: elevations[elevations.length - 1], gain, loss,
    totalDistance: samples[samples.length - 1].distance
  };
}

export function sampleProfileLine(line, options = {}) {
  if (!Array.isArray(line) || line.length < 2) return [];
  const segments = line.slice(1).map((end, index) => ({ start: line[index], end, length: distanceMetres(line[index], end) }));
  const totalDistance = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!totalDistance) return [];
  const requested = Math.round(finite(options.sampleCount) ?? Math.max(50, Math.min(200, Math.ceil(totalDistance / 75) + 1)));
  const sampleCount = Math.max(2, Math.min(200, requested));
  return Array.from({ length: sampleCount }, (_item, index) => {
    const distance = totalDistance * index / (sampleCount - 1);
    let traversed = 0;
    const segment = segments.find(item => {
      const contains = distance <= traversed + item.length;
      if (!contains) traversed += item.length;
      return contains;
    }) || segments[segments.length - 1];
    const fraction = segment.length ? Math.max(0, Math.min(1, (distance - traversed) / segment.length)) : 0;
    return {
      lat: segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
      lng: segment.start[1] + (segment.end[1] - segment.start[1]) * fraction,
      distance
    };
  });
}

export function buildSampledElevationProfile(points, provenance) {
  const samples = (points || []).map(point => ({
    coordinate: [finite(point.lat), finite(point.lng)],
    distance: finite(point.distance),
    elevation: finite(point.elevation)
  })).filter(sample => sample.coordinate.every(value => value != null) && sample.distance != null && sample.elevation != null).sort((left, right) => left.distance - right.distance);
  return { available: samples.length >= 2, samples, statistics: samples.length >= 2 ? elevationStatistics(samples) : null, provenance: provenance || null };
}

function nearestOnLine(point, line) {
  const latitudeScale = 111320;
  const referenceLatitude = radians(point[0]);
  const project = coordinate => [coordinate[1] * latitudeScale * Math.cos(referenceLatitude), coordinate[0] * latitudeScale];
  const target = project(point);
  let traversed = 0;
  let best = null;
  for (let index = 1; index < line.length; index++) {
    const startCoordinate = line[index - 1];
    const endCoordinate = line[index];
    const start = project(startCoordinate);
    const end = project(endCoordinate);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const fraction = Math.max(0, Math.min(1, ((target[0] - start[0]) * dx + (target[1] - start[1]) * dy) / (length * length)));
    const projected = [start[0] + fraction * dx, start[1] + fraction * dy];
    const candidate = {
      distanceFromLine: Math.hypot(target[0] - projected[0], target[1] - projected[1]),
      distance: traversed + length * fraction,
      coordinate: [startCoordinate[0] + (endCoordinate[0] - startCoordinate[0]) * fraction, startCoordinate[1] + (endCoordinate[1] - startCoordinate[1]) * fraction]
    };
    if (!best || candidate.distanceFromLine < best.distanceFromLine) best = candidate;
    traversed += length;
  }
  return best;
}

export function projectCoordinateToProfile(coordinate, line) {
  if (!Array.isArray(coordinate) || coordinate.length < 2 || !Array.isArray(line) || line.length < 2) return null;
  return nearestOnLine(coordinate, line);
}

export function interpolateProfileElevation(samples, distance) {
  const ordered = (samples || []).filter(sample => finite(sample.distance) != null && finite(sample.elevation) != null).sort((left, right) => left.distance - right.distance);
  const target = finite(distance);
  if (!ordered.length || target == null) return null;
  if (target <= ordered[0].distance) return ordered[0].elevation;
  if (target >= ordered[ordered.length - 1].distance) return ordered[ordered.length - 1].elevation;
  const upperIndex = ordered.findIndex(sample => sample.distance >= target);
  const lower = ordered[upperIndex - 1];
  const upper = ordered[upperIndex];
  const fraction = upper.distance === lower.distance ? 0 : (target - lower.distance) / (upper.distance - lower.distance);
  return lower.elevation + (upper.elevation - lower.elevation) * fraction;
}

export function buildElevationProfile(line, source, options = {}) {
  if (!source || !Array.isArray(line) || line.length < 2) return { available: false, samples: [], statistics: null, provenance: source?.provenance || null };
  const resolution = finite(source.provenance?.resolution);
  const maximumDistance = finite(options.maximumDistance) ?? (resolution != null ? Math.max(10, resolution * 1.5) : 30);
  const samples = source.points.map(point => {
    const nearest = nearestOnLine([point.lat, point.lng], line);
    return nearest && nearest.distanceFromLine <= maximumDistance ? { ...nearest, elevation: point.elevation, sourceCoordinate: [point.lat, point.lng] } : null;
  }).filter(Boolean).sort((left, right) => left.distance - right.distance);
  return { available: samples.length >= 2, samples, statistics: samples.length >= 2 ? elevationStatistics(samples) : null, provenance: source.provenance };
}

export function summarizeDma(project = {}, feature, riskResults = []) {
  const properties = feature?.properties || {};
  const logicalId = property(properties, ["__aquaLogicalDmaId", "logical_dma_uid", "dma_uid"]);
  const code = property(properties, ["dma_code", "smallare_1", "code", "dma", "name"]);
  const logical = (project.logicalDmas || project.lambayDemo?.logicalDmas || []).find(item => String(item.logical_dma_uid || "") === String(logicalId || "") || String(item.dma_code || "") === String(code || "")) || null;
  const dmaCode = logical?.dma_code || code || logicalId || "Unavailable";
  const pipeFeatures = (project.layers || []).filter(layer => layer.kind === "pipe").flatMap(layer => layer.geojson?.features || []).filter(pipe => {
    const coordinate = featureCoordinate(pipe);
    return coordinate && pointInFeature(coordinate, feature);
  });
  const pipeIds = new Set(pipeFeatures.map(pipeId));
  const inDma = entity => {
    const entityCode = entity.dmaCode ?? entity.dma_code ?? entity.dma;
    if (entityCode != null && String(entityCode) === String(dmaCode)) return true;
    const coordinate = entityCoordinate("telemetry", entity);
    return coordinate ? pointInFeature(coordinate, feature) : false;
  };
  const telemetry = (project.telemetry || []).filter(inDma);
  const sensors = (project.acousticSensor || []).filter(inDma);
  const alerts = (project.acousticAlert || []).filter(alert => pipeIds.has(String(alert.matchedPipeId || "")) || inDma(alert));
  const relevantRisk = riskResults.filter(result => pipeIds.has(String(result.pipeId)));
  const elevationSource = resolveElevationSource(project);
  const elevations = elevationSource?.points.filter(point => pointInFeature([point.lat, point.lng], feature)).map(point => point.elevation) || [];
  const inletIds = new Set([logical?.flow_summary?.meter_id, ...telemetry.filter(item => item.type === "flow").map(item => item.id || item._id)].filter(Boolean).map(String));
  return {
    id: String(logicalId || dmaCode),
    code: String(dmaCode),
    name: logical?.label || logical?.dma_name || property(properties, ["name", "dma_name", "smallare_1"]) || String(dmaCode),
    feature,
    logical,
    pipes: pipeFeatures,
    pipeCount: pipeFeatures.length,
    totalPipeLength: pipeFeatures.reduce((sum, pipe) => sum + pipeLength(pipe), 0),
    materials: breakdown(pipeFeatures, ["pipe_mtr", "material", "mat", "pipe_type"]),
    diameters: breakdown(pipeFeatures, ["pipe_size", "diameter", "dia", "size"]),
    inletMeters: telemetry.filter(item => item.type === "flow" && inletIds.has(String(item.id || item._id))),
    pressureLoggers: telemetry.filter(item => item.type === "pressure"),
    flowMeters: telemetry.filter(item => item.type === "flow"),
    acousticSensors: sensors,
    activeAlerts: alerts.filter(alert => alert.stateGroup === "active"),
    historicalAlerts: alerts.filter(alert => alert.stateGroup === "historical"),
    priority: {
      critical: relevantRisk.filter(result => result.classification === "Critical").length,
      high: relevantRisk.filter(result => result.classification === "High").length,
      elevated: relevantRisk.filter(result => result.classification === "Elevated").length,
      maximum: relevantRisk.length ? Math.max(...relevantRisk.map(result => result.investigationPriority)) : null
    },
    elevation: elevations.length ? { minimum: Math.min(...elevations), maximum: Math.max(...elevations), range: Math.max(...elevations) - Math.min(...elevations), provenance: elevationSource.provenance } : null
  };
}

if (typeof window !== "undefined") window.AquaContextualCore = { assetIdentity, buildElevationProfile, buildSampledElevationProfile, describeElevationSource, distanceMetres, entityCoordinate, featureCoordinate, filterDmaPipes, filteredPipeSummary, navigationUrl, pipeFilterAttributes, pointInFeature, presentAssetFields, resolveElevationSource, sampleProfileLine, streetViewUrl, summarizeDma };