// Azure OpenAI (Foundry) client for the Airport IQ backend. Ported from
// digital-twin-fabric-app/server/lib/foundryClient.mjs, trimmed to the two
// things this app needs — streaming chat with a function-tool loop, and
// realtime voice client-secret minting — and adapted for gpt-5.x reasoning
// models (reasoning effort + a generous output budget).

import { buildAssistantInstructions, buildRealtimeInstructions } from "./instructions.mjs";
import {
  resolveRealtimeClientSecretUrl,
  resolveResponsesUrl,
  resolveTokenResource
} from "./foundryEndpoints.mjs";
import { getToken, hasManagedIdentity } from "./identity.mjs";

export class FoundryClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FoundryClientError";
    this.details = details;
  }
}

function isAuthConfigured(config) {
  return Boolean(config.apiKey || config.accessToken || config.useAzureCliToken || hasManagedIdentity());
}

function toRealtimeTools(toolDefinitions) {
  return toolDefinitions.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

function toResponsesTools(toolDefinitions) {
  return toolDefinitions.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties: tool.parameters?.properties ?? {},
      required: tool.parameters?.required ?? [],
      additionalProperties: false
    }
  }));
}

function getResponseText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");
}

function getFunctionCalls(response) {
  return (response.output ?? []).filter((item) => item.type === "function_call");
}

async function getOpenAiToken(config) {
  if (config.accessToken) return config.accessToken;
  if (config.apiKey) return ""; // API key auth uses a different header
  return getToken(resolveTokenResource(config));
}

async function openAiRequest(config, url, body) {
  const authHeaders = config.apiKey
    ? { "api-key": config.apiKey }
    : { authorization: `Bearer ${await getOpenAiToken(config)}` };
  const response = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    throw new FoundryClientError("Azure OpenAI request failed.", { status: response.status, response: data });
  }
  return data;
}

export class FoundryClient {
  constructor(config) {
    this.config = config;
  }

  status() {
    return {
      configured: Boolean(this.config.endpoint && isAuthConfigured(this.config)),
      endpoint: this.config.endpoint ? new URL(this.config.endpoint).hostname : null,
      chatDeployment: this.config.chatDeployment,
      realtimeDeployment: this.config.deployment,
      voice: this.config.voice
    };
  }

  // Optional reasoning field for gpt-5.x models. Empty effort → omit it.
  _reasoning() {
    const effort = String(this.config.reasoningEffort ?? "").trim();
    return effort ? { reasoning: { effort } } : {};
  }

  async createRealtimeClientSecret(toolDefinitions, context = {}, overrides = {}) {
    const realtimeConfig = {
      ...this.config,
      voice: overrides.voice ?? this.config.voice,
      speakingRate: overrides.speakingRate ?? this.config.speakingRate
    };
    const body = {
      session: {
        type: "realtime",
        model: realtimeConfig.deployment,
        instructions: buildRealtimeInstructions({ ...context, speakingRate: realtimeConfig.speakingRate }),
        audio: { output: { voice: realtimeConfig.voice } },
        tools: toRealtimeTools(toolDefinitions)
      }
    };
    return openAiRequest(this.config, resolveRealtimeClientSecretUrl(this.config), body);
  }

  // Non-streaming one-shot with a function-tool loop (kept for /api/assistant).
  async chatWithTools({ prompt, sessionId, toolDefinitions, executeTool, context = {} }) {
    const url = resolveResponsesUrl(this.config);
    const instructions = buildAssistantInstructions({ sessionId, ...context });
    const tools = toResponsesTools(toolDefinitions);
    const toolResults = [];

    let response = await openAiRequest(this.config, url, {
      model: this.config.chatDeployment,
      instructions,
      input: prompt,
      tools,
      tool_choice: "auto",
      max_output_tokens: this.config.maxOutputTokens,
      ...this._reasoning()
    });

    for (let round = 0; round < 3; round += 1) {
      const functionCalls = getFunctionCalls(response);
      if (!functionCalls.length) break;
      const input = [];
      for (const toolCall of functionCalls) {
        const args = JSON.parse(toolCall.arguments || "{}");
        const result = await executeTool(toolCall.name, args);
        toolResults.push({ name: toolCall.name, arguments: args, result });
        input.push({ type: "function_call_output", call_id: toolCall.call_id, output: JSON.stringify(result) });
      }
      response = await openAiRequest(this.config, url, {
        model: this.config.chatDeployment,
        previous_response_id: response.id,
        input,
        tools,
        tool_choice: "auto",
        max_output_tokens: this.config.maxOutputTokens,
        ...this._reasoning()
      });
    }

    return {
      provider: "azure-openai-foundry",
      model: this.config.chatDeployment,
      text: getResponseText(response),
      toolResults,
      usage: response.usage ?? null
    };
  }

  // Stream a single Responses API call as SSE. Yields { text } for every
  // output_text delta, and RETURNS aggregated function calls + response id.
  async *_streamResponse(url, body) {
    const authHeaders = this.config.apiKey
      ? { "api-key": this.config.apiKey }
      : { authorization: `Bearer ${await getOpenAiToken(this.config)}` };
    const response = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new FoundryClientError("Azure OpenAI streaming request failed.", {
        status: response.status,
        response: detail
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const functionCalls = new Map(); // item_id -> { name, call_id, arguments }
    let responseId = null;
    let usage = null;
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        switch (event.type) {
          case "response.output_text.delta":
            if (event.delta) yield { text: event.delta };
            break;
          case "response.output_item.added":
          case "response.output_item.done":
            if (event.item?.type === "function_call") {
              const existing = functionCalls.get(event.item.id);
              functionCalls.set(event.item.id, {
                name: event.item.name ?? existing?.name,
                call_id: event.item.call_id ?? existing?.call_id,
                arguments: event.item.arguments ?? existing?.arguments ?? ""
              });
            }
            break;
          case "response.function_call_arguments.delta": {
            const entry = functionCalls.get(event.item_id);
            if (entry) entry.arguments = (entry.arguments ?? "") + (event.delta ?? "");
            break;
          }
          case "response.function_call_arguments.done": {
            const entry = functionCalls.get(event.item_id);
            if (entry && event.arguments != null) entry.arguments = event.arguments;
            break;
          }
          case "response.completed":
          case "response.incomplete":
            responseId = event.response?.id ?? responseId;
            usage = event.response?.usage ?? usage;
            break;
          case "error":
          case "response.failed":
            throw new FoundryClientError("Azure OpenAI streaming error.", { response: event });
          default:
            break;
        }
      }
    }

    return { functionCalls: [...functionCalls.values()], responseId, usage };
  }

  // Real streaming chat with a function-tool loop. Yields events:
  //   { type: "delta", text }
  //   { type: "tool", name, arguments, result }
  //   { type: "metadata", provider, model, usage }
  async *streamChatWithTools({ prompt, sessionId, toolDefinitions, executeTool, context = {} }) {
    const url = resolveResponsesUrl(this.config);
    const instructions = buildAssistantInstructions({ sessionId, ...context });
    const tools = toResponsesTools(toolDefinitions);

    let body = {
      model: this.config.chatDeployment,
      instructions,
      input: prompt,
      tools,
      tool_choice: "auto",
      max_output_tokens: this.config.maxOutputTokens,
      ...this._reasoning()
    };

    for (let round = 0; round < 4; round += 1) {
      const { functionCalls, responseId, usage } = yield* this._streamResponse(url, body);
      if (!functionCalls.length) {
        yield { type: "metadata", provider: "azure-openai-foundry", model: this.config.chatDeployment, usage };
        return;
      }
      const input = [];
      for (const call of functionCalls) {
        const args = JSON.parse(call.arguments || "{}");
        const result = await executeTool(call.name, args);
        yield { type: "tool", name: call.name, arguments: args, result };
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      }
      body = {
        model: this.config.chatDeployment,
        previous_response_id: responseId,
        input,
        tools,
        tool_choice: "auto",
        max_output_tokens: this.config.maxOutputTokens,
        ...this._reasoning()
      };
    }
    yield { type: "metadata", provider: "azure-openai-foundry", model: this.config.chatDeployment, usage: null };
  }
}
