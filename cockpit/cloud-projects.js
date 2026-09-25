(() => {
  "use strict";

  class AquaCloudError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = "AquaCloudError";
      this.status = status;
      this.details = details;
    }
  }

  async function responseJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new AquaCloudError(body.error || `Project service returned ${response.status}`, response.status, body.details);
    return body;
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      return await fetch(path, { credentials: "same-origin", ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === "AbortError") throw new AquaCloudError("Project service timed out", 0);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function list() {
    const body = await responseJson(await request("/api/projects"));
    return Array.isArray(body.projects) ? body.projects : [];
  }

  async function data(id) {
    const response = await request(`/api/projects/${encodeURIComponent(id)}/data`);
    const project = await responseJson(response);
    const version = Number(response.headers.get("x-aqua-project-version") || project.cloudRevision || project.version || 0);
    return { project, version };
  }

  async function create(project, sourceFile, telemetryFiles = []) {
    const form = new FormData();
    form.set("project", JSON.stringify(project));
    form.set("source", sourceFile, sourceFile.name);
    telemetryFiles.forEach(file => form.append("telemetry", file, file.name));
    return (await responseJson(await request("/api/projects", { method: "POST", body: form }))).project;
  }

  async function update(project, expectedVersion) {
    return (await responseJson(await request(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project, expectedVersion })
    }))).project;
  }

  window.AquaCloudProjects = { AquaCloudError, list, data, create, update };
})();