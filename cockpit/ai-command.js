(() => {
  "use strict";

  const INTERPRET_ENDPOINT = "/api/ai/interpret";
  const SUMMARY_ENDPOINT = "/api/ai/summarize";
  let latestResult = null;

  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const identifier = feature => {
    const properties = feature?.properties || {};
    const key = Object.keys(properties).find(name => ["unific_id", "pipe_id", "id", "gid", "objectid", "fid"].includes(name.toLowerCase()));
    return key ? String(properties[key]) : null;
  };

  function catalog(project) {
    const telemetry = (project.telemetry || []).map(asset => ({ id: String(asset.id || asset._id), type: asset.type, dmaCode: asset.dmaCode || asset.dma_code || null }));
    const network = (project.layers || []).flatMap(layer => (layer.geojson?.features || []).map(feature => {
      const id = identifier(feature);
      return id ? { id, type: layer.kind, layer: layer.name } : null;
    })).filter(Boolean);
    return {
      dmas: (project.logicalDmas || project.lambayDemo?.logicalDmas || []).map(dma => ({ id: dma.logical_dma_uid, code: dma.dma_code, label: dma.label || dma.dma_name, aliases: dma.aliases || [] })),
      assets: [...telemetry, ...network].slice(0, 10000),
      alerts: (project.acousticAlert || []).map(alert => ({ id: String(alert.alertId || alert.id), type: "acoustic", dmaCode: alert.dmaCode || null }))
    };
  }

  function context(project) {
    const investigation = window.AquaInvestigationContext?.current || {};
    return {
      projectId: project.id,
      dmaCode: investigation.selectedDMA?.code || null,
      selectedAssetId: investigation.selectedAsset?.identity?.id || null,
      resultId: latestResult?.resultId || null,
      resultCalculator: latestResult?.calculator || null
    };
  }

  async function post(url, body) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `AI Worker returned ${response.status}`);
    return payload;
  }

  function sourceId(asset) {
    return `${asset.type}:${asset.id}`;
  }

  function showDma(dmaCode) {
    if (!dmaCode) return;
    window.AquaLambayDemo?.focusDma?.(dmaCode);
  }

  function setAlertPeriod(alert, relation) {
    const eventDate = new Date(alert?.detectionDate);
    if (!relation || Number.isNaN(eventDate.getTime())) return;
    const offset = relation === "before" ? -7 : 7;
    const otherDate = new Date(eventDate);
    otherDate.setUTCDate(otherDate.getUTCDate() + offset);
    const start = relation === "before" ? otherDate : eventDate;
    const end = relation === "before" ? eventDate : otherDate;
    const startInput = document.getElementById("environmentalStart");
    const endInput = document.getElementById("environmentalEnd");
    if (startInput) startInput.value = start.toISOString().slice(0, 10);
    if (endInput) endInput.value = end.toISOString().slice(0, 10);
  }

  async function executePlan(plan) {
    const args = plan.tool.arguments;
    const project = window.aquaState.active;
    const resultId = `${plan.intent.toLowerCase()}-${Date.now()}`;
    showDma(args.dmaCode);
    switch (plan.tool.name) {
      case "GIS_SHOW_ASSETS": {
        if (args.assetIds[0]) window.AquaContextual?.selectTelemetry?.(args.assetIds[0]);
        else window.AquaProjectQueries?.run?.(`show ${args.assetType || "pipe"}s`);
        return { resultId, calculator: "GIS", facts: [`Displayed ${args.assetType || "network asset"}${args.dmaCode ? ` records for DMA ${args.dmaCode}` : " records"}.`] };
      }
      case "GIS_FILTER_NETWORK": {
        const filtered = window.AquaContextual?.filterPipes?.({ dmaCode: args.dmaCode, materials: args.material ? [args.material] : [], diameters: Number.isFinite(args.diameterMm) ? [args.diameterMm] : [] });
        if (!filtered) throw new Error("Network filter tool is unavailable");
        return { resultId, calculator: "GIS", facts: [`Filtered network: ${filtered.count} pipes, ${(filtered.totalLength / 1000).toFixed(2)} km.`, `Criteria: ${[args.dmaCode, args.material, Number.isFinite(args.diameterMm) ? `${args.diameterMm} mm` : null].filter(Boolean).join(" / ") || "none"}.`] };
      }
      case "COMPARE_SOURCES": {
        const assets = plan.entities.assets;
        window.AquaComparison?.openForSources?.(sourceId(assets[0]), sourceId(assets[1]));
        return { resultId, calculator: "Compare", facts: [`Opened deterministic comparison for ${assets[0].id} and ${assets[1].id}.`] };
      }
      case "LEAK_RISK_SHOW": {
        if (args.dmaCode) window.AquaContextual?.filterPipes?.({ dmaCode: args.dmaCode, materials: [], diameters: [] });
        const results = window.AquaLeakRisk?.render?.() || [];
        window.AquaWindowManager?.restore("events");
        const requestedClass = args.riskLevel ? args.riskLevel.replace(/^./, value => value.toUpperCase()) : null;
        const scoped = args.dmaCode ? results.filter(result => window.AquaDmaPipeFilters?.matchesFeature?.(result.pipe?.feature || result.pipe) !== false) : results;
        const matching = requestedClass ? scoped.filter(result => result.classification === requestedClass) : scoped;
        return { resultId, calculator: "Leak Risk", facts: [`Leak Risk returned ${matching.length} ${requestedClass || "ranked"} pipe records.`, "Priority indicates investigation need, not confirmed leakage."] };
      }
      case "ENVIRONMENTAL_CONTEXT_SHOW": {
        const alert = (project.acousticAlert || []).find(item => String(item.alertId || item.id) === String(args.alertId));
        if (alert) window.AquaAcoustics?.selectAlert?.(alert);
        setAlertPeriod(alert, args.temporalRelation);
        const coordinate = Number.isFinite(alert?.lat) && Number.isFinite(alert?.lng) ? [alert.lat, alert.lng] : null;
        window.AquaEnvironmental?.open?.(coordinate ? { coordinate, label: `Alert ${args.alertId}`, pipeId: alert.matchedPipeId || null, alerts: [alert] } : {});
        return { resultId, calculator: "Environmental", facts: [`Opened environmental context${args.alertId ? ` for alert ${args.alertId}` : " for the active selection"}.`] };
      }
      case "ELEVATION_SHOW": {
        const opened = args.dmaCode ? window.AquaContextual?.openDmaElevation?.(args.dmaCode) : false;
        if (!opened) window.AquaWindowManager?.restore("elevation-profile");
        return { resultId, calculator: "Elevation", facts: [`Opened elevation context${args.dmaCode ? ` for DMA ${args.dmaCode}` : ""}.`, "Terrain remains separate from hydraulic node elevations."] };
      }
      case "EPANET_RUN": {
        window.AquaWindowManager?.restore("hydraulics");
        return window.AquaHydraulics.runScenario("base", { dmaCodes: args.dmaCode ? [args.dmaCode] : undefined, persist: false });
      }
      case "HYDRAULIC_DIAGNOSTICS":
        return window.AquaHydraulics.diagnose({ dmaCodes: args.dmaCode ? [args.dmaCode] : [], assetIds: args.assetIds || [], diagnosticFocus: args.diagnosticFocus || null });
      case "RESULT_EXPLAIN": {
        if (!latestResult || latestResult.resultId !== args.resultId) throw new Error("The retained result is no longer available");
        return latestResult;
      }
      default:
        throw new Error("Unsupported deterministic tool plan");
    }
  }

  function renderSummary(summary, facts) {
    const factMarkup = facts.map(fact => escape(fact)).join("<br>");
    return `${factMarkup}<br><span class="thinking">Interpreted by AI · Calculated by: ${escape(summary.provenance.calculatedBy)}</span>`;
  }

  const fallbackAsk = window.askCopilot || askCopilot;
  askCopilot = async function(question) {
    const project = window.aquaState?.active;
    if (!project) return fallbackAsk(question);
    addUser(question);
    try {
      const { plan } = await post(INTERPRET_ENDPOINT, { command: question, catalog: catalog(project), context: context(project) });
      if (plan.status === "clarification_required") return addAi(`${escape(plan.clarification.question)}${plan.clarification.candidates?.length ? `<br>${plan.clarification.candidates.map(candidate => escape(candidate.label || candidate.code || candidate.id || candidate)).join(" · ")}` : ""}`);
      if (plan.status === "refused") return addAi(escape(plan.reason));
      const toolResult = await executePlan(plan);
      latestResult = toolResult;
      const { summary } = await post(SUMMARY_ENDPOINT, { command: question, toolResult: { intent: plan.intent, ...toolResult } });
      aquaSetAiStatus("AI intent router connected · deterministic tools active.");
      addAi(renderSummary(summary, toolResult.facts));
    } catch (error) {
      aquaSetAiStatus("AI service unavailable · deterministic commands remain active.");
      addAi(`<b>AI routing unavailable:</b> ${escape(error.message)}<br><span class="thinking">No engineering values were generated.</span>`);
    }
  };

  window.AquaAiCommands = { catalog, executePlan, get latestResult() { return latestResult; } };
})();