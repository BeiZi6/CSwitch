import { expect, test } from "bun:test";
import {
  assertIsolatedDataDir,
  buildScienceLaunch,
  candidateScienceBins,
  firstHttpUrl,
  resolveScienceBinary,
} from "../src/science/launch.ts";
import { DEFAULT_GATEWAY_PORT } from "../src/gateway/types.ts";
import { scienceBaseUrl } from "../src/gateway/server.ts";

test("windows candidates include Claude Science install paths", () => {
  const paths = candidateScienceBins("win32", {
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    ProgramFiles: "C:\\Program Files",
    CSWITCH_SCIENCE_BIN: "D:\\tools\\claude-science.exe",
  });
  expect(paths[0]).toBe("D:\\tools\\claude-science.exe");
  expect(paths.some((path) => path.includes("Claude Science") && path.endsWith("claude-science.exe"))).toBe(true);
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
  expect(found.toLowerCase()).toContain("claude science");
});

test("url parser takes the first http URL", () => {
  expect(firstHttpUrl("noise\nhttp://127.0.0.1:8990/abc extra\n")).toBe("http://127.0.0.1:8990/abc");
});
