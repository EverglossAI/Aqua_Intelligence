const PIPE_ID_FIELDS = ["unific_id", "pipe_id", "id", "gid", "objectid", "fid"];

function finite(value) {
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

export function pipeIdentifier(pipe, index = 0) {
  const feature = pipe?.feature || pipe;
  return String(pipe?.id || property(feature?.properties, PIPE_ID_FIELDS) || `pipe-${index + 1}`);
}

function matchStrength(entity) {
  const confidence = Math.max(0, Math.min(1, finite(entity?.confidence) ?? 0));
  const distance = finite(entity?.matchDistance);
  const distanceFactor = distance == null ? 0.7 : distance <= 20 ? 1 : distance <= 50 ? 0.8 : distance <= 100 ? 0.55 : 0.3;
  return confidence * distanceFactor;
}

function alertKind(alert) {
  return String(alert?.alertType || alert?.type || "").toLowerCase();
}

function isLeakAlert(alert) {
  return alertKind(alert).includes("leak");
}

function isActiveAlert(alert) {
  return alert?.stateGroup === "active" || ["new", "reopen", "located", "active"].includes(String(alert?.status || "").toLowerCase());
}

function evidenceGroups(alerts) {
  const parent = new Map();
  const find = id => {
    const key = String(id);
    if (!parent.has(key)) parent.set(key, key);
    if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
    return parent.get(key);
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };
  alerts.forEach(alert => {
    const id = String(alert.alertId);
    find(id);
    (alert.relationships || []).filter(link => /duplicate|shadow/i.test(link.type || "")).forEach(link => unite(id, link.alertId));
  });
  const groups = new Map();
  alerts.forEach(alert => {
    const root = find(alert.alertId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(alert);
  });
  return [...groups.values()];
}

function representative(group) {
  return [...group].sort((left, right) => {
    const activeDifference = Number(isActiveAlert(right)) - Number(isActiveAlert(left));
    if (activeDifference) return activeDifference;
    const leakDifference = Number(isLeakAlert(right)) - Number(isLeakAlert(left));
    if (leakDifference) return leakDifference;
    return (finite(right.probability) ?? 0) - (finite(left.probability) ?? 0);
  })[0];
}

function pipeSusceptibility(pipe) {
  const properties = pipe?.feature?.properties || pipe?.properties || {};
  const material = String(property(properties, ["pipe_mtr", "material", "mat", "pipe_type", "type"]) || "").toUpperCase();
  const diameter = finite(property(properties, ["pipe_size", "diameter", "dia", "size"]));
  const failures = finite(property(properties, ["bursts", "breaks", "failures"])) ?? 0;
  const materialPoints = /(^|\W)(CI|AC|GI|GALV)(\W|$)/.test(material) ? 10 : /(^|\W)(DI|STEEL|MS)(\W|$)/.test(material) ? 6 : 2;
  const diameterPoints = diameter != null && diameter < 100 ? 4 : 0;
  const historyPoints = Math.min(8, Math.max(0, failures) * 2);
  return {
    score: Math.min(20, materialPoints + diameterPoints + historyPoints),
    material: material || "Unknown",
    diameter,
    failures,
    contributions: { material: materialPoints, smallDiameter: diameterPoints, failureHistory: historyPoints }
  };
}

function classification(score, hasOperationalEvidence) {
  if (!hasOperationalEvidence) return "Insufficient evidence";
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Elevated";
  return "Normal";
}

function confidenceLabel(value) {
  if (value >= 80) return "High";
  if (value >= 55) return "Medium";
  return "Low";
}

export function analyzeLeakRisk(input = {}) {
  const pipes = input.pipes || [];
  const alerts = input.alerts || [];
  const sensors = input.sensors || [];
  const groupedAlerts = evidenceGroups(alerts).map(group => ({ group, alert: representative(group) }));
  const hydraulicAllowed = Boolean(input.includeHydraulics && input.hydraulicContext?.retained && input.hydraulicContext?.engineeringGate?.usable);

  return pipes.map((pipe, index) => {
    const pipeId = pipeIdentifier(pipe, index);
    const susceptibility = pipeSusceptibility(pipe);
    const pipeGroups = groupedAlerts.filter(item => String(item.alert.matchedPipeId || "") === pipeId && isLeakAlert(item.alert));
    const activeGroups = pipeGroups.filter(item => isActiveAlert(item.alert));
    const historicalGroups = pipeGroups.filter(item => !isActiveAlert(item.alert));
    const primary = activeGroups.sort((left, right) => (finite(right.alert.probability) ?? 0) - (finite(left.alert.probability) ?? 0))[0];
    const primaryAlert = primary ? Math.min(50, (32 + (finite(primary.alert.probability) ?? 0) * 0.18) * matchStrength(primary.alert)) : 0;
    const repeatAlerts = Math.min(18, Math.max(0, activeGroups.length - 1) * 9);
    const historicalAlerts = Math.min(16, historicalGroups.reduce((sum, item) => sum + 6 * matchStrength(item.alert), 0));
    const pipeSensors = sensors.filter(sensor => String(sensor.matchedPipeId || "") === pipeId && matchStrength(sensor) > 0);
    const strongestSensor = pipeSensors.sort((left, right) => Math.max(finite(right.intensity?.filtered) ?? 0, finite(right.intensity?.sampled) ?? 0) - Math.max(finite(left.intensity?.filtered) ?? 0, finite(left.intensity?.sampled) ?? 0))[0];
    const strongestIntensity = strongestSensor ? Math.max(finite(strongestSensor.intensity?.filtered) ?? 0, finite(strongestSensor.intensity?.sampled) ?? 0) : 0;
    const acousticIntensity = strongestIntensity >= 1000 ? Math.min(12, 6 + Math.log10(strongestIntensity / 1000 + 1) * 6) * matchStrength(strongestSensor) : 0;
    const hydraulicCandidate = finite(input.hydraulicContext?.byPipe?.[pipeId]) ?? 0;
    const hydraulic = hydraulicAllowed ? Math.max(0, Math.min(12, hydraulicCandidate)) : 0;
    const syntheticTelemetry = 0;
    const rawScore = susceptibility.score + primaryAlert + repeatAlerts + historicalAlerts + acousticIntensity + hydraulic;
    const operationalEntities = [...activeGroups, ...historicalGroups].map(item => item.alert).concat(acousticIntensity ? [strongestSensor] : []);
    const strongestMatch = operationalEntities.length ? Math.max(...operationalEntities.map(matchStrength)) : 0;
    const confidence = operationalEntities.length ? Math.round(Math.min(100, strongestMatch * 88 + Math.min(12, Math.max(0, pipeGroups.length - 1) * 4))) : 0;
    const investigationPriority = Math.round(Math.max(0, Math.min(100, rawScore)));
    return {
      pipeId,
      pipe,
      investigationPriority,
      evidenceConfidence: { score: confidence, label: confidenceLabel(confidence) },
      classification: classification(investigationPriority, operationalEntities.length > 0),
      contributions: {
        pipeSusceptibility: susceptibility.score,
        activeLeakAlert: Number(primaryAlert.toFixed(2)),
        repeatIndependentAlerts: repeatAlerts,
        historicalLeakAlerts: Number(historicalAlerts.toFixed(2)),
        acousticIntensity: Number(acousticIntensity.toFixed(2)),
        syntheticTelemetry,
        hydraulic
      },
      evidence: {
        activeAlerts: activeGroups.map(item => item.alert),
        historicalAlerts: historicalGroups.map(item => item.alert),
        sensors: acousticIntensity ? [strongestSensor] : [],
        duplicateRecordsCollapsed: pipeGroups.reduce((sum, item) => sum + item.group.length - 1, 0),
        susceptibility,
        hydraulicStatus: hydraulicAllowed ? "retained-usable" : "excluded"
      }
    };
  }).sort((left, right) => right.investigationPriority - left.investigationPriority || right.evidenceConfidence.score - left.evidenceConfidence.score);
}

export function filterLeakRisk(results, filters = {}) {
  const classes = new Set(filters.classifications || []);
  return (results || []).filter(result => {
    if (classes.size && !classes.has(result.classification)) return false;
    if (finite(filters.minimumPriority) != null && result.investigationPriority < Number(filters.minimumPriority)) return false;
    if (finite(filters.minimumConfidence) != null && result.evidenceConfidence.score < Number(filters.minimumConfidence)) return false;
    if (filters.activeAlertsOnly && !result.evidence.activeAlerts.length) return false;
    return true;
  });
}

if (typeof window !== "undefined") window.AquaLeakRiskCore = { analyzeLeakRisk, filterLeakRisk, pipeIdentifier };