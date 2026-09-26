(() => {
  "use strict";

  const COLORS = { pressure: "#53a8ff", flow: "#55d6be", acoustic: "#ffbf59" };
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

  function scale(values, minimumPixel, maximumPixel) {
    const clean = values.filter(Number.isFinite);
    const minimum = clean.length ? Math.min(...clean) : 0;
    const maximum = clean.length ? Math.max(...clean) : 1;
    const spread = maximum - minimum || 1;
    return value => maximumPixel - (value - minimum) / spread * (maximumPixel - minimumPixel);
  }

  function linePath(points, range, yScale, top, bottom) {
    const visible = points.filter(point => point.time >= range.start && point.time <= range.end);
    return visible.map((point, index) => {
      const x = 48 + (point.time - range.start) / Math.max(1, range.end - range.start) * 690;
      const y = Math.max(top, Math.min(bottom, yScale(point.value)));
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  function eventMarks(source, range, top, bottom, color) {
    return source.events.filter(event => event.time >= range.start && event.time <= range.end).map(event => {
      const x = 48 + (event.time - range.start) / Math.max(1, range.end - range.start) * 690;
      return `<g><line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="${color}" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${x}" cy="${top + 8}" r="5" fill="${color}"><title>${escape(event.label)} · ${escape(event.timestamp)}</title></circle></g>`;
    }).join("");
  }

  function renderChart(comparison) {
    const svg = element("comparisonChart");
    if (!svg) return;
    const range = visibleRange(comparison);
    view.range = range;
    const split = view.layout === "split";
    view.scaleMode = element("comparisonScale")?.value || "actual";
    const allValues = [comparison.sourceA, comparison.sourceB].flatMap(source => source.points.map(point => point.value));
    const commonScale = scale(allValues, 24, 276);
    const sourcesToDraw = [
      { key: "A", source: comparison.sourceA, color: COLORS[comparison.sourceA.type], top: 24, bottom: split ? 132 : 276 },
      { key: "B", source: comparison.sourceB, color: COLORS[comparison.sourceB.type], top: split ? 168 : 24, bottom: 276 }
    ];
    const content = sourcesToDraw.map(item => {
      if (!view.visible[item.key]) return "";
      const values = item.source.points.map(point => point.value);
      const normalizedValues = values.length ? values.map(value => {
        const minimum = Math.min(...values);
        const spread = Math.max(...values) - minimum || 1;
        return (value - minimum) / spread * 100;
      }) : [];
      const normalizedByValue = value => {
        const index = values.indexOf(value);
        return scale([0, 100], item.top, item.bottom)(normalizedValues[index] ?? 0);
      };
      const yScale = view.scaleMode === "actual" ? commonScale : view.scaleMode === "normalized" ? normalizedByValue : scale(values, item.top, item.bottom);
      const path = item.source.eventOnly ? "" : `<path d="${linePath(item.source.points, range, yScale, item.top, item.bottom)}" fill="none" stroke="${item.color}" stroke-width="2.5"/>`;
      return `${split ? `<text x="12" y="${item.top + 10}" fill="${item.color}" font-size="10">${item.key}</text>` : ""}${path}${eventMarks(item.source, range, item.top, item.bottom, item.color)}`;
    }).join("");
    svg.setAttribute("viewBox", "0 0 760 300");
    svg.innerHTML = `<rect x="48" y="24" width="690" height="252" fill="#07141e" stroke="#294150"/><line id="comparisonCursorLine" x1="48" x2="48" y1="24" y2="276" stroke="#ffffff" stroke-width="1" opacity="0"/>${content}`;
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
      const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const x = 48 + fraction * 690;
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