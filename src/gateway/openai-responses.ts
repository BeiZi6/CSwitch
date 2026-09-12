import { USER_AGENT, type Profile } from "./types.js";
import { openaiEndpoint } from "./endpoints.js";
import { sseEvent } from "./openai-chat.js";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function dumps(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function systemPrompt(system: unknown): string {
  if (typeof system === "string") {
    return system;
  }
  if (!Array.isArray(system)) {
    return "";
  }
  return system
    .map((block) => {
      const item = asObject(block);
      return typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function anthropicToResponses(body: Json, upstreamModel: string): Json {
  const items: Json[] = [];
  for (const raw of Array.isArray(body.messages) ? body.messages : []) {
    const message = asObject(raw);
    const role = message.role;
    const content = message.content;
    if (typeof content === "string") {
      items.push({ role, content });
      continue;
    }
    let textParts: string[] = [];
    const flushText = () => {
      if (textParts.length > 0) {
        items.push({ role, content: textParts.join("") });
        textParts = [];
      }
    };
    for (const block of Array.isArray(content) ? content : []) {
      const item = asObject(block);
      if (item.type === "text" && typeof item.text === "string") {
        textParts.push(item.text);
      } else if (item.type === "tool_use") {
        flushText();
        items.push({
          type: "function_call",
          call_id: item.id,
          name: item.name,
          arguments: dumps(item.input ?? {}),
        });
      } else if (item.type === "tool_result") {
        flushText();
        items.push({
          type: "function_call_output",
          call_id: item.tool_use_id,
          output:
            typeof item.content === "string"
              ? item.content
              : dumps(item.content ?? ""),
        });
      }
    }
    flushText();
  }

  const tools = Array.isArray(body.tools)
    ? body.tools
        .map((tool) => {
          const item = asObject(tool);
          if (typeof item.name !== "string") {
            return undefined;
          }
          return {
            type: "function",
            name: item.name,
            description: item.description ?? "",
            parameters: item.input_schema ?? { type: "object", properties: {} },
          };
        })
        .filter(Boolean)
    : [];

  const out: Json = {
    model: upstreamModel,
    input: items,
    stream: true,
  };
  const instructions = systemPrompt(body.system);
  if (instructions) {
    out.instructions = instructions;
  }
  if (typeof body.max_tokens === "number") {
    out.max_output_tokens = Math.min(body.max_tokens, 65_536);
  }
  if (typeof body.temperature === "number") {
    out.temperature = body.temperature;
  }
  if (tools.length > 0) {
    out.tools = tools;
    out.tool_choice = "auto";
  }
  return out;
}

function outputText(item: Json): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((part) => {
      const block = asObject(part);
      if (block.type === "output_text" || block.type === "text") {
        return typeof block.text === "string" ? block.text : "";
      }
      return "";
    })
    .join("");
}

export function responsesToAnthropic(resp: Json, requestedModel: string): Json {
  const blocks: Json[] = [];
  for (const raw of Array.isArray(resp.output) ? resp.output : []) {
    const item = asObject(raw);
    if (item.type === "message") {
      const text = outputText(item);
      if (text) {
        blocks.push({ type: "text", text });
      }
    } else if (item.type === "function_call") {
      let input: unknown = {};
      if (typeof item.arguments === "string") {
        try {
          input = JSON.parse(item.arguments);
        } catch {
          input = { raw: item.arguments };
        }
      }
      blocks.push({
        type: "tool_use",
        id: item.call_id ?? item.id,
        name: item.name,
        input,
      });
    }
  }
  if (blocks.length === 0 && typeof resp.output_text === "string" && resp.output_text) {
    blocks.push({ type: "text", text: resp.output_text });
  }
  const stopReason = blocks.some((block) => block.type === "tool_use")
    ? "tool_use"
    : resp.status === "incomplete"
      ? "max_tokens"
      : "end_turn";
  const usage = asObject(resp.usage);
  return {
    id: typeof resp.id === "string" ? resp.id : "msg_cswitch",
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    },
  };
}

export async function postResponses(profile: Profile, payload: Json): Promise<Response> {
  const url = openaiEndpoint(profile.baseUrl, "/responses");
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${profile.apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });
}

export async function streamResponsesToAnthropic(
  response: Response,
  requestedModel: string,
  write: (chunk: string) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("上游未返回流");
  }
  const id = `msg_${Date.now()}`;
  write(
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }),
  );
  let textOpen = false;
  let textIndex = 0;
  let nextIndex = 0;
  const tools = new Map<string, { index: number; started: boolean }>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";
  const emitText = (delta: string) => {
    if (!textOpen) {
      textIndex = nextIndex;
      nextIndex += 1;
      write(
        sseEvent("content_block_start", {
          type: "content_block_start",
          index: textIndex,
          content_block: { type: "text", text: "" },
        }),
      );
      textOpen = true;
    }
    write(
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: textIndex,
        delta: { type: "text_delta", text: delta },
      }),
    );
  };
  const closeText = () => {
    if (!textOpen) {
      return;
    }
    write(sseEvent("content_block_stop", { type: "content_block_stop", index: textIndex }));
    textOpen = false;
  };
  while (true) {
    const { done, value } = await reader.read();
    leftover += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = leftover.split("\n");
    leftover = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      let event: Json;
      try {
        event = JSON.parse(data) as Json;
      } catch {
        continue;
      }
      const kind = typeof event.type === "string" ? event.type : "";
      if (kind === "response.output_text.delta" && typeof event.delta === "string") {
        emitText(event.delta);
      } else if (kind === "response.output_item.added") {
        const item = asObject(event.item);
        if (item.type === "function_call") {
          closeText();
          const key = String(item.id ?? item.call_id ?? nextIndex);
          const index = nextIndex;
          nextIndex += 1;
          tools.set(key, { index, started: true });
          write(
            sseEvent("content_block_start", {
              type: "content_block_start",
              index,
              content_block: {
                type: "tool_use",
                id: item.call_id ?? item.id,
                name: item.name,
                input: {},
              },
            }),
          );
        }
      } else if (kind === "response.function_call_arguments.delta") {
        const itemId = String(event.item_id ?? "");
        const tool = tools.get(itemId);
        if (tool && typeof event.delta === "string") {
          write(
            sseEvent("content_block_delta", {
              type: "content_block_delta",
              index: tool.index,
              delta: { type: "input_json_delta", partial_json: event.delta },
            }),
          );
        }
      } else if (kind === "response.output_item.done") {
        const item = asObject(event.item);
        const key = String(item.id ?? item.call_id ?? "");
        const tool = tools.get(key);
        if (item.type === "function_call" && tool) {
          write(sseEvent("content_block_stop", { type: "content_block_stop", index: tool.index }));
        } else if (item.type === "message") {
          closeText();
        }
      }
    }
    if (done) {
      break;
    }
  }
  closeText();
  write(
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: tools.size > 0 ? "tool_use" : "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    }),
  );
  write(sseEvent("message_stop", { type: "message_stop" }));
}
