import { routeProjectRequest } from "./routes/projects.js";
import { routeElevationRequest } from "./routes/elevation.js";
import { routeEnvironmentRequest } from "./routes/environment.js";

export default {
  async fetch(request, env) {
    const response = await routeElevationRequest(request, env) || await routeEnvironmentRequest(request, env) || await routeProjectRequest(request, env);
    return response || env.ASSETS.fetch(request);
  }
};