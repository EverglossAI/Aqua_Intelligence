export const ENVIRONMENTAL_THRESHOLDS = Object.freeze({
  heavyRain24hMm: 25,
  dryDayMaximumMm: 1,
  antecedentDryDays: 3,
  soilMoistureIncrease: 0.03,
  temperatureDropC: 5,
  minimumAssociationEvents: 3,
  investigationPriorityWeight: 0
});

export const CONFIRMED_BURST_EVENT_FIELDS = Object.freeze([
  "eventId", "pipeId", "eventType", "eventDateTime", "confirmedBurst", "repairDateTime",
  "material", "diameter", "repairType", "latitude", "longitude", "source"
]);

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const time = value => {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
};
const values = (samples, field) => samples.map(sample => finite(sample[field])).filter(value => value != null);
const sum = list => list.reduce((total, value) => total + value, 0);
const average = list => list.length ? sum(list) / list.length : null;

function pipeMetadata(project, pipeId) {
  if (!pipeId) return {};
  const feature = (project.layers || []).filter(layer => layer.kind === "pipe").flatMap(layer => layer.geojson?.features || []).find(item => {
    const properties = item.properties || {};
    return Object.entries(properties).some(([key, value]) => ["unific_id", "pipe_id", "id", "gid", "objectid", "fid"].includes(key.toLowerCase()) && String(value) === String(pipeId));
  });
  const properties = feature?.properties || {};
  const property = names => {
    const key = Object.keys(properties).find(name => names.includes(name.toLowerCase()));
    return key ? properties[key] : null;
  };
  return { material: property(["pipe_mtr", "material", "mat", "pipe_type"]), diameter: property(["pipe_size", "diameter", "dia", "size"]) };
}

export function normalizedSamples(result) {
  return (result?.hourly || []).map(sample => ({ ...sample, time: time(sample.timestamp) }))
    .filter(sample => sample.time != null)
    .sort((left, right) => left.time - right.time);
}

function inWindow(samples, end, hours, offsetHours = 0) {
  const upper = end - offsetHours * 3600000;
  const lower = upper - hours * 3600000;
  return samples.filter(sample => sample.time > lower && sample.time <= upper);
}

function nearestBefore(samples, target) {
  return samples.reduce((best, sample) => sample.time <= target && (!best || sample.time > best.time) ? sample : best, null);
}

function samplePeriod(samples) {
  return samples.length ? { start: new Date(samples[0].time).toISOString(), end: new Date(samples.at(-1).time).toISOString() } : null;
}

export function formatUtcPeriod(period) {
  const stamp = value => String(value || "").slice(0, 16).replace("T", " ");
  return period ? `${stamp(period.start)} to ${stamp(period.end)} UTC` : "Period unavailable";
}

function dailyRain(samples) {
  const days = new Map();
  samples.forEach(sample => {
    const day = new Date(sample.time).toISOString().slice(0, 10);
    days.set(day, (days.get(day) || 0) + (finite(sample.precipitation) || 0));
  });
  return [...days.entries()].map(([date, precipitation]) => ({ date, precipitation }));
}

export function summarizeEnvironment(result, endTime) {
  const samples = normalizedSamples(result);
  if (!samples.length) return null;
  const end = time(endTime) ?? samples.at(-1).time;
  const recent = nearestBefore(samples, end);
  const previous24 = nearestBefore(samples, end - 24 * 3600000);
  const rainfall24h = inWindow(samples, end, 24);
  const rainfall72h = inWindow(samples, end, 72);
  const rainfall7d = inWindow(samples, end, 168);
  const rainfall14d = inWindow(samples, end, 336);
  const rainfall30d = inWindow(samples, end, 720);
  const temperature24h = inWindow(samples, end, 24);
  const priorSoilSamples = inWindow(samples, end, 24, 24);
  const selectedSamples = samples.filter(sample => sample.time <= end);
  const priorSoil = average(values(priorSoilSamples, "soilMoisture"));
  return {
    rainfall: {
      last24h: sum(values(rainfall24h, "precipitation")),
      last72h: sum(values(rainfall72h, "precipitation")),
      last7d: sum(values(rainfall7d, "precipitation")),
      previous14d: sum(values(rainfall14d, "precipitation")),
      previous30d: sum(values(rainfall30d, "precipitation")),
      last30d: sum(values(rainfall30d, "precipitation"))
    },
    temperature: {
      recent: finite(recent?.temperature),
      dailyMaximum: Math.max(...values(temperature24h, "temperature")),
      recentMaximum: Math.max(...values(selectedSamples, "temperature")),
      change24h: finite(recent?.temperature) != null && finite(previous24?.temperature) != null ? finite(recent.temperature) - finite(previous24.temperature) : null
    },
    soilMoisture: {
      recent: finite(recent?.soilMoisture),
      previousPeriod: priorSoil,
      change: finite(recent?.soilMoisture) != null && priorSoil != null ? finite(recent.soilMoisture) - priorSoil : null
    },
    evapotranspiration: { selectedPeriod: sum(values(selectedSamples, "evapotranspiration")) },
    periods: {
      rainfall24h: samplePeriod(rainfall24h),
      rainfall72h: samplePeriod(rainfall72h),
      rainfall7d: samplePeriod(rainfall7d),
      rainfall30d: samplePeriod(rainfall30d),
      temperatureRecent: recent ? { at: new Date(recent.time).toISOString() } : null,
      temperatureMaximum24h: samplePeriod(temperature24h),
      temperatureChange24h: recent && previous24 ? { from: new Date(previous24.time).toISOString(), to: new Date(recent.time).toISOString() } : null,
      soilMoistureRecent: recent ? { at: new Date(recent.time).toISOString() } : null,
      soilMoistureBaseline24h: samplePeriod(priorSoilSamples),
      selected: samplePeriod(selectedSamples)
    },
    end: new Date(end).toISOString()
  };
}

export function analyseWetTransition(result, endTime, thresholds = ENVIRONMENTAL_THRESHOLDS) {
  const samples = normalizedSamples(result);
  if (!samples.length) return null;
  const end = time(endTime) ?? samples.at(-1).time;
  const summary = summarizeEnvironment(result, end);
  const antecedent = dailyRain(inWindow(samples, end, 24 * 7, 24));
  const dryDays = antecedent.filter(day => day.precipitation <= thresholds.dryDayMaximumMm).length;
  const heavyRain = summary.rainfall.last24h >= thresholds.heavyRain24hMm;
  const soilIncrease = summary.soilMoisture.change != null && summary.soilMoisture.change >= thresholds.soilMoistureIncrease;
  const temperatureDrop = summary.temperature.change24h != null && summary.temperature.change24h <= -thresholds.temperatureDropC;
  const antecedentDry = dryDays >= thresholds.antecedentDryDays;
  const score = [heavyRain, soilIncrease, temperatureDrop, antecedentDry].filter(Boolean).length;
  return {
    indicator: score >= 3 ? "High" : score >= 2 ? "Moderate" : "Low",
    score,
    antecedentDry,
    dryDays,
    heavyRain,
    soilIncrease,
    temperatureDrop,
    values: { rainfall24h: summary.rainfall.last24h, soilMoistureChange: summary.soilMoisture.change, temperatureChange24h: summary.temperature.change24h },
    thresholds: { ...thresholds },
    explanation: `Checks ${thresholds.antecedentDryDays}+ dry days, ${thresholds.heavyRain24hMm} mm/24 h rain, ${thresholds.soilMoistureIncrease} m³/m³ soil wetting, and a ${thresholds.temperatureDropC} °C temperature drop. This is context, not a leak probability.`
  };
}

export function environmentalEvents(project = {}, scope = {}) {
  const allowed = scope.alerts ? new Set(scope.alerts.map(alert => String(alert.alertId))) : null;
  return (project.acousticAlert || []).filter(alert => {
    if (allowed && !allowed.has(String(alert.alertId))) return false;
    return !scope.pipeId || String(alert.matchedPipeId) === String(scope.pipeId);
  }).map(alert => {
    const eventTime = time(alert.detectionDate || alert.timestamp);
    const metadata = pipeMetadata(project, alert.matchedPipeId);
    return eventTime == null ? null : {
      eventId: String(alert.alertId),
      timestamp: new Date(eventTime).toISOString(),
      time: eventTime,
      type: alert.alertType || "Acoustic alert",
      label: `${alert.alertId} · ${alert.alertType || "Acoustic alert"}`,
      status: alert.status || alert.stateGroup || "Unknown",
      probability: finite(alert.probability),
      pipeId: alert.matchedPipeId || null,
      coupleId: alert.coupleId || null,
      sensorId: alert.sensorId || alert.sensor1Id || null,
      source: alert.source || null,
      material: metadata.material,
      diameter: metadata.diameter,
      confirmedBurst: false
    };
  }).filter(Boolean).sort((left, right) => left.time - right.time);
}

function lagWindow(samples, eventTime, hours) {
  const selected = hours === 0
    ? samples.filter(sample => sample.time >= new Date(eventTime).setUTCHours(0, 0, 0, 0) && sample.time <= eventTime)
    : inWindow(samples, eventTime, hours);
  const precipitation = values(selected, "precipitation");
  const atEvent = nearestBefore(samples, eventTime);
  const before = nearestBefore(samples, eventTime - (hours || 24) * 3600000);
  return {
    hours,
    rainfall: sum(precipitation),
    rainfallIntensity: precipitation.length ? Math.max(...precipitation) : null,
    soilMoistureChange: finite(atEvent?.soilMoisture) != null && finite(before?.soilMoisture) != null ? finite(atEvent.soilMoisture) - finite(before.soilMoisture) : null,
    temperatureChange: finite(atEvent?.temperature) != null && finite(before?.temperature) != null ? finite(atEvent.temperature) - finite(before.temperature) : null
  };
}

export function analyseEventLags(result, events, thresholds = ENVIRONMENTAL_THRESHOLDS) {
  const samples = normalizedSamples(result);
  return (events || []).map(event => {
    const windows = [0, 24, 48, 72, 168].map(hours => lagWindow(samples, event.time ?? time(event.timestamp), hours));
    const transition = analyseWetTransition(result, event.time ?? event.timestamp, thresholds);
    return { event, windows, antecedentDry: transition?.antecedentDry ?? false, wetTransition: transition?.indicator || "Low" };
  });
}

export function buildEnvironmentalComparisonSources(result, events = []) {
  const samples = normalizedSamples(result);
  const definitions = [
    ["rainfall", "Rainfall", "mm", "precipitation"],
    ["temperature", "Temperature", "°C", "temperature"],
    ["soil-moisture", "Soil moisture", "m³/m³", "soilMoisture"],
    ["evapotranspiration", "Evapotranspiration", "mm", "evapotranspiration"]
  ];
  return definitions.map(([name, label, unit, field]) => ({
    id: `environment:${name}`,
    entityId: name,
    type: `environment-${name}`,
    label,
    context: "Environmental",
    unit,
    eventOnly: false,
    provenance: { provider: result.provider, classification: result.classification, dataset: result.dataset },
    points: samples.map(sample => ({ timestamp: sample.timestamp, time: sample.time, value: finite(sample[field]) })).filter(point => point.value != null),
    events
  }));
}

export function season(month) {
  if ([12, 1, 2].includes(month)) return "Winter";
  if ([3, 4, 5].includes(month)) return "Spring";
  if ([6, 7, 8].includes(month)) return "Summer";
  return "Autumn";
}

export function groupEventRecords(records, field) {
  const counts = new Map();
  (records || []).forEach(record => {
    let value = record[field];
    if (field === "month" || field === "season") {
      const date = new Date(record.eventDateTime || record.timestamp);
      if (Number.isNaN(date.getTime())) return;
      value = field === "month" ? date.getUTCMonth() + 1 : season(date.getUTCMonth() + 1);
    }
    if (value == null || value === "") value = "Unknown";
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  });
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

export function summarizeAssociations(events, lagRows, thresholds = ENVIRONMENTAL_THRESHOLDS) {
  if ((events || []).length < thresholds.minimumAssociationEvents) return { status: "Insufficient data", eventCount: (events || []).length };
  const byId = new Map((lagRows || []).map(row => [String(row.event.eventId), row]));
  const enriched = events.map(event => ({ ...event, lag: byId.get(String(event.eventId)) }));
  return {
    status: "Descriptive only",
    eventCount: enriched.length,
    afterHeavyRain: enriched.filter(item => (item.lag?.windows.find(window => window.hours === 24)?.rainfall || 0) >= thresholds.heavyRain24hMm).length,
    afterWetTransition: enriched.filter(item => item.lag?.wetTransition === "High").length,
    byMonth: groupEventRecords(enriched, "month"),
    bySeason: groupEventRecords(enriched, "season"),
    byMaterial: groupEventRecords(enriched, "material"),
    byDiameter: groupEventRecords(enriched, "diameter"),
    byDma: groupEventRecords(enriched, "dma")
  };
}

export function environmentalRiskContribution() {
  return 0;
}

if (typeof window !== "undefined") window.AquaEnvironmentalCore = {
  ENVIRONMENTAL_THRESHOLDS, CONFIRMED_BURST_EVENT_FIELDS, normalizedSamples, summarizeEnvironment,
  analyseWetTransition, environmentalEvents, analyseEventLags, buildEnvironmentalComparisonSources,
  season, groupEventRecords, summarizeAssociations, environmentalRiskContribution, formatUtcPeriod
};