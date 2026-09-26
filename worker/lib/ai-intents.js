export const SUPPORTED_INTENTS = Object.freeze([
  "SHOW_ASSETS",
  "FILTER_NETWORK",
  "COMPARE_SOURCES",
  "SHOW_LEAK_RISK",
  "SHOW_ENVIRONMENTAL_CONTEXT",
  "SHOW_ELEVATION",
  "RUN_HYDRAULIC_ANALYSIS",
  "DIAGNOSE_HYDRAULICS",
  "EXPLAIN_RESULT"
]);

export const TOOL_REGISTRY = Object.freeze({
  SHOW_ASSETS: { name: "GIS_SHOW_ASSETS", calculatedBy: "GIS" },
  FILTER_NETWORK: { name: "GIS_FILTER_NETWORK", calculatedBy: "GIS" },
  COMPARE_SOURCES: { name: "COMPARE_SOURCES", calculatedBy: "Compare" },
  SHOW_LEAK_RISK: { name: "LEAK_RISK_SHOW", calculatedBy: "Leak Risk" },
  SHOW_ENVIRONMENTAL_CONTEXT: { name: "ENVIRONMENTAL_CONTEXT_SHOW", calculatedBy: "Environmental" },
  SHOW_ELEVATION: { name: "ELEVATION_SHOW", calculatedBy: "Elevation" },
  RUN_HYDRAULIC_ANALYSIS: { name: "EPANET_RUN", calculatedBy: "EPANET" },
  DIAGNOSE_HYDRAULICS: { name: "HYDRAULIC_DIAGNOSTICS", calculatedBy: "Hydraulic Reasoning Engine v1" },
  EXPLAIN_RESULT: { name: "RESULT_EXPLAIN", calculatedBy: null }
});

const MUTATION_PATTERN = /\b(delete|remove|import|upload|save|edit|update|rename|create|write|calibrat(?:e|ion))\b/i;
const OPERATION_MUTATION_PATTERN = /\b(?:resize|increase|decrease|change|set)\b.{0,40}\b(?:pipe|diameter|roughness|source head)\b|\b(?:open|close|operate|throttle|change|set)\b.{0,30}\bvalves?\b/i;
const IDENTIFIER_PATTERN = /\b[A-Z]{2,}(?:-\d+)+(?:-[A-Z0-9]+)*\b/gi;

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function classify(command) {
  if (/\b(compare|versus|vs\.?|correlat)/i.test(command)) return "COMPARE_SOURCES";
  if (/\b(hydraulic(?:ally)? healthy|hydraulic health|diagnos(?:e|is|tic)|too small|model.{0,20}match|why.{0,40}pressure|pressure.{0,20}(?:low|high))\b/i.test(command)) return "DIAGNOSE_HYDRAULICS";
  if (/\b(hydraulic|epanet|pressure simulation|run scenario)/i.test(command)) return "RUN_HYDRAULIC_ANALYSIS";
  if (/\b(rain|rainfall|weather|environment|temperature|wind)\b/i.test(command)) return "SHOW_ENVIRONMENTAL_CONTEXT";
  if (/\b(elevation|terrain profile|height profile)\b/i.test(command)) return "SHOW_ELEVATION";
  if (/\b(leak risk|risk score|high[- ]risk|medium[- ]risk|low[- ]risk)\b/i.test(command)) return "SHOW_LEAK_RISK";
  if (/\b(explain|why|interpret result|what does)\b/i.test(command)) return "EXPLAIN_RESULT";
  if (/\b(filter|only|diameter|material)\b/i.test(command)) return "FILTER_NETWORK";
  if (/\b(show|list|find|locate|zoom)\b/i.test(command) && /\b(asset|pipe|meter|valve|logger|network|dma)s?\b/i.test(command)) return "SHOW_ASSETS";
  return null;
}

function aliases(entity, fields) {
  return [...new Set(fields.flatMap(field => {
    const value = entity?.[field];
    return Array.isArray(value) ? value : value == null ? [] : [value];
  }).map(normalized).filter(Boolean))];
}

function matches(command, entities, fields) {
  const text = normalized(command);
  return (entities || []).filter(entity => aliases(entity, fields).some(alias => text.includes(alias)));
}

function clarification(question, candidates = []) {
  return { status: "clarification_required", clarification: { question, candidates } };
}

function resolveEntities(command, catalog, intent) {
  const dmaMatches = matches(command, catalog.dmas, ["id", "code", "label", "aliases"]);
  if (dmaMatches.length > 1) return clarification("Which DMA did you mean?", dmaMatches.map(dma => ({ id: dma.id, code: dma.code, label: dma.label })));
  const scopedName = command.match(/\b(?:in|for)\s+([A-Za-z][A-Za-z0-9 _-]*)$/i)?.[1]?.trim();
  if (scopedName && !dmaMatches.length && ["SHOW_ASSETS", "FILTER_NETWORK", "SHOW_LEAK_RISK", "SHOW_ENVIRONMENTAL_CONTEXT", "SHOW_ELEVATION", "RUN_HYDRAULIC_ANALYSIS"].includes(intent)) {
    return clarification(`I could not resolve DMA ${scopedName}. Choose a known DMA.`);
  }

  let assetMatches = matches(command, catalog.assets, ["id", "name", "label", "aliases"]);
  const identifiers = [...new Set(command.match(IDENTIFIER_PATTERN) || [])];
  if (intent === "DIAGNOSE_HYDRAULICS" && !assetMatches.length && identifiers.length) {
    assetMatches = (catalog.assets || []).filter(asset => identifiers.some(identifier => normalized(asset.id).startsWith(normalized(identifier))));
    if (assetMatches.length > 1) return clarification(`Which asset did you mean by ${identifiers[0]}?`, assetMatches.map(asset => ({ id: asset.id, type: asset.type })));
  }
  const unmatchedIdentifiers = identifiers.filter(identifier => !assetMatches.some(asset => normalized(asset.id) === normalized(identifier)));
  if (unmatchedIdentifiers.length && ["COMPARE_SOURCES", "SHOW_ASSETS", "FILTER_NETWORK", "SHOW_ELEVATION"].includes(intent)) {
    return clarification(`I could not resolve ${unmatchedIdentifiers.join(", ")}. Choose a known asset ID or refine the command.`);
  }
  const comparableTypes = new Set(["pressure", "flow", "acoustic", "elevation", "environment-rainfall", "environment-temperature", "environment-soil-moisture", "environment-evapotranspiration"]);
  if (intent === "COMPARE_SOURCES" && (assetMatches.length !== 2 || assetMatches.some(asset => !comparableTypes.has(asset.type)))) return clarification("Choose exactly two comparable monitoring, elevation, or environmental sources.", assetMatches.map(asset => ({ id: asset.id, type: asset.type })));

  const alertMatches = matches(command, catalog.alerts, ["id", "name", "label", "aliases"]);
  const alertReference = command.match(/\balert\s+([A-Za-z0-9_-]+)/i)?.[1];
  if (intent === "SHOW_ENVIRONMENTAL_CONTEXT" && alertReference && !alertMatches.length) return clarification(`I could not resolve alert ${alertReference}. Choose a known alert ID.`);
  if (alertMatches.length > 1) return clarification("Which alert did you mean?", alertMatches.map(alert => ({ id: alert.id, type: alert.type })));

  return {
    dma: dmaMatches[0] || null,
    assets: assetMatches,
    alert: alertMatches[0] || null
  };
}

function toolArguments(command, intent, entities, context) {
  const riskLevel = command.match(/\b(high|medium|low)[- ]risk\b/i)?.[1]?.toLowerCase() || null;
  const assetType = command.match(/\b(pipe|meter|valve|logger)s?\b/i)?.[1]?.toLowerCase() || null;
  const material = command.match(/\b(PVC|HDPE|PE|DIP|DI|STEEL|MS|GI|CI|AC)\b/i)?.[1]?.toUpperCase() || null;
  const diameterMm = Number(command.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i)?.[1]);
  const temporalRelation = intent === "SHOW_ENVIRONMENTAL_CONTEXT" ? command.match(/\b(before|after)\b/i)?.[1]?.toLowerCase() || null : null;
  const diagnosticFocus = intent === "DIAGNOSE_HYDRAULICS" ?
    /\btoo small|undersized\b/i.test(command) ? "UNDERSIZED_PIPE_INDICATION" :
      /\bmodel.{0,20}match|logger.{0,20}(?:residual|mismatch)\b/i.test(command) ? "LOGGER_MODEL_MISMATCH" :
        /\bhigh pressure\b/i.test(command) ? "HIGH_PRESSURE" :
          /\blow pressure\b|why.{0,40}pressure/i.test(command) ? "LOW_PRESSURE" :
            /\bhealthy|health\b/i.test(command) ? "DMA_SUMMARY" : null
    : null;
  const contextualAssetId = intent === "DIAGNOSE_HYDRAULICS" && /\bthis\s+(?:pipe|logger|asset)\b/i.test(command) ? context.selectedAssetId || null : null;
  return {
    projectId: context.projectId || null,
    dmaCode: entities.dma?.code || entities.dma?.dmaCode || (intent === "DIAGNOSE_HYDRAULICS" ? context.dmaCode || null : null),
    assetIds: uniqueStrings([...entities.assets.map(asset => asset.id), contextualAssetId]),
    alertId: entities.alert?.id || null,
    resultId: intent === "EXPLAIN_RESULT" ? context.resultId || null : null,
    ...(riskLevel ? { riskLevel } : {}),
    ...(assetType ? { assetType } : {}),
    ...(material ? { material } : {}),
    ...(Number.isFinite(diameterMm) ? { diameterMm } : {}),
    ...(temporalRelation ? { temporalRelation } : {}),
    ...(diagnosticFocus ? { diagnosticFocus } : {})
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function interpretCommand(command, options = {}) {
  const text = String(command || "").trim();
  const catalog = { dmas: [], assets: [], alerts: [], ...(options.catalog || {}) };
  const context = options.context || {};
  if (!text) return clarification("What would you like to inspect or calculate?");
  if (MUTATION_PATTERN.test(text) || OPERATION_MUTATION_PATTERN.test(text)) return { status: "refused", reason: "Aqua AI actions are read-only. Project mutation, import, deletion, calibration, resizing, and valve operation are not permitted." };

  const intent = classify(text);
  if (!intent) return clarification("I could not map that request to a supported read-only engineering action.", SUPPORTED_INTENTS);
  const entities = resolveEntities(text, catalog, intent);
  if (entities.status === "clarification_required") return entities;
  if (intent === "EXPLAIN_RESULT" && !context.resultId) return clarification("Which retained result should I explain?");

  const registeredTool = TOOL_REGISTRY[intent];
  const calculatedBy = intent === "EXPLAIN_RESULT" ? context.resultCalculator || null : registeredTool.calculatedBy;
  if (intent === "EXPLAIN_RESULT" && !calculatedBy) return clarification("The result calculator is unknown. Open a retained result with provenance first.");
  const resolvedEntities = { dma: entities.dma, assets: entities.assets, alert: entities.alert };
  return {
    status: "ready",
    intent,
    entities: resolvedEntities,
    tool: { name: registeredTool.name, readOnly: true, arguments: toolArguments(text, intent, resolvedEntities, context) },
    explanation: `Interpreted as ${intent}. Route to ${registeredTool.name}; engineering values must come from ${calculatedBy}.`,
    provenance: { interpretedBy: "AI", calculatedBy }
  };
}

export function summarizeToolResult(result) {
  const calculator = String(result?.calculator || "").trim();
  const allowedCalculators = new Set(["EPANET", "GIS", "Compare", "Environmental", "Leak Risk", "Elevation", "Hydraulic Reasoning Engine v1"]);
  if (!result?.resultId || !allowedCalculators.has(calculator) || !Array.isArray(result.facts)) throw new Error("A retained deterministic result with calculator provenance and facts is required");
  return {
    resultId: String(result.resultId),
    intent: SUPPORTED_INTENTS.includes(result.intent) ? result.intent : "EXPLAIN_RESULT",
    factCount: result.facts.filter(fact => typeof fact === "string" && fact.trim()).slice(0, 20).length,
    provenance: { interpretedBy: "AI", calculatedBy: calculator }
  };
}