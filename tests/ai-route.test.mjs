import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { routeAiRequest } from "../worker/routes/ai.js";

const catalog = {
  dmas: [{ id: "dma-2", code: "1350-00-01-02", label: "Danan" }],
  assets: [{ id: "FM-02-IN", type: "flow" }, { id: "PL-02-DIST", type: "pressure" }],
  alerts: []
};

test("AI route returns a read-only deterministic tool plan and structured log", async () => {
  const records = [];
  const original = console.log;
  console.log = message => records.push(JSON.parse(message));
  try {
    const response = await routeAiRequest(new Request("http://local/api/ai/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "run hydraulic analysis for Danan", catalog, context: { projectId: "lambay-island" } })
    }), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.plan.tool.name, "EPANET_RUN");
    assert.equal(body.plan.tool.readOnly, true);
    assert.deepEqual(Object.keys(records[0]).sort(), ["event", "modelExplanation", "resolvedEntities", "resolvedIntent", "resultId", "toolCalled", "userCommand"].sort());
    assert.ok(!Object.hasOwn(records[0], "reasoning"));
  } finally {
    console.log = original;
  }
});

test("AI summary route accepts only deterministic result facts", async () => {
  const response = await routeAiRequest(new Request("http://local/api/ai/summarize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolResult: { resultId: "hyd-1", calculator: "EPANET", facts: ["Negative pressures: 0"] } })
  }), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.summary.factCount, 1);
  assert.ok(!Object.hasOwn(body.summary, "facts"));
  assert.equal(body.summary.provenance.calculatedBy, "EPANET");
});

test("Worker dispatches AI routes before static fallback", async () => {
  let staticCalls = 0;
  const env = { ASSETS: { fetch: async () => { staticCalls++; return new Response("static"); } } };
  const response = await worker.fetch(new Request("http://local/api/ai/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "show high risk pipes in Danan", catalog })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(staticCalls, 0);
});