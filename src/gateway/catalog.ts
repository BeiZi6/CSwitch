import { createHash } from "node:crypto";
import {
  OFFICIAL_DEFAULTS,
  SCIENCE_SELECTORS,
  type AdapterKind,
  type GatewayConfig,
  type ModelRole,
  type Profile,
  type ProfileModels,
  type ProviderKind,
} from "./types.js";

const CREATED_AT = "2026-01-01T00:00:00Z";
const ROLE_ORDER: ModelRole[] = ["sonnet", "opus", "haiku", "fable"];

export interface ResolvedRoute {
  selectorId: string;
  displayName: string;
  upstreamModel: string;
  role: ModelRole;
}

export interface CatalogRoute extends ResolvedRoute {
  supportsTools: boolean;
}

export function adapterFor(profile: Profile): AdapterKind {
  return OFFICIAL_DEFAULTS[profile.provider].adapter;
}

export function filledModels(profile: Profile): ProfileModels {
  const sonnet = profile.models.sonnet.trim();
  return {
    sonnet,
    opus: profile.models.opus.trim() || sonnet,
    haiku: profile.models.haiku.trim() || sonnet,
    fable: profile.models.fable.trim() || sonnet,
  };
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

function slug(value: string, max: number): string {
  let out = "";
  let pendingDash = false;
  for (const ch of value.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) {
      if (pendingDash && out.length > 0 && out.length < max) {
        out += "-";
      }
      pendingDash = false;
      if (out.length < max) {
        out += ch;
      }
    } else {
      pendingDash = true;
    }
    if (out.length >= max) {
      break;
    }
  }
  out = out.replace(/-+$/g, "");
  return out || "model";
}

export function namespaceFor(provider: ProviderKind): string {
  if (provider === "openai-responses") {
    return "custom-openai-responses";
  }
  if (provider === "openai-chat") {
    return "custom-openai-chat";
  }
  return "custom-anthropic";
}

export function selectorId(namespace: string, upstreamModel: string): string {
  const digest = createHash("sha256")
    .update(`selector-v1\0${namespace}\0${upstreamModel}`)
    .digest()
    .subarray(0, 6)
    .toString("hex");
  return `claude-cswitch-${slug(namespace, 36)}-${slug(upstreamModel, 94)}-${digest}`;
}

export function buildCatalog(profile: Profile): {
  routes: CatalogRoute[];
  bySelector: Map<string, CatalogRoute>;
  defaultSelectorId: string;
} {
  const models = filledModels(profile);
  if (!models.sonnet) {
    throw new Error("当前配置缺少默认模型");
  }
  const namespace = namespaceFor(profile.provider);
  const byUpstream = new Map<string, CatalogRoute>();
  const routes: CatalogRoute[] = [];
  const bySelector = new Map<string, CatalogRoute>();
  for (const role of ROLE_ORDER) {
    const upstream = models[role];
    let route = byUpstream.get(upstream);
    if (!route) {
      route = {
        selectorId: selectorId(namespace, upstream),
        displayName: upstream,
        upstreamModel: upstream,
        role,
        supportsTools: true,
      };
      byUpstream.set(upstream, route);
      routes.push(route);
      bySelector.set(route.selectorId, route);
    }
  }
  const defaultSelectorId = selectorId(namespace, models.sonnet);
  for (const selector of SCIENCE_SELECTORS) {
    const upstream = models[selector.role] || models.sonnet;
    const displayName = byUpstream.get(upstream)?.displayName ?? upstream;
    if (!bySelector.has(selector.id)) {
      bySelector.set(selector.id, {
        selectorId: selector.id,
        displayName,
        upstreamModel: upstream,
        role: selector.role,
        supportsTools: true,
      });
    }
  }
  return { routes, bySelector, defaultSelectorId };
}

export function resolveUpstream(profile: Profile, requested: string): ResolvedRoute {
  const catalog = buildCatalog(profile);
  const exact = catalog.bySelector.get(requested);
  if (exact) {
    return exact;
  }
  const models = filledModels(profile);
  if (Object.values(models).includes(requested)) {
    return {
      selectorId: requested,
      displayName: requested,
      upstreamModel: requested,
      role: resolveRole(requested) ?? "sonnet",
    };
  }
  const role = resolveRole(requested) ?? "sonnet";
  const upstream = models[role] || models.sonnet;
  return {
    selectorId: requested,
    displayName: upstream,
    upstreamModel: upstream,
    role,
  };
}

function modelEntry(route: CatalogRoute) {
  return {
    type: "model",
    id: route.selectorId,
    display_name: route.displayName,
    supports_tools: route.supportsTools,
    capabilities: {
      reasoning_round_trip: "none",
      forced_tool_choice: true,
      structured_output: false,
      vision: false,
    },
    created_at: CREATED_AT,
  };
}

export function modelsResponse(config: GatewayConfig) {
  const catalog = buildCatalog(config.profile);
  const seen = new Set<string>();
  const data: ReturnType<typeof modelEntry>[] = [];
  const prefer = catalog.routes.find((route) => route.selectorId === catalog.defaultSelectorId);
  const ordered = prefer
    ? [prefer, ...catalog.routes.filter((route) => route.selectorId !== prefer.selectorId)]
    : catalog.routes;
  for (const route of ordered) {
    if (seen.has(route.selectorId)) {
      continue;
    }
    seen.add(route.selectorId);
    data.push(modelEntry(route));
  }
  for (const selector of SCIENCE_SELECTORS) {
    const route = catalog.bySelector.get(selector.id);
    if (!route || seen.has(selector.id)) {
      continue;
    }
    seen.add(selector.id);
    data.push(modelEntry({ ...route, selectorId: selector.id }));
  }
  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}
