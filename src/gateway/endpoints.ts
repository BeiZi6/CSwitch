export function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function normalizeOpenaiBase(base: string): string {
  let out = trimSlash(base);
  for (const suffix of [
    "/v1/chat/completions",
    "/chat/completions",
    "/v1/responses",
    "/responses",
    "/v1/models",
    "/models",
  ]) {
    if (out.endsWith(suffix)) {
      out = trimSlash(out.slice(0, -suffix.length));
      break;
    }
  }
  return out;
}

function endsWithVersionSegment(base: string): boolean {
  const last = base.split("/").pop() ?? "";
  if (!last.startsWith("v")) {
    return false;
  }
  const version = last.slice(1);
  return version.length > 0 && version.split(".").every((part) => /^\d+$/.test(part));
}

export function openaiEndpoint(base: string, suffix: string): string {
  let root = normalizeOpenaiBase(base);
  if (!endsWithVersionSegment(root)) {
    root += "/v1";
  }
  return `${root}${suffix}`;
}

export function normalizeAnthropicV1Base(base: string): string {
  let root = trimSlash(base);
  for (const suffix of ["/messages", "/models"]) {
    if (root.endsWith(suffix)) {
      root = trimSlash(root.slice(0, -suffix.length));
      break;
    }
  }
  if (!root.endsWith("/v1")) {
    root += "/v1";
  }
  return root;
}

export function anthropicMessagesUrl(base: string): string {
  return `${normalizeAnthropicV1Base(base)}/messages`;
}

export function anthropicModelsUrl(base: string): string {
  return `${normalizeAnthropicV1Base(base)}/models`;
}

export function requireHttpUrl(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    throw new Error(`${label} 必须是 http(s)://...`);
  }
  return trimmed;
}
