import { routeProjectRequest } from "./routes/projects.js";

export default {
  async fetch(request, env) {
    const response = await routeProjectRequest(request, env);
    return response || env.ASSETS.fetch(request);
  }
};