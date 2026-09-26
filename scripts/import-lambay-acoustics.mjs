import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { importAcousticReports } from "./acoustic-import.mjs";

function argumentsMap(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) result[values[index].replace(/^--/, "")] = values[index + 1];
  return result;
}

async function readProject(filename) {
  let content = await readFile(resolve(filename), "utf8");
  if (content.startsWith("Result: ")) content = content.slice(8).split("\nPage Title:")[0];
  let project = JSON.parse(content);
  if (typeof project === "string") project = JSON.parse(project);
  return project;
}

async function upload(origin, projectId, result, paths) {
  const form = new FormData();
  form.set("data", new Blob([JSON.stringify(result)], { type: "application/json" }), "lambay-acoustic-operational-data.json");
  for (const path of paths) {
    const bytes = await readFile(path);
    const filename = path.split(/[\\/]/).pop();
    form.append("source", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
  }
  const headers = {};
  if (process.env.AQUA_PROJECT_WRITE_TOKEN) headers.authorization = `Bearer ${process.env.AQUA_PROJECT_WRITE_TOKEN}`;
  const response = await fetch(`${origin.replace(/\/$/, "")}/api/projects/${encodeURIComponent(projectId)}/acoustics`, { method: "PUT", headers, body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Acoustic upload failed (${response.status})`);
  return body;
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  const required = ["project", "sensors", "couples", "alerts", "output"];
  if (required.some(name => !args[name])) throw new Error("Usage: node scripts/import-lambay-acoustics.mjs --project lambay-project.json --sensors sensors.xlsx --couples couples.xlsx --alerts alerts.xlsx --output projects/lambay-island/acoustic/lambay-acoustic-operational-data.json [--origin http://127.0.0.1:8788]");
  const paths = [resolve(args.sensors), resolve(args.couples), resolve(args.alerts)];
  const project = await readProject(args.project);
  const result = await importAcousticReports({ sensorsPath: paths[0], couplesPath: paths[1], alertsPath: paths[2], project });
  if (result.acousticSensor.length !== 10) throw new Error(`Spatial import found ${result.acousticSensor.length} Lambay sensors; expected 10`);
  if (result.acousticCouple.length !== 9) throw new Error(`Spatial import found ${result.acousticCouple.length} Lambay couples; expected 9`);
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  let cloud = null;
  if (args.origin) cloud = await upload(args.origin, project.id || "lambay-island", result, paths);
  console.log(JSON.stringify({
    output,
    sensors: result.acousticSensor.length,
    couples: result.acousticCouple.length,
    alerts: result.acousticAlert.length,
    summary: result.acousticSummary,
    matchDistances: {
      sensors: result.acousticSensor.map(item => ({ id: item.sensorId, metres: item.matchDistance, confidence: item.confidence, reviewRequired: item.reviewRequired })),
      alerts: result.acousticAlert.map(item => ({ id: item.alertId, metres: item.matchDistance, confidence: item.confidence, reviewRequired: item.reviewRequired }))
    },
    cloud
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});