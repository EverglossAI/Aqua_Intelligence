import test from "node:test";
import assert from "node:assert/strict";
import { buildHydraulicTopology } from "../cockpit/topology-core.js";

function line(id, coordinates) {
  return { type: "Feature", properties: { id }, geometry: { type: "LineString", coordinates } };
}

function multiline(id, coordinates) {
  return { type: "Feature", properties: { id }, geometry: { type: "MultiLineString", coordinates } };
}

test("derived topology attaches an isolated service endpoint to a main interior without changing source GIS", () => {
  const layers = [
    { name: "area/pipe", kind: "pipe", geojson: { features: [line("M1", [[120, 22], [120.001, 22]])] } },
    { name: "area/eupipe", kind: "pipe", geojson: { features: [line("S1", [[120.0005, 22.000001], [120.0005, 22.0002]])] } }
  ];
  const original = JSON.stringify(layers);
  const topology = buildHydraulicTopology(layers);

  assert.equal(JSON.stringify(layers), original);
  assert.equal(topology.source.components, 2);
  assert.equal(topology.source.isolatedServicePipes, 1);
  assert.equal(topology.diagnostics.endpointToLineAttachments, 1);
  assert.equal(topology.diagnostics.connectionAudit.acceptedEndpointToLine.count, 1);
  assert.equal(topology.diagnostics.connectionAudit.legacyEndpointToLineScreen.count, 1);
  assert.deepEqual(topology.diagnostics.connectionAudit.reconciliation, {
    sharedSourceEndpoints: 1,
    acceptedOnlySourceEndpoints: 0,
    legacyOnlySourceEndpoints: 0
  });
  assert.equal(topology.derived.components, 1);
  assert.equal(topology.derived.edges.length, 4);
  assert.deepEqual(topology.attachments[0], {
    nodeId: "D5",
    sourcePipeId: "S1",
    connectionType: "endpoint-to-line",
    snapDistance: topology.attachments[0].snapDistance,
    derived: true,
    targetPipeId: "M1",
    sourcePipeIndex: 1,
    targetPipeIndex: 0
  });
  assert.ok(topology.attachments[0].snapDistance < 0.25);
});

test("interior crossings remain disconnected and are marked review_required", () => {
  const layers = [{
    name: "area/pipe",
    kind: "pipe",
    geojson: { features: [
      line("H", [[120, 22], [120.001, 22]]),
      line("V", [[120.0005, 21.9995], [120.0005, 22.0005]])
    ] }
  }];
  const topology = buildHydraulicTopology(layers);

  assert.equal(topology.derived.components, 2);
  assert.equal(topology.reviewRequiredConnections, 1);
  assert.equal(topology.unresolvedCrossings[0].status, "review_required");
  assert.equal(topology.unresolvedCrossings[0].connectionType, "pipe-crossing");
});

test("legacy endpoint screen remains distinct from accepted service-to-main attachments", () => {
  const layers = [
    { name: "area/pipe", kind: "pipe", geojson: { features: [line("M1", [[120, 22], [120.001, 22]])] } },
    { name: "area/eupipe", kind: "pipe", geojson: { features: [
      line("S1", [[120.0005, 22.000001], [120.0005, 22.0002]]),
      line("S2", [[120.000501, 22.0001], [120.0007, 22.0001]])
    ] } }
  ];
  const topology = buildHydraulicTopology(layers);
  const audit = topology.diagnostics.connectionAudit;

  assert.equal(audit.acceptedEndpointToLine.count, 1);
  assert.equal(audit.legacyEndpointToLineScreen.byType["service-service"], 1);
  assert.equal(audit.reconciliation.legacyOnlySourceEndpoints, 1);
});

test("disjoint MultiLineString parts remain separate hydraulic components", () => {
  const feature = multiline("M1", [
    [[120, 22], [120.001, 22]],
    [[121, 23], [121.001, 23]]
  ]);
  const topology = buildHydraulicTopology([{ name: "area/pipe", kind: "pipe", geojson: { features: [feature] } }]);

  assert.equal(topology.source.edges.length, 2);
  assert.equal(topology.source.components, 2);
  assert.equal(topology.derived.components, 2);
  assert.ok(topology.derived.edges.every(edge => edge.length < 200));
  assert.deepEqual(topology.pipeCatalog.map(pipe => pipe.sourcePartIndex), [0, 1]);
});