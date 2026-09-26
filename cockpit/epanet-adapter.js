const SOLVER_VERSION = "epanet-js@0.9.0 / OWA EPANET WASM";
let toolkitPromise = null;

async function toolkit() {
  toolkitPromise ||= import("./vendor/epanet-js/index.mjs");
  return toolkitPromise;
}

export async function runInp(inp, options = {}) {
  if (!String(inp || "").trim()) throw new Error("EPANET input is empty");
  const E = await toolkit();
  const workspace = new E.Workspace();
  await workspace.loadModule();
  const project = new E.Project(workspace);
  const filename = options.filename || "aqua.inp";
  workspace.writeFile(filename, new TextEncoder().encode(inp));
  project.open(filename, "aqua.rpt", "aqua.bin");
  try {
    project.solveH();
    const nodeCount = project.getCount(E.CountType.NodeCount);
    const linkCount = project.getCount(E.CountType.LinkCount);
    const nodes = [];
    const links = [];
    for (let index = 1; index <= nodeCount; index++) {
      nodes.push({
        id: project.getNodeId(index),
        pressure: project.getNodeValue(index, E.NodeProperty.Pressure),
        head: project.getNodeValue(index, E.NodeProperty.Head),
        demand: project.getNodeValue(index, E.NodeProperty.Demand)
      });
    }
    for (let index = 1; index <= linkCount; index++) {
      const flow = project.getLinkValue(index, E.LinkProperty.Flow);
      links.push({
        id: project.getLinkId(index),
        flow,
        velocity: project.getLinkValue(index, E.LinkProperty.Velocity),
        headloss: project.getLinkValue(index, E.LinkProperty.Headloss),
        status: project.getLinkValue(index, E.LinkProperty.Status),
        flowDirection: flow >= 0 ? "from-to" : "to-from"
      });
    }
    return { solverVersion: SOLVER_VERSION, units: { flow: "L/s", demand: "L/s", pressure: "m", head: "m", velocity: "m/s", headloss: "m" }, nodes, links };
  } finally {
    project.close();
  }
}

export { SOLVER_VERSION };

if (typeof window !== "undefined") window.AquaEpanetAdapter = { runInp, SOLVER_VERSION };