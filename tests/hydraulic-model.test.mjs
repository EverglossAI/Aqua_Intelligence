import test from "node:test";
import assert from "node:assert/strict";
import { buildHydraulicTopology } from "../cockpit/topology-core.js";
import { buildHydraulicModel } from "../cockpit/hydraulic-model.js";

function line(id, coordinates, properties = {}) {
  return { type: "Feature", properties: { id, ...properties }, geometry: { type: "LineString", coordinates } };
}

function polygon(id, coordinates) {
  return { type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [coordinates] } };
}

function fixture() {
  const project = {
    id: "fixture",
    cloudRevision: 7,
    layers: [
      { name: "area/pipe", kind: "pipe", geojson: { features: [line("M1", [[120, 22], [120.001, 22]], { pipe_size: 150, pipe_mtr: "DIP" })] } },
      { name: "area/eupipe", kind: "pipe", geojson: { features: [line("S1", [[120.0005, 22.000001], [120.0005, 22.0002]], { pipe_mtr: "PVC" })] } }
    ],
    telemetry: [{
      id: "FM-1", type: "flow", lat: 22, lng: 120,
      source: "Synthetic/demo", readings: [{ flow: 3 }, { flow: 5 }]
    }]
  };
  return { project, topology: buildHydraulicTopology(project.layers) };
}

test("hydraulic model builder emits deterministic EPANET input and visible assumptions", () => {
  const { project, topology } = fixture();
  const options = { scenarioId: "base", timestamp: "2026-09-25T00:00:00.000Z" };
  const first = buildHydraulicModel(project, topology, options);
  const second = buildHydraulicModel(project, topology, options);

  assert.equal(first.inp, second.inp);
  assert.match(first.inp, /\[JUNCTIONS\]/);
  assert.match(first.inp, /\[PIPES\]/);
  assert.equal(first.scenario.inputRevision, 7);
  assert.equal(first.scenario.solverVersion, "epanet-js@0.9.0 / OWA EPANET WASM");
  assert.equal(first.assumptions.elevationSource, "demo_flat_datum");
  assert.equal(first.provenance.demand, "Synthetic/demo");
  assert.equal(first.statistics.baseSyntheticInletFlowLps, 4);
  assert.equal(first.statistics.scenarioDemandLps, 4);
  assert.equal(first.nodes.filter(node => node.demand > 0).reduce((sum, node) => sum + node.demand, 0), 4);
  assert.ok(first.pipes.some(pipe => pipe.diameterSource === "GIS" && pipe.roughness === 130));
  assert.ok(first.pipes.some(pipe => pipe.diameterSource === "audit_fallback" && pipe.roughness === 145));
});

test("minimum-night-flow scenario derives its multiplier from labelled synthetic inlet telemetry", () => {
  const { project, topology } = fixture();
  const model = buildHydraulicModel(project, topology, { scenarioId: "mnf", timestamp: "2026-09-25T00:00:00.000Z" });

  assert.equal(model.scenario.name, "Minimum night flow");
  assert.equal(model.scenario.assumptions.demandMultiplier, 0.75);
  assert.equal(model.statistics.scenarioDemandLps, 3);
});

test("logical DMA boundaries allocate each inlet target to service demand nodes", () => {
  const dmaFeatures = [
    polygon("DMA-1", [[119.999, 21.999], [120.002, 21.999], [120.002, 22.002], [119.999, 22.002], [119.999, 21.999]]),
    polygon("DMA-2", [[120.009, 21.999], [120.012, 21.999], [120.012, 22.002], [120.009, 22.002], [120.009, 21.999]])
  ];
  const project = {
    id: "two-dma",
    layers: [
      { name: "area/pipe", kind: "pipe", geojson: { features: [
        line("M1", [[120, 22], [120.001, 22]], { pipe_size: 150 }),
        line("M2", [[120.01, 22], [120.011, 22]], { pipe_size: 150 })
      ] } },
      { name: "area/eupipe", kind: "pipe", geojson: { features: [
        line("S1", [[120.0005, 22.000001], [120.0005, 22.0002]], { pipe_size: 20 }),
        line("S2", [[120.0105, 22.000001], [120.0105, 22.0002]], { pipe_size: 20 })
      ] } },
      { name: "area/dma", kind: "dma", geojson: { features: dmaFeatures } }
    ],
    logicalDmas: [
      { logical_dma_uid: "logical-1", dma_code: "DMA-1", label: "North" },
      { logical_dma_uid: "logical-2", dma_code: "DMA-2", label: "South" }
    ],
    dmaFeatureMappings: [
      { logicalDmaId: "logical-1", dmaCode: "DMA-1", sourceLayer: "area/dma", featureIndex: 0 },
      { logicalDmaId: "logical-2", dmaCode: "DMA-2", sourceLayer: "area/dma", featureIndex: 1 }
    ],
    telemetry: [
      { id: "FM-1", type: "flow", dmaCode: "DMA-1", lat: 22, lng: 120, readings: [{ flow: 4 }] },
      { id: "FM-2", type: "flow", dmaCode: "DMA-2", lat: 22, lng: 120.01, readings: [{ flow: 2 }] }
    ]
  };
  const topology = buildHydraulicTopology(project.layers);
  const model = buildHydraulicModel(project, topology, { scenarioId: "base", timestamp: "2026-09-25T00:00:00.000Z" });
  const demandByDma = Object.fromEntries(model.statistics.demandByDma.map(row => [row.dmaCode, row]));

  assert.equal(model.nodes.filter(node => node.type === "reservoir").length, 2);
  assert.equal(model.boundaries.length, 2);
  assert.equal(demandByDma["DMA-1"].targetLps, 4);
  assert.equal(demandByDma["DMA-1"].modelDemandLps, 4);
  assert.equal(demandByDma["DMA-2"].targetLps, 2);
  assert.equal(demandByDma["DMA-2"].modelDemandLps, 2);
  assert.ok(model.nodes.some(node => node.demandDmaCode === "DMA-1" && node.demand > 0));
  assert.ok(model.nodes.some(node => node.demandDmaCode === "DMA-2" && node.demand > 0));
  const scoped = buildHydraulicModel(project, topology, { scenarioId: "base", dmaCodes: ["DMA-2"], timestamp: "2026-09-25T00:00:00.000Z" });
  assert.equal(scoped.boundaries.length, 1);
  assert.equal(scoped.statistics.scenarioDemandLps, 2);
  assert.equal(scoped.statistics.demandByDma[0].dmaCode, "DMA-2");
});

test("suspicious service diameters are audited without changing source GIS", () => {
  const { project, topology } = fixture();
  project.layers[1].geojson.features[0].properties.pipe_size = 5;
  topology.pipeCatalog.find(pipe => pipe.sourcePipeId === "S1").properties.pipe_size = 5;
  const model = buildHydraulicModel(project, topology, { timestamp: "2026-09-25T00:00:00.000Z", fallbackServiceDiameterMm: 20 });
  const servicePipe = model.pipes.find(pipe => pipe.sourcePipeId === "S1");

  assert.equal(servicePipe.rawDiameter, 5);
  assert.equal(servicePipe.sourceDiameter, 5);
  assert.equal(servicePipe.diameter, 20);
  assert.equal(servicePipe.modelDiameter, 20);
  assert.equal(servicePipe.diameterSource, "audit_fallback");
  assert.equal(servicePipe.substitutionReason, "below_modeling_minimum");
  assert.equal(servicePipe.diameterConfidence, "low");
  assert.equal(servicePipe.service, true);
  assert.equal(model.statistics.diameterAudit.suspicious, 1);
  assert.equal(model.statistics.diameterAudit.rows[0].sourcePipeId, "S1");
  assert.equal(model.statistics.diameterAudit.rows[0].sourceDiameter, 5);
  assert.equal(model.statistics.diameterAudit.rows[0].modelDiameter, 20);
  assert.equal(model.statistics.diameterAudit.rows[0].substitutionReason, "below_modeling_minimum");
  assert.equal(model.statistics.diameterAudit.rows[0].confidence, "low");
  assert.equal(project.layers[1].geojson.features[0].properties.pipe_size, 5);
});

test("distribution-main variant retains DMA demand at service connection nodes", () => {
  const { project, topology } = fixture();
  const full = buildHydraulicModel(project, topology, { timestamp: "2026-09-25T00:00:00.000Z", modelVariant: "full-network" });
  const distribution = buildHydraulicModel(project, topology, { timestamp: "2026-09-25T00:00:00.000Z", modelVariant: "distribution-main" });

  assert.equal(full.statistics.modelVariant, "full-network");
  assert.equal(distribution.statistics.modelVariant, "distribution-main");
  assert.ok(distribution.pipes.filter(pipe => !pipe.boundary).length < full.pipes.filter(pipe => !pipe.boundary).length);
  assert.equal(distribution.statistics.scenarioDemandLps, full.statistics.scenarioDemandLps);
  assert.equal(distribution.statistics.demandByDma[0].modelDemandLps, full.statistics.demandByDma[0].modelDemandLps);
  assert.ok(distribution.nodes.some(node => node.demand > 0 && node.demandRepresentation === "service_connection_on_distribution_main"));
});

test("DEM terrain never substitutes for explicit hydraulic node elevations", () => {
  const { project, topology } = fixture();
  project.dem = { real: true, source: "terrain-dem", points: [{ lat: 22, lng: 120, elevation: 99 }] };
  const terrainOnly = buildHydraulicModel(project, topology, { timestamp: "2026-09-25T00:00:00.000Z" });
  const topologyNodeId = terrainOnly.nodes.find(node => node.type === "junction").topologyNodeId;
  project.hydraulicNodeElevations = { [topologyNodeId]: 12.5 };
  const withHydraulicElevation = buildHydraulicModel(project, topology, { timestamp: "2026-09-25T00:00:00.000Z" });
  const explicitNode = withHydraulicElevation.nodes.find(node => node.topologyNodeId === topologyNodeId);

  assert.equal(terrainOnly.provenance.terrain, "separate_context_only");
  assert.ok(terrainOnly.nodes.filter(node => node.type === "junction").every(node => node.elevation !== 99));
  assert.equal(explicitNode.elevation, 12.5);
  assert.equal(explicitNode.elevationSource, "hydraulic_node_elevation");
});