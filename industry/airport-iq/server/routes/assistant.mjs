// Streaming chat (NDJSON) + one-shot chat, grounded in the airport ops snapshot.

import { Router } from "express";
import { ndjson, send } from "../lib/httpHelpers.mjs";
import {
  buildToolDefinitions,
  config,
  foundryClient,
  foundryIsConfigured,
  makeToolExecutor,
  requestContext
} from "../lib/runtime.mjs";

const FOUNDRY_NOT_CONFIGURED = {
  error: "foundry_not_configured",
  message:
    "Set AZURE_OPENAI_ENDPOINT plus an auth source (managed identity, AZURE_OPENAI_USE_AZURE_CLI_TOKEN=true, AZURE_OPENAI_ACCESS_TOKEN, or AZURE_OPENAI_API_KEY) to enable Foundry-powered answers."
};

export function assistantRouter() {
  const router = Router();

  router.post("/api/assistant/stream", async (req, res) => {
    const body = req.body ?? {};
    const prompt = body.prompt ?? "";
    if (!prompt.trim()) return send(res, 400, { error: "missing_prompt", message: "Prompt is required." });
    if (!foundryIsConfigured(config)) return send(res, 503, FOUNDRY_NOT_CONFIGURED);

    res.status(200).set({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.flushHeaders?.();

    try {
      const context = requestContext(req, body);
      ndjson(res, { type: "status", message: `Checking ${context.airportName} operations...` });
      ndjson(res, { type: "metadata", provider: "azure-openai-foundry", model: config.foundry.chatDeployment });

      const toolResults = [];
      let usage = null;
      const stream = foundryClient.streamChatWithTools({
        prompt,
        sessionId: body.sessionId ?? "airport-iq",
        toolDefinitions: buildToolDefinitions(),
        executeTool: makeToolExecutor(context),
        context
      });

      for await (const event of stream) {
        if (event.text) {
          ndjson(res, { type: "delta", text: event.text });
        } else if (event.type === "tool") {
          toolResults.push({ name: event.name, arguments: event.arguments, result: event.result });
          ndjson(res, { type: "status", message: `Reading ${event.name.replace(/_/g, " ")}...` });
        } else if (event.type === "metadata") {
          usage = event.usage ?? usage;
        }
      }

      ndjson(res, {
        type: "metadata",
        provider: "azure-openai-foundry",
        model: config.foundry.chatDeployment,
        toolResults,
        usage
      });
      ndjson(res, { type: "done" });
      res.end();
    } catch (error) {
      ndjson(res, { type: "error", message: error instanceof Error ? error.message : "Unknown streaming error." });
      res.end();
    }
  });

  router.post("/api/assistant", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const prompt = body.prompt ?? "";
      if (!prompt.trim()) return send(res, 400, { error: "missing_prompt", message: "Prompt is required." });
      if (!foundryIsConfigured(config)) return send(res, 503, FOUNDRY_NOT_CONFIGURED);
      const context = requestContext(req, body);
      const answer = await foundryClient.chatWithTools({
        prompt,
        sessionId: body.sessionId ?? "airport-iq",
        toolDefinitions: buildToolDefinitions(),
        executeTool: makeToolExecutor(context),
        context
      });
      send(res, 200, answer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
