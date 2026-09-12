export type AuthResult = { ok: true; path: string } | { ok: false };

export function stripPathSecret(path: string, secret: string | undefined): AuthResult {
  if (!secret) {
    return { ok: true, path };
  }
  const prefix = `/${secret}`;
  if (path === prefix) {
    return { ok: true, path: "/" };
  }
  if (path.startsWith(`${prefix}/`)) {
    return { ok: true, path: `/${path.slice(prefix.length + 1)}` };
  }
  return { ok: false };
}

export function dequery(target: string): string {
  const q = target.indexOf("?");
  return q === -1 ? target : target.slice(0, q);
}

export function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
