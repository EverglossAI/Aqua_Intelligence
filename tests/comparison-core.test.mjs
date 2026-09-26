import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonSources, compareSources } from "../cockpit/comparison-core.js";

const times = ["2026-09-25T00:00:00Z", "2026-09-25T01:00:00Z", "2026-09-25T02:00:00Z", "2026-09-25T03:00:00Z"];
const project = {
  telemetry: [
    { id: "P-1", type: "pressure", source: "synthetic/demo", readings: times.map((timestamp, index) => ({ timestamp, pressure: index + 1 })) },
    { id: "P-2", type: "pressure", source: "synthetic/demo", readings: times.map((timestamp, index) => ({ timestamp, pressure: (index + 1) * 2 })) },
    { id: "F-1", type: "flow", source: "synthetic/demo", readings: times.map((timestamp, index) => ({ timestamp, flow: 10 - index })) },
    { id: "F-2", type: "flow", source: "synthetic/demo", readings: times.map((timestamp, index) => ({ timestamp, flow: 20 - index * 2 })) }
  ],
  acousticSensor: [
    { sensorId: "S-1", status: "Active", lastActive: times[3], source: { filename: "sensors.xlsx" }, intensity: { filtered: 7 } },
    { sensorId: "S-2", status: "Active", lastActive: times[2], source: { filename: "sensors.xlsx" }, intensity: { filtered: 8 } }
  ],
  acousticCouple: [{ coupleId: "C-1", sensor1Id: "S-1", sensor2Id: "S-2" }],
  acousticAlert: [{ alertId: "A-1", alertType: "Leak", status: "New", coupleId: "C-1", detectionDate: times[1], probability: 90 }]
};

const sources = buildComparisonSources(project);
const byId = id => sources.find(source => source.id === id);

test("all pressure, flow, and acoustic source pair types are supported", () => {
  const pairs = [
    ["pressure:P-1", "pressure:P-2"],
    ["pressure:P-1", "flow:F-1"],
    ["flow:F-1", "flow:F-2"],
    ["pressure:P-1", "acoustic:S-1"],
    ["flow:F-1", "acoustic:S-1"],
    ["acoustic:S-1", "acoustic:S-2"]
  ];
  pairs.forEach(([left, right]) => assert.doesNotThrow(() => compareSources(byId(left), byId(right))));
});

test("aligned numeric sources report deterministic statistics and correlation", () => {
  const comparison = compareSources(byId("pressure:P-1"), byId("pressure:P-2"));
  assert.deepEqual(comparison.sourceA.statistics, { count: 4, min: 1, max: 4, average: 2.5 });
  assert.equal(comparison.correlation.sampleCount, 4);
  assert.equal(comparison.correlation.value, 1);
  assert.ok(comparison.overlap.durationMs > 0);
});

test("date and overnight time filters are shared by both sources", () => {
  const comparison = compareSources(byId("pressure:P-1"), byId("flow:F-1"), {
    start: "2026-09-25T00:30:00Z",
    end: "2026-09-25T03:00:00Z",
    timeStart: "23:00",
    timeEnd: "02:00"
  });
  assert.equal(comparison.sourceA.statistics.count, 2);
  assert.equal(comparison.sourceB.statistics.count, 2);
  assert.equal(comparison.correlation.value, null);
  assert.equal(comparison.correlation.sampleCount, 2);
});

test("acoustic sources remain event-only and never report numeric correlation", () => {
  const acoustic = byId("acoustic:S-1");
  assert.equal(acoustic.points.length, 0);
  assert.equal(acoustic.events.length, 2);
  const comparison = compareSources(byId("pressure:P-1"), acoustic);
  assert.equal(comparison.correlation.value, null);
  assert.match(comparison.correlation.reason, /event-only/);
  assert.equal(comparison.sourceB.statistics.count, 0);
});