import test from "node:test";
import assert from "node:assert/strict";
import { mapModeSummary, operationalAssetType } from "../cockpit/map-mode-core.js";

const feature = properties => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [-6, 53] } });

test("operational asset classification requires positive source identification", () => {
  assert.equal(operationalAssetType(feature({ type: "valve", name: "Boundary valve" })), null);
  assert.equal(operationalAssetType(feature({ asset_type: "PRV" })), "prv");
  assert.equal(operationalAssetType(feature({ category: "Combination air valve" })), "air");
});

test("map mode summary derives logical DMA and acoustic counts", () => {
  const project = {
    logicalDmas: Array.from({ length: 4 }, (_, index) => ({ logical_dma_uid: `dma-${index}` })),
    acousticSensor: Array.from({ length: 10 }, () => ({})),
    acousticCouple: Array.from({ length: 9 }, () => ({})),
    acousticAlert: [...Array.from({ length: 3 }, () => ({ stateGroup: "active" })), ...Array.from({ length: 19 }, () => ({ stateGroup: "historical" }))],
    layers: [{ kind: "valve", geojson: { features: [feature({ type: "valve" })] } }]
  };
  const summary = mapModeSummary(project);
  assert.equal(summary.dma.count, 4);
  assert.equal(summary.acoustic.count, 10);
  assert.equal(summary.acoustic.detail, "10 sensors · 9 couples · 3 active alerts · 19 historical");
  assert.equal(summary.prv.enabled, false);
  assert.equal(summary.air.enabled, false);
  assert.equal(summary.topology.enabled, false);
});

test("topology mode consumes retained graph metadata without constructing it", () => {
  const topology = { nodes: [{ id: 1 }, { id: 2 }], edges: [{ a: 0, b: 1 }], components: 1 };
  const summary = mapModeSummary({ topology, layers: [] });
  assert.equal(summary.topology.enabled, true);
  assert.equal(summary.topology.topology, topology);
  assert.match(summary.topology.detail, /2 nodes · 1 edges · 1 components/);
});