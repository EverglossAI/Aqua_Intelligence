const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function apiError(status, message, details) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

export function requireBindings(env) {
  if (!env.AQUA_DB || !env.AQUA_PROJECTS) throw new Error("AQUA_DB and AQUA_PROJECTS bindings are required");
}

export function requireWriteAccess(request, env) {
  if (env.AQUA_ALLOW_LOCAL_WRITES === "true") return null;
  const accessUser = request.headers.get("CF-Access-Authenticated-User-Email");
  const allowed = String(env.AQUA_ALLOWED_WRITERS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (accessUser && (!allowed.length || allowed.includes(accessUser.toLowerCase()))) return null;
  const token = env.AQUA_PROJECT_WRITE_TOKEN;
  if (token && request.headers.get("authorization") === `Bearer ${token}`) return null;
  return apiError(401, "Project write access is required");
}

export function requireReadAccess(request, env) {
  if (env.AQUA_REQUIRE_READ_AUTH !== "true") return null;
  const accessUser = request.headers.get("CF-Access-Authenticated-User-Email");
  if (accessUser) return null;
  const token = env.AQUA_PROJECT_READ_TOKEN || env.AQUA_PROJECT_WRITE_TOKEN;
  if (token && request.headers.get("authorization") === `Bearer ${token}`) return null;
  return apiError(401, "Project read access is required");
}

export async function readJson(request) {
  try { return { value: await request.json() }; }
  catch { return { error: apiError(400, "Request body must be valid JSON") }; }
}

export function safeProjectId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{3,100}$/.test(id)) throw new Error("Invalid project ID");
  return id;
}

export function safeFilename(value, fallback = "payload.bin") {
  const filename = String(value || fallback).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return filename || fallback;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function projectFromRow(row, detailed = false) {
  if (!row) return null;
  const project = {
    id: row.id,
    name: row.name,
    utility: row.utility,
    created: row.created_at,
    updated: row.updated_at,
    sourceCrs: row.source_crs,
    normalizedCrs: row.normalized_crs,
    status: row.status,
    sourceFilename: row.source_filename,
    version: Number(row.version),
    layerInventory: parseJson(row.layer_inventory, []),
    r2Objects: parseJson(row.r2_objects, {})
  };
  if (!detailed) return project;
  return {
    ...project,
    logicalDmas: parseJson(row.logical_dmas, []),
    dmaFeatureMappings: parseJson(row.dma_feature_mappings, []),
    dmaStyles: parseJson(row.dma_styles, {}),
    telemetryDefinitions: parseJson(row.telemetry_definitions, []),
    provenance: parseJson(row.provenance, {})
  };
}

export async function findProject(env, id) {
  return env.AQUA_DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
}

export function projectMetadata(project, r2Objects, version, now = new Date().toISOString()) {
  const layers = Array.isArray(project.layers) ? project.layers : [];
  const telemetry = Array.isArray(project.telemetry) ? project.telemetry : [];
  const created = project.created || now;
  return {
    id: safeProjectId(project.id),
    name: String(project.name || "Untitled project"),
    utility: String(project.utility || ""),
    created,
    updated: now,
    sourceCrs: String(project.sourceCrs || "EPSG:4326"),
    normalizedCrs: String(project.normalizedCrs || "EPSG:4326"),
    status: String(project.status || "active"),
    sourceFilename: safeFilename(project.source || project.sourceFilename || ""),
    r2Objects,
    layerInventory: project.layerClassification || layers.map(layer => ({
      name: layer.name,
      kind: layer.kind,
      count: layer.geojson?.features?.length || 0
    })),
    logicalDmas: project.logicalDmas || project.lambayDemo?.logicalDmas || [],
    dmaFeatureMappings: project.dmaFeatureMappings || [],
    dmaStyles: project.dmaStyles || {},
    telemetryDefinitions: telemetry.map(item => ({
      id: item.id || item._id,
      type: item.type,
      assetType: item.assetType,
      dmaCode: item.dmaCode,
      dmaUid: item.dmaUid,
      dmaName: item.dmaName,
      role: item.role,
      source: item.source,
      readingCount: Array.isArray(item.readings) ? item.readings.length : 0
    })),
    version: Number(version),
    provenance: project.provenance || {
      sourceType: project.sourceType || "unknown",
      sourceFilename: project.source || project.sourceFilename || "",
      telemetrySources: project.telemetryProvenance || [],
      reprojected: Boolean(project.reprojected)
    }
  };
}

export function insertProjectStatement(env, metadata) {
  return env.AQUA_DB.prepare(`INSERT INTO projects (
    id, name, utility, created_at, updated_at, source_crs, normalized_crs, status,
    source_filename, r2_objects, layer_inventory, logical_dmas, dma_feature_mappings,
    dma_styles, telemetry_definitions, version, provenance
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      metadata.id, metadata.name, metadata.utility, metadata.created, metadata.updated,
      metadata.sourceCrs, metadata.normalizedCrs, metadata.status, metadata.sourceFilename,
      JSON.stringify(metadata.r2Objects), JSON.stringify(metadata.layerInventory),
      JSON.stringify(metadata.logicalDmas), JSON.stringify(metadata.dmaFeatureMappings),
      JSON.stringify(metadata.dmaStyles), JSON.stringify(metadata.telemetryDefinitions),
      metadata.version, JSON.stringify(metadata.provenance)
    );
}

export function updateProjectStatement(env, metadata, expectedVersion) {
  return env.AQUA_DB.prepare(`UPDATE projects SET
    name = ?, utility = ?, updated_at = ?, source_crs = ?, normalized_crs = ?, status = ?,
    source_filename = ?, r2_objects = ?, layer_inventory = ?, logical_dmas = ?,
    dma_feature_mappings = ?, dma_styles = ?, telemetry_definitions = ?, version = ?, provenance = ?
    WHERE id = ? AND version = ?`)
    .bind(
      metadata.name, metadata.utility, metadata.updated, metadata.sourceCrs,
      metadata.normalizedCrs, metadata.status, metadata.sourceFilename,
      JSON.stringify(metadata.r2Objects), JSON.stringify(metadata.layerInventory),
      JSON.stringify(metadata.logicalDmas), JSON.stringify(metadata.dmaFeatureMappings),
      JSON.stringify(metadata.dmaStyles), JSON.stringify(metadata.telemetryDefinitions),
      metadata.version, JSON.stringify(metadata.provenance), metadata.id, expectedVersion
    );
}

export async function deleteObjects(env, keys) {
  await Promise.all(keys.map(key => env.AQUA_PROJECTS.delete(key).catch(() => undefined)));
}