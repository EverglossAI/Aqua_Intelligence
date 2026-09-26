(() => {
  "use strict";

  let selectedCode = null;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function issueLabel(code) {
    return String(code).replaceAll("_", " ").toLowerCase().replace(/^./, character => character.toUpperCase());
  }

  function issueSummary(issue) {
    const threshold = issue.threshold;
    const rule = threshold ? `${threshold.metric} ${threshold.operator} ${threshold.value}${threshold.unit ? ` ${threshold.unit}` : ""}` : "deterministic evidence rule";
    return `Triggered by ${rule}. Network conclusion: ${issue.networkConclusion}.`;
  }

  function assetId(feature) {
    const properties = feature?.properties || {};
    return String(feature?.id || properties.assetId || properties.pipeId || properties.id || properties.ID || properties.name || "");
  }

  function focusAsset(item) {
    if (/logger|meter/i.test(item.type)) {
      window.AquaContextual?.selectTelemetry?.(item.id);
      return;
    }
    if (Array.isArray(item.coordinate) && item.coordinate.length >= 2) {
      window.aquaState?.map?.setView(item.coordinate, 17);
      return;
    }
    for (const group of Object.values(window.aquaState?.kindLayers || {})) {
      let match = null;
      group?.eachLayer?.(container => container.eachLayer?.(layer => {
        if (assetId(layer.__aquaFeature) === String(item.id)) match = layer;
      }));
      if (!match) continue;
      if (match.getBounds) window.aquaState.map.fitBounds(match.getBounds(), { maxZoom: 18, padding: [36, 36] });
      else if (match.getLatLng) window.aquaState.map.setView(match.getLatLng(), 18);
      match.fire?.("click");
      return;
    }
  }

  function renderIssue(issue, assets) {
    const causes = issue.likelyCauses.map(cause => `<li class="cause-${escape(cause.assessment)}"><b>${escape(cause.label)}</b><span>${escape(cause.assessment)} · ${escape(cause.evidence)}</span></li>`).join("");
    const links = issue.affectedAssets.slice(0, 12).map(item => {
      const index = assets.push(item) - 1;
      return `<button type="button" class="diagnosis-asset" data-diagnosis-asset="${index}">${escape(item.id)} <span>${escape(item.type)}</span></button>`;
    }).join("");
    return `<section class="diagnosis-detail"><div class="diagnosis-detail-head"><div><small>${escape(issue.severity)} · ${escape(issue.confidence)} confidence</small><h3>${escape(issueLabel(issue.code))}</h3></div><span>${escape(issue.evidenceClassification)}</span></div><p>${escape(issueSummary(issue))}</p>${links ? `<div class="diagnosis-assets">${links}</div>` : ""}<h4>Evidence and causes</h4><ul class="diagnosis-causes">${causes || "<li><span>No cause is assigned from current evidence.</span></li>"}</ul></section>`;
  }

  function render(reasoning, options = {}) {
    const body = document.getElementById("hydraulicDiagnosisBody");
    if (!body || !reasoning) return;
    const issues = reasoning.diagnostics.filter(item => item.severity !== "INFO");
    selectedCode = options.focus && options.focus !== "DMA_SUMMARY" && issues.some(item => item.code === options.focus) ? options.focus : selectedCode;
    if (!issues.some(item => item.code === selectedCode)) selectedCode = issues[0]?.code || null;
    const selected = issues.find(item => item.code === selectedCode);
    const assets = [];
    const counts = issues.reduce((result, issue) => ({ ...result, [issue.severity.toLowerCase()]: (result[issue.severity.toLowerCase()] || 0) + 1 }), { error: 0, warning: 0 });
    const issueButtons = issues.map(issue => `<button type="button" class="diagnosis-issue ${issue.code === selectedCode ? "active" : ""}" data-diagnosis-code="${escape(issue.code)}"><span class="severity-${escape(issue.severity.toLowerCase())}">${escape(issue.severity)}</span><b>${escape(issueLabel(issue.code))}</b><small>${issue.affectedAssets.length} affected · ${escape(issue.confidence)}</small></button>`).join("");
    const limitations = reasoning.modelQuality.limitations.map(item => `<li>${escape(item)}</li>`).join("");
    const recommendations = reasoning.recommendations.slice(0, 8).map(item => `<li><b>${escape(item.category)}</b><span>${escape(item.label)}</span></li>`).join("");
    const dmaRows = reasoning.dmaSummaries.map(dma => `<tr><td>${escape(dma.dmaCode)}</td><td>${dma.pressure.minimumMetres == null ? "Unavailable" : escape(dma.pressure.minimumMetres.toFixed(1))}</td><td>${dma.headloss.maximumMetresPerKilometre == null ? "Unavailable" : escape(dma.headloss.maximumMetresPerKilometre.toFixed(1))}</td><td>${escape(dma.overallModelConfidence)}</td></tr>`).join("");
    const variant = options.variantComparison || reasoning.variantComparison;
    const variantMarkup = variant ? `<section class="diagnosis-variant"><h4>Variant evidence</h4><div><span>Service artefacts</span><b>${variant.classificationCounts?.["service-line artefact"] || 0}</b></div><div><span>Main candidates</span><b>${variant.classificationCounts?.["genuine-network candidate"] || 0}</b></div></section>` : "";
    const gateMessage = reasoning.modelQuality.strongDiagnosisAllowed ? "Hydraulic findings are suitable for screening, not design conclusions." : "Strong hydraulic diagnosis is not supported; pressure distribution is not a calibrated field prediction.";
    body.innerHTML = `<section class="diagnosis-quality quality-${escape(reasoning.modelQuality.status.toLowerCase())}"><div><small>MODEL CONFIDENCE</small><b>${escape(reasoning.modelQuality.status)}</b></div><div><span>Errors</span><b>${counts.error}</b></div><div><span>Warnings</span><b>${counts.warning}</b></div><p>${escape(gateMessage)}</p><ul>${limitations}</ul></section>
      <section><h4>Active issues</h4><div class="diagnosis-issue-list">${issueButtons || '<div class="empty-row">No active issue crosses the configured thresholds.</div>'}</div></section>
      ${selected ? renderIssue(selected, assets) : ""}${variantMarkup}
      <section><h4>Recommended next actions</h4><ol class="diagnosis-recommendations">${recommendations || "<li>No additional action generated.</li>"}</ol></section>
      <details class="diagnosis-dma"><summary>DMA summary</summary><div class="table-wrap"><table><thead><tr><th>DMA</th><th>Min pressure m</th><th>Max headloss m/km</th><th>Confidence</th></tr></thead><tbody>${dmaRows}</tbody></table></div></details>`;
    body.querySelectorAll("[data-diagnosis-code]").forEach(button => button.addEventListener("click", () => { selectedCode = button.dataset.diagnosisCode; render(reasoning, options); }));
    body.querySelectorAll("[data-diagnosis-asset]").forEach(button => button.addEventListener("click", () => focusAsset(assets[Number(button.dataset.diagnosisAsset)])));
  }

  window.AquaHydraulicDiagnosisUI = { render, focusAsset };
})();