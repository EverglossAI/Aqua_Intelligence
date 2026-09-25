import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as listProjects, onRequestPost as createProject } from "../functions/api/projects/index.js";
import { onRequestPut as updateProject } from "../functions/api/projects/[id].js";
import { onRequestGet as getProjectData } from "../functions/api/projects/[id]/data.js";

class FakeBucket {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata || {}, etag: `etag-${this.objects.size + 1}` });
  }
  async get(key) {
    const value = this.objects.get(key);
    if (!value) return null;
    return { body: value.bytes, httpMetadata: value.httpMetadata, etag: value.etag, httpEtag: `"${value.etag}"` };
  }
  async delete(key) { this.objects.delete(key); }
}

class FakeDb {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    const database = this;
    const statement = {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return database.rows.get(this.values[0]) || null; },
      async all() { return { results: [...database.rows.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at)) }; },
      async run() {
        if (/^INSERT INTO projects/i.test(sql.trim())) {
          const value = this.values;
          database.rows.set(value[0], {
            id: value[0], name: value[1], utility: value[2], created_at: value[3], updated_at: value[4],
            source_crs: value[5], normalized_crs: value[6], status: value[7], source_filename: value[8],
            r2_objects: value[9], layer_inventory: value[10], logical_dmas: value[11],
            dma_feature_mappings: value[12], dma_styles: value[13], telemetry_definitions: value[14],
            version: value[15], provenance: value[16]
          });
          return { meta: { changes: 1 } };
        }
        if (/^UPDATE projects SET/i.test(sql.trim())) {
          const value = this.values;
          const id = value[15];
          const current = database.rows.get(id);
          if (!current || Number(current.version) !== Number(value[16])) return { meta: { changes: 0 } };
          database.rows.set(id, {
            ...current, name: value[0], utility: value[1], updated_at: value[2], source_crs: value[3],
            normalized_crs: value[4], status: value[5], source_filename: value[6], r2_objects: value[7],
            layer_inventory: value[8], logical_dmas: value[9], dma_feature_mappings: value[10],
            dma_styles: value[11], telemetry_definitions: value[12], version: value[13], provenance: value[14]
          });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unsupported SQL: ${sql}`);
      }
    };
    return statement;
  }
}

function sampleProject() {
  return {
    id: "lambay-island",
    name: "Lambay Island",
    utility: "Test Utility",
    source: "Lambay Island(2).zip",
    sourceType: "shapefile-zip",
    sourceCrs: "EPSG:3826",
    normalizedCrs: "EPSG:4326",
    layers: [{ name: "pipe", kind: "pipe", geojson: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: null }] } }],
    logicalDmas: [{ logical_dma_uid: "dma-1", dma_code: "01" }],
    dmaFeatureMappings: [{ gisFeatureId: "region:1", logicalDmaId: "dma-1" }],
    dmaStyles: { "dma-1": { fillColor: "#1457d9", fillOpacity: 0.23 } },
    telemetry: [{ id: "P-1", type: "pressure", dmaCode: "01", source: "demo", readings: [{ value: 20 }, { value: 21 }] }],
    provenance: { sourceType: "shapefile-zip" }
  };
}

test("project API stores payloads in R2 and metadata in D1 with optimistic revisions", async () => {
  const env = { AQUA_DB: new FakeDb(), AQUA_PROJECTS: new FakeBucket(), AQUA_ALLOW_LOCAL_WRITES: "true" };
  const form = new FormData();
  form.set("project", JSON.stringify(sampleProject()));
  form.set("source", new Blob(["zip-data"], { type: "application/zip" }), "Lambay Island(2).zip");
  form.append("telemetry", new Blob(["sensor,value\nP-1,20"], { type: "text/csv" }), "pressure.csv");
  const created = await createProject({ request: new Request("http://local/api/projects", { method: "POST", body: form }), env });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.project.version, 1);
  assert.equal(env.AQUA_DB.rows.get("lambay-island").version, 1);
  assert.deepEqual([...env.AQUA_PROJECTS.objects.keys()].sort(), [
    "projects/lambay-island/versions/1/normalized/project.json",
    "projects/lambay-island/versions/1/source/Lambay-Island-2-.zip",
    "projects/lambay-island/versions/1/telemetry/pressure.csv"
  ]);
  const definitions = JSON.parse(env.AQUA_DB.rows.get("lambay-island").telemetry_definitions);
  assert.equal(definitions[0].readingCount, 2);
  assert.equal("readings" in definitions[0], false);

  const list = await listProjects({ env });
  assert.equal((await list.json()).projects[0].name, "Lambay Island");

  const changed = sampleProject();
  changed.dmaStyles["dma-1"].fillOpacity = 0.47;
  const updated = await updateProject({
    request: new Request("http://local/api/projects/lambay-island", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: changed, expectedVersion: 1 }) }),
    params: { id: "lambay-island" }, env
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).project.version, 2);
  assert.equal(JSON.parse(env.AQUA_DB.rows.get("lambay-island").dma_styles)["dma-1"].fillOpacity, 0.47);
  assert.ok(env.AQUA_PROJECTS.objects.has("projects/lambay-island/versions/2/normalized/project.json"));

  const stale = await updateProject({
    request: new Request("http://local/api/projects/lambay-island", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: changed, expectedVersion: 1 }) }),
    params: { id: "lambay-island" }, env
  });
  assert.equal(stale.status, 409);
  assert.equal(env.AQUA_DB.rows.get("lambay-island").version, 2);

  const data = await getProjectData({ params: { id: "lambay-island" }, env });
  assert.equal(data.status, 200);
  assert.equal(data.headers.get("x-aqua-project-version"), "2");
  assert.equal((await data.json()).dmaStyles["dma-1"].fillOpacity, 0.47);
});

test("project writes are denied without an authenticated writer", async () => {
  const env = { AQUA_DB: new FakeDb(), AQUA_PROJECTS: new FakeBucket() };
  const response = await createProject({ request: new Request("http://local/api/projects", { method: "POST" }), env });
  assert.equal(response.status, 401);
});

test("project reads can be protected by the deployment policy", async () => {
  const env = { AQUA_DB: new FakeDb(), AQUA_PROJECTS: new FakeBucket(), AQUA_REQUIRE_READ_AUTH: "true" };
  const denied = await listProjects({ request: new Request("http://local/api/projects"), env });
  assert.equal(denied.status, 401);
  const allowed = await listProjects({ request: new Request("http://local/api/projects", { headers: { "CF-Access-Authenticated-User-Email": "engineer@example.com" } }), env });
  assert.equal(allowed.status, 200);
});

test("malformed project requests return 400", async () => {
  const env = { AQUA_DB: new FakeDb(), AQUA_PROJECTS: new FakeBucket(), AQUA_ALLOW_LOCAL_WRITES: "true" };
  const form = new FormData();
  form.set("project", "{not-json");
  form.set("source", new Blob(["zip-data"], { type: "application/zip" }), "source.zip");
  const createResponse = await createProject({ request: new Request("http://local/api/projects", { method: "POST", body: form }), env });
  assert.equal(createResponse.status, 400);
  const updateResponse = await updateProject({
    request: new Request("http://local/api/projects/lambay-island", { method: "PUT", headers: { "content-type": "application/json" }, body: "{" }),
    params: { id: "lambay-island" }, env
  });
  assert.equal(updateResponse.status, 400);
});

test("failed D1 create removes partially uploaded R2 objects", async () => {
  const bucket = new FakeBucket();
  const database = new FakeDb();
  const originalPrepare = database.prepare.bind(database);
  database.prepare = sql => {
    const statement = originalPrepare(sql);
    if (/^INSERT INTO projects/i.test(sql.trim())) statement.run = async () => { throw new Error("forced D1 failure"); };
    return statement;
  };
  const env = { AQUA_DB: database, AQUA_PROJECTS: bucket, AQUA_ALLOW_LOCAL_WRITES: "true" };
  const form = new FormData();
  form.set("project", JSON.stringify(sampleProject()));
  form.set("source", new Blob(["zip-data"], { type: "application/zip" }), "source.zip");
  const originalError = console.error;
  console.error = () => {};
  const response = await createProject({ request: new Request("http://local/api/projects", { method: "POST", body: form }), env });
  console.error = originalError;
  assert.equal(response.status, 500);
  assert.equal(bucket.objects.size, 0);
});