import {
  apiError, deleteObjects, findProject, insertProjectStatement, json, projectFromRow,
  projectMetadata, projectSession, readJson, requireAdminAccess, requireBindings,
  requireReadAccess, requireWriteAccess, safeFilename, safeProjectId,
  sessionCapabilities, updateProjectStatement
} from "../lib/projects.js";

export function getSession({ request, env }) {
  return json(sessionCapabilities(projectSession(request, env)), 200, { "cache-control": "private, no-store" });
}

export async function listProjects({ request, env }) {
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

export async function createProject({ request, env }) {
  const denied = requireAdminAccess(request, env);
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

export async function getProject({ request, params, env }) {
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

export async function updateProject({ request, params, env }) {
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

export async function getProjectData({ request, params, env }) {
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
        etag: object.httpEtag || object.etag || `W/"project-${row.id}-${row.version}"`,
        "x-aqua-project-version": String(row.version)
      }
    });
  } catch (error) {
    console.error("Could not load project payload", error);
    return apiError(500, "Could not load project payload");
  }
}

function acousticStatements(env, projectId, data) {
  const statements = [
    env.AQUA_DB.prepare("DELETE FROM acoustic_sensors WHERE project_id = ?").bind(projectId),
    env.AQUA_DB.prepare("DELETE FROM acoustic_couples WHERE project_id = ?").bind(projectId),
    env.AQUA_DB.prepare("DELETE FROM acoustic_alerts WHERE project_id = ?").bind(projectId)
  ];
  for (const sensor of data.acousticSensor) statements.push(env.AQUA_DB.prepare(`INSERT INTO acoustic_sensors (
    project_id, sensor_id, status, latitude, longitude, matched_pipe_id, confidence, review_required, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    projectId, sensor.sensorId, sensor.status || "", sensor.lat, sensor.lng, sensor.matchedPipeId,
    Number(sensor.confidence || 0), sensor.reviewRequired ? 1 : 0, JSON.stringify(sensor)
  ));
  for (const couple of data.acousticCouple) statements.push(env.AQUA_DB.prepare(`INSERT INTO acoustic_couples (
    project_id, couple_id, sensor_1_id, sensor_2_id, material, last_activity, overlapping, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    projectId, couple.coupleId, couple.sensor1Id, couple.sensor2Id, couple.material,
    couple.lastActivity, couple.overlapping ? 1 : 0, JSON.stringify(couple)
  ));
  for (const alert of data.acousticAlert) statements.push(env.AQUA_DB.prepare(`INSERT INTO acoustic_alerts (
    project_id, alert_id, couple_id, alert_type, status, state_group, probability, detection_date,
    matched_pipe_id, confidence, review_required, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    projectId, alert.alertId, alert.coupleId, alert.alertType, alert.status, alert.stateGroup,
    alert.probability, alert.detectionDate, alert.matchedPipeId, Number(alert.confidence || 0),
    alert.reviewRequired ? 1 : 0, JSON.stringify(alert)
  ));
  return statements;
}

function validAcousticData(data) {
  return data && Array.isArray(data.acousticSensor) && Array.isArray(data.acousticCouple) && Array.isArray(data.acousticAlert)
    && data.acousticSensor.every(item => item.entityType === "acousticSensor" && item.sensorId)
    && data.acousticCouple.every(item => item.entityType === "acousticCouple" && item.coupleId)
    && data.acousticAlert.every(item => item.entityType === "acousticAlert" && item.alertId);
}

export async function importProjectAcoustics({ request, params, env }) {
  const denied = requireAdminAccess(request, env);
  if (denied) return denied;
  const uploadedKeys = [];
  try {
    requireBindings(env);
    const id = safeProjectId(params.id);
    const current = await findProject(env, id);
    if (!current) return apiError(404, "Project not found");
    if (!request.headers.get("content-type")?.includes("multipart/form-data")) return apiError(415, "Expected multipart acoustic import");
    const form = await request.formData();
    const dataFile = form.get("data");
    const sourceFiles = form.getAll("source").filter(file => file && typeof file.arrayBuffer === "function");
    if (!dataFile || typeof dataFile.text !== "function") return apiError(400, "Normalized acoustic data is required");
    let data;
    try { data = JSON.parse(await dataFile.text()); }
    catch { return apiError(400, "Normalized acoustic data must be valid JSON"); }
    if (!validAcousticData(data)) return apiError(400, "Normalized acoustic entities are invalid");
    if (sourceFiles.length !== 3) return apiError(400, "All three original acoustic reports are required");

    const currentR2Objects = JSON.parse(current.r2_objects || "{}");
    const currentObject = await env.AQUA_PROJECTS.get(currentR2Objects.normalized);
    if (!currentObject) return apiError(404, "Current project payload is unavailable");
    const project = await new Response(currentObject.body).json();
    const version = Number(current.version) + 1;
    const prefix = `projects/${id}/versions/${version}/acoustics`;
    const sourceKeys = [];
    for (const file of sourceFiles) {
      const key = `${prefix}/source/${safeFilename(file.name)}`;
      await env.AQUA_PROJECTS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      uploadedKeys.push(key);
      sourceKeys.push(key);
    }
    const acousticKey = `${prefix}/normalized/lambay-acoustic-operational-data.json`;
    await env.AQUA_PROJECTS.put(acousticKey, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
    uploadedKeys.push(acousticKey);
    Object.assign(project, data, { version, cloudRevision: version });
    project.provenance = { ...(project.provenance || {}), acoustic: data.acousticProvenance };
    const projectKey = `projects/${id}/versions/${version}/normalized/project.json`;
    const r2Objects = {
      ...currentR2Objects,
      normalized: projectKey,
      acoustic: { normalized: acousticKey, sources: sourceKeys }
    };
    project.r2Objects = r2Objects;
    await env.AQUA_PROJECTS.put(projectKey, JSON.stringify(project), { httpMetadata: { contentType: "application/json" } });
    uploadedKeys.push(projectKey);
    const metadata = projectMetadata(project, r2Objects, version);
    const results = await env.AQUA_DB.batch([
      updateProjectStatement(env, metadata, Number(current.version)),
      ...acousticStatements(env, id, data)
    ]);
    if (!results[0]?.meta?.changes) throw new Error("Project revision changed during acoustic import");
    return json({ projectId: id, version, r2Objects: r2Objects.acoustic, summary: data.acousticSummary });
  } catch (error) {
    await deleteObjects(env, uploadedKeys);
    console.error("Could not import project acoustics", error);
    return apiError(500, "Could not import project acoustics");
  }
}

function methodNotAllowed(allowed) {
  return json({ error: "Method not allowed" }, 405, { allow: allowed.join(", ") });
}

function decodeProjectId(value) {
  try { return { value: decodeURIComponent(value) }; }
  catch { return { error: apiError(400, "Invalid project ID") }; }
}

export async function routeProjectRequest(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  if (pathname === "/api/session") {
    if (method === "GET") return getSession({ request, env });
    return methodNotAllowed(["GET"]);
  }

  if (pathname === "/api/projects") {
    if (method === "GET") return listProjects({ request, env });
    if (method === "POST") return createProject({ request, env });
    return methodNotAllowed(["GET", "POST"]);
  }

  const dataMatch = pathname.match(/^\/api\/projects\/([^/]+)\/data$/);
  if (dataMatch) {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const id = decodeProjectId(dataMatch[1]);
    return id.error || getProjectData({ request, env, params: { id: id.value } });
  }

  const acousticMatch = pathname.match(/^\/api\/projects\/([^/]+)\/acoustics$/);
  if (acousticMatch) {
    if (method !== "PUT") return methodNotAllowed(["PUT"]);
    const id = decodeProjectId(acousticMatch[1]);
    return id.error || importProjectAcoustics({ request, env, params: { id: id.value } });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = decodeProjectId(projectMatch[1]);
    if (id.error) return id.error;
    const params = { id: id.value };
    if (method === "GET") return getProject({ request, env, params });
    if (method === "PUT") return updateProject({ request, env, params });
    return methodNotAllowed(["GET", "PUT"]);
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) return apiError(404, "API route not found");
  return null;
}