import test from "node:test";
import assert from "node:assert/strict";
import { buildElevationProfile, buildSampledElevationProfile, describeElevationSource, featureCoordinate, filterDmaPipes, filteredPipeSummary, navigationUrl, presentAssetFields, resolveElevationSource, sampleProfileLine, streetViewUrl, summarizeDma } from "../cockpit/contextual-core.js";

const dma = { type: "Feature", properties: { dma_code: "DMA-1", name: "North" }, geometry: { type: "Polygon", coordinates: [[[120, 22], [120.01, 22], [120.01, 22.01], [120, 22.01], [120, 22]]] } };
const pipe = (id, latitude, material = "CI", diameter = 100) => ({ type: "Feature", properties: { unific_id: id, pipe_mtr: material, pipe_size: diameter }, geometry: { type: "LineString", coordinates: [[120.001, latitude], [120.009, latitude]] } });

test("asset fields contain only values actually present", () => {
  const fields = presentAssetFields({ properties: { id: "P-1", material: "CI", installation_year: null, condition: "", __aquaRisk: 90 } }, { kind: "network" });
  assert.deepEqual(fields.map(field => field.key), ["id", "material"]);
});

test("DMA summary derives counts and linked evidence from project data", () => {
  const project = {
    layers: [{ kind: "pipe", geojson: { features: [pipe("P-1", 22.002), pipe("P-2", 22.006, "PVC", 150)] } }],
    logicalDmas: [{ dma_code: "DMA-1", label: "North", flow_summary: { meter_id: "F-1" } }],
    telemetry: [
      { id: "F-1", type: "flow", dmaCode: "DMA-1", lat: 22.003, lng: 120.003 },
      { id: "PR-1", type: "pressure", dmaCode: "DMA-1", lat: 22.004, lng: 120.004 }
    ],
    acousticSensor: [{ sensorId: "S-1", lat: 22.005, lng: 120.005 }],
    acousticAlert: [{ alertId: "A-1", matchedPipeId: "P-1", stateGroup: "active" }]
  };
  const summary = summarizeDma(project, dma, [{ pipeId: "P-1", classification: "High", investigationPriority: 72 }]);
  assert.equal(summary.pipeCount, 2);
  assert.ok(summary.totalPipeLength > 1600);
  assert.equal(summary.materials.find(item => item.value === "CI").count, 1);
  assert.equal(summary.pressureLoggers.length, 1);
  assert.equal(summary.flowMeters.length, 1);
  assert.equal(summary.acousticSensors.length, 1);
  assert.equal(summary.activeAlerts.length, 1);
  assert.equal(summary.priority.high, 1);
  assert.equal(summary.elevation, null);
});

test("synthetic hydraulic fallback is never accepted as map elevation", () => {
  assert.equal(resolveElevationSource(null), null);
  assert.equal(describeElevationSource(null), null);
  assert.equal(resolveElevationSource({ elevationData: { source: "demo_flat_datum", real: false, points: [{ lat: 22, lng: 120, elevation: 0 }] } }), null);
  assert.equal(resolveElevationSource({ latestHydraulicModel: { assumptions: { elevationSource: "demo_flat_datum", elevationMetres: 0 } } }), null);
  assert.deepEqual(describeElevationSource({ latestHydraulicModel: { assumptions: { elevationSource: "demo_flat_datum" } } }), {
    source: "demo_flat_datum", resolution: null, date: null, version: null, classification: "demo/model-derived", usable: false
  });
});

test("verified elevation samples produce real profile statistics", () => {
  const source = resolveElevationSource({ elevationData: {
    real: true,
    points: [
      { lat: 22, lng: 120, elevation: 10 },
      { lat: 22, lng: 120.001, elevation: 14 },
      { lat: 22, lng: 120.002, elevation: 11 }
    ],
    provenance: { source: "Survey 2026", resolution: 5, date: "2026-09-01", kind: "surveyed" }
  } });
  const profile = buildElevationProfile([[22, 120], [22, 120.002]], source, { maximumDistance: 5 });
  assert.equal(profile.available, true);
  assert.equal(profile.statistics.minimum, 10);
  assert.equal(profile.statistics.maximum, 14);
  assert.equal(profile.statistics.gain, 4);
  assert.equal(profile.statistics.loss, 3);
  assert.ok(profile.statistics.totalDistance > 200);
  assert.equal(profile.provenance.source, "Survey 2026");
});

test("map actions preserve exact latitude and longitude", () => {
  const coordinate = [22.350123, 120.919876];
  assert.equal(streetViewUrl(coordinate), "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=22.350123,120.919876");
  assert.equal(navigationUrl(coordinate), "https://www.google.com/maps/dir/?api=1&destination=22.350123,120.919876");
  assert.equal(featureCoordinate({ geometry: { type: "Point", coordinates: [] } }), null);
});

test("external elevation providers receive bounded evenly spaced samples", () => {
  const points = sampleProfileLine([[22, 120], [22, 120.01]], { sampleCount: 60 });
  assert.equal(points.length, 60);
  assert.deepEqual([points[0].lat, points[0].lng], [22, 120]);
  assert.ok(Math.abs(points.at(-1).lng - 120.01) < 1e-10);
  assert.ok(points[30].distance > points[29].distance);
  assert.equal(sampleProfileLine([[22, 120], [22, 121]], { sampleCount: 500 }).length, 200);
});

test("external DEM samples retain cumulative distance and statistics", () => {
  const profile = buildSampledElevationProfile([
    { lat: 22, lng: 120, distance: 0, elevation: 8 },
    { lat: 22, lng: 120.001, distance: 100, elevation: 13 },
    { lat: 22, lng: 120.002, distance: 200, elevation: 10 }
  ], { source: "Mapbox Terrain DEM", kind: "external DEM" });
  assert.equal(profile.available, true);
  assert.equal(profile.statistics.totalDistance, 200);
  assert.equal(profile.statistics.gain, 5);
  assert.equal(profile.statistics.loss, 3);
});

test("DMA pipe filters use OR within groups and AND between groups", () => {
  const pipes = [pipe("P-1", 22.002, "PVC", 100), pipe("P-2", 22.004, "DIP", 150), pipe("P-3", 22.006, "PVC", 80)];
  assert.deepEqual(filterDmaPipes(pipes, { materials: ["PVC", "CI"] }).map(item => item.properties.unific_id), ["P-1", "P-3"]);
  assert.deepEqual(filterDmaPipes(pipes, { diameters: [100, 150] }).map(item => item.properties.unific_id), ["P-1", "P-2"]);
  const combined = filteredPipeSummary(pipes, { materials: ["PVC", "DIP"], diameters: [80, 100] });
  assert.deepEqual(combined.pipes.map(item => item.properties.unific_id), ["P-1", "P-3"]);
  assert.equal(combined.count, 2);
  assert.ok(combined.totalLength > 0);
});