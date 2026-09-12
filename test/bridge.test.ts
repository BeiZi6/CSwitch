import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireBridge } from "../src/renderer/bridge.ts";

test("requireBridge rejects a missing desktop API instead of reading .status", () => {
  expect(() => requireBridge(undefined).status()).toThrow(/桌面桥接未加载/);
  expect(requireBridge({ status: () => "ok" }).status()).toBe("ok");
});

test("packaged preload is CommonJS so Windows sandbox can load it", () => {
  const preload = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/main/preload.cjs"),
    "utf8",
  );
  expect(preload).toContain('require("electron")');
  expect(preload).toContain("exposeInMainWorld");
  expect(preload).not.toMatch(/^import\s/m);
});
