import test from "node:test";
import assert from "node:assert/strict";
import { interpretCommand, summarizeToolResult } from "../worker/lib/ai-intents.js";

const catalog = {
  dmas: [
    { id: "dma-1", code: "1350-00-01-01", label: "Baisha" },
    { id: "dma-2", code: "1350-00-01-02", label: "Danan" }
  ],
  assets: [
    { id: "FM-02-IN", type: "flow", dmaCode: "1350-00-01-02" },
    { id: "PL-02-DIST", type: "pressure", dmaCode: "1350-00-01-02" }
  ],
  alerts: [{ id: "206053", type: "acoustic", dmaCode: "1350-00-01-02" }]
};

test("high-risk request resolves DMA and routes to Leak Risk", () => {
  const plan = interpretCommand("show high risk pipes in Danan", { catalog });
  assert.equal(plan.status, "ready");
  assert.equal(plan.intent, "SHOW_LEAK_RISK");
  assert.equal(plan.entities.dma.code, "1350-00-01-02");
  assert.equal(plan.tool.name, "LEAK_RISK_SHOW");
  assert.equal(plan.provenance.interpretedBy, "AI");
  assert.equal(plan.provenance.calculatedBy, "Leak Risk");
});

test("comparison resolves both source IDs and routes to Compare", () => {
  const plan = interpretCommand("compare FM-02-IN and PL-02-DIST", { catalog });
  assert.equal(plan.intent, "COMPARE_SOURCES");
  assert.deepEqual(plan.entities.assets.map(asset => asset.id), ["FM-02-IN", "PL-02-DIST"]);
  assert.equal(plan.tool.name, "COMPARE_SOURCES");
  assert.equal(plan.provenance.calculatedBy, "Compare");
});

test("network filter retains only criteria stated by the user", () => {
  const plan = interpretCommand("filter 150 mm PVC pipes in Danan", { catalog });
  assert.equal(plan.intent, "FILTER_NETWORK");
  assert.equal(plan.tool.arguments.material, "PVC");
  assert.equal(plan.tool.arguments.diameterMm, 150);
  assert.equal(plan.tool.arguments.dmaCode, "1350-00-01-02");
});

test("environmental request resolves an alert without inventing weather", () => {
  const plan = interpretCommand("show rainfall before alert 206053", { catalog });
  assert.equal(plan.intent, "SHOW_ENVIRONMENTAL_CONTEXT");
  assert.equal(plan.entities.alert.id, "206053");
  assert.equal(plan.tool.name, "ENVIRONMENTAL_CONTEXT_SHOW");
  assert.equal(plan.tool.arguments.temporalRelation, "before");
  assert.ok(!JSON.stringify(plan).includes("mm"));
});

test("hydraulic request routes to EPANET and does not contain results", () => {
  const plan = interpretCommand("run hydraulic analysis for Danan", { catalog });
  assert.equal(plan.intent, "RUN_HYDRAULIC_ANALYSIS");
  assert.equal(plan.tool.name, "EPANET_RUN");
  assert.equal(plan.provenance.calculatedBy, "EPANET");
  assert.equal(plan.result, undefined);
});

test("hydraulic diagnosis questions route to deterministic diagnostics", () => {
  const lowPressure = interpretCommand("Why is pressure low in Danan?", { catalog });
  assert.equal(lowPressure.intent, "DIAGNOSE_HYDRAULICS");
  assert.equal(lowPressure.tool.name, "HYDRAULIC_DIAGNOSTICS");
  assert.equal(lowPressure.tool.arguments.diagnosticFocus, "LOW_PRESSURE");
  assert.equal(lowPressure.tool.arguments.dmaCode, "1350-00-01-02");
  assert.equal(lowPressure.provenance.calculatedBy, "Hydraulic Reasoning Engine v1");

  const pipe = interpretCommand("Is this pipe too small?", { catalog, context: { selectedAssetId: "PIPE-7", dmaCode: "1350-00-01-02" } });
  assert.equal(pipe.tool.arguments.diagnosticFocus, "UNDERSIZED_PIPE_INDICATION");
  assert.deepEqual(pipe.tool.arguments.assetIds, ["PIPE-7"]);

  const logger = interpretCommand("Why doesn't the model match PL-02-DIST?", { catalog });
  assert.equal(logger.tool.arguments.diagnosticFocus, "LOGGER_MODEL_MISMATCH");
  assert.deepEqual(logger.tool.arguments.assetIds, ["PL-02-DIST"]);
});

test("unknown and ambiguous entities produce clarification", () => {
  const unknown = interpretCommand("compare FM-99 and PL-02-DIST", { catalog });
  assert.equal(unknown.status, "clarification_required");
  assert.match(unknown.clarification.question, /FM-99/);

  const ambiguous = interpretCommand("show assets in Central", { catalog: { ...catalog, dmas: [
    { id: "dma-a", code: "A", label: "Central" },
    { id: "dma-b", code: "B", label: "Central" }
  ] } });
  assert.equal(ambiguous.status, "clarification_required");
  assert.equal(ambiguous.clarification.candidates.length, 2);
  assert.equal(interpretCommand("run hydraulic analysis for Atlantis", { catalog }).status, "clarification_required");
});

test("mutation and roughness calibration commands are refused", () => {
  assert.equal(interpretCommand("delete pipe P-1", { catalog }).status, "refused");
  assert.equal(interpretCommand("calibrate roughness for Danan", { catalog }).status, "refused");
  assert.equal(interpretCommand("increase pipe diameter to 150 mm", { catalog }).status, "refused");
  assert.equal(interpretCommand("open valve V-01", { catalog }).status, "refused");
});

test("summaries contain only supplied deterministic facts and provenance", () => {
  const summary = summarizeToolResult({
    intent: "RUN_HYDRAULIC_ANALYSIS",
    resultId: "hyd-123",
    calculator: "EPANET",
    facts: ["Pressure range: 12.1 to 44.8 m", "Negative pressures: 0"]
  });
  assert.equal(summary.resultId, "hyd-123");
  assert.equal(summary.provenance.calculatedBy, "EPANET");
  assert.equal(summary.factCount, 2);
  assert.ok(!Object.hasOwn(summary, "facts"));
  assert.ok(!Object.hasOwn(summary, "reasoning"));
});