import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRegistry() {
  const storage = new Map();
  const window = { addEventListener() {}, dispatchEvent() {} };
  const context = vm.createContext({
    window,
    document: { querySelectorAll: () => [], getElementById: () => null },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Event: class Event {}
  });
  const source = await readFile(new URL("../cockpit/visual-styles.js", import.meta.url), "utf8");
  vm.runInContext(source, context);
  return window.AquaVisualStyles;
}

function rgb(hex) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}

function distance(left, right) {
  const a = rgb(left);
  const b = rgb(right);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test("requested comparison pairs use clearly distinct colours", async () => {
  const styles = await loadRegistry();
  const pairs = [
    ["environment-rainfall", "pressure"],
    ["flow", "pressure"],
    ["environment-temperature", "pressure"],
    ["environment-soil-moisture", "environment-rainfall"],
    ["elevation", "pressure"]
  ];
  for (const [left, right] of pairs) {
    const pair = styles.comparisonPair(left, right);
    assert.ok(distance(pair.A, pair.B) >= 95, `${left} and ${right} should be immediately distinguishable`);
  }
});

test("identical custom source colours receive a contrasting B presentation", async () => {
  const styles = await loadRegistry();
  styles.setColor("environmental.rainfall", "#336699");
  styles.setColor("monitoring.pressure", "#336699");
  const pair = styles.comparisonPair("environment-rainfall", "pressure");
  assert.equal(pair.A, "#336699");
  assert.notEqual(pair.B, pair.A);
  assert.ok(distance(pair.A, pair.B) >= 95);
});

test("layer visibility defaults and preferences stay presentation-only", async () => {
  const styles = await loadRegistry();
  assert.equal(styles.visible("network.pipe"), true);
  assert.equal(styles.visible("network.meter"), false);
  styles.setVisible("network.pipe", false);
  assert.equal(styles.visible("network.pipe"), false);
});
