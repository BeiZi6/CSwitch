import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertIsolatedDataDir } from "./launch.js";

const KEY_NAMES = [
  "ANTHROPIC_API_KEY_ENCRYPTION_KEY",
  "OAUTH_ENCRYPTION_KEY",
  "JWT_SIGNING_SECRET",
  "USER_SECRET_ENCRYPTION_KEY",
] as const;
const HKDF_INFO = Buffer.from("operon:aes-256-gcm:oauth");
const AAD = Buffer.from("v2:oauth");
const VIRTUAL_EMAIL = "virtual@localhost.invalid";

function b64Key(): string {
  return randomBytes(32).toString("base64");
}

export function deriveOauthKey(oauthKeyB64: string): Buffer {
  const ikm = Buffer.from(oauthKeyB64.trim(), "base64");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), HKDF_INFO, 32));
}

export function encryptTokenV2(plaintext: Buffer, oauthKeyB64: string): string {
  const key = deriveOauthKey(oauthKeyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${Buffer.concat([iv, encrypted, tag]).toString("base64")}`;
}

export function decryptTokenV2(body: string, oauthKeyB64: string): Buffer {
  if (!body.startsWith("v2:")) {
    throw new Error("缺 v2: 前缀");
  }
  const raw = Buffer.from(body.slice(3), "base64");
  if (raw.length < 12 + 16) {
    throw new Error("v2 密文过短");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", deriveOauthKey(oauthKeyB64), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function parseKeyFile(text: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const value = line.slice(eq + 1).trim();
      if (value) {
        keys.set(line.slice(0, eq).trim(), value);
      }
    }
  }
  return keys;
}

function oauthKeyUsable(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    return Buffer.from(value.trim(), "base64").length >= 16;
  } catch {
    return false;
  }
}

function writeFile(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
}

export function prepareApiKeyAuth(dataDir: string, realHome: string): void {
  assertIsolatedDataDir(dataDir, realHome);
  mkdirSync(dataDir, { recursive: true });
  const tokenDir = join(dataDir, ".oauth-tokens");
  if (existsSync(tokenDir)) {
    for (const name of readdirSync(tokenDir)) {
      rmSync(join(tokenDir, name), { recursive: true, force: true });
    }
  }
  const activeOrg = join(dataDir, "active-org.json");
  if (existsSync(activeOrg)) {
    unlinkSync(activeOrg);
  }
}

export function ensureVirtualLogin(dataDir: string, realHome: string): void {
  assertIsolatedDataDir(dataDir, realHome);
  mkdirSync(dataDir, { recursive: true });
  const keyFile = join(dataDir, "encryption.key");
  let keys = new Map<string, string>();
  try {
    keys = parseKeyFile(readFileSync(keyFile, "utf8"));
  } catch {
    keys = new Map();
  }
  if (!oauthKeyUsable(keys.get("OAUTH_ENCRYPTION_KEY"))) {
    keys.delete("OAUTH_ENCRYPTION_KEY");
  }
  for (const name of KEY_NAMES) {
    if (!keys.has(name)) {
      keys.set(name, b64Key());
    }
  }
  const oauthKey = keys.get("OAUTH_ENCRYPTION_KEY");
  if (!oauthKey) {
    throw new Error("无法写入虚拟登录密钥");
  }
  writeFile(keyFile, `${KEY_NAMES.map((name) => `${name}=${keys.get(name)}`).join("\n")}\n`);

  const tokenDir = join(dataDir, ".oauth-tokens");
  mkdirSync(tokenDir, { recursive: true });
  const existing = readdirSync(tokenDir).filter((name) => name.endsWith(".enc"));
  if (existing.length === 1) {
    try {
      const body = readFileSync(join(tokenDir, existing[0]), "utf8").trim();
      const parsed = JSON.parse(decryptTokenV2(body, oauthKey).toString("utf8")) as {
        email?: string;
        org_uuid?: string;
      };
      if (parsed.email === VIRTUAL_EMAIL && parsed.org_uuid) {
        writeFile(join(dataDir, "active-org.json"), `${JSON.stringify({ org_uuid: parsed.org_uuid }, null, 2)}\n`);
        return;
      }
    } catch {
      // rewrite below
    }
  }
  for (const name of existing) {
    unlinkSync(join(tokenDir, name));
  }

  const accountUuid = randomUUID();
  const orgUuid = randomUUID();
  const blob = {
    access_token: `sk-ant-virtual-${randomBytes(24).toString("hex")}`,
    refresh_token: "",
    api_key: null,
    token_expires_at: "2099-01-01T00:00:00.000Z",
    provider: "claude_ai",
    scopes: "user:inference user:file_upload user:profile user:mcp_servers user:plugins",
    email: VIRTUAL_EMAIL,
    account_uuid: accountUuid,
    subscription_type: "max",
    rate_limit_tier: null,
    seat_tier: null,
    org_uuid: orgUuid,
    billing_type: null,
    has_extra_usage_enabled: false,
  };
  const encBody = encryptTokenV2(Buffer.from(JSON.stringify(blob), "utf8"), oauthKey);
  const roundtrip = JSON.parse(decryptTokenV2(encBody, oauthKey).toString("utf8")) as { email?: string };
  if (roundtrip.email !== VIRTUAL_EMAIL) {
    throw new Error("虚拟登录自校验失败");
  }
  const userId = accountUuid.replace(/[^A-Za-z0-9_-]/g, "");
  writeFile(join(tokenDir, `${userId}.enc`), encBody);
  writeFile(join(dataDir, "active-org.json"), `${JSON.stringify({ org_uuid: orgUuid }, null, 2)}\n`);
}
