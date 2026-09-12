import { ANTHROPIC_VERSION, USER_AGENT, type Profile } from "./types.js";
import { openaiEndpoint } from "./endpoints.js";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      const item = asObject(block);
      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      if (item.type === "tool_result") {
        return textFromContent(item.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function anthropicToOpenAI(body: Json, upstreamModel: string): Json {
  const messages: Json[] = [];
  const system = body.system;
  if (typeof system === "string" && system.trim()) {
    messages.push({ role: "system", content: system });
  } else if (Array.isArray(system)) {
    const text = textFromContent(system);
    if (text) {
      messages.push({ role: "system", content: text });
    }
  }

  for (const raw of Array.isArray(body.messages) ? body.messages : []) {
    const message = asObject(raw);
    const role = message.role;
    if (role === "user") {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const toolResults = blocks.filter((block) => asObject(block).type === "tool_result");
      const other = blocks.filter((block) => asObject(block).type !== "tool_result");
      for (const block of toolResults) {
        const item = asObject(block);
        messages.push({
          role: "tool",
          tool_call_id: item.tool_use_id,
          content: textFromContent(item.content) || "",
        });
      }
      if (other.length > 0 || toolResults.length === 0) {
        messages.push({ role: "user", content: textFromContent(other.length ? other : message.content) });
      }
      continue;
    }
    if (role === "assistant") {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const toolCalls = blocks
        .filter((block) => asObject(block).type === "tool_use")
        .map((block) => {
          const item = asObject(block);
          return {
            id: item.id,
            type: "function",
            function: {
              name: item.name,
              arguments: JSON.stringify(item.input ?? {}),
            },
          };
        });
      const text = textFromContent(blocks);
      const out: Json = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) {
        out.tool_calls = toolCalls;
      }
      messages.push(out);
    }
  }

  const tools = Array.isArray(body.tools)
    ? body.tools.map((tool) => {
        const item = asObject(tool);
        return {
          type: "function",
          function: {
            name: item.name,
            description: item.description ?? "",
            parameters: item.input_schema ?? { type: "object", properties: {} },
          },
        };
      })
    : undefined;

  const out: Json = {
    model: upstreamModel,
    messages,
    stream: Boolean(body.stream),
  };
  if (typeof body.max_tokens === "number") {
    out.max_tokens = body.max_tokens;
  }
  if (typeof body.temperature === "number") {
    out.temperature = body.temperature;
  }
  if (tools && tools.length > 0) {
    out.tools = tools;
  }
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const choice = asObject(body.tool_choice);
    if (choice.type === "tool" && typeof choice.name === "string") {
      out.tool_choice = { type: "function", function: { name: choice.name } };
    } else if (choice.type === "any") {
      out.tool_choice = "required";
    } else if (choice.type === "auto") {
      out.tool_choice = "auto";
    } else if (choice.type === "none") {
      out.tool_choice = "none";
    }
  }
  return out;
}

export function openAIToAnthropic(upstream: Json, requestedModel: string): Json {
  const choice = asObject((Array.isArray(upstream.choices) ? upstream.choices[0] : {}) as Json);
  const message = asObject(choice.message);
  const content: Json[] = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    const item = asObject(call);
    const fn = asObject(item.function);
    let input: unknown = {};
    if (typeof fn.arguments === "string") {
      try {
        input = JSON.parse(fn.arguments);
      } catch {
        input = { raw: fn.arguments };
      }
    }
    content.push({
      type: "tool_use",
      id: item.id,
      name: fn.name,
      input,
    });
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }
  const stop = typeof choice.finish_reason === "string" ? choice.finish_reason : "end_turn";
  const stopReason =
    stop === "tool_calls" ? "tool_use" : stop === "length" ? "max_tokens" : "end_turn";
  return {
    id: typeof upstream.id === "string" ? upstream.id : "cswitch",
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: asObject(upstream.usage).prompt_tokens ?? 0,
      output_tokens: asObject(upstream.usage).completion_tokens ?? 0,
    },
  };
}

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function anthropicMessageStart(id: string, model: string): string {
  return sseEvent("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
}

export function anthropicMessageStop(): string {
  return (
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    }) + sseEvent("message_stop", { type: "message_stop" })
  );
}

export async function postOpenAI(profile: Profile, payload: Json): Promise<Response> {
  const url = openaiEndpoint(profile.baseUrl, "/chat/completions");
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${profile.apiKey}`,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });
}

export async function postAnthropic(
  profile: Profile,
  payload: Json,
  url: string,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": profile.apiKey,
      authorization: `Bearer ${profile.apiKey}`,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });
}

export async function streamOpenAIToAnthropic(
  response: Response,
  requestedModel: string,
  write: (chunk: string) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("上游未返回流");
  }
  const id = `msg_${Date.now()}`;
  write(anthropicMessageStart(id, requestedModel));
  let textOpen = false;
  let toolIndex = 0;
  const toolBuf = new Map<number, { id: string; name: string; args: string; started: boolean }>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";
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
      if (data === "[DONE]") {
        continue;
      }
      let parsed: Json;
      try {
        parsed = JSON.parse(data) as Json;
      } catch {
        continue;
      }
      const choice = asObject((Array.isArray(parsed.choices) ? parsed.choices[0] : {}) as Json);
      const delta = asObject(choice.delta);
      if (typeof delta.content === "string" && delta.content.length > 0) {
        if (!textOpen) {
          write(
            sseEvent("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }),
          );
          textOpen = true;
        }
        write(
          sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: delta.content },
          }),
        );
      }
      if (Array.isArray(delta.tool_calls)) {
        if (textOpen) {
          write(sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
          textOpen = false;
        }
        for (const call of delta.tool_calls) {
          const item = asObject(call);
          const idx = typeof item.index === "number" ? item.index : 0;
          const current = toolBuf.get(idx) ?? {
            id: "",
            name: "",
            args: "",
            started: false,
          };
          if (typeof item.id === "string") {
            current.id = item.id;
          }
          const fn = asObject(item.function);
          if (typeof fn.name === "string") {
            current.name = fn.name;
          }
          if (typeof fn.arguments === "string") {
            current.args += fn.arguments;
          }
          if (!current.started && current.id && current.name) {
            const blockIndex = textOpen ? 1 + idx : idx + (textOpen ? 1 : 0);
            const index = 0 + (textOpen ? 1 : 0) + idx;
            write(
              sseEvent("content_block_start", {
                type: "content_block_start",
                index,
                content_block: {
                  type: "tool_use",
                  id: current.id,
                  name: current.name,
                  input: {},
                },
              }),
            );
            current.started = true;
            toolIndex = index;
          }
          if (current.started && typeof fn.arguments === "string" && fn.arguments.length > 0) {
            write(
              sseEvent("content_block_delta", {
                type: "content_block_delta",
                index: toolIndex,
                delta: { type: "input_json_delta", partial_json: fn.arguments },
              }),
            );
          }
          toolBuf.set(idx, current);
        }
      }
    }
    if (done) {
      break;
    }
  }
  if (textOpen) {
    write(sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
  }
  for (const [idx, tool] of toolBuf) {
    if (tool.started) {
      write(sseEvent("content_block_stop", { type: "content_block_stop", index: idx }));
    }
  }
  write(anthropicMessageStop());
}
