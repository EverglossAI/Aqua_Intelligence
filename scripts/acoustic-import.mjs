import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

const EARTH_METRES_PER_DEGREE = 111_320;
const ACTIVE_ALERT_STATES = new Set(["New", "Reopen", "Located"]);

function value(row, name) {
  const entry = Object.entries(row).find(([key]) => key.trim().toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function number(input) {
  if (input == null || input === "") return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(input) {
  return input == null ? null : String(input).trim() || null;
}

function identifier(input) {
  const normalized = text(input);
  return normalized == null ? null : normalized;
}

function date(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString();
  const match = String(input).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (match) return `20${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}T00:00:00.000Z`;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? text(input) : parsed.toISOString();
}

function excelValue(cell) {
  const input = cell.value;
  if (input && typeof input === "object" && "result" in input) return input.result;
  if (input && typeof input === "object" && Array.isArray(input.richText)) return input.richText.map(item => item.text).join("");
  return input;
}

export async function readReport(filename) {
  const bytes = await readFile(filename);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`${filename} has no worksheet`);
  const headers = worksheet.getRow(1).values.slice(1).map(item => String(item || "").trim());
  const rows = [];
  worksheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const row = {};
    headers.forEach((header, index) => { row[header] = excelValue(excelRow.getCell(index + 1)); });
    if (Object.values(row).some(item => item != null && item !== "")) rows.push({ row, sourceRow: rowNumber });
  });
  return {
    filename: filename.split(/[\\/]/).pop(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sheet: worksheet.name,
    rows
  };
}

function source(report, sourceRow) {
  return {
    type: "imported-operational-report",
    filename: report.filename,
    sheet: report.sheet,
    sourceRow,
    sha256: report.sha256,
    reportDate: "2026-09-26"
  };
}

function coordinates(row) {
  return { lat: number(value(row, "Latitude")), lng: number(value(row, "Longitude")) };
}

function coordinateLines(input) {
  if (!Array.isArray(input) || !input.length) return [];
  if (input.length >= 2 && Number.isFinite(number(input[0])) && Number.isFinite(number(input[1]))) return [];
  if (Array.isArray(input[0]) && input[0].length >= 2 && Number.isFinite(number(input[0][0])) && Number.isFinite(number(input[0][1]))) return [input];
  return input.flatMap(coordinateLines);
}

function allCoordinates(geometry) {
  return coordinateLines(geometry?.coordinates).flat();
}

export function projectBounds(project, paddingMetres = 1_000) {
  const coordinates = (project.layers || [])
    .filter(layer => layer.kind === "pipe")
    .flatMap(layer => (layer.geojson?.features || []).flatMap(feature => allCoordinates(feature.geometry)));
  if (!coordinates.length) throw new Error("Project has no pipe geometry for spatial filtering");
  const lngs = coordinates.map(point => number(point[0])).filter(Number.isFinite);
  const lats = coordinates.map(point => number(point[1])).filter(Number.isFinite);
  const meanLat = lats.reduce((sum, item) => sum + item, 0) / lats.length;
  const latPadding = paddingMetres / EARTH_METRES_PER_DEGREE;
  const lngPadding = paddingMetres / (EARTH_METRES_PER_DEGREE * Math.cos(meanLat * Math.PI / 180));
  return {
    minLat: Math.min(...lats) - latPadding,
    maxLat: Math.max(...lats) + latPadding,
    minLng: Math.min(...lngs) - lngPadding,
    maxLng: Math.max(...lngs) + lngPadding
  };
}

function inside(bounds, row) {
  const { lat, lng } = coordinates(row);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

function normalizeSensor(entry, report) {
  const row = entry.row;
  const { lat, lng } = coordinates(row);
  return {
    entityType: "acousticSensor",
    sensorId: identifier(value(row, "Sensor ID")),
    deviceId: text(value(row, "Device ID")),
    deviceType: text(value(row, "Device Type")),
    assetId: text(value(row, "Asset ID")),
    sopId: text(value(row, "SOP ID")),
    status: text(value(row, "Sensor Status")),
    daysInactive: number(value(row, "Days Inactive")),
    battery: number(value(row, "Battery")),
    batteryVoltage: number(value(row, "Battery Voltage")),
    signals: {
      g4Csq: number(value(row, "G4 CSQ")), g4Snr: number(value(row, "G4 SNR")),
      g5Rsrq: number(value(row, "G5 RSRQ")), g5Rsrp: number(value(row, "G5 RSRP")),
      csq: number(value(row, "CSQ")), rssi: number(value(row, "RSSI")),
      rssiCondition: text(value(row, "RSSI Condition")), radioFrequency: number(value(row, "Radio Frequency"))
    },
    intensity: {
      filtered: number(value(row, "Filtered Intensity")),
      minimal: number(value(row, "Minimal Intensity")),
      sampled: number(value(row, "Sampled Intensity"))
    },
    installationDate: date(value(row, "Sensor Installation Date") || value(row, "Device Installation Date")),
    lastActive: date(value(row, "Last Active Time")),
    lastCommunication: date(value(row, "Last Communication Time")),
    lat, lng,
    projectedCoordinates: { x: number(value(row, "X")), y: number(value(row, "Y")) },
    address: text(value(row, "Street Address")),
    maintenance: {
      type: text(value(row, "Maintenance Type")), user: text(value(row, "Maintenance User")),
      date: date(value(row, "Maintenance Date")), comment: text(value(row, "Maintenance Comment"))
    },
    hardwareVersion: text(value(row, "Hard Version")),
    firmwareVersion: text(value(row, "Firmware Version")),
    simNumber: text(value(row, "SIM Number")),
    source: source(report, entry.sourceRow)
  };
}

function normalizeCouple(entry, report) {
  const row = entry.row;
  return {
    entityType: "acousticCouple",
    coupleId: identifier(value(row, "Couple ID")),
    sensor1Id: identifier(value(row, "Sensor 1")),
    sensor2Id: identifier(value(row, "Sensor 2")),
    sensor1OptionalPoint: text(value(row, "SensorOptionalPoint1")),
    sensor2OptionalPoint: text(value(row, "SensorOptionalPoint2")),
    device1Id: text(value(row, "DeviceID1")),
    device2Id: text(value(row, "DeviceID2")),
    pathLength: number(value(row, "PathLengthM")),
    material: text(value(row, "Material")),
    lastActivity: date(value(row, "Last Activity")),
    overlapping: Boolean(number(value(row, "Overlapping"))),
    addresses: [text(value(row, "Address1")), text(value(row, "Address2"))],
    comment: text(value(row, "Comment")),
    source: source(report, entry.sourceRow)
  };
}

function alertRelationships(comment) {
  const relationships = [];
  const pattern = /\b(dup(?:licate)?|shadow)\s+of\s+(?:leak|alert)\s+(\d+)(?:\s+in\s+couple\s+(\d+))?/ig;
  let match;
  while ((match = pattern.exec(comment || ""))) relationships.push({ type: /^dup/i.test(match[1]) ? "duplicate-of" : "shadow-of", alertId: match[2], coupleId: match[3] || null });
  return relationships;
}

function normalizeAlert(entry, report) {
  const row = entry.row;
  const { lat, lng } = coordinates(row);
  const status = text(value(row, "Alert Status"));
  const comment = text(value(row, "Comment"));
  return {
    entityType: "acousticAlert",
    alertId: identifier(value(row, "Alert ID")),
    coupleId: identifier(value(row, "Couple ID")),
    sensor1Id: identifier(value(row, "Sensor ID 1")),
    sensor2Id: identifier(value(row, "Sensor ID 2")),
    alertType: String(value(row, "Alert Type") || "").replace(/:$/, ""),
    priority: text(value(row, "Priority")),
    probability: number(value(row, "Probability")),
    status,
    stateGroup: ACTIVE_ALERT_STATES.has(status) ? "active" : status === "Closed" ? "historical" : "review",
    daysDetected: number(value(row, "Days Detected")),
    detectionDate: date(value(row, "Detection Date")),
    closureDate: date(value(row, "Closure date:")),
    lat, lng,
    projectedCoordinates: { x: number(value(row, "X")), y: number(value(row, "Y")) },
    distances: { metres: number(value(row, "Distance M")), feet: number(value(row, "Distance F")) },
    address: text(value(row, "Address")),
    workArea: text(value(row, "Work Area")),
    sapNumber: text(value(row, "SAP Number")),
    commentDate: date(value(row, "Comment Date")),
    comments: comment,
    repair: {
      essence: text(value(row, "Repair Essence")),
      lat: number(value(row, "Repair Latitude")),
      lng: number(value(row, "Repair Longitude"))
    },
    relationships: alertRelationships(comment),
    sourceSystem: text(value(row, "Source")),
    source: source(report, entry.sourceRow)
  };
}

function localPoint([lng, lat], originLat) {
  return [lng * EARTH_METRES_PER_DEGREE * Math.cos(originLat * Math.PI / 180), lat * EARTH_METRES_PER_DEGREE];
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  const projected = [start[0] + ratio * dx, start[1] + ratio * dy];
  return Math.hypot(point[0] - projected[0], point[1] - projected[1]);
}

function distanceToGeometry(entity, geometry) {
  const lines = coordinateLines(geometry?.coordinates);
  const originLat = entity.lat;
  const point = localPoint([entity.lng, entity.lat], originLat);
  let best = Infinity;
  for (const line of lines) for (let index = 1; index < (line || []).length; index++) {
    best = Math.min(best, pointSegmentDistance(point, localPoint(line[index - 1], originLat), localPoint(line[index], originLat)));
  }
  return best;
}

function canonicalMaterial(input) {
  const material = String(input || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (/DUCTILEIRON|DIP|^DI$/.test(material)) return "DI";
  if (/PVC/.test(material)) return "PVC";
  if (/HDPE|PE/.test(material)) return "PE";
  if (/CASTIRON|^CI$/.test(material)) return "CI";
  if (/STEEL|^GI$/.test(material)) return "STEEL";
  return material || null;
}

function pipeIdentity(feature, index) {
  const properties = feature.properties || {};
  return String(properties.unific_id || properties.gid || properties.fid || properties.pipe_id || `pipe-${index}`);
}

function pipeMaterial(feature) {
  const properties = feature.properties || {};
  return text(properties.pipe_mtr || properties.material || properties.pipe_material || properties.mat);
}

function relevantCouples(entity, couples) {
  if (entity.entityType === "acousticAlert") return couples.filter(item => item.coupleId === entity.coupleId);
  return couples.filter(item => item.sensor1Id === entity.sensorId || item.sensor2Id === entity.sensorId);
}

export function matchEntitiesToPipes(entities, couples, sensors, project) {
  const sensorById = new Map(sensors.map(item => [item.sensorId, item]));
  const pipes = (project.layers || []).filter(layer => layer.kind === "pipe").flatMap(layer => layer.geojson?.features || []);
  return entities.map(entity => {
    if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lng) || !pipes.length) return { ...entity, matchedPipeId: null, matchDistance: null, matchMethod: "unmatched", confidence: 0, reviewRequired: true };
    const links = relevantCouples(entity, couples);
    const expectedMaterials = links.map(item => canonicalMaterial(item.material)).filter(Boolean);
    const linkedSensors = links.flatMap(item => [sensorById.get(item.sensor1Id), sensorById.get(item.sensor2Id)]).filter(Boolean);
    const scored = pipes.map((feature, index) => {
      const distance = distanceToGeometry(entity, feature.geometry);
      const material = canonicalMaterial(pipeMaterial(feature));
      const materialKnown = expectedMaterials.length && material;
      const materialPenalty = !materialKnown ? 12 : expectedMaterials.includes(material) ? 0 : 65;
      const corridorDistance = linkedSensors.length > 1
        ? linkedSensors.reduce((sum, sensor) => sum + distanceToGeometry(sensor, feature.geometry), 0) / linkedSensors.length
        : distance;
      const corridorPenalty = Math.min(35, corridorDistance * .18);
      return { feature, index, distance, material, score: distance + materialPenalty + corridorPenalty };
    }).filter(item => Number.isFinite(item.distance)).sort((left, right) => left.score - right.score || left.distance - right.distance);
    const best = scored[0];
    if (!best || best.distance > 250) return { ...entity, matchedPipeId: null, matchDistance: best ? Math.round(best.distance * 10) / 10 : null, matchMethod: "unmatched", confidence: 0, reviewRequired: true };
    const materialMatched = expectedMaterials.includes(best.material);
    const method = links.length ? `spatial${expectedMaterials.length ? "+material" : ""}+couple-path` : "spatial";
    const confidence = Math.max(.1, Math.min(.98, 1 - best.distance / 180 + (materialMatched ? .12 : 0) - (expectedMaterials.length && !materialMatched ? .18 : 0)));
    return {
      ...entity,
      matchedPipeId: pipeIdentity(best.feature, best.index),
      matchDistance: Math.round(best.distance * 10) / 10,
      matchMethod: method,
      confidence: Math.round(confidence * 100) / 100,
      reviewRequired: best.distance > 35 || confidence < .65 || Boolean(expectedMaterials.length && !materialMatched)
    };
  });
}

export function summarizeAcoustics(sensors, couples, alerts) {
  const activeAlerts = alerts.filter(item => item.stateGroup === "active");
  const historicalAlerts = alerts.filter(item => item.stateGroup === "historical");
  const alertsByCouple = new Map();
  alerts.forEach(item => alertsByCouple.set(item.coupleId, (alertsByCouple.get(item.coupleId) || 0) + 1));
  return {
    totalLambaySensors: sensors.length,
    activeSensors: sensors.filter(item => /^active$/i.test(item.status)).length,
    couples: couples.length,
    activeAlerts: activeAlerts.length,
    historicalAlerts: historicalAlerts.length,
    leakAlerts: alerts.filter(item => /^leak$/i.test(item.alertType)).length,
    consumptionAlerts: alerts.filter(item => /^consumption$/i.test(item.alertType)).length,
    repeatAlertCouples: [...alertsByCouple.values()].filter(count => count > 1).length,
    highIntensitySensors: sensors.filter(item => Math.max(item.intensity.filtered || 0, item.intensity.sampled || 0) >= 1_000).length,
    communicationBatteryWarnings: sensors.filter(item => !/^active$/i.test(item.status) || (item.daysInactive || 0) > 0 || (item.battery != null && item.battery < 3.5)).length,
    unmatchedSensors: sensors.filter(item => !item.matchedPipeId).length,
    unmatchedAlerts: alerts.filter(item => !item.matchedPipeId).length,
    duplicateShadowRelationships: alerts.reduce((sum, item) => sum + item.relationships.length, 0)
  };
}

export async function importAcousticReports({ sensorsPath, couplesPath, alertsPath, project }) {
  const [sensorReport, coupleReport, alertReport] = await Promise.all([readReport(sensorsPath), readReport(couplesPath), readReport(alertsPath)]);
  const bounds = projectBounds(project);
  const sensors = sensorReport.rows.filter(entry => inside(bounds, entry.row)).map(entry => normalizeSensor(entry, sensorReport));
  const sensorIds = new Set(sensors.map(item => item.sensorId));
  const couples = coupleReport.rows.map(entry => normalizeCouple(entry, coupleReport)).filter(item => sensorIds.has(item.sensor1Id) && sensorIds.has(item.sensor2Id));
  const alerts = alertReport.rows.filter(entry => inside(bounds, entry.row)).map(entry => normalizeAlert(entry, alertReport));
  const matchedSensors = matchEntitiesToPipes(sensors, couples, sensors, project);
  const matchedAlerts = matchEntitiesToPipes(alerts, couples, matchedSensors, project);
  return {
    acousticSensor: matchedSensors,
    acousticCouple: couples,
    acousticAlert: matchedAlerts,
    acousticSummary: summarizeAcoustics(matchedSensors, couples, matchedAlerts),
    acousticProvenance: {
      classification: "imported-operational-data",
      importedAt: new Date().toISOString(),
      spatialSelection: { method: "project-pipe-bounds-with-1000m-padding", bounds },
      sourceArtifacts: [sensorReport, coupleReport, alertReport].map(report => ({ filename: report.filename, sheet: report.sheet, sha256: report.sha256, rows: report.rows.length }))
    }
  };
}