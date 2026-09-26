import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLeakRisk, filterLeakRisk } from "../cockpit/leak-risk-core.js";

const pipes = [
  { type: "Feature", properties: { unific_id: "P-1", pipe_mtr: "CI", pipe_size: 75, bursts: 2 } },
  { type: "Feature", properties: { unific_id: "P-2", pipe_mtr: "PVC", pipe_size: 150 } }
];

const alert = (overrides = {}) => ({
  alertId: "A-1",
  alertType: "Leak",
  status: "New",
  stateGroup: "active",
  probability: 90,
  matchedPipeId: "P-1",
  matchDistance: 4,
  confidence: 0.95,
  relationships: [],
  ...overrides
});

test("operational evidence is scored while duplicate records count once", () => {
  const results = analyzeLeakRisk({
    pipes,
    alerts: [alert(), alert({ alertId: "A-1-shadow", probability: 70, relationships: [{ type: "shadow-of", alertId: "A-1" }] })],
    sensors: [{ sensorId: "S-1", matchedPipeId: "P-1", confidence: 0.98, matchDistance: 2, intensity: { filtered: 1800 } }]
  });
  const first = results.find(result => result.pipeId === "P-1");
  assert.equal(first.evidence.activeAlerts.length, 1);
  assert.equal(first.evidence.duplicateRecordsCollapsed, 1);
  assert.equal(first.contributions.repeatIndependentAlerts, 0);
  assert.ok(first.contributions.activeLeakAlert > 40);
  assert.ok(first.contributions.acousticIntensity > 0);
  assert.equal(first.classification, "High");
});

test("synthetic telemetry and unretained hydraulics contribute exactly zero", () => {
  const [result] = analyzeLeakRisk({
    pipes: [pipes[0]],
    alerts: [alert()],
    telemetry: [{ type: "pressure", source: "synthetic/demo", value: 80 }],
    includeHydraulics: true,
    hydraulicContext: { retained: false, engineeringGate: { usable: true }, byPipe: { "P-1": 12 } }
  });
  assert.equal(result.contributions.syntheticTelemetry, 0);
  assert.equal(result.contributions.hydraulic, 0);
  assert.equal(result.evidence.hydraulicStatus, "excluded");
});

test("usable retained hydraulics are opt-in and filters change the result set", () => {
  const results = analyzeLeakRisk({
    pipes,
    alerts: [alert()],
    includeHydraulics: true,
    hydraulicContext: { retained: true, engineeringGate: { usable: true }, byPipe: { "P-1": 9 } }
  });
  const first = results.find(result => result.pipeId === "P-1");
  assert.equal(first.contributions.hydraulic, 9);
  assert.equal(first.evidence.hydraulicStatus, "retained-usable");
  assert.equal(filterLeakRisk(results, { classifications: ["Insufficient evidence"] }).length, 1);
  assert.equal(filterLeakRisk(results, { activeAlertsOnly: true }).length, 1);
});