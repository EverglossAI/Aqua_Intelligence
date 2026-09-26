import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { matchEntitiesToPipes, summarizeAcoustics } from "../scripts/acoustic-import.mjs";

function pipe(id, material, coordinates) {
  return { type: "Feature", properties: { gid: id, pipe_mtr: material }, geometry: { type: "LineString", coordinates } };
}

test("material and couple path can beat the nearest incompatible pipe", () => {
  const sensors = [
    { entityType: "acousticSensor", sensorId: "1", lat: 22.33, lng: 120.36 },
    { entityType: "acousticSensor", sensorId: "2", lat: 22.331, lng: 120.36 }
  ];
  const couples = [{ coupleId: "9", sensor1Id: "1", sensor2Id: "2", material: "DuctileIron" }];
  const project = { layers: [{ kind: "pipe", geojson: { features: [
    pipe("pvc-nearest", "PVCP", [[120.35999, 22.3299], [120.35999, 22.3311]]),
    pipe("di-plausible", "DIP", [[120.3601, 22.3299], [120.3601, 22.3311]])
  ] } }] };
  const [matched] = matchEntitiesToPipes([sensors[0]], couples, sensors, project);
  assert.equal(matched.matchedPipeId, "di-plausible");
  assert.match(matched.matchMethod, /material.*couple-path/);
});

test("summary keeps consumption and historical evidence separate", () => {
  const sensors = [{ status: "Active", intensity: { sampled: 1400 }, matchedPipeId: "1" }];
  const couples = [{ coupleId: "7" }];
  const alerts = [
    { coupleId: "7", alertType: "Leak", stateGroup: "active", relationships: [], matchedPipeId: "1" },
    { coupleId: "7", alertType: "Consumption", stateGroup: "historical", relationships: [{ type: "shadow-of" }], matchedPipeId: null }
  ];
  assert.deepEqual(summarizeAcoustics(sensors, couples, alerts), {
    totalLambaySensors: 1, activeSensors: 1, couples: 1, activeAlerts: 1, historicalAlerts: 1,
    leakAlerts: 1, consumptionAlerts: 1, repeatAlertCouples: 1, highIntensitySensors: 1,
    communicationBatteryWarnings: 0, unmatchedSensors: 0, unmatchedAlerts: 1, duplicateShadowRelationships: 1
  });
});

test("generated Lambay artifact retains operational records, provenance, and GIS review fields", async () => {
  const data = JSON.parse(await readFile(new URL("../projects/lambay-island/acoustic/lambay-acoustic-operational-data.json", import.meta.url), "utf8"));
  assert.equal(data.acousticSensor.length, 10);
  assert.equal(data.acousticCouple.length, 9);
  assert.equal(data.acousticAlert.length, 22);
  assert.equal(data.acousticAlert.filter(item => item.stateGroup === "active").length, 3);
  assert.equal(data.acousticAlert.filter(item => item.stateGroup === "historical").length, 19);
  assert.equal(data.acousticAlert.filter(item => item.alertType === "Consumption").length, 5);
  assert.equal(data.acousticAlert.reduce((sum, item) => sum + item.relationships.length, 0), 7);
  for (const entity of [...data.acousticSensor, ...data.acousticAlert]) {
    assert.equal(entity.source.type, "imported-operational-report");
    assert.ok(entity.source.filename.endsWith("_report_20260926.xlsx"));
    assert.equal(typeof entity.matchedPipeId, "string");
    assert.equal(typeof entity.matchDistance, "number");
    assert.equal(typeof entity.confidence, "number");
    assert.equal(typeof entity.reviewRequired, "boolean");
  }
});