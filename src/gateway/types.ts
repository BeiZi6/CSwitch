export const SCIENCE_SELECTORS = [
  { id: "claude-opus-5", display: "Claude Opus 5", role: "opus" },
  { id: "claude-sonnet-5", display: "Claude Sonnet 5", role: "sonnet" },
  { id: "claude-opus-4-8", display: "Claude Opus 4.8", role: "opus" },
  { id: "claude-sonnet-4-6", display: "Claude Sonnet 4.6", role: "sonnet" },
  { id: "claude-haiku-4-5-20251001", display: "Claude Haiku 4.5", role: "haiku" },
] as const;

export type ModelRole = "sonnet" | "opus" | "haiku" | "fable";

export type AdapterKind = "anthropic" | "openai-responses";

export type ProviderKind = "anthropic" | "openai-responses";

export interface ProfileModels {
  sonnet: string;
  opus: string;
  haiku: string;
  fable: string;
}

export interface Profile {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  models: ProfileModels;
}

export interface GatewayConfig {
  port: number;
  authSecret: string;
  profile: Profile;
}

export const OFFICIAL_DEFAULTS: Record<
  ProviderKind,
  { adapter: AdapterKind; baseUrl: string; label: string }
> = {
  anthropic: {
    adapter: "anthropic",
    baseUrl: "",
    label: "自定义 Anthropic",
  },
  "openai-responses": {
    adapter: "openai-responses",
    baseUrl: "",
    label: "自定义 OpenAI Responses",
  },
};

const LEGACY_PROVIDERS: Record<string, ProviderKind> = {
  deepseek: "anthropic",
  "anthropic-relay": "anthropic",
  custom: "anthropic",
  qwen: "openai-responses",
  "openai-chat": "openai-responses",
};

export function migrateProvider(raw: string | undefined): ProviderKind {
  if (raw === "anthropic" || raw === "openai-responses") {
    return raw;
  }
  return LEGACY_PROVIDERS[raw ?? ""] ?? "anthropic";
}

export const USER_AGENT = "CSwitch/0.1";
export const ANTHROPIC_VERSION = "2023-06-01";
export const MAX_BODY_BYTES = 64 * 1024 * 1024;
export const MAX_CONNECTIONS = 128;
/** Loopback gateway listen port. Distinct from CSSwitch 18991 and Science 8765. */
export const DEFAULT_GATEWAY_PORT = 19191;
