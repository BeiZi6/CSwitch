import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertIsolatedDataDir,
  buildScienceLaunch,
  candidateScienceBins,
  firstHttpUrl,
  pickSandboxHome,
  resolveScienceBinary,
  SCIENCE_LOCAL_API_KEY,
  writeIsolatedProxyConfig,
} from "../src/science/launch.ts";
import { DEFAULT_GATEWAY_PORT } from "../src/gateway/types.ts";
import { scienceBaseUrl } from "../src/gateway/server.ts";

test("windows candidates include Claude Science install paths", () => {
  const paths = candidateScienceBins("win32", {
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    ProgramFiles: "C:\\Program Files",
    PATH: "C:\\Users\\me\\bin",
    CSWITCH_SCIENCE_BIN: "D:\\tools\\claude-science.exe",
  });
  expect(paths[0]).toBe("D:\\tools\\claude-science.exe");
  expect(paths.some((path) => path.includes("ClaudeScience") && path.endsWith("claude-science.exe"))).toBe(true);
  expect(paths.some((path) => path.includes("Claude Science") && path.endsWith("claude-science.exe"))).toBe(true);
  expect(paths).toContain("C:\\Users\\me\\bin\\claude-science.exe");
});

test("launch plan isolates data-dir and injects gateway URL", () => {
  expect(DEFAULT_GATEWAY_PORT).not.toBe(18991);
  expect(DEFAULT_GATEWAY_PORT).not.toBe(8765);
  const secret = "path-secret";
  const gatewayUrl = scienceBaseUrl(DEFAULT_GATEWAY_PORT, secret);
  const spec = buildScienceLaunch({
    binary: "C:\\claude-science.exe",
    sandboxHome: "/tmp/cswitch-home",
    realHome: "/Users/me",
    gatewayUrl,
    sciencePort: 8990,
    previewPort: 8992,
    platform: "win32",
  });
  expect(spec.env.ANTHROPIC_BASE_URL).toBe(gatewayUrl);
  expect(spec.env.ANTHROPIC_API_KEY).toBe(SCIENCE_LOCAL_API_KEY);
  expect(spec.env.ANTHROPIC_AUTH_TOKEN).toBe(SCIENCE_LOCAL_API_KEY);
  expect(spec.env.HTTPS_PROXY).toBe(`http://127.0.0.1:${DEFAULT_GATEWAY_PORT}`);
  expect(spec.env.NO_PROXY).toContain("127.0.0.1");
  expect(spec.env.HTTPS_PROXY).not.toContain(secret);
  expect(spec.env.ANTHROPIC_BASE_URL).toContain(`127.0.0.1:${DEFAULT_GATEWAY_PORT}/`);
  expect(spec.env.ANTHROPIC_BASE_URL).toContain(`/${secret}`);
  expect(spec.env.HOME).toBe("/tmp/cswitch-home");
  expect(spec.args).toContain("serve");
  expect(spec.args).toContain("8990");
  expect(spec.args).not.toContain("8765");
  expect(spec.dataDir).toContain(".claude-science");
  expect(() => assertIsolatedDataDir("/Users/me/.claude-science", "/Users/me")).toThrow();
  expect(() =>
    buildScienceLaunch({
      binary: "x",
      sandboxHome: "/tmp/x",
      realHome: "/Users/me",
      gatewayUrl: "http://127.0.0.1/s",
      sciencePort: 8765,
      previewPort: 8992,
      platform: "win32",
    }),
  ).toThrow();
});

test("binary resolution uses the first existing candidate", () => {
  const found = resolveScienceBinary("win32", { LOCALAPPDATA: "C:\\x" }, (path) =>
    path.endsWith("resources\\bin\\claude-science.exe") ||
    path.endsWith("resources/bin/claude-science.exe"),
  );
  expect(found.replaceAll("\\", "/").toLowerCase()).toContain("resources/bin/claude-science.exe");
});

test("windows resolution prefers official ClaudeScience install", () => {
  const official = "C:\\Users\\me\\AppData\\Local\\Programs\\ClaudeScience\\claude-science.exe";
  const found = resolveScienceBinary(
    "win32",
    { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    (path) => path === official,
  );
  expect(found).toBe(official);
});

test("sandbox home prefers the volume with more free space", () => {
  const picked = pickSandboxHome(
    [
      "C:\\Users\\me\\AppData\\Roaming\\CSwitch\\cswitch\\sandbox\\home",
      "D:\\CSwitch\\sandbox\\home",
    ],
    (path) => (path.startsWith("D:") ? 191 * 1024 ** 3 : 0.13 * 1024 ** 3),
  );
  expect(picked).toBe("D:\\CSwitch\\sandbox\\home");
});

test("url parser takes the first http URL", () => {
  expect(firstHttpUrl("noise\nhttp://127.0.0.1:8990/abc extra\n")).toBe("http://127.0.0.1:8990/abc");
});

test("isolated proxy config stays out of the real home", () => {
  const root = mkdtempSync(join(tmpdir(), "cswitch-proxy-"));
  const dataDir = join(root, "sandbox", ".claude-science");
  try {
    writeIsolatedProxyConfig(dataDir, join(root, "real-home"), "http://127.0.0.1:19191");
    expect(readFileSync(join(dataDir, "config.toml"), "utf8")).toContain('proxy = "http://127.0.0.1:19191"');
    expect(() => writeIsolatedProxyConfig(join(root, "real-home", ".claude-science"), join(root, "real-home"), "http://127.0.0.1:1")).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
