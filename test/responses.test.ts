import { expect, test } from "bun:test";
import { anthropicToResponses, responsesToAnthropic } from "../src/gateway/openai-responses.ts";

test("anthropic messages become Responses input items", () => {
  const payload = anthropicToResponses(
    {
      model: "claude-sonnet-5",
      system: "be brief",
      max_tokens: 128,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { q: "x" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }],
        },
      ],
      tools: [{ name: "lookup", description: "d", input_schema: { type: "object", properties: {} } }],
    },
    "gpt-5",
  );
  expect(payload.model).toBe("gpt-5");
  expect(payload.instructions).toBe("be brief");
  expect(payload.stream).toBe(false);
  const input = payload.input as Array<Record<string, unknown>>;
  expect(input[0]).toEqual({ role: "user", content: "hi" });
  expect(input[1]).toMatchObject({ type: "function_call", call_id: "call_1", name: "lookup" });
  expect(input[2]).toMatchObject({ type: "function_call_output", call_id: "call_1", output: "ok" });
});

test("Responses output maps back to Anthropic content blocks", () => {
  const message = responsesToAnthropic(
    {
      id: "resp_1",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "hello" }],
        },
        {
          type: "function_call",
          call_id: "call_2",
          name: "lookup",
          arguments: "{\"q\":\"y\"}",
        },
      ],
      usage: { input_tokens: 3, output_tokens: 4 },
    },
    "claude-opus-5",
  );
  expect(message.model).toBe("claude-opus-5");
  expect(message.stop_reason).toBe("tool_use");
  expect(message.content).toEqual([
    { type: "text", text: "hello" },
    { type: "tool_use", id: "call_2", name: "lookup", input: { q: "y" } },
  ]);
});
