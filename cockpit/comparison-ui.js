(() => {
  "use strict";

  const COLORS = { pressure: "#53a8ff", flow: "#55d6be", acoustic: "#ffbf59" };
  const PLOT = Object.freeze({ left: 76, right: 684, top: 24, bottom: 258, splitTopBottom: 120, splitBottomTop: 154 });
  const view = { sourceA: null, sourceB: null, layout: "overlay", scaleMode: "actual", zoom: 1, visible: { A: true, B: true }, picking: null, styledLayers: [] };

  const element = id => document.getElementById(id);
  const escape = value => String(value ?? "-").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const format = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : "-";

  function sources() {
    return window.AquaComparisonCore?.buildComparisonSources(window.aquaState?.active || {}) || [];
  }

  function sourceForEntity(kind, entity) {
    const type = kind === "acoustic-sensor" ? "acoustic" : entity?.type;
    const id = type === "acoustic" ? entity?.sensorId : entity?.id || entity?._id;
    return sources().find(source => source.id === `${type}:${id}`) || null;
  }

  function groupedOptions(allSources, selected) {
    const labels = { pressure: "Pressure loggers", flow: "Flow meters", acoustic: "Acoustic sensors" };
    return ["pressure", "flow", "acoustic"].map(type => {
      const options = allSources.filter(source => source.type === type).map(source => `<option value="${escape(source.id)}"${source.id === selected ? " selected" : ""}>${escape(source.label)}${source.context ? ` · ${escape(source.context)}` : ""}</option>`).join("");
      return options ? `<optgroup label="${labels[type]}">${options}</optgroup>` : "";
    }).join("");
  }

  function refreshSelectors() {
    const allSources = sources();
    if (!allSources.some(source => source.id === view.sourceA)) view.sourceA = allSources[0]?.id || null;
    if (!allSources.some(source => source.id === view.sourceB) || view.sourceB === view.sourceA) view.sourceB = allSources.find(source => source.id !== view.sourceA)?.id || null;
    const sourceA = element("comparisonSourceA");
    const sourceB = element("comparisonSourceB");
    if (sourceA) sourceA.innerHTML = groupedOptions(allSources, view.sourceA);
    if (sourceB) sourceB.innerHTML = groupedOptions(allSources, view.sourceB);
  }

  function inputOptions() {
    const localValue = id => {
      const value = element(id)?.value;
      return value ? new Date(value).toISOString() : undefined;
    };
    const period = element("comparisonPeriod")?.value || "all";
    const selectedSources = sources().filter(source => source.id === view.sourceA || source.id === view.sourceB);
    const latest = Math.max(...selectedSources.flatMap(source => chartItems(source).map(item => item.time)), 0);
    const days = Number(period);
    return {
      start: period === "custom" ? localValue("comparisonStart") : Number.isFinite(days) && latest ? new Date(latest - days * 86400000).toISOString() : undefined,
      end: period === "custom" ? localValue("comparisonEnd") : Number.isFinite(days) && latest ? new Date(latest).toISOString() : undefined,
      timeStart: element("comparisonTimeStart")?.value,
      timeEnd: element("comparisonTimeEnd")?.value,
      aggregation: element("comparisonAggregation")?.value || "raw"
    };
  }

  function chartItems(source) {
    return source.eventOnly ? source.events : source.points;
  }

  function visibleRange(comparison) {
    const times = [comparison.sourceA, comparison.sourceB].flatMap(chartItems).map(item => item.time);
    if (!times.length) return { start: 0, end: 1 };
    const fullStart = Math.min(...times);
    const fullEnd = Math.max(...times);
    const duration = Math.max(1, fullEnd - fullStart);
    const width = duration / view.zoom;
    return { start: fullEnd - width, end: fullEnd };
  }

  function scaleDetails(values, minimumPixel, maximumPixel, padded = true) {
    const clean = values.filter(Number.isFinite);
    let minimum = clean.length ? Math.min(...clean) : 0;
    let maximum = clean.length ? Math.max(...clean) : 1;
    if (minimum === maximum) { minimum -= 0.5; maximum += 0.5; }
    const padding = padded ? (maximum - minimum) * 0.06 : 0;
    minimum -= padding;
    maximum += padding;
    return { minimum, maximum, value: number => maximumPixel - (number - minimum) / (maximum - minimum) * (maximumPixel - minimumPixel) };
  }

  function linePath(points, range, yScale, top, bottom) {
    const visible = points.filter(point => point.time >= range.start && point.time <= range.end);
    return visible.map((point, index) => {
      const x = PLOT.left + (point.time - range.start) / Math.max(1, range.end - range.start) * (PLOT.right - PLOT.left);
      const y = Math.max(top, Math.min(bottom, yScale(point.value)));
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  function eventMarks(source, range, top, bottom, color) {
    return source.events.filter(event => event.time >= range.start && event.time <= range.end).map(event => {
      const x = PLOT.left + (event.time - range.start) / Math.max(1, range.end - range.start) * (PLOT.right - PLOT.left);
      return `<g><line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="${color}" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${x}" cy="${top + 8}" r="5" fill="${color}"><title>${escape(event.label)} · ${escape(event.timestamp)}</title></circle></g>`;
    }).join("");
  }

  function sourceAxisLabel(source) {
    const labels = { pressure: "Pressure", flow: "Flow", acoustic: "Events" };
    return `${labels[source.type] || source.label} (${source.unit})`;
  }

  function valueTicks(details, x, top, bottom, color, side = "left", label = "") {
    const anchor = side === "right" ? "start" : "end";
    const offset = side === "right" ? 7 : -7;
    const ticks = Array.from({ length: 5 }, (_item, index) => {
      const fraction = index / 4;
      const y = bottom - fraction * (bottom - top);
      const value = details.minimum + fraction * (details.maximum - details.minimum);
      return `<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${y}" y2="${y}" stroke="#294150" stroke-width="1" opacity="${index === 0 ? 0.8 : 0.45}"/><line x1="${x}" x2="${x + (side === "right" ? 4 : -4)}" y1="${y}" y2="${y}" stroke="${color}"/><text x="${x + offset}" y="${y + 3}" text-anchor="${anchor}" fill="${color}" font-size="9">${format(value, Math.abs(value) < 10 ? 1 : 0)}</text>`;
    }).join("");
    const labelX = side === "right" ? 744 : 12;
    return `${ticks}<text x="${labelX}" y="${(top + bottom) / 2}" text-anchor="middle" fill="${color}" font-size="10" transform="rotate(-90 ${labelX} ${(top + bottom) / 2})">${escape(label)}</text>`;
  }

  function timeLabel(time, duration) {
    const date = new Date(time);
    if (duration <= 36 * 3600000) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (duration <= 14 * 86400000) return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function timeAxis(range) {
    const duration = Math.max(1, range.end - range.start);
    const ticks = Array.from({ length: 5 }, (_item, index) => {
      const fraction = index / 4;
      const x = PLOT.left + fraction * (PLOT.right - PLOT.left);
      const time = range.start + fraction * duration;
      return `<line x1="${x}" x2="${x}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#294150" opacity="0.28"/><text x="${x}" y="274" text-anchor="middle" fill="#9ab7c9" font-size="9">${escape(timeLabel(time, duration))}</text>`;
    }).join("");
    return `${ticks}<text x="${(PLOT.left + PLOT.right) / 2}" y="294" text-anchor="middle" fill="#b9cfdd" font-size="10">Date/time</text>`;
  }

  function renderChart(comparison) {
    const svg = element("comparisonChart");
    if (!svg) return;
    const range = visibleRange(comparison);
    view.range = range;
    const split = view.layout === "split";
    view.scaleMode = element("comparisonScale")?.value || "actual";
    const allValues = [comparison.sourceA, comparison.sourceB].flatMap(source => source.points.map(point => point.value));
    const normalized = view.scaleMode === "normalized";
    const sameUnit = comparison.sourceA.unit === comparison.sourceB.unit;
    const dualAxis = view.scaleMode === "dual" || !sameUnit;
    const commonScale = scaleDetails(normalized ? [0, 100] : allValues, PLOT.top, PLOT.bottom, !normalized);
    const sourcesToDraw = [
      { key: "A", source: comparison.sourceA, color: COLORS[comparison.sourceA.type], top: PLOT.top, bottom: split ? PLOT.splitTopBottom : PLOT.bottom },
      { key: "B", source: comparison.sourceB, color: COLORS[comparison.sourceB.type], top: split ? PLOT.splitBottomTop : PLOT.top, bottom: PLOT.bottom }
    ];
    const scales = {};
    const content = sourcesToDraw.map(item => {
      const values = item.source.points.map(point => point.value);
      const sourceDomain = scaleDetails(values, item.top, item.bottom);
      const normalizationMinimum = values.length ? Math.min(...values) : 0;
      const normalizationSpread = values.length ? Math.max(...values) - normalizationMinimum || 1 : 1;
      const normalizedScale = scaleDetails([0, 100], item.top, item.bottom, false);
      const actualScale = split || dualAxis ? sourceDomain : commonScale;
      const details = normalized ? normalizedScale : actualScale;
      scales[item.key] = details;
      if (!view.visible[item.key]) return "";
      const yScale = normalized ? value => normalizedScale.value((value - normalizationMinimum) / normalizationSpread * 100) : details.value;
      const path = item.source.eventOnly ? "" : `<path d="${linePath(item.source.points, range, yScale, item.top, item.bottom)}" fill="none" stroke="${item.color}" stroke-width="2.5"/>`;
      return `${split ? `<text x="12" y="${item.top + 10}" fill="${item.color}" font-size="10">${item.key}</text>` : ""}${path}${eventMarks(item.source, range, item.top, item.bottom, item.color)}`;
    }).join("");
    let axes;
    if (normalized) {
      axes = valueTicks(commonScale, PLOT.left, PLOT.top, PLOT.bottom, "#b9cfdd", "left", "Normalized scale (%)");
    } else if (split) {
      axes = valueTicks(scales.A, PLOT.left, PLOT.top, PLOT.splitTopBottom, sourcesToDraw[0].color, "left", sourceAxisLabel(comparison.sourceA))
        + valueTicks(scales.B, PLOT.left, PLOT.splitBottomTop, PLOT.bottom, sourcesToDraw[1].color, "left", sourceAxisLabel(comparison.sourceB));
    } else if (!dualAxis) {
      axes = valueTicks(commonScale, PLOT.left, PLOT.top, PLOT.bottom, sourcesToDraw[0].color, "left", sourceAxisLabel(comparison.sourceA));
    } else {
      axes = valueTicks(scales.A, PLOT.left, PLOT.top, PLOT.bottom, sourcesToDraw[0].color, "left", sourceAxisLabel(comparison.sourceA))
        + valueTicks(scales.B, PLOT.right, PLOT.top, PLOT.bottom, sourcesToDraw[1].color, "right", sourceAxisLabel(comparison.sourceB));
    }
    svg.setAttribute("viewBox", "0 0 760 300");
    svg.innerHTML = `<rect x="${PLOT.left}" y="${PLOT.top}" width="${PLOT.right - PLOT.left}" height="${PLOT.bottom - PLOT.top}" fill="#07141e" stroke="#294150"/>${axes}${timeAxis(range)}<line id="comparisonCursorLine" x1="${PLOT.left}" x2="${PLOT.left}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#ffffff" stroke-width="1" opacity="0"/>${content}`;
  }

  function summaryCard(key, source) {
    const stats = source.statistics;
    const details = source.eventOnly
      ? `<b>${source.events.length}</b><span>events / snapshots</span>`
      : `<b>${format(stats.min)} / ${format(stats.average)} / ${format(stats.max)}</b><span>min / average / max · ${stats.count} samples</span>`;
    return `<label class="comparison-summary-card"><input type="checkbox" data-comparison-visible="${key}"${view.visible[key] ? " checked" : ""}><i style="background:${COLORS[source.type]}"></i><strong>${key} · ${escape(source.label)}</strong>${details}<small>${escape(source.unit)}</small></label>`;
  }

  function render() {
    refreshSelectors();
    const allSources = sources();
    const sourceA = allSources.find(source => source.id === view.sourceA);
    const sourceB = allSources.find(source => source.id === view.sourceB);
    if (!sourceA || !sourceB) {
      if (element("comparisonSummary")) element("comparisonSummary").innerHTML = '<div class="empty-row">Open a project with at least two monitoring sources.</div>';
      return;
    }
    let comparison;
    try {
      comparison = window.AquaComparisonCore.compareSources(sourceA, sourceB, inputOptions());
    } catch (error) {
      element("comparisonSummary").innerHTML = `<div class="result-note">${escape(error.message)}</div>`;
      return;
    }
    view.comparison = comparison;
    const correlation = comparison.correlation.value == null ? comparison.correlation.reason : `${comparison.correlation.value.toFixed(3)} (${comparison.correlation.sampleCount} aligned)`;
    const overlap = comparison.overlap.start ? `${new Date(comparison.overlap.start).toLocaleString()} to ${new Date(comparison.overlap.end).toLocaleString()}` : "No overlapping period";
    element("comparisonSummary").innerHTML = `${summaryCard("A", comparison.sourceA)}${summaryCard("B", comparison.sourceB)}<div class="comparison-stat"><span>Overlap</span><b>${escape(overlap)}</b></div><div class="comparison-stat"><span>Correlation</span><b>${escape(correlation)}</b></div>`;
    element("comparisonProvenance").innerHTML = comparison.provenance.map(item => `<span><b>${escape(item.id)}</b> ${escape(typeof item.provenance === "string" ? item.provenance : item.provenance?.filename || item.provenance?.type || "unknown")}${item.eventOnly ? " · event-only" : ""}</span>`).join("");
    element("comparisonZoomReset").textContent = `${view.zoom}×`;
    renderChart(comparison);
  }

  function restoreMapStyles() {
    view.styledLayers.forEach(({ layer, options, opacity }) => {
      if (layer.setStyle) layer.setStyle(options);
      if (layer.setOpacity && opacity != null) layer.setOpacity(opacity);
    });
    view.styledLayers = [];
  }

  function styleLayer(layer, eligible, current) {
    const options = { ...layer.options };
    view.styledLayers.push({ layer, options, opacity: layer.options?.opacity ?? 1 });
    if (layer.setStyle) layer.setStyle({ opacity: current ? 0.12 : eligible ? 1 : 0.08, fillOpacity: current ? 0.08 : eligible ? 1 : 0.04, weight: eligible && !current ? 4 : options.weight });
    else if (layer.setOpacity) layer.setOpacity(current ? 0.12 : eligible ? 1 : 0.08);
  }

  function mapSources(callback) {
    Object.values(window.aquaState?.telemetryKindLayers || {}).forEach(group => group.eachLayer(layer => callback(layer, layer.__aquaTelemetry ? `${layer.__aquaTelemetry.type}:${layer.__aquaTelemetry.id || layer.__aquaTelemetry._id}` : null)));
    for (const [id, layer] of window.aquaState?.acousticMarkers?.sensors || []) callback(layer, `acoustic:${id}`);
    Object.values(window.aquaState?.kindLayers || {}).forEach(group => group.eachLayer(wrapper => wrapper.eachLayer?.(layer => callback(layer, null))));
  }

  function startPicking(slot) {
    cancelPicking();
    view.picking = slot;
    const current = slot === "A" ? view.sourceB : view.sourceA;
    mapSources((layer, id) => styleLayer(layer, Boolean(id), id === current));
    element("comparisonPickNotice")?.classList.remove("hidden");
    element("comparisonPickNotice").querySelector("span").textContent = `Select source ${slot} on the map. Current opposite source is unavailable.`;
  }

  function cancelPicking() {
    restoreMapStyles();
    view.picking = null;
    element("comparisonPickNotice")?.classList.add("hidden");
  }

  function addCompareAction(source) {
    const card = element("selectionCard");
    if (!card || !source) return;
    card.querySelector("[data-compare-source]")?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary selection-compare";
    button.dataset.compareSource = source.id;
    button.textContent = "Compare with...";
    button.onclick = () => {
      view.sourceA = source.id;
      if (view.sourceB === source.id) view.sourceB = sources().find(item => item.id !== source.id)?.id || null;
      render();
      window.AquaWindowManager?.restore("comparison");
    };
    card.append(button);
  }

  function handleSelection(event) {
    const source = sourceForEntity(event.detail?.kind, event.detail?.entity);
    if (!source) return;
    if (view.picking) {
      const other = view.picking === "A" ? view.sourceB : view.sourceA;
      if (source.id === other) return;
      view[`source${view.picking}`] = source.id;
      cancelPicking();
      render();
      window.AquaWindowManager?.restore("comparison");
      return;
    }
    addCompareAction(source);
  }

  function nearest(items, time) {
    return items.reduce((best, item) => !best || Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best, null);
  }

  function bindCursor() {
    const svg = element("comparisonChart");
    svg?.addEventListener("pointermove", event => {
      if (!view.comparison || !view.range) return;
      const bounds = svg.getBoundingClientRect();
      const svgX = (event.clientX - bounds.left) / bounds.width * 760;
      const fraction = Math.max(0, Math.min(1, (svgX - PLOT.left) / (PLOT.right - PLOT.left)));
      const x = PLOT.left + fraction * (PLOT.right - PLOT.left);
      const time = view.range.start + fraction * (view.range.end - view.range.start);
      const line = element("comparisonCursorLine");
      line?.setAttribute("x1", x); line?.setAttribute("x2", x); line?.setAttribute("opacity", "0.8");
      const rows = [view.comparison.sourceA, view.comparison.sourceB].map(source => {
        const item = nearest(chartItems(source), time);
        if (!item) return `${source.label}: no data`;
        return `${source.label}: ${source.eventOnly ? item.label : `${format(item.value)} ${source.unit}`}`;
      });
      const cursor = element("comparisonCursor");
      cursor.innerHTML = `<b>${new Date(time).toLocaleString()}</b><span>${escape(rows[0])}</span><span>${escape(rows[1])}</span>`;
      cursor.style.left = `${Math.min(bounds.width - 190, Math.max(4, event.clientX - bounds.left + 10))}px`;
      cursor.classList.remove("hidden");
    });
    svg?.addEventListener("pointerleave", () => {
      element("comparisonCursor")?.classList.add("hidden");
      element("comparisonCursorLine")?.setAttribute("opacity", "0");
    });
    svg?.addEventListener("wheel", event => {
      event.preventDefault();
      view.zoom = Math.max(1, Math.min(8, view.zoom * (event.deltaY < 0 ? 2 : 0.5)));
      render();
    }, { passive: false });
  }

  function bind() {
    ["comparisonSourceA", "comparisonSourceB", "comparisonPeriod", "comparisonStart", "comparisonEnd", "comparisonTimeStart", "comparisonTimeEnd", "comparisonAggregation", "comparisonScale"].forEach(id => element(id)?.addEventListener("change", event => {
      if (id === "comparisonSourceA") view.sourceA = event.target.value;
      if (id === "comparisonSourceB") view.sourceB = event.target.value;
      if (id === "comparisonStart" || id === "comparisonEnd") element("comparisonPeriod").value = "custom";
      if (view.sourceA === view.sourceB) {
        const alternative = sources().find(source => source.id !== event.target.value)?.id || null;
        if (id === "comparisonSourceA") view.sourceB = alternative;
        else view.sourceA = alternative;
      }
      render();
    }));
    document.querySelectorAll("[data-comparison-layout]").forEach(button => button.addEventListener("click", () => {
      view.layout = button.dataset.comparisonLayout;
      document.querySelectorAll("[data-comparison-layout]").forEach(item => item.classList.toggle("active", item === button));
      render();
    }));
    element("comparisonPickA")?.addEventListener("click", () => startPicking("A"));
    element("comparisonPickB")?.addEventListener("click", () => startPicking("B"));
    element("comparisonCancelPick")?.addEventListener("click", cancelPicking);
    element("comparisonZoomIn")?.addEventListener("click", () => { view.zoom = Math.min(8, view.zoom * 2); render(); });
    element("comparisonZoomOut")?.addEventListener("click", () => { view.zoom = Math.max(1, view.zoom / 2); render(); });
    element("comparisonZoomReset")?.addEventListener("click", () => { view.zoom = 1; render(); });
    element("comparisonSummary")?.addEventListener("change", event => {
      if (!event.target.dataset.comparisonVisible) return;
      view.visible[event.target.dataset.comparisonVisible] = event.target.checked;
      renderChart(view.comparison);
    });
    element("projectSelect")?.addEventListener("change", () => setTimeout(render, 100));
    window.addEventListener("aqua:selection", handleSelection);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && view.picking) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPicking();
      }
    }, true);
    bindCursor();
    render();
  }

  window.AquaComparison = { render, openForSource(id) { view.sourceA = id; render(); window.AquaWindowManager?.restore("comparison"); }, cancelPicking };
  window.addEventListener("load", bind);
})();