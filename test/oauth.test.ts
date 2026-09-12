import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptTokenV2, encryptTokenV2, ensureVirtualLogin, prepareApiKeyAuth } from "../src/science/oauth.ts";

test("oauth v2 roundtrip matches Science token framing", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const payload = Buffer.from(JSON.stringify({ email: "virtual@localhost.invalid" }), "utf8");
  const encoded = encryptTokenV2(payload, key);
  expect(encoded.startsWith("v2:")).toBe(true);
  expect(decryptTokenV2(encoded, key).toString("utf8")).toBe(payload.toString("utf8"));
});

test("virtual login writes isolated tokens and refuses the real home", () => {
  const root = mkdtempSync(join(tmpdir(), "cswitch-oauth-"));
  const dataDir = join(root, "sandbox", ".claude-science");
  try {
    ensureVirtualLogin(dataDir, join(root, "real-home"));
    const keys = readFileSync(join(dataDir, "encryption.key"), "utf8");
    expect(keys).toContain("OAUTH_ENCRYPTION_KEY=");
    const tokens = readdirSync(join(dataDir, ".oauth-tokens")).filter((name) => name.endsWith(".enc"));
    expect(tokens).toHaveLength(1);
    const org = JSON.parse(readFileSync(join(dataDir, "active-org.json"), "utf8")) as { org_uuid: string };
    expect(org.org_uuid).toMatch(/^[0-9a-f-]{36}$/i);
    ensureVirtualLogin(dataDir, join(root, "real-home"));
    expect(readdirSync(join(dataDir, ".oauth-tokens")).filter((name) => name.endsWith(".enc"))).toHaveLength(1);
    expect(() => ensureVirtualLogin(join(root, "real-home", ".claude-science"), join(root, "real-home"))).toThrow();
    prepareApiKeyAuth(dataDir, join(root, "real-home"));
    expect(readdirSync(join(dataDir, ".oauth-tokens")).filter((name) => name.endsWith(".enc"))).toHaveLength(0);
    expect(() => readFileSync(join(dataDir, "active-org.json"))).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
