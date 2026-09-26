import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonSources, buildSpatialComparison, compareSources, SPATIAL_COMPARISON_DEFAULTS } from "../cockpit/comparison-core.js";

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

test("saved elevation profiles are spatial sources and cannot enter temporal comparison", () => {
  const spatialProject = { ...project, analyses: { elevationProfiles: [{ profileId: "EP-1", name: "Ridge", geometry: [[22, 120], [22, 120.002]], samples: [{ distance: 0, elevation: 10 }, { distance: 206, elevation: 14 }], provenance: { source: "Open-Meteo", dataset: "Copernicus DEM GLO-90" } }] } };
  const elevation = buildComparisonSources(spatialProject).find(source => source.id === "elevation:EP-1");
  assert.equal(elevation.domain, "spatial");
  assert.throws(() => compareSources(elevation, buildComparisonSources(spatialProject)[0]), /Spatial mode/);
});

test("spatial comparison projects nearby pressure loggers and supports pressure modes", () => {
  const spatialProject = {
    telemetry: [
      { id: "near", type: "pressure", lat: 22.0005, lng: 120.001, source: "synthetic/demo", readings: times.slice(0, 3).map((timestamp, index) => ({ timestamp, pressure: 30 + index * 10 })) },
      { id: "far", type: "pressure", lat: 22.01, lng: 120.001, readings: [{ timestamp: times[0], pressure: 99 }] }
    ],
    analyses: { elevationProfiles: [{ profileId: "EP-1", name: "Ridge", geometry: [[22, 120], [22, 120.002]], samples: [{ distance: 0, elevation: 10 }, { distance: 206, elevation: 14 }], provenance: { source: "Open-Meteo", dataset: "Copernicus DEM GLO-90" } }] }
  };
  const sources = buildComparisonSources(spatialProject);
  const elevation = sources.find(source => source.type === "elevation");
  const pressure = sources.filter(source => source.type === "pressure");
  const latest = buildSpatialComparison(elevation, pressure);
  assert.equal(SPATIAL_COMPARISON_DEFAULTS.corridorMetres, 200);
  assert.equal(latest.loggers.length, 1);
  assert.equal(latest.loggers[0].pressure, 50);
  assert.ok(latest.loggers[0].chainage > 100 && latest.loggers[0].chainage < 110);
  assert.ok(latest.loggers[0].terrainElevation > 11 && latest.loggers[0].terrainElevation < 13);
  assert.equal(latest.loggers[0].provenance, "synthetic/demo");
  assert.equal(latest.engineeringHydraulicGrade.available, false);
  const average = buildSpatialComparison(elevation, pressure, { pressureMode: "average", start: times[0], end: times[1] });
  assert.equal(average.loggers[0].pressure, 35);
  const minimum = buildSpatialComparison(elevation, pressure, { pressureMode: "minimum" });
  const maximum = buildSpatialComparison(elevation, pressure, { pressureMode: "maximum" });
  assert.equal(minimum.loggers[0].pressure, 30);
  assert.equal(maximum.loggers[0].pressure, 50);
});