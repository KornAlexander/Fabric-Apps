// Deterministic airport-ops tool ingress. Used by the realtime voice controller
// (browser -> backend) to execute a tool the model asked for, and handy for
// debugging the grounded tools directly.

import { Router } from "express";
import { send } from "../lib/httpHelpers.mjs";
import { executeTool } from "../lib/tools.mjs";
import { config, requestContext } from "../lib/runtime.mjs";

export function toolsRouter() {
  const router = Router();

  router.post("/api/tools/:name", (req, res) => {
    const body = req.body ?? {};
    const context = requestContext(req, body);
    const result = executeTool(req.params.name, body, {
      airport: context.airport,
      defaultAirport: config.defaultAirport
    });
    send(res, 200, result);
  });

  return router;
}
