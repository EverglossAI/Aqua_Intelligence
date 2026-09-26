(() => {
  "use strict";

  const METRICS = {
    precipitation: { label: "Rainfall", unit: "mm", color: "#5ac8fa" },
    temperature: { label: "Temperature", unit: "°C", color: "#ff7b62" },
    soilMoisture: { label: "Soil moisture", unit: "m³/m³", color: "#7ed6a7" },
    evapotranspiration: { label: "Evapotranspiration", unit: "mm", color: "#d6b36a" }
  };
  const view = { coordinate: null, label: "", pipeId: null, dma: null, alerts: [], days: 30, metric: "precipitation", result: null, events: [], request: 0, followSelection: true, locationBasis: null };
  const element = id => document.getElementById(id);
  const escape = value => String(value ?? "-").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const format = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
  const dateValue = value => new Date(value).toISOString().slice(0, 10);

  function eventDate(alert) {
    const date = new Date(alert?.detectionDate || alert?.timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function defaultEnd() {
    const dates = view.alerts.map(eventDate).filter(Boolean).sort((left, right) => right - left);
    return dates[0] || new Date();
  }

  function setPeriod(days = view.days) {
    view.days = days;
    const end = defaultEnd();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    element("environmentalStart").value = dateValue(start);
    element("environmentalEnd").value = dateValue(end);
    document.querySelectorAll("[data-environment-days]").forEach(button => button.classList.toggle("active", Number(button.dataset.environmentDays) === days));
  }

  function status(title, detail, kind = "") {
    const target = element("environmentalStatus");
    if (!target) return;
    target.className = `environmental-status ${kind}`.trim();
    target.innerHTML = `<b>${escape(title)}</b><span>${escape(detail)}</span>`;
  }

  function syncContextMode() {
    element("followEnvironmentalContext")?.classList.toggle("active", view.followSelection);
    element("pinEnvironmentalContext")?.classList.toggle("active", !view.followSelection);
  }

  function sharedLocation() {
    const context = window.AquaInvestigationContext?.current;
    if (context?.selectedMapPoint?.coordinate) return { ...context.selectedMapPoint, locationBasis: context.selectedMapPoint.locationBasis || "Selected map point" };
    if (context?.selectedDMA?.coordinate) {
      const dma = context.selectedDMA;
      return { coordinate: dma.coordinate, label: `DMA ${dma.name}`, dma: dma.name, alerts: [...(dma.summary?.activeAlerts || []), ...(dma.summary?.historicalAlerts || [])], locationBasis: dma.locationBasis };
    }
    if (context?.selectedAsset?.coordinate) {
      const asset = context.selectedAsset;
      return { coordinate: asset.coordinate, label: `${asset.identity?.type || "Asset"} ${asset.identity?.id || ""}`.trim(), pipeId: context.selectedPipe?.id || null, alerts: [], locationBasis: "Selected asset location" };
    }
    const selected = window.aquaState?.selected;
    const coordinate = window.AquaContextualCore?.featureCoordinate(selected?.feature);
    return coordinate ? { coordinate, label: "Selected map feature", locationBasis: "Selected feature location" } : null;
  }

  function applyLocation(options) {
    if (!options?.coordinate) return false;
    Object.assign(view, { coordinate: options.coordinate, label: options.label || "Map location", pipeId: options.pipeId || null, dma: options.dma || null, alerts: options.alerts || [], locationBasis: options.locationBasis || "Explicit map location", result: null, events: [] });
    const location = element("environmentalLocation");
    if (location) {
      location.classList.remove("hidden");
      location.innerHTML = `<b>${escape(view.label)}</b><span>Location basis: ${escape(view.locationBasis)}</span><span>Lat/Lon: ${format(view.coordinate[0], 6)}, ${format(view.coordinate[1], 6)}</span><span>Open-Meteo · external model/reanalysis</span>`;
    }
    return true;
  }

  function chart(samples, events) {
    const metric = METRICS[view.metric];
    const points = samples.map(sample => ({ time: sample.time, value: Number(sample[view.metric]) })).filter(point => Number.isFinite(point.value));
    if (!points.length) return '<div class="empty-row">No values for this variable.</div>';
    const left = 64, right = 736, top = 20, bottom = 202;
    const start = points[0].time, end = points.at(-1).time;
    let minimum = Math.min(...points.map(point => point.value)), maximum = Math.max(...points.map(point => point.value));
    if (minimum === maximum) { minimum -= 0.5; maximum += 0.5; }
    const padding = (maximum - minimum) * 0.06;
    minimum -= padding; maximum += padding;
    const x = value => left + (value - start) / Math.max(1, end - start) * (right - left);
    const y = value => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
    const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    const yTicks = Array.from({ length: 5 }, (_item, index) => {
      const fraction = index / 4, py = bottom - fraction * (bottom - top), value = minimum + fraction * (maximum - minimum);
      return `<line x1="${left}" x2="${right}" y1="${py}" y2="${py}" stroke="#294150" opacity=".45"/><text x="${left - 7}" y="${py + 3}" text-anchor="end" fill="#9ab7c9" font-size="9">${format(value, Math.abs(value) < 10 ? 2 : 1)}</text>`;
    }).join("");
    const xTicks = Array.from({ length: 5 }, (_item, index) => {
      const fraction = index / 4, px = left + fraction * (right - left), tick = start + fraction * (end - start);
      return `<line x1="${px}" x2="${px}" y1="${top}" y2="${bottom}" stroke="#294150" opacity=".25"/><text x="${px}" y="220" text-anchor="middle" fill="#9ab7c9" font-size="9">${escape(new Date(tick).toLocaleDateString([], { month: "short", day: "numeric" }))}</text>`;
    }).join("");
    const markers = events.filter(event => event.time >= start && event.time <= end).map(event => `<line x1="${x(event.time)}" x2="${x(event.time)}" y1="${top}" y2="${bottom}" stroke="#ffbf59" stroke-width="2" stroke-dasharray="4 4"><title>${escape(event.label)} · ${escape(event.status)}</title></line>`).join("");
    return `<div class="environmental-chart-wrap"><svg class="environmental-chart" viewBox="0 0 800 250" role="img" aria-label="${escape(metric.label)} over time with operational event markers"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="#07141e" stroke="#294150"/>${yTicks}${xTicks}<path d="${path}" fill="none" stroke="${metric.color}" stroke-width="2.5"/>${markers}<text x="14" y="${(top + bottom) / 2}" fill="${metric.color}" font-size="10" transform="rotate(-90 14 ${(top + bottom) / 2})">${escape(metric.label)} (${escape(metric.unit)})</text><text x="${(left + right) / 2}" y="242" text-anchor="middle" fill="#b9cfdd" font-size="10">Date / time (UTC)</text></svg></div>`;
  }

  function lagTable(rows) {
    if (!rows.length) return '<div class="empty-row">No acoustic events are linked to this context.</div>';
    return `<div class="environmental-table-wrap"><table class="environmental-table"><thead><tr><th>Event</th><th>Status</th><th>Same day</th><th>24h</th><th>48h</th><th>72h</th><th>7d</th><th>Wet transition</th></tr></thead><tbody>${rows.map(row => `<tr><td><b>${escape(row.event.eventId)}</b><small>${escape(new Date(row.event.time).toISOString())}</small></td><td>${escape(row.event.type)} · ${escape(row.event.status)}</td>${row.windows.map(window => `<td>${format(window.rainfall)} mm<small>${window.soilMoistureChange == null ? "-" : `${window.soilMoistureChange >= 0 ? "+" : ""}${format(window.soilMoistureChange, 3)} moisture`}</small></td>`).join("")}<td><span class="environmental-level ${row.wetTransition.toLowerCase()}">${escape(row.wetTransition)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }

  function groupList(title, rows) {
    return `<div><b>${escape(title)}</b>${rows.map(row => `<span>${escape(row.value)} <strong>${row.count}</strong></span>`).join("") || '<span>Unavailable</span>'}</div>`;
  }

  function render() {
    const core = window.AquaEnvironmentalCore;
    const target = element("environmentalContent");
    if (!core || !target || !view.result) return;
    const samples = core.normalizedSamples(view.result);
    const summary = core.summarizeEnvironment(view.result);
    const transition = core.analyseWetTransition(view.result);
    const lagRows = core.analyseEventLags(view.result, view.events);
    const associations = core.summarizeAssociations(view.events.map(event => ({ ...event, dma: view.dma })), lagRows);
    const utc = value => value ? `${String(value).slice(0, 16).replace("T", " ")} UTC` : "Time unavailable";
    const period = value => core.formatUtcPeriod(value);
    const metric = (label, value, detail) => `<div><span>${escape(label)}</span><b>${escape(value)}</b><small>${escape(detail)}</small></div>`;
    target.innerHTML = `<div class="environmental-metrics">
      ${metric("Rainfall last 24 h", `${format(summary.rainfall.last24h)} mm`, `${period(summary.periods.rainfall24h)} · rolling 24-hour total`)}
      ${metric("Rainfall last 72 h", `${format(summary.rainfall.last72h)} mm`, `${period(summary.periods.rainfall72h)} · rolling 72-hour total`)}
      ${metric("Rainfall last 7 d", `${format(summary.rainfall.last7d)} mm`, `${period(summary.periods.rainfall7d)} · rolling 7-day total`)}
      ${metric("Rainfall last 30 d", `${format(summary.rainfall.last30d)} mm`, `${period(summary.periods.rainfall30d)} · rolling 30-day total`)}
      ${metric("Temperature latest sample", `${format(summary.temperature.recent)} °C`, utc(summary.periods.temperatureRecent?.at))}
      ${metric("Temperature maximum last 24 h", `${format(summary.temperature.dailyMaximum)} °C`, period(summary.periods.temperatureMaximum24h))}
      ${metric("Temperature change over 24 h", `${summary.temperature.change24h >= 0 ? "+" : ""}${format(summary.temperature.change24h)} °C`, `${utc(summary.periods.temperatureChange24h?.from)} to ${utc(summary.periods.temperatureChange24h?.to)}`)}
      ${metric("Soil moisture latest sample", `${format(summary.soilMoisture.recent, 3)} m³/m³`, utc(summary.periods.soilMoistureRecent?.at))}
      ${metric("Soil-moisture change vs prior 24 h average", `${summary.soilMoisture.change >= 0 ? "+" : ""}${format(summary.soilMoisture.change, 3)} m³/m³`, `${period(summary.periods.soilMoistureBaseline24h)} baseline; compared with ${utc(summary.periods.soilMoistureRecent?.at)}`)}
      ${metric("Reference evapotranspiration", `${format(summary.evapotranspiration.selectedPeriod)} mm`, `${period(summary.periods.selected)} · selected-period total`)}
      </div>
      <section class="environmental-transition"><div><small>WET-TRANSITION INDICATOR</small><b class="environmental-level ${transition.indicator.toLowerCase()}">${escape(transition.indicator)}</b></div><p>${escape(transition.explanation)}</p><span>Rainfall last 24 h (${escape(period(summary.periods.rainfall24h))}): ${format(transition.values.rainfall24h)} mm · Soil-moisture change versus prior 24 h average (${escape(period(summary.periods.soilMoistureBaseline24h))}): ${format(transition.values.soilMoistureChange, 3)} m³/m³ · Temperature change over 24 h (${escape(utc(summary.periods.temperatureChange24h?.from))} to ${escape(utc(summary.periods.temperatureChange24h?.to))}): ${format(transition.values.temperatureChange24h)} °C</span></section>
      <div class="environmental-tabs">${Object.entries(METRICS).map(([id, metric]) => `<button type="button" data-environment-metric="${id}" class="${view.metric === id ? "active" : ""}">${escape(metric.label)}</button>`).join("")}<button type="button" id="compareEnvironmental" class="secondary">Compare ${escape(METRICS[view.metric].label)}</button></div>
      ${chart(samples, view.events)}
      <section class="environmental-section"><h3>Operational event lag review</h3>${lagTable(lagRows)}</section>
      <section class="environmental-section"><h3>Descriptive associations</h3><p>${associations.status === "Insufficient data" ? `Insufficient data: ${associations.eventCount} events; at least ${core.ENVIRONMENTAL_THRESHOLDS.minimumAssociationEvents} are required.` : `${associations.eventCount} events · ${associations.afterHeavyRain} after threshold rain · ${associations.afterWetTransition} after a high wet transition.`}</p>${associations.status === "Insufficient data" ? "" : `<div class="environmental-groups">${groupList("Month", associations.byMonth)}${groupList("Season", associations.bySeason)}${groupList("Material", associations.byMaterial)}${groupList("Diameter", associations.byDiameter)}${groupList("DMA", associations.byDma)}</div>`}</section>
      <footer class="environmental-provenance"><b>Provider: Open-Meteo</b><span>Data source/classification: model/reanalysis</span><span>Dataset: ${escape(view.result.dataset)} · model grid ${format(view.result.location.modelGrid.latitude, 4)}, ${format(view.result.location.modelGrid.longitude, 4)} · soil ${escape(view.result.soilMoistureDepth)} · UTC</span><strong>Not a physical site rain gauge or soil sensor</strong><span>Environmental evidence is contextual only. Investigation priority contribution: 0.</span></footer>`;
    target.querySelectorAll("[data-environment-metric]").forEach(button => button.addEventListener("click", () => { view.metric = button.dataset.environmentMetric; render(); }));
    element("compareEnvironmental")?.addEventListener("click", () => window.AquaComparison?.openForSource(`environment:${view.metric === "precipitation" ? "rainfall" : view.metric === "soilMoisture" ? "soil-moisture" : view.metric}`));
  }

  async function load() {
    if (!view.coordinate) return status("Location unavailable", "Select an asset, DMA, risk result, or map point.", "error");
    const start = element("environmentalStart")?.value;
    const end = element("environmentalEnd")?.value;
    if (!start || !end) return status("Date range required", "Choose a start and end date.", "error");
    const request = ++view.request;
    status(`Loading ${view.label}`, `${start} to ${end} · UTC`, "loading");
    try {
      const response = await fetch("/api/environment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ latitude: view.coordinate[0], longitude: view.coordinate[1], start, end }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
      if (request !== view.request) return;
      view.result = result;
      view.events = window.AquaEnvironmentalCore.environmentalEvents(window.aquaState?.active || {}, { pipeId: view.pipeId, alerts: view.alerts });
      render();
      status(view.label, `${start} to ${end} · ${result.hourly.length} hourly model samples`);
      window.AquaComparison?.render?.();
    } catch (error) {
      if (request !== view.request) return;
      view.result = null;
      element("environmentalContent").innerHTML = "";
      status("Environmental data unavailable", error.message, "error");
    }
  }

  function open(options = {}) {
    const explicit = Boolean(options.coordinate);
    view.followSelection = !explicit;
    syncContextMode();
    const resolved = explicit ? options : sharedLocation();
    if (!applyLocation(resolved)) {
      window.AquaWindowManager?.restore("environmental-context");
      return status("Location unavailable", "Select an asset, DMA, risk result, or map point.", "error");
    }
    if (explicit && options.label === "Map location") window.AquaInvestigationContext?.update({ selectedMapPoint: { coordinate: options.coordinate, label: options.label, locationBasis: "Selected map point" } }, "map-point");
    window.AquaWindowManager?.restore("environmental-context");
    load();
  }

  function openForRisk(result) {
    const feature = result?.pipe?.feature || result?.pipe;
    const coordinate = window.AquaContextualCore?.featureCoordinate(feature);
    open({ coordinate, label: `Pipe ${result.pipeId}`, pipeId: result.pipeId, alerts: [...result.evidence.activeAlerts, ...result.evidence.historicalAlerts] });
  }

  function bind() {
    if (!element("environmentalStart")?.value) setPeriod(30);
    syncContextMode();
    document.querySelectorAll("[data-environment-days]").forEach(button => button.addEventListener("click", () => {
      if (button.dataset.environmentDays === "custom") {
        view.days = "custom";
        document.querySelectorAll("[data-environment-days]").forEach(item => item.classList.toggle("active", item === button));
        return;
      }
      setPeriod(Number(button.dataset.environmentDays));
      load();
    }));
    ["environmentalStart", "environmentalEnd"].forEach(id => element(id)?.addEventListener("change", () => {
      view.days = "custom";
      document.querySelectorAll("[data-environment-days]").forEach(button => button.classList.toggle("active", button.dataset.environmentDays === "custom"));
    }));
    element("loadEnvironmentalContext")?.addEventListener("click", load);
    element("followEnvironmentalContext")?.addEventListener("click", () => {
      view.followSelection = true;
      syncContextMode();
      if (applyLocation(sharedLocation())) load();
    });
    element("pinEnvironmentalContext")?.addEventListener("click", () => { view.followSelection = false; syncContextMode(); });
    window.addEventListener("aqua:context-changed", event => {
      if (!view.followSelection || event.detail?.source === "profile" || element("environmentalContextWorkbench")?.classList.contains("is-hidden")) return;
      const location = sharedLocation();
      if (!location?.coordinate || location.coordinate.every((value, index) => value === view.coordinate?.[index])) return;
      if (applyLocation(location)) load();
    });
    window.addEventListener("aqua:window-restored", event => {
      if (event.detail?.id !== "environmental-context" || !view.followSelection) return;
      const location = sharedLocation();
      if (!location?.coordinate || location.coordinate.every((value, index) => value === view.coordinate?.[index])) return;
      if (applyLocation(location)) load();
    });
    element("projectSelect")?.addEventListener("change", () => { view.result = null; view.coordinate = null; view.events = []; element("environmentalContent").innerHTML = ""; status("Select a mapped location.", "Environmental context does not change investigation priority."); });
  }

  window.AquaEnvironmental = { open, openForRisk, load, get context() { return { ...view }; }, get result() { return view.result; }, get comparisonSources() { return view.result ? window.AquaEnvironmentalCore.buildEnvironmentalComparisonSources(view.result, view.events) : []; } };
  window.addEventListener("load", bind);
})();