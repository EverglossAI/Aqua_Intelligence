import { apiError, findProject, requireBindings, requireReadAccess, safeProjectId } from "../../../_lib/projects.js";

export async function onRequestGet({ request, params, env }) {
  const denied = requireReadAccess(request, env);
  if (denied) return denied;
  try {
    requireBindings(env);
    let id;
    try { id = safeProjectId(params.id); }
    catch (error) { return apiError(400, error.message); }
    const row = await findProject(env, id);
    if (!row) return apiError(404, "Project not found");
    const key = JSON.parse(row.r2_objects || "{}").normalized;
    if (!key) return apiError(404, "Project payload is unavailable");
    const object = await env.AQUA_PROJECTS.get(key);
    if (!object) return apiError(404, "Project payload is unavailable");
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/json; charset=utf-8",
        "cache-control": "private, no-cache",
        etag: object.httpEtag || object.etag || `W/\"project-${row.id}-${row.version}\"`,
        "x-aqua-project-version": String(row.version)
      }
    });
  } catch (error) {
    console.error("Could not load project payload", error);
    return apiError(500, "Could not load project payload");
  }
}