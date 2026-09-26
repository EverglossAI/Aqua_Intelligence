import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHydraulicRun, loggerComparison } from "../cockpit/hydraulic-diagnostics.js";

const project = {
  telemetry: [
    { id: "PL-1", type: "pressure", dmaCode: "DMA-1", lat: 22, lng: 120.001, readings: [{ pressure: 30 }, { pressure: 34 }] },
    { id: "FM-1", type: "flow", dmaCode: "DMA-1", readings: [{ flow: 4 }] },
    { id: "FM-2", type: "flow", dmaCode: "DMA-2", readings: [{ flow: 2 }] }
  ],
  logicalDmas: [{ dma_code: "DMA-1", label: "North", flow_summary: { meter_id: "FM-1", mean_lps: 4 } }],
  dmaFeatureMappings: [],
  layers: []
};

const model = {
  assumptions: { sourceHeadMetres: 55, sourceHeadSource: "demo_assumption", elevationMetres: 0, elevationSource: "demo_flat_datum" },
  statistics: { excludedComponents: 3 },
  nodes: [
    { id: "R1", topologyNodeId: "N1", type: "reservoir", coord: [22, 120], elevation: 0, head: 55, demand: 0 },
    { id: "J2", topologyNodeId: "N2", type: "junction", coord: [22, 120.001], elevation: 0, head: null, demand: 4 }
  ],
  pipes: [{ id: "P1", from: "R1", to: "J2", length: 100, diameter: 100 }]
};

const result = {
  solverVersion: "test-solver",
  nodes: [{ id: "R1", pressure: 0, head: 55, demand: -4 }, { id: "J2", pressure: -5, head: -5, demand: 4 }],
  links: [{ id: "P1", velocity: 4, headloss: 12, flow: 4 }]
};

test("logger comparison reports DMA and complete residual statistics", () => {
  const comparison = loggerComparison(project, model, result);
  assert.equal(comparison.rows.length, 1);
  assert.equal(comparison.rows[0].dmaCode, "DMA-1");
  assert.equal(comparison.rows[0].residual, -37);
  assert.equal(comparison.mae, 37);
  assert.equal(comparison.rmse, 37);
  assert.equal(comparison.bias, -37);
  assert.equal(comparison.maximumAbsoluteResidual, 37);
});

test("sanity gate separates solver completion from engineering usability", () => {
  const diagnostics = analyzeHydraulicRun(project, { reviewRequiredConnections: 2 }, model, result);
  assert.equal(diagnostics.solver.completed, true);
  assert.equal(diagnostics.engineeringGate.status, "requires_review");
  assert.equal(diagnostics.engineeringGate.usable, false);
  assert.ok(diagnostics.engineeringGate.flags.some(flag => flag.code === "negative_pressure"));
  assert.ok(diagnostics.engineeringGate.flags.some(flag => flag.code === "combined_inlets_single_source"));
  assert.equal(diagnostics.worstPressureNodes[0].id, "J2");
});

test("multi-boundary diagnostics reconcile solved demand by DMA", () => {
  const correctedModel = {
    assumptions: model.assumptions,
    statistics: {
      excludedComponents: 1,
      demandByDma: [
        { dmaCode: "DMA-1", label: "North", targetLps: 4, modelDemandLps: 4, demandNodes: 1, inletMeters: ["FM-1"] },
        { dmaCode: "DMA-2", label: "South", targetLps: 2, modelDemandLps: 2, demandNodes: 1, inletMeters: ["FM-2"] }
      ]
    },
    nodes: [
      { id: "B1", type: "reservoir", coord: [22, 120], elevation: null, head: 55, demand: 0 },
      { id: "B2", type: "reservoir", coord: [22, 120.01], elevation: null, head: 55, demand: 0 },
      { id: "J1", topologyNodeId: "N1", type: "junction", coord: [22, 120.001], elevation: 0, demand: 4, demandDmaCode: "DMA-1", demandAllocations: { "DMA-1": 4 } },
      { id: "J2", topologyNodeId: "N2", type: "junction", coord: [22, 120.011], elevation: 0, demand: 2, demandDmaCode: "DMA-2", demandAllocations: { "DMA-2": 2 } }
    ],
    pipes: [
      { id: "P1", from: "B1", to: "J1", length: 100, diameter: 100 },
      { id: "P2", from: "B2", to: "J2", length: 100, diameter: 100 }
    ]
  };
  const correctedResult = {
    solverVersion: "test-solver",
    nodes: [
      { id: "B1", pressure: 0, head: 55, demand: -4 },
      { id: "B2", pressure: 0, head: 55, demand: -2 },
      { id: "J1", pressure: 30, head: 30, demand: 4 },
      { id: "J2", pressure: 28, head: 28, demand: 2 }
    ],
    links: [
      { id: "P1", velocity: 0.5, headloss: 1, flow: 4 },
      { id: "P2", velocity: 0.4, headloss: 1, flow: 2 }
    ]
  };
  const diagnostics = analyzeHydraulicRun(project, { reviewRequiredConnections: 0 }, correctedModel, correctedResult, { rows: [], mae: null, rmse: null, bias: null, maximumAbsoluteResidual: null });

  assert.ok(!diagnostics.engineeringGate.flags.some(flag => flag.code === "combined_inlets_single_source"));
  assert.equal(diagnostics.demand.byDma[0].solvedDemandLps, 4);
  assert.equal(diagnostics.demand.byDma[0].differenceLps, 0);
  assert.equal(diagnostics.demand.byDma[1].solvedDemandLps, 2);
  assert.equal(diagnostics.worstPressureNodes.find(node => node.id === "J2").distanceFromSourceMetres, 100);

  const scopedDiagnostics = analyzeHydraulicRun(project, { reviewRequiredConnections: 0 }, {
    ...correctedModel,
    statistics: { ...correctedModel.statistics, demandByDma: correctedModel.statistics.demandByDma.slice(0, 1) },
    nodes: correctedModel.nodes.filter(node => ["B1", "J1"].includes(node.id)),
    pipes: correctedModel.pipes.slice(0, 1)
  }, {
    ...correctedResult,
    nodes: correctedResult.nodes.filter(node => ["B1", "J1"].includes(node.id)),
    links: correctedResult.links.slice(0, 1)
  }, { rows: [], mae: null, rmse: null, bias: null, maximumAbsoluteResidual: null });
  assert.ok(!scopedDiagnostics.engineeringGate.flags.some(flag => flag.code === "combined_inlets_single_source"));
});