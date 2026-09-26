import { apiError, json, readJson, requireReadAccess } from "../lib/projects.js";
import { interpretCommand, summarizeToolResult } from "../lib/ai-intents.js";

function entityLog(entities = {}) {
  return {
    dma: entities.dma ? { id: entities.dma.id || null, code: entities.dma.code || entities.dma.dmaCode || null } : null,
    assets: (entities.assets || []).map(asset => ({ id: asset.id, type: asset.type || null })),
    alert: entities.alert ? { id: entities.alert.id, type: entities.alert.type || null } : null
  };
}

function writeLog(command, response, resultId = null) {
  console.log(JSON.stringify({
    event: "aqua_ai_command",
    userCommand: String(command || ""),
    resolvedIntent: response.intent || null,
    resolvedEntities: entityLog(response.entities),
    toolCalled: response.tool?.name || null,
    resultId,
    modelExplanation: response.explanation || response.reason || response.clarification?.question || null
  }));
}

function validCatalog(catalog) {
  return [catalog?.dmas, catalog?.assets, catalog?.alerts].every(items => items == null || (Array.isArray(items) && items.length <= 10000));
}

export async function routeAiRequest(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/ai/interpret" && pathname !== "/api/ai/summarize") return null;
  if (request.method !== "POST") return apiError(405, "Method not allowed", { allow: ["POST"] });
  const denied = requireReadAccess(request, env);
  if (denied) return denied;
  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const body = parsed.value || {};

  if (pathname === "/api/ai/summarize") {
    try {
      const summary = summarizeToolResult(body.toolResult);
      writeLog(body.command || "Explain retained result", {
        intent: summary.intent,
        entities: {},
        tool: { name: "RESULT_EXPLAIN" },
        explanation: `Explained supplied facts calculated by ${summary.provenance.calculatedBy}.`
      }, summary.resultId);
      return json({ summary }, 200, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(400, error.message);
    }
  }

  const command = String(body.command || "").trim();
  if (command.length > 1000) return apiError(413, "AI command is too long");
  if (!validCatalog(body.catalog)) return apiError(413, "Entity catalog is too large or invalid");
  const plan = interpretCommand(command, { catalog: body.catalog, context: body.context });
  writeLog(command, plan);
  return json({ plan }, 200, { "cache-control": "private, no-store" });
}