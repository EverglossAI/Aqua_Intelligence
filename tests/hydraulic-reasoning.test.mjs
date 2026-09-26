import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHydraulicReasoning, compareHydraulicVariants, reasoningFacts } from "../cockpit/hydraulic-reasoning.js";

function fixture(overrides = {}) {
  const model = {
    scenario: { modelVariant: "full-network" },
    assumptions: {
      sourceHeadMetres: 55,
      sourceHeadSource: "measured",
      elevationSource: "surveyed",
      roughnessSource: "calibrated"
    },
    provenance: { demand: "metered" },
    statistics: {
      derivedTopologyComponents: 1,
      modeledComponents: 1,
      excludedComponents: 0,
      demandNodes: 2,
      demandByDma: [{ dmaCode: "DMA-1", label: "Danan", targetLps: 4, modelDemandLps: 4, demandNodes: 2, inletMeters: ["FM-1"] }],
      diameterAudit: { suspicious: 0, rows: [] },
      roughnessAssumedByMaterial: 0
    },
    reviewRequired: { connections: 0 },
    boundaries: [{ nodeId: "B1", linkId: "BV1", dmaCode: "DMA-1", meterIds: ["FM-1"], headMetres: 55 }],
    nodes: [
      { id: "B1", type: "reservoir", head: 55, elevation: null, dmaCode: "DMA-1" },
      { id: "J1", type: "junction", elevation: 10, demand: 2, demandDmaCode: "DMA-1" },
      { id: "J2", type: "junction", elevation: 12, demand: 2, demandDmaCode: "DMA-1" }
    ],
    pipes: [
      { id: "BV1", from: "B1", to: "J1", boundary: true, length: 0.1, diameter: 300 },
      { id: "P1", sourcePipeId: "MAIN-1", from: "J1", to: "J2", service: false, length: 100, sourceDiameter: 150, modelDiameter: 150, diameter: 150, diameterSource: "GIS" }
    ]
  };
  const result = {
    nodes: [
      { id: "B1", pressure: 0, head: 55, demand: -4 },
      { id: "J1", pressure: 35, head: 45, demand: 2 },
      { id: "J2", pressure: 30, head: 42, demand: 2 }
    ],
    links: [
      { id: "BV1", flow: 4, velocity: 0.05, headloss: 0 },
      { id: "P1", flow: 4, velocity: 0.3, headloss: 1 }
    ]
  };
  const diagnostics = {
    solver: { completed: true },
    sourceBoundaries: [{ id: "B1", linkId: "BV1", dmaCode: "DMA-1", meterIds: ["FM-1"], targetFlowLps: 4, solvedFlowLps: 4, differenceLps: 0 }],
    demand: { requestedLps: 4, solvedLps: 4, differenceLps: 0, byDma: [{ dmaCode: "DMA-1", label: "Danan", targetLps: 4, modelDemandLps: 4, solvedDemandLps: 4, demandNodes: 2 }] },
    loggerComparison: { rows: [{ logger: "PL-1", dmaCode: "DMA-1", observed: 31, simulated: 30, residual: -1, modelNode: "J2", snapDistanceMetres: 2 }], mae: 1, rmse: 1, bias: -1, maximumAbsoluteResidual: 1 },
    network: { checks: { negativePressureCount: 0, excessiveVelocityCount: 0, extremeHeadlossCount: 0 } }
  };
  return {
    project: { logicalDmas: [{ dma_code: "DMA-1", label: "Danan" }] },
    topology: { reviewRequiredConnections: 0 },
    model: { ...model, ...(overrides.model || {}), assumptions: { ...model.assumptions, ...(overrides.assumptions || {}) }, statistics: { ...model.statistics, ...(overrides.statistics || {}) } },
    result: { ...result, ...(overrides.result || {}) },
    diagnostics: { ...diagnostics, ...(overrides.diagnostics || {}) }
  };
}

function issue(output, code) {
  return output.diagnostics.find(item => item.code === code);
}

function cause(diagnostic, code) {
  return diagnostic.likelyCauses.find(item => item.code === code);
}

test("model-quality gate exposes current Lambay-style limitations", () => {
  const input = fixture({
    assumptions: { sourceHeadSource: "demo_assumption", elevationSource: "demo_flat_datum", roughnessSource: "assumed_by_material" },
    statistics: { derivedTopologyComponents: 1061, modeledComponents: 3, excludedComponents: 1058, roughnessAssumedByMaterial: 1749, diameterAudit: { suspicious: 1297, rows: [] } },
    topology: { reviewRequiredConnections: 87 },
    diagnostics: { loggerComparison: { rows: [], mae: 20.05, rmse: 20.53, bias: 20.05, maximumAbsoluteResidual: 27.56 } }
  });
  input.topology.reviewRequiredConnections = 87;
  const output = analyzeHydraulicReasoning(input);
  assert.equal(output.modelQuality.status, "PRELIMINARY");
  assert.ok(output.modelQuality.limitations.some(value => value.includes("Flat assumed node elevations")));
  assert.ok(output.modelQuality.limitations.some(value => value.includes("55 m assumed source heads")));
  assert.ok(output.modelQuality.limitations.some(value => value.includes("87 unresolved")));
  assert.ok(output.modelQuality.limitations.some(value => value.includes("Logger MAE 20.05 m")));
});

test("low pressure can support high elevation without claiming friction loss", () => {
  const input = fixture();
  input.model.nodes[2].elevation = 48;
  input.result.nodes[2] = { id: "J2", pressure: 7, head: 55, demand: 2 };
  const diagnostic = issue(analyzeHydraulicReasoning(input), "LOW_PRESSURE");
  assert.equal(cause(diagnostic, "HIGH_ELEVATION").assessment, "supported");
  assert.equal(cause(diagnostic, "EXCESSIVE_FRICTION_LOSS").assessment, "unsupported");
});

test("low pressure can support excessive headloss", () => {
  const input = fixture();
  input.result.nodes[2] = { id: "J2", pressure: 8, head: 20, demand: 2 };
  input.result.links[1].headloss = 20;
  const diagnostic = issue(analyzeHydraulicReasoning(input), "LOW_PRESSURE");
  assert.equal(cause(diagnostic, "EXCESSIVE_FRICTION_LOSS").assessment, "supported");
});

test("inadequate source head is identified from measured head and elevation", () => {
  const input = fixture({ assumptions: { sourceHeadMetres: 20 } });
  input.model.boundaries[0].headMetres = 20;
  input.model.nodes[0].head = 20;
  assert.ok(issue(analyzeHydraulicReasoning(input), "INADEQUATE_SOURCE_HEAD"));
});

test("suspicious substituted diameter prevents a bottleneck conclusion", () => {
  const input = fixture({ statistics: { diameterAudit: { suspicious: 1, rows: [{ sourcePipeId: "MAIN-1", sourceDiameter: 0, modelDiameter: 100, substitutionReason: "non_positive", confidence: "low", modeled: true }] } } });
  input.model.pipes[1] = { ...input.model.pipes[1], sourceDiameter: 0, modelDiameter: 100, diameter: 100, diameterSource: "audit_fallback", substitutionReason: "non_positive", diameterConfidence: "low" };
  input.result.links[1].headloss = 2;
  const diagnostic = issue(analyzeHydraulicReasoning(input), "UNDERSIZED_PIPE_INDICATION");
  assert.equal(diagnostic.confidence, "LOW");
  assert.equal(diagnostic.evidenceClassification, "suspect-input artefact");
});

test("disconnected and uncertain topology block strong diagnosis", () => {
  const input = fixture({ statistics: { derivedTopologyComponents: 4, modeledComponents: 1, excludedComponents: 3 } });
  input.topology.reviewRequiredConnections = 2;
  const output = analyzeHydraulicReasoning(input);
  assert.ok(issue(output, "DISCONNECTED_NETWORK"));
  assert.ok(issue(output, "MODEL_TOPOLOGY_UNCERTAINTY"));
  assert.equal(output.modelQuality.status, "PRELIMINARY");
});

test("large logger residual is treated as model mismatch, not a network anomaly", () => {
  const input = fixture({ assumptions: { sourceHeadSource: "demo_assumption", elevationSource: "demo_flat_datum" }, diagnostics: { loggerComparison: { rows: [{ logger: "PL-1", dmaCode: "DMA-1", observed: 31.8, simulated: 52.1, residual: 20.3, modelNode: "J2", snapDistanceMetres: 2 }], mae: 20.3, rmse: 20.3, bias: 20.3, maximumAbsoluteResidual: 20.3 } } });
  const diagnostic = issue(analyzeHydraulicReasoning(input), "LOGGER_MODEL_MISMATCH");
  assert.equal(diagnostic.networkConclusion, "not currently reliable");
  assert.equal(cause(diagnostic, "ASSUMED_ELEVATION").assessment, "possible");
  assert.equal(cause(diagnostic, "ASSUMED_SOURCE_HEAD").assessment, "possible");
});

test("flat elevation prevents assigning the cause of low pressure", () => {
  const input = fixture({ assumptions: { elevationSource: "demo_flat_datum" } });
  input.result.nodes[2].pressure = 8;
  const output = analyzeHydraulicReasoning(input);
  const diagnostic = issue(output, "LOW_PRESSURE");
  assert.equal(cause(diagnostic, "HIGH_ELEVATION").assessment, "cannot evaluate");
  assert.notEqual(diagnostic.confidence, "HIGH");
  assert.ok(reasoningFacts(output, "Danan", { diagnosticFocus: "LOW_PRESSURE" }).some(fact => fact.includes("cannot evaluate")));
});

test("variant comparison separates service artefacts from genuine main candidates", () => {
  const full = fixture();
  full.model.pipes.push({ id: "P2", sourcePipeId: "SERVICE-1", from: "J1", to: "J2", service: true, length: 10, sourceDiameter: 20, modelDiameter: 20, diameter: 20, diameterSource: "GIS" });
  full.result.links.push({ id: "P2", flow: 1, velocity: 0.5, headloss: 0.2 });
  full.result.links[1].headloss = 2;
  const distribution = fixture();
  const comparison = compareHydraulicVariants(full, distribution);
  assert.equal(comparison.outliers.find(item => item.assetId === "SERVICE-1").classification, "service-line artefact");
  assert.equal(comparison.outliers.find(item => item.assetId === "MAIN-1").classification, "genuine-network candidate");
});

test("reasoning output is deterministic", () => {
  const input = fixture();
  const output = analyzeHydraulicReasoning(input);
  const before = structuredClone(output.diagnostics);
  assert.deepEqual(output, analyzeHydraulicReasoning(input));
  reasoningFacts(output, "Danan", { diagnosticFocus: "LOW_PRESSURE" });
  assert.deepEqual(output.diagnostics, before);
});