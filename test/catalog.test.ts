import { expect, test } from "bun:test";
import { modelsResponse, resolveUpstream, selectorId } from "../src/gateway/catalog.ts";
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

test("custom catalog ids start with claude- and show upstream names", () => {
  const custom = selectorId("custom-openai-responses", "gpt-4.1");
  expect(custom.startsWith("claude-cswitch-")).toBe(true);
  expect(resolveUpstream(profile, custom).upstreamModel).toBe("gpt-4.1");
  const models = modelsResponse({
    port: 19191,
    authSecret: "s",
    profile,
  });
  expect(models.data[0]?.id).toBe(custom);
  expect(models.data[0]?.display_name).toBe("gpt-4.1");
  expect(models.first_id).toBe(custom);
  expect(models.data.some((item) => item.id === "claude-sonnet-5")).toBe(true);
  expect(models.data.every((item) => item.id.startsWith("claude-"))).toBe(true);
});

test("endpoint joining", () => {
  expect(openaiEndpoint("https://api.example.com", "/chat/completions")).toBe(
    "https://api.example.com/v1/chat/completions",
  );
  expect(anthropicMessagesUrl("https://api.deepseek.com/anthropic")).toBe(
    "https://api.deepseek.com/anthropic/v1/messages",
  );
});
