// Foundry Realtime voice: session plan + ephemeral client-secret minting.

import { Router } from "express";
import { send } from "../lib/httpHelpers.mjs";
import {
  buildToolDefinitions,
  createRealtimeSessionPlan,
  foundryClient,
  realtimeOverrides,
  requestContext
} from "../lib/runtime.mjs";

export function realtimeRouter() {
  const router = Router();

  router.post("/api/realtime/session", (req, res) => {
    const body = req.body ?? {};
    send(res, 200, createRealtimeSessionPlan(requestContext(req, body), realtimeOverrides(body)));
  });

  router.post("/api/realtime/client-secret", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const context = requestContext(req, body);
      send(
        res,
        200,
        await foundryClient.createRealtimeClientSecret(buildToolDefinitions(), context, realtimeOverrides(body))
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
