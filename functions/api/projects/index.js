import {
  apiError, deleteObjects, findProject, insertProjectStatement, json, projectFromRow,
  projectMetadata, requireBindings, requireReadAccess, requireWriteAccess, safeFilename, safeProjectId
} from "../../_lib/projects.js";

export async function onRequestGet({ request, env }) {
  const denied = requireReadAccess(request, env);
  if (denied) return denied;
  try {
    requireBindings(env);
    const result = await env.AQUA_DB.prepare("SELECT * FROM projects WHERE status != 'deleted' ORDER BY updated_at DESC").all();
    return json({ projects: (result.results || []).map(row => projectFromRow(row)) });
  } catch (error) {
    console.error("Could not load projects", error);
    return apiError(500, "Could not load projects");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireWriteAccess(request, env);
  if (denied) return denied;
  const uploadedKeys = [];
  try {
    requireBindings(env);
    if (!request.headers.get("content-type")?.includes("multipart/form-data")) return apiError(415, "Expected multipart project upload");
    const form = await request.formData();
    let project;
    try { project = JSON.parse(String(form.get("project") || "{}")); }
    catch { return apiError(400, "Project metadata must be valid JSON"); }
    const source = form.get("source");
    if (!source || typeof source.arrayBuffer !== "function") return apiError(400, "Original source file is required");
    let id;
    try { id = safeProjectId(project.id); }
    catch (error) { return apiError(400, error.message); }
    if (await findProject(env, id)) return apiError(409, "Project already exists");

    const version = 1;
    project.version = version;
    project.cloudRevision = version;
    project.normalizedCrs ||= "EPSG:4326";
    const prefix = `projects/${id}/versions/${version}`;
    const sourceKey = `${prefix}/source/${safeFilename(source.name, project.source || "source.zip")}`;
    const dataKey = `${prefix}/normalized/project.json`;
    await env.AQUA_PROJECTS.put(sourceKey, source.stream(), { httpMetadata: { contentType: source.type || "application/octet-stream" } });
    uploadedKeys.push(sourceKey);
    await env.AQUA_PROJECTS.put(dataKey, JSON.stringify(project), { httpMetadata: { contentType: "application/json" } });
    uploadedKeys.push(dataKey);

    const telemetryKeys = [];
    for (const file of form.getAll("telemetry")) {
      if (!file || typeof file.arrayBuffer !== "function") continue;
      const key = `${prefix}/telemetry/${safeFilename(file.name)}`;
      await env.AQUA_PROJECTS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      uploadedKeys.push(key);
      telemetryKeys.push(key);
    }
    const r2Objects = { source: sourceKey, normalized: dataKey, telemetry: telemetryKeys };
    const metadata = projectMetadata(project, r2Objects, version);
    await insertProjectStatement(env, metadata).run();
    return json({ project: { ...projectFromRow({
      id: metadata.id, name: metadata.name, utility: metadata.utility, created_at: metadata.created,
      updated_at: metadata.updated, source_crs: metadata.sourceCrs, normalized_crs: metadata.normalizedCrs,
      status: metadata.status, source_filename: metadata.sourceFilename, r2_objects: JSON.stringify(r2Objects),
      layer_inventory: JSON.stringify(metadata.layerInventory), version
    }), r2Objects } }, 201);
  } catch (error) {
    await deleteObjects(env, uploadedKeys);
    console.error("Could not create project", error);
    return apiError(500, "Could not create project");
  }
}