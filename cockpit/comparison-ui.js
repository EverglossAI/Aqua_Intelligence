(() => {
  "use strict";

  const PLOT = Object.freeze({ left: 76, right: 684, top: 24, bottom: 258, splitTopBottom: 120, splitBottomTop: 154 });
  const view = { sourceA: null, sourceB: null, domain: "temporal", layout: "overlay", scaleMode: "actual", zoom: 1, visible: { A: true, B: true }, picking: null, styledLayers: [], spatialMarkers: [] };

  const element = id => document.getElementById(id);
  const escape = value => String(value ?? "-").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const format = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : "-";

  function sources() {
    return [...(window.AquaComparisonCore?.buildComparisonSources(window.aquaState?.active || {}) || []), ...(window.AquaEnvironmental?.comparisonSources || [])];
  }

  function sourceForEntity(kind, entity) {
    const type = kind === "acoustic-sensor" ? "acoustic" : entity?.type;
    const id = type === "acoustic" ? entity?.sensorId : entity?.id || entity?._id;
    return sources().find(source => source.id === `${type}:${id}`) || null;
  }

  function groupedOptions(allSources, selected) {
    const labels = { pressure: "Pressure loggers", flow: "Flow meters", acoustic: "Acoustic sensors" };
    const monitoring = ["pressure", "flow", "acoustic"].map(type => {
      const options = allSources.filter(source => source.type === type).map(source => `<option value="${escape(source.id)}"${source.id === selected ? " selected" : ""}>${escape(source.label)}${source.context ? ` · ${escape(source.context)}` : ""}</option>`).join("");
      return options ? `<optgroup label="${labels[type]}">${options}</optgroup>` : "";
    }).join("");
    const environmental = allSources.filter(source => source.type.startsWith("environment-")).map(source => `<option value="${escape(source.id)}"${source.id === selected ? " selected" : ""}>${escape(source.label)}</option>`).join("");
    const elevation = allSources.filter(source => source.type === "elevation").map(source => `<option value="${escape(source.id)}"${source.id === selected ? " selected" : ""}>${escape(source.label)}</option>`).join("");
    const allPressure = view.domain === "spatial" && allSources.some(source => source.type === "pressure") ? `<option value="pressure:*"${selected === "pressure:*" ? " selected" : ""}>All nearby pressure loggers</option>` : "";
    return `${elevation ? `<optgroup label="Elevation profiles">${elevation}</optgroup>` : ""}${allPressure}${monitoring}${environmental ? `<optgroup label="Environmental">${environmental}</optgroup>` : ""}`;
  }

  function refreshSelectors() {
    const available = sources();
    const allSources = view.domain === "spatial" ? available.filter(source => source.type === "elevation" || source.type === "pressure") : available.filter(source => source.domain !== "spatial");
    const valid = id => id === "pressure:*" || allSources.some(source => source.id === id);
    if (view.domain === "spatial") {
      if (!valid(view.sourceA)) view.sourceA = allSources.find(source => source.type === "elevation")?.id || allSources.find(source => source.type === "pressure")?.id || null;
      if (!valid(view.sourceB) || view.sourceB === view.sourceA) view.sourceB = allSources.find(source => source.type !== allSources.find(item => item.id === view.sourceA)?.type)?.id || (allSources.some(source => source.type === "pressure") ? "pressure:*" : null);
      if (allSources.find(source => source.id === view.sourceA)?.type === "elevation" && allSources.some(source => source.type === "pressure")) view.sourceB = valid(view.sourceB) && view.sourceB.startsWith("pressure:") ? view.sourceB : "pressure:*";
    } else {
      if (!valid(view.sourceA)) view.sourceA = allSources[0]?.id || null;
      if (!valid(view.sourceB) || view.sourceB === view.sourceA) view.sourceB = allSources.find(source => source.id !== view.sourceA)?.id || null;
    }
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

  function pointMarks(source, key, range, yScale, top, bottom, color) {
    return source.points.filter(point => point.time >= range.start && point.time <= range.end).map(point => {
      const x = PLOT.left + (point.time - range.start) / Math.max(1, range.end - range.start) * (PLOT.right - PLOT.left);
      const y = Math.max(top, Math.min(bottom, yScale(point.value)));
      const title = `${key} · ${source.label} · ${format(point.value)} ${source.unit}`;
      return key === "B"
        ? `<rect x="${(x - 2.5).toFixed(1)}" y="${(y - 2.5).toFixed(1)}" width="5" height="5" fill="${color}"><title>${escape(title)}</title></rect>`
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}"><title>${escape(title)}</title></circle>`;
    }).join("");
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
    const pair = window.AquaVisualStyles.comparisonPair(comparison.sourceA.type, comparison.sourceB.type);
    view.colors = pair;
    const sourcesToDraw = [
      { key: "A", source: comparison.sourceA, color: pair.A, top: PLOT.top, bottom: split ? PLOT.splitTopBottom : PLOT.bottom },
      { key: "B", source: comparison.sourceB, color: pair.B, top: split ? PLOT.splitBottomTop : PLOT.top, bottom: PLOT.bottom }
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
      const path = item.source.eventOnly ? "" : `<path d="${linePath(item.source.points, range, yScale, item.top, item.bottom)}" fill="none" stroke="${item.color}" stroke-width="2.5"${item.key === "B" ? ' stroke-dasharray="7 4"' : ""}/>${pointMarks(item.source, item.key, range, yScale, item.top, item.bottom, item.color)}`;
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

  function summaryCard(key, source, color) {
    const stats = source.statistics;
    const details = source.eventOnly
      ? `<b>${source.events.length}</b><span>events / snapshots</span>`
      : `<b>${format(stats.min)} / ${format(stats.average)} / ${format(stats.max)}</b><span>min / average / max · ${stats.count} samples</span>`;
    return `<label class="comparison-summary-card comparison-source-${key.toLowerCase()}" style="--series-color:${color}"><input type="checkbox" data-comparison-visible="${key}"${view.visible[key] ? " checked" : ""}><i></i><strong>${key} · ${escape(source.label)}</strong>${details}<small>${escape(source.unit)}</small></label>`;
  }

  function spatialInputOptions() {
    const iso = id => element(id)?.value ? new Date(element(id).value).toISOString() : undefined;
    return {
      pressureMode: element("spatialPressureMode")?.value || "latest",
      selectedTimestamp: iso("spatialTimestamp"),
      start: iso("spatialStart"),
      end: iso("spatialEnd"),
      corridorMetres: Number(element("spatialCorridor")?.value) || window.AquaComparisonCore.SPATIAL_COMPARISON_DEFAULTS.corridorMetres
    };
  }

  function spatialPath(samples, totalDistance, yScale) {
    return samples.map((sample, index) => {
      const x = PLOT.left + sample.distance / Math.max(1, totalDistance) * (PLOT.right - PLOT.left);
      return `${index ? "L" : "M"}${x.toFixed(1)},${yScale(sample.elevation).toFixed(1)}`;
    }).join(" ");
  }

  function chainageAxis(totalDistance) {
    const ticks = Array.from({ length: 5 }, (_item, index) => {
      const fraction = index / 4;
      const x = PLOT.left + fraction * (PLOT.right - PLOT.left);
      return `<line x1="${x}" x2="${x}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#294150" opacity="0.28"/><text x="${x}" y="274" text-anchor="middle" fill="#9ab7c9" font-size="9">${format(totalDistance * fraction, 0)} m</text>`;
    }).join("");
    return `${ticks}<text x="${(PLOT.left + PLOT.right) / 2}" y="294" text-anchor="middle" fill="#b9cfdd" font-size="10">Chainage along saved profile</text>`;
  }

  function renderSpatial() {
    const allSources = sources();
    const selected = [view.sourceA, view.sourceB].map(id => allSources.find(source => source.id === id)).filter(Boolean);
    const elevation = selected.find(source => source.type === "elevation");
    const pressureId = [view.sourceA, view.sourceB].find(id => id === "pressure:*" || allSources.find(source => source.id === id)?.type === "pressure");
    const pressure = pressureId === "pressure:*" ? allSources.filter(source => source.type === "pressure") : allSources.filter(source => source.id === pressureId);
    if (!elevation || !pressure.length) {
      element("comparisonSummary").innerHTML = '<div class="empty-row">Choose one saved elevation profile and at least one pressure logger.</div>';
      element("comparisonChart").innerHTML = "";
      return;
    }
    const comparison = window.AquaComparisonCore.buildSpatialComparison(elevation, pressure, spatialInputOptions());
    view.spatialComparison = comparison;
    const samples = comparison.elevation.samples || [];
    const totalDistance = comparison.elevation.distance || comparison.elevation.statistics?.totalDistance || samples.at(-1)?.distance || 1;
    const terrainScale = scaleDetails(samples.map(sample => sample.elevation), PLOT.top, PLOT.bottom);
    const pressureScale = scaleDetails(comparison.loggers.map(logger => logger.pressure), PLOT.top, PLOT.bottom);
    const pair = window.AquaVisualStyles.comparisonPair("elevation", "pressure");
    const terrain = `<path d="${spatialPath(samples, totalDistance, terrainScale.value)}" fill="none" stroke="${pair.A}" stroke-width="3"/>`;
    const loggers = comparison.loggers.map(logger => {
      const x = PLOT.left + logger.chainage / Math.max(1, totalDistance) * (PLOT.right - PLOT.left);
      const y = pressureScale.value(logger.pressure);
      return `<circle data-spatial-logger="${escape(logger.entityId)}" cx="${x}" cy="${y}" r="6" fill="${pair.B}" stroke="#fff" stroke-width="2"><title>${escape(logger.label)} · ${format(logger.pressure)} m · offset ${format(logger.offset)} m</title></circle>`;
    }).join("");
    const svg = element("comparisonChart");
    svg.setAttribute("viewBox", "0 0 760 300");
    svg.innerHTML = `<rect x="${PLOT.left}" y="${PLOT.top}" width="${PLOT.right - PLOT.left}" height="${PLOT.bottom - PLOT.top}" fill="#07141e" stroke="#294150"/>${valueTicks(terrainScale, PLOT.left, PLOT.top, PLOT.bottom, pair.A, "left", "Terrain elevation (m)")}${valueTicks(pressureScale, PLOT.right, PLOT.top, PLOT.bottom, pair.B, "right", "Pressure (m)")}${chainageAxis(totalDistance)}${terrain}${loggers}`;
    const modeLabel = comparison.pressureMode.replace(/^./, value => value.toUpperCase());
    element("comparisonSummary").innerHTML = `<div class="comparison-stat"><span>Profile</span><b>${escape(elevation.label)}</b></div><div class="comparison-stat"><span>Corridor</span><b>${format(comparison.corridorMetres, 0)} m · ${comparison.loggers.length} logger(s)</b></div><div class="comparison-stat"><span>Pressure value</span><b>${escape(modeLabel)}</b></div><div class="spatial-results">${comparison.loggers.map(logger => `<button type="button" data-spatial-result="${escape(logger.entityId)}"><b>${escape(logger.label)}</b><span>${format(logger.chainage)} m chainage · ${format(logger.offset)} m offset</span><span>Terrain ${format(logger.terrainElevation)} m · pressure ${format(logger.pressure)} m</span><span>Δ terrain ${format(logger.terrainElevationDifference)} m · Δ pressure ${format(logger.pressureDifference)} m · pressure head minus terrain ${format(logger.pressureHeadMinusTerrain)} m</span></button>`).join("") || '<div class="empty-row">No pressure loggers fall inside this corridor.</div>'}</div><p class="comparison-caveat">Terrain is external DEM evidence, not surveyed pipe elevation. Pressure head minus terrain is descriptive and is not HGL.</p>`;
    element("comparisonProvenance").innerHTML = `<span><b>${escape(elevation.id)}</b> ${escape(elevation.provenance?.source || elevation.provenance?.provider || "unknown")} · ${escape(elevation.provenance?.dataset || "dataset not stated")} · ${escape(elevation.provenance?.resolution || "resolution not stated")}</span>${comparison.loggers.map(logger => `<span><b>pressure:${escape(logger.entityId)}</b> ${escape(typeof logger.provenance === "string" ? logger.provenance : logger.provenance?.filename || logger.provenance?.type || "unknown")}</span>`).join("")}`;
  }

  function render() {
    refreshSelectors();
    const spatial = view.domain === "spatial";
    document.querySelectorAll("[data-comparison-domain]").forEach(button => button.classList.toggle("active", button.dataset.comparisonDomain === view.domain));
    document.querySelector(".comparison-controls")?.classList.toggle("hidden", spatial);
    element("spatialComparisonControls")?.classList.toggle("hidden", !spatial);
    if (spatial) return renderSpatial();
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
    const pair = window.AquaVisualStyles.comparisonPair(comparison.sourceA.type, comparison.sourceB.type);
    element("comparisonSummary").innerHTML = `${summaryCard("A", comparison.sourceA, pair.A)}${summaryCard("B", comparison.sourceB, pair.B)}<div class="comparison-stat"><span>Overlap</span><b>${escape(overlap)}</b></div><div class="comparison-stat"><span>Correlation</span><b>${escape(correlation)}</b></div>`;
    element("comparisonProvenance").innerHTML = comparison.provenance.map(item => `<span><b>${escape(item.id)}</b> ${escape(typeof item.provenance === "string" ? item.provenance : item.provenance?.filename || item.provenance?.dataset || item.provenance?.provider || item.provenance?.type || "unknown")}${item.eventOnly ? " · event-only" : ""}</span>`).join("");
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

  function clearSpatialMarkers() {
    view.spatialMarkers.forEach(marker => window.aquaState?.map?.removeLayer(marker));
    view.spatialMarkers = [];
  }

  function spatialLogger(entityId) {
    return view.spatialComparison?.loggers.find(logger => String(logger.entityId) === String(entityId)) || null;
  }

  function highlightSpatialLogger(logger) {
    clearSpatialMarkers();
    if (!logger || !window.aquaState?.map || typeof L === "undefined") return;
    view.spatialMarkers.push(
      L.circleMarker(logger.projectedCoordinate, { radius: 7, color: "#fff", fillColor: COLORS.elevation, fillOpacity: 1, weight: 2 }).addTo(window.aquaState.map),
      L.circleMarker(logger.coordinate, { radius: 9, color: "#fff", fillColor: COLORS.pressure, fillOpacity: 0.35, weight: 3 }).addTo(window.aquaState.map)
    );
  }

  function focusSpatialLogger(entityId) {
    const logger = spatialLogger(entityId);
    if (!logger) return;
    highlightSpatialLogger(logger);
    window.aquaState?.map?.setView(logger.coordinate, Math.max(window.aquaState.map.getZoom(), 16));
    window.AquaContextual?.selectTelemetry(logger.entityId);
  }

  function bindCursor() {
    const svg = element("comparisonChart");
    svg?.addEventListener("pointermove", event => {
      if (view.domain === "spatial") {
        const logger = spatialLogger(event.target.closest?.("[data-spatial-logger]")?.dataset.spatialLogger);
        highlightSpatialLogger(logger);
        return;
      }
      if (!view.comparison || !view.range) return;
      const bounds = svg.getBoundingClientRect();
      const svgX = (event.clientX - bounds.left) / bounds.width * 760;
      const fraction = Math.max(0, Math.min(1, (svgX - PLOT.left) / (PLOT.right - PLOT.left)));
      const x = PLOT.left + fraction * (PLOT.right - PLOT.left);
      const time = view.range.start + fraction * (view.range.end - view.range.start);
      const line = element("comparisonCursorLine");
      line?.setAttribute("x1", x); line?.setAttribute("x2", x); line?.setAttribute("opacity", "0.8");
      const rows = [view.comparison.sourceA, view.comparison.sourceB].map((source, index) => {
        const item = nearest(chartItems(source), time);
        const key = index ? "B" : "A";
        if (!item) return { key, text: `${source.label}: no data` };
        return { key, text: `${source.label}: ${source.eventOnly ? item.label : `${format(item.value)} ${source.unit}`}` };
      });
      const cursor = element("comparisonCursor");
      cursor.innerHTML = `<b>${new Date(time).toLocaleString()}</b><span style="color:${view.colors.A}">A · ${escape(rows[0].text)}</span><span style="color:${view.colors.B}">B · ${escape(rows[1].text)}</span>`;
      cursor.style.left = `${Math.min(bounds.width - 190, Math.max(4, event.clientX - bounds.left + 10))}px`;
      cursor.classList.remove("hidden");
    });
    svg?.addEventListener("pointerleave", () => {
      clearSpatialMarkers();
      element("comparisonCursor")?.classList.add("hidden");
      element("comparisonCursorLine")?.setAttribute("opacity", "0");
    });
    svg?.addEventListener("wheel", event => {
      if (view.domain === "spatial") return;
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
      if (view.domain === "temporal" && view.sourceA === view.sourceB) {
        const alternative = sources().find(source => source.id !== event.target.value)?.id || null;
        if (id === "comparisonSourceA") view.sourceB = alternative;
        else view.sourceA = alternative;
      }
      render();
    }));
    document.querySelectorAll("[data-comparison-domain]").forEach(button => button.addEventListener("click", () => {
      view.domain = button.dataset.comparisonDomain;
      document.querySelectorAll("[data-comparison-domain]").forEach(item => item.classList.toggle("active", item === button));
      clearSpatialMarkers();
      render();
    }));
    ["spatialPressureMode", "spatialTimestamp", "spatialStart", "spatialEnd", "spatialCorridor"].forEach(id => element(id)?.addEventListener("change", render));
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
    element("comparisonSummary")?.addEventListener("click", event => {
      const entityId = event.target.closest?.("[data-spatial-result]")?.dataset.spatialResult;
      if (entityId) focusSpatialLogger(entityId);
    });
    element("projectSelect")?.addEventListener("change", () => setTimeout(render, 100));
    window.addEventListener("aqua:project-activated", render);
    window.addEventListener("aqua:elevation-profiles-changed", render);
    window.addEventListener("aqua:visual-style-changed", render);
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

  window.AquaComparison = { render, openForSource(id) { view.sourceA = id; if (id.startsWith("elevation:")) view.domain = "spatial"; render(); window.AquaWindowManager?.restore("comparison"); }, openSpatialForSource(id) { view.domain = "spatial"; view.sourceA = id; render(); window.AquaWindowManager?.restore("comparison"); }, cancelPicking };
  window.addEventListener("load", bind);
})();