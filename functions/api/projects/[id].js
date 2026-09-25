import {
  apiError, deleteObjects, findProject, json, projectFromRow, projectMetadata,
  readJson, requireBindings, requireReadAccess, requireWriteAccess, safeProjectId, updateProjectStatement
} from "../../_lib/projects.js";

export async function onRequestGet({ request, params, env }) {
  const denied = requireReadAccess(request, env);
  if (denied) return denied;
  try {
    requireBindings(env);
    let id;
    try { id = safeProjectId(params.id); }
    catch (error) { return apiError(400, error.message); }
    const row = await findProject(env, id);
    return row ? json({ project: projectFromRow(row, true) }) : apiError(404, "Project not found");
  } catch (error) {
    console.error("Could not load project", error);
    return apiError(500, "Could not load project");
  }
}

export async function onRequestPut({ request, params, env }) {
  const denied = requireWriteAccess(request, env);
  if (denied) return denied;
  let dataKey;
  try {
    requireBindings(env);
    let id;
    try { id = safeProjectId(params.id); }
    catch (error) { return apiError(400, error.message); }
    const parsed = await readJson(request);
    if (parsed.error) return parsed.error;
    const body = parsed.value;
    const project = body.project || body;
    const expectedVersion = Number(body.expectedVersion ?? project.cloudRevision ?? project.version);
    const current = await findProject(env, id);
    if (!current) return apiError(404, "Project not found");
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(current.version)) {
      return apiError(409, "Project revision conflict", { cloudVersion: Number(current.version) });
    }

    const version = expectedVersion + 1;
    project.id = id;
    project.version = version;
    project.cloudRevision = version;
    project.normalizedCrs ||= "EPSG:4326";
    dataKey = `projects/${id}/versions/${version}/normalized/project.json`;
    await env.AQUA_PROJECTS.put(dataKey, JSON.stringify(project), { httpMetadata: { contentType: "application/json" } });
    const r2Objects = { ...JSON.parse(current.r2_objects || "{}"), normalized: dataKey };
    const metadata = projectMetadata(project, r2Objects, version);
    const result = await updateProjectStatement(env, metadata, expectedVersion).run();
    if (!result.meta?.changes) {
      await env.AQUA_PROJECTS.delete(dataKey);
      return apiError(409, "Project revision changed during save");
    }
    return json({ project: projectFromRow({ ...current,
      name: metadata.name, utility: metadata.utility, updated_at: metadata.updated,
      source_crs: metadata.sourceCrs, normalized_crs: metadata.normalizedCrs,
      status: metadata.status, source_filename: metadata.sourceFilename,
      r2_objects: JSON.stringify(r2Objects), layer_inventory: JSON.stringify(metadata.layerInventory), version
    }) });
  } catch (error) {
    if (dataKey) await deleteObjects(env, [dataKey]);
    console.error("Could not update project", error);
    return apiError(500, "Could not update project");
  }
}