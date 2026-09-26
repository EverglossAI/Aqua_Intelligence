import test from "node:test";
import assert from "node:assert/strict";
import { CONFIRMED_BURST_EVENT_FIELDS, analyseEventLags, analyseWetTransition, buildEnvironmentalComparisonSources, environmentalEvents, environmentalRiskContribution, formatUtcPeriod, groupEventRecords, summarizeAssociations, summarizeEnvironment } from "../cockpit/environmental-core.js";
import { compareSources } from "../cockpit/comparison-core.js";

function result(hours = 24 * 30) {
  const start = Date.parse("2026-08-28T00:00:00Z");
  return {
    provider: "open-meteo",
    classification: "external model/reanalysis",
    dataset: "Open-Meteo best-match weather models",
    hourly: Array.from({ length: hours }, (_item, index) => {
      const recentRain = index >= hours - 24 ? 1.5 : 0;
      const soil = index >= hours - 24 ? 0.28 : 0.2;
      return { timestamp: new Date(start + index * 3600000).toISOString(), precipitation: recentRain, rain: recentRain, temperature: index >= hours - 24 ? 24 : 31, soilMoisture: soil, evapotranspiration: 0.1 };
    })
  };
}

test("environmental summaries expose supported rainfall, temperature, moisture and evapotranspiration", () => {
  const summary = summarizeEnvironment(result());
  assert.equal(summary.rainfall.last24h, 36);
  assert.equal(summary.rainfall.last72h, 36);
  assert.equal(summary.rainfall.last30d, 36);
  assert.equal(formatUtcPeriod(summary.periods.rainfall30d), "2026-08-28 00:00 to 2026-09-26 23:00 UTC");
  assert.equal(summary.temperature.recent, 24);
  assert.equal(summary.temperature.change24h, -7);
  assert.deepEqual(summary.periods.temperatureChange24h, { from: "2026-09-25T23:00:00.000Z", to: "2026-09-26T23:00:00.000Z" });
  assert.ok(summary.soilMoisture.change > 0.07);
  assert.equal(formatUtcPeriod(summary.periods.soilMoistureBaseline24h), "2026-09-25 00:00 to 2026-09-25 23:00 UTC");
  assert.ok(Math.abs(summary.evapotranspiration.selectedPeriod - 72) < 1e-9);
});

test("wet-transition analysis is deterministic and is not risk scoring", () => {
  const transition = analyseWetTransition(result());
  assert.equal(transition.indicator, "High");
  assert.equal(transition.heavyRain, true);
  assert.equal(transition.antecedentDry, true);
  assert.equal(transition.soilIncrease, true);
  assert.equal(environmentalRiskContribution(), 0);
});

test("acoustic terminology is preserved and alerts are never promoted to confirmed bursts", () => {
  const events = environmentalEvents({ layers: [{ kind: "pipe", geojson: { features: [{ properties: { pipe_id: "P-1", material: "DIP", diameter: 100 } }] } }], acousticAlert: [{ alertId: "A-1", alertType: "Leak", status: "Located", detectionDate: "2026-09-26T00:00:00Z", probability: 80, matchedPipeId: "P-1", coupleId: "C-1" }] });
  assert.equal(events[0].type, "Leak");
  assert.equal(events[0].status, "Located");
  assert.equal(events[0].material, "DIP");
  assert.equal(events[0].diameter, 100);
  assert.equal(events[0].confirmedBurst, false);
  assert.deepEqual(environmentalEvents({ acousticAlert: [{ alertId: "A-1", detectionDate: "2026-09-26T00:00:00Z" }] }, { alerts: [] }), []);
});

test("lag analysis calculates same-day, 24, 48, 72 and 168 hour windows", () => {
  const data = result();
  const event = { eventId: "A-1", timestamp: data.hourly.at(-1).timestamp, time: Date.parse(data.hourly.at(-1).timestamp) };
  const [analysis] = analyseEventLags(data, [event]);
  assert.deepEqual(analysis.windows.map(window => window.hours), [0, 24, 48, 72, 168]);
  assert.equal(analysis.windows.find(window => window.hours === 24).rainfall, 36);
  assert.ok(analysis.windows.find(window => window.hours === 24).soilMoistureChange > 0.07);
  assert.equal(analysis.wetTransition, "High");
});

test("environmental sources integrate with numeric comparison without changing its engine", () => {
  const sources = buildEnvironmentalComparisonSources(result(), []);
  assert.deepEqual(sources.map(source => source.label), ["Rainfall", "Temperature", "Soil moisture", "Evapotranspiration"]);
  const pressure = { id: "pressure:P-1", type: "pressure", label: "P-1", unit: "m", points: sources[1].points.map(point => ({ ...point, value: point.value + 10 })), events: [] };
  const comparison = compareSources(pressure, sources[1]);
  assert.equal(comparison.sourceB.unit, "°C");
  assert.equal(comparison.correlation.value, 1);
});

test("future event grouping is ready without fabricating burst records", () => {
  assert.deepEqual(CONFIRMED_BURST_EVENT_FIELDS, ["eventId", "pipeId", "eventType", "eventDateTime", "confirmedBurst", "repairDateTime", "material", "diameter", "repairType", "latitude", "longitude", "source"]);
  const records = [
    { eventId: "1", eventDateTime: "2026-06-01T00:00:00Z", material: "DIP", diameter: 100, dma: "A" },
    { eventId: "2", eventDateTime: "2026-07-01T00:00:00Z", material: "DIP", diameter: 150, dma: "A" },
    { eventId: "3", eventDateTime: "2026-12-01T00:00:00Z", material: "PVC", diameter: 100, dma: "B" }
  ];
  assert.deepEqual(groupEventRecords(records, "material"), [{ value: "DIP", count: 2 }, { value: "PVC", count: 1 }]);
  const summary = summarizeAssociations(records, records.map(event => ({ event, wetTransition: "Low", windows: [{ hours: 24, rainfall: 0 }] })));
  assert.equal(summary.status, "Descriptive only");
  assert.deepEqual(summary.bySeason, [{ value: "Summer", count: 2 }, { value: "Winter", count: 1 }]);
  assert.deepEqual(summarizeAssociations(records.slice(0, 2), []).status, "Insufficient data");
});