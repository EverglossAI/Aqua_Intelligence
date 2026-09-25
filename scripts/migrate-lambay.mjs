import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function argumentsMap(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) result[values[index].replace(/^--/, "")] = values[index + 1];
  return result;
}

function count(project, kind) {
  return (project.layers || []).filter(layer => layer.kind === kind).reduce((total, layer) => total + (layer.geojson?.features?.length || 0), 0);
}

function validate(project) {
  const expected = { pipe: 3165, meter: 3025, valve: 272, hydrant: 86, dma: 8 };
  for (const [kind, value] of Object.entries(expected)) {
    const actual = count(project, kind);
    if (actual !== value) throw new Error(`Lambay ${kind} count is ${actual}; expected ${value}`);
  }
  const pressure = (project.telemetry || []).filter(item => item.type === "pressure").length;
  const flow = (project.telemetry || []).filter(item => item.type === "flow").length;
  if (pressure !== 12 || flow !== 4) throw new Error(`Lambay telemetry is ${pressure} pressure / ${flow} flow; expected 12 / 4`);
  if ((project.logicalDmas || project.lambayDemo?.logicalDmas || []).length !== 4) throw new Error("Lambay must have four logical DMAs");
  if ((project.dmaFeatureMappings || []).length !== 8) throw new Error("Lambay must have eight source-to-logical DMA mappings");
  if (Object.keys(project.dmaStyles || {}).length !== 4) throw new Error("Lambay must have four DMA style records");
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  if (!args.origin || !args.snapshot || !args.source) {
    throw new Error("Usage: node scripts/migrate-lambay.mjs --origin https://host --snapshot lambay-project.json --source \"Lambay Island(2).zip\" [--telemetry-dir projects/lambay-island/demo]");
  }
  const origin = args.origin.replace(/\/$/, "");
  const snapshotPath = resolve(args.snapshot);
  const sourcePath = resolve(args.source);
  const project = JSON.parse(await readFile(snapshotPath, "utf8"));
  validate(project);

  project.id = "lambay-island";
  project.name = "Lambay Island";
  project.source = basename(sourcePath);
  project.sourceType = "shapefile-zip";
  project.sourceCrs = "EPSG:3826";
  project.normalizedCrs = "EPSG:4326";
  project.status = "active";
  project.cloudRevision = 0;
  project.projectVersion = 0;
  project.provenance = {
    sourceType: "shapefile-zip",
    sourceFilename: basename(sourcePath),
    normalizedCrs: "EPSG:4326",
    telemetrySources: ["Synthetic Lambay demo telemetry"],
    migratedAt: new Date().toISOString()
  };

  const headers = {};
  if (process.env.AQUA_PROJECT_WRITE_TOKEN) headers.authorization = `Bearer ${process.env.AQUA_PROJECT_WRITE_TOKEN}`;
  const existing = await fetch(`${origin}/api/projects/lambay-island`, { headers });
  if (existing.ok) throw new Error("Lambay already exists centrally; migration will not overwrite it");
  if (existing.status !== 404) throw new Error(`Could not check existing Lambay project (${existing.status})`);

  const form = new FormData();
  form.set("project", JSON.stringify(project));
  form.set("source", new Blob([await readFile(sourcePath)], { type: "application/zip" }), basename(sourcePath));
  if (args["telemetry-dir"]) {
    const directory = resolve(args["telemetry-dir"]);
    for (const filename of await readdir(directory)) {
      if (!/\.(csv|json|geojson)$/i.test(filename)) continue;
      const path = join(directory, filename);
      const type = /\.csv$/i.test(filename) ? "text/csv" : "application/json";
      form.append("telemetry", new Blob([await readFile(path)], { type }), filename);
    }
  }

  const response = await fetch(`${origin}/api/projects`, { method: "POST", headers, body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Migration failed (${response.status})`);
  console.log(JSON.stringify({ id: body.project.id, version: body.project.version, r2Objects: body.project.r2Objects }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});