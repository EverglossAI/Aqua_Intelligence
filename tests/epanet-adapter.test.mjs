import test from "node:test";
import assert from "node:assert/strict";
import { runInp } from "../cockpit/epanet-adapter.js";

test("EPANET adapter exposes LPS flow and demand units", async () => {
  const result = await runInp(`[JUNCTIONS]
J1 0 2
[RESERVOIRS]
R1 50
[PIPES]
P1 R1 J1 100 100 120 0 Open
[OPTIONS]
UNITS LPS
HEADLOSS H-W
[END]
`);

  assert.equal(result.units.flow, "L/s");
  assert.ok(Math.abs(result.nodes.find(node => node.id === "J1").demand - 2) < 1e-6);
  assert.ok(Math.abs(Math.abs(result.links[0].flow) - 2) < 1e-6);
});