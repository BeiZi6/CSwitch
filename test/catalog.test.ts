import { expect, test } from "bun:test";
import { resolveUpstream } from "../src/gateway/catalog.ts";
import { openaiEndpoint, anthropicMessagesUrl } from "../src/gateway/endpoints.ts";
import type { Profile } from "../src/gateway/types.ts";

const profile: Profile = {
  id: "p1",
  name: "t",
  provider: "openai-responses",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  models: {
    sonnet: "gpt-4.1",
    opus: "gpt-4.1",
    haiku: "gpt-4.1-mini",
    fable: "",
  },
};

test("science selectors map onto profile models", () => {
  expect(resolveUpstream(profile, "claude-sonnet-5").upstreamModel).toBe("gpt-4.1");
  expect(resolveUpstream(profile, "claude-haiku-4-5-20251001").upstreamModel).toBe("gpt-4.1-mini");
  expect(resolveUpstream(profile, "claude-opus-4-8").role).toBe("opus");
});

test("endpoint joining", () => {
  expect(openaiEndpoint("https://api.example.com", "/chat/completions")).toBe(
    "https://api.example.com/v1/chat/completions",
  );
  expect(anthropicMessagesUrl("https://api.deepseek.com/anthropic")).toBe(
    "https://api.deepseek.com/anthropic/v1/messages",
  );
});
