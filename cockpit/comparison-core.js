function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceId(type, id) {
  return `${type}:${id}`;
}

function telemetryPoints(asset) {
  const field = asset.type === "pressure" ? "pressure" : "flow";
  return (asset.readings || []).map(reading => {
    const date = timestamp(reading.timestamp);
    const value = finite(reading[field] ?? reading.value ?? reading[`${field}_${asset.type === "pressure" ? "m" : "lps"}`]);
    return date && value != null ? { timestamp: date.toISOString(), time: date.getTime(), value } : null;
  }).filter(Boolean).sort((left, right) => left.time - right.time);
}

function sensorEvents(project, sensor) {
  const couples = (project.acousticCouple || []).filter(couple => couple.sensor1Id === sensor.sensorId || couple.sensor2Id === sensor.sensorId);
  const coupleIds = new Set(couples.map(couple => String(couple.coupleId)));
  const alerts = (project.acousticAlert || []).filter(alert => coupleIds.has(String(alert.coupleId)) || (alert.relationships || []).some(link => coupleIds.has(String(link.coupleId))));
  const events = alerts.map(alert => {
    const date = timestamp(alert.detectionDate);
    return date ? {
      timestamp: date.toISOString(),
      time: date.getTime(),
      kind: "alert",
      label: `${alert.alertType || "Alert"} ${alert.alertId}`,
      status: alert.status,
      probability: finite(alert.probability),
      entity: alert
    } : null;
  }).filter(Boolean);
  const snapshotDate = timestamp(sensor.lastActive || sensor.lastCommunication);
  if (snapshotDate) events.push({
    timestamp: snapshotDate.toISOString(),
    time: snapshotDate.getTime(),
    kind: "snapshot",
    label: `Sensor ${sensor.sensorId} snapshot`,
    intensity: finite(sensor.intensity?.filtered ?? sensor.intensity?.sampled),
    entity: sensor
  });
  return events.sort((left, right) => left.time - right.time);
}

export function buildComparisonSources(project = {}) {
  const telemetry = (project.telemetry || []).filter(asset => asset.type === "pressure" || asset.type === "flow").map(asset => ({
    id: sourceId(asset.type, asset.id || asset._id),
    entityId: String(asset.id || asset._id),
    type: asset.type,
    label: String(asset.id || asset._id),
    context: [asset.dmaLabel || asset.dmaCode, asset.role].filter(Boolean).join(" · "),
    unit: asset.type === "pressure" ? "m" : "L/s",
    eventOnly: false,
    provenance: asset.source || asset.sourceDetail || "unknown",
    points: telemetryPoints(asset),
    events: [],
    entity: asset
  }));
  const acoustic = (project.acousticSensor || []).map(sensor => ({
    id: sourceId("acoustic", sensor.sensorId),
    entityId: String(sensor.sensorId),
    type: "acoustic",
    label: `Sensor ${sensor.sensorId}`,
    context: [sensor.status, sensor.matchedPipeId ? `pipe ${sensor.matchedPipeId}` : null].filter(Boolean).join(" · "),
    unit: "event",
    eventOnly: true,
    provenance: sensor.source || "imported operational report",
    points: [],
    events: sensorEvents(project, sensor),
    entity: sensor
  }));
  return [...telemetry, ...acoustic];
}

function minutesOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function parseClock(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  return match ? Math.min(1439, Number(match[1]) * 60 + Number(match[2])) : fallback;
}

function inTimeWindow(date, start, end) {
  const value = minutesOfDay(date);
  return start <= end ? value >= start && value <= end : value >= start || value <= end;
}

function filteredItems(items, options) {
  const start = timestamp(options.start)?.getTime() ?? -Infinity;
  const endDate = timestamp(options.end);
  const end = endDate ? endDate.getTime() : Infinity;
  const dayStart = parseClock(options.timeStart, 0);
  const dayEnd = parseClock(options.timeEnd, 1439);
  return items.filter(item => item.time >= start && item.time <= end && inTimeWindow(new Date(item.time), dayStart, dayEnd));
}

function bucketTime(time, aggregation) {
  const date = new Date(time);
  if (aggregation === "day") date.setHours(0, 0, 0, 0);
  else if (aggregation === "hour") date.setMinutes(0, 0, 0);
  return date.getTime();
}

function aggregatePoints(points, aggregation) {
  if (!aggregation || aggregation === "raw") return points;
  const buckets = new Map();
  points.forEach(point => {
    const key = bucketTime(point.time, aggregation);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(point.value);
  });
  return [...buckets.entries()].map(([time, values]) => ({
    time,
    timestamp: new Date(time).toISOString(),
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
    sampleCount: values.length
  })).sort((left, right) => left.time - right.time);
}

function statistics(points) {
  const values = points.map(point => point.value).filter(value => value != null);
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  };
}

function overlap(left, right) {
  if (!left.length || !right.length) return { start: null, end: null, durationMs: 0 };
  const start = Math.max(left[0].time, right[0].time);
  const end = Math.min(left[left.length - 1].time, right[right.length - 1].time);
  return end < start ? { start: null, end: null, durationMs: 0 } : { start: new Date(start).toISOString(), end: new Date(end).toISOString(), durationMs: end - start };
}

function correlation(left, right, eventOnly) {
  if (eventOnly) return { value: null, sampleCount: 0, reason: "Correlation is unavailable for event-only acoustic evidence." };
  const rightByTime = new Map(right.map(point => [point.time, point.value]));
  const pairs = left.filter(point => rightByTime.has(point.time)).map(point => [point.value, rightByTime.get(point.time)]);
  if (pairs.length < 3) return { value: null, sampleCount: pairs.length, reason: "At least three aligned numeric samples are required." };
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + (pair[0] - leftMean) * (pair[1] - rightMean), 0);
  const leftSpread = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[0] - leftMean) ** 2, 0));
  const rightSpread = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[1] - rightMean) ** 2, 0));
  if (!leftSpread || !rightSpread) return { value: null, sampleCount: pairs.length, reason: "Correlation is undefined for a constant series." };
  const value = numerator / (leftSpread * rightSpread);
  return { value: Math.abs(Math.abs(value) - 1) < 1e-12 ? Math.sign(value) : value, sampleCount: pairs.length, reason: null };
}

export function compareSources(sourceA, sourceB, options = {}) {
  if (!sourceA || !sourceB) throw new Error("Two comparison sources are required.");
  if (sourceA.id === sourceB.id) throw new Error("Choose two different comparison sources.");
  const aggregation = options.aggregation || "raw";
  const prepare = source => {
    const points = aggregatePoints(filteredItems(source.points || [], options), aggregation);
    const events = filteredItems(source.events || [], options);
    return { ...source, points, events, statistics: statistics(points) };
  };
  const left = prepare(sourceA);
  const right = prepare(sourceB);
  return {
    sourceA: left,
    sourceB: right,
    aggregation,
    overlap: overlap(left.eventOnly ? left.events : left.points, right.eventOnly ? right.events : right.points),
    correlation: correlation(left.points, right.points, left.eventOnly || right.eventOnly),
    provenance: [left, right].map(source => ({ id: source.id, provenance: source.provenance, eventOnly: source.eventOnly }))
  };
}

if (typeof window !== "undefined") window.AquaComparisonCore = { buildComparisonSources, compareSources };