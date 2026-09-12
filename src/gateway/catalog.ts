import {
  OFFICIAL_DEFAULTS,
  SCIENCE_SELECTORS,
  type AdapterKind,
  type GatewayConfig,
  type ModelRole,
  type Profile,
} from "./types.js";

export interface ResolvedRoute {
  selectorId: string;
  displayName: string;
  upstreamModel: string;
  role: ModelRole;
}

export function adapterFor(profile: Profile): AdapterKind {
  return OFFICIAL_DEFAULTS[profile.provider].adapter;
}

export function resolveRole(model: string): ModelRole | undefined {
  const exact = SCIENCE_SELECTORS.find((item) => item.id === model);
  if (exact) {
    return exact.role;
  }
  const parts = model.split("-");
  if (parts[0] !== "claude" || parts.length < 3) {
    return undefined;
  }
  const known = ["sonnet", "opus", "haiku", "fable"] as const;
  for (const role of known) {
    if (parts.includes(role)) {
      return role;
    }
  }
  return undefined;
}

export function resolveUpstream(profile: Profile, requested: string): ResolvedRoute {
  const role = resolveRole(requested) ?? "sonnet";
  const upstream = profile.models[role] || profile.models.sonnet;
  if (!upstream) {
    throw new Error("当前配置缺少默认模型");
  }
  const selector = SCIENCE_SELECTORS.find((item) => item.id === requested);
  return {
    selectorId: requested,
    displayName: selector?.display ?? requested,
    upstreamModel: upstream,
    role,
  };
}

export function modelsResponse(config: GatewayConfig) {
  const data = SCIENCE_SELECTORS.map((item) => ({
    id: item.id,
    object: "model",
    created: 1_704_067_200,
    owned_by: "cswitch",
    display_name: item.display,
    type: "model",
  }));
  return { object: "list", data };
}
