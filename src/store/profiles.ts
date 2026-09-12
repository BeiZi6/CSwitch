import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_GATEWAY_PORT,
  migrateProvider,
  OFFICIAL_DEFAULTS,
  type Profile,
  type ProfileModels,
  type ProviderKind,
} from "../gateway/types.js";
import { requireHttpUrl } from "../gateway/endpoints.js";

export interface StoredState {
  currentId: string | null;
  profiles: Profile[];
  port: number;
  sciencePort: number;
}

const DEFAULT_MODELS: ProfileModels = {
  sonnet: "",
  opus: "",
  haiku: "",
  fable: "",
};

export function emptyState(): StoredState {
  return { currentId: null, profiles: [], port: DEFAULT_GATEWAY_PORT, sciencePort: 8990 };
}

export function profileStorePath(root: string): string {
  return join(root, "state.json");
}

export function loadState(root: string): StoredState {
  try {
    const raw = readFileSync(profileStorePath(root), "utf8");
    const parsed = JSON.parse(raw) as StoredState;
    if (!Array.isArray(parsed.profiles)) {
      return emptyState();
    }
    return {
      currentId: parsed.currentId ?? null,
      profiles: parsed.profiles.map((profile) => ({
        ...profile,
        provider: migrateProvider(profile.provider),
      })),
      port: Number.isInteger(parsed.port) && parsed.port > 0 ? parsed.port : DEFAULT_GATEWAY_PORT,
      sciencePort:
        Number.isInteger(parsed.sciencePort) && parsed.sciencePort > 0
          ? parsed.sciencePort
          : 8990,
    };
  } catch {
    return emptyState();
  }
}

export function saveState(root: string, state: StoredState): void {
  const path = profileStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function maskKey(apiKey: string): string {
  if (!apiKey) {
    return "未填写";
  }
  if (apiKey.length <= 8) {
    return "••••";
  }
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

export function publicProfile(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    models: profile.models,
    apiKeyMasked: maskKey(profile.apiKey),
    hasKey: Boolean(profile.apiKey),
  };
}

export function validateProfile(input: Partial<Profile> & { provider: ProviderKind }): Profile {
  const name = (input.name ?? "").trim();
  if (!name) {
    throw new Error("配置名称不能为空");
  }
  const defaults = OFFICIAL_DEFAULTS[input.provider];
  if (!defaults) {
    throw new Error("不支持的 provider");
  }
  const baseUrl = requireHttpUrl(input.baseUrl || defaults.baseUrl, "base URL");
  const models = {
    sonnet: (input.models?.sonnet ?? "").trim(),
    opus: (input.models?.opus ?? "").trim(),
    haiku: (input.models?.haiku ?? "").trim(),
    fable: (input.models?.fable ?? "").trim(),
  };
  if (!models.sonnet) {
    throw new Error("必须填写默认 / Sonnet 模型 ID");
  }
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey) {
    throw new Error("必须填写 API Key");
  }
  return {
    id: input.id?.trim() || randomUUID(),
    name,
    provider: input.provider,
    baseUrl,
    apiKey,
    models,
  };
}

export function upsertProfile(state: StoredState, profile: Profile): StoredState {
  const index = state.profiles.findIndex((item) => item.id === profile.id);
  const profiles = [...state.profiles];
  if (index === -1) {
    profiles.push(profile);
  } else {
    profiles[index] = profile;
  }
  return {
    ...state,
    profiles,
    currentId: state.currentId ?? profile.id,
  };
}

export function deleteProfile(state: StoredState, id: string): StoredState {
  const profiles = state.profiles.filter((item) => item.id !== id);
  return {
    ...state,
    profiles,
    currentId: state.currentId === id ? (profiles[0]?.id ?? null) : state.currentId,
  };
}

export function currentProfile(state: StoredState): Profile | undefined {
  return state.profiles.find((item) => item.id === state.currentId);
}

export { DEFAULT_MODELS };
