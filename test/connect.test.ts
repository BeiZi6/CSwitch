import { expect, test } from "bun:test";
import net from "node:net";
import { isBlockedHost, parseConnectTarget } from "../src/gateway/connect.ts";
import { listenGateway } from "../src/gateway/server.ts";
import type { Profile } from "../src/gateway/types.ts";

test("blocks Anthropic and Claude hosts", () => {
  expect(isBlockedHost("claude.ai")).toBe(true);
  expect(isBlockedHost("api.anthropic.com")).toBe(true);
  expect(isBlockedHost("www.claude.com")).toBe(true);
  expect(isBlockedHost("conda.anaconda.org")).toBe(false);
  expect(parseConnectTarget("claude.ai:443")).toEqual({ host: "claude.ai", port: 443 });
});

test("CONNECT to claude.ai is refused", async () => {
  const profile: Profile = {
    id: "p",
    name: "t",
    provider: "anthropic",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "sk",
    models: { sonnet: "s", opus: "o", haiku: "h", fable: "" },
  };
  const gw = await listenGateway({ port: 0, authSecret: "secret", profile });
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(gw.port, "127.0.0.1", () => {
        sock.write("CONNECT claude.ai:443 HTTP/1.1\r\nHost: claude.ai:443\r\n\r\n");
      });
      let data = "";
      sock.on("data", (chunk) => {
        data += chunk.toString("utf8");
        if (data.includes("\r\n\r\n")) {
          sock.end();
          resolve(data);
        }
      });
      sock.on("error", reject);
    });
    expect(body.startsWith("HTTP/1.1 401")).toBe(true);
  } finally {
    await gw.close();
  }
});
