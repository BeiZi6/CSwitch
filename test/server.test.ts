import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { listenGateway, scienceBaseUrl } from "../src/gateway/server.ts";
import type { Profile } from "../src/gateway/types.ts";

async function withUpstream(
  handler: (req: Request) => Response | Promise<Response>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const url = `http://127.0.0.1${req.url ?? "/"}`;
    const request = new Request(url, {
      method: req.method,
      body:
        req.method === "GET" || req.method === "HEAD" || chunks.length === 0
          ? undefined
          : Buffer.concat(chunks),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}/v1`);
  } finally {
    server.close();
  }
}

test("health, models, and anthropic relay", async () => {
  await withUpstream(async (request) => {
    if (request.url.endsWith("/messages")) {
      const body = (await request.json()) as { model: string };
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "pong" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    return new Response("nope", { status: 404 });
  }, async (baseUrl) => {
    const profile: Profile = {
      id: "p",
      name: "relay",
      provider: "anthropic",
      baseUrl,
      apiKey: "sk-test",
      models: { sonnet: "up-sonnet", opus: "up-opus", haiku: "up-haiku", fable: "" },
    };
    const gw = await listenGateway({ port: 0, authSecret: "secret", profile });
    const root = scienceBaseUrl(gw.port, gw.authSecret);
    try {
      const health = await fetch(`${root}/health`);
      expect(health.status).toBe(200);
      const forbidden = await fetch(`http://127.0.0.1:${gw.port}/health`);
      expect(forbidden.status).toBe(403);
      const models = (await (await fetch(`${root}/v1/models`)).json()) as { data: Array<{ id: string }> };
      const ids = models.data.map((item) => item.id);
      expect(ids.some((id) => id.includes("sonnet"))).toBe(true);
      expect(ids.some((id) => id.includes("opus"))).toBe(true);
      expect(ids.some((id) => id.includes("haiku"))).toBe(true);
      const message = await fetch(`${root}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 32,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      expect(message.status).toBe(200);
      const payload = (await message.json()) as { content: Array<{ text: string }>; model: string };
      expect(payload.content[0]?.text).toBe("pong");
      expect(payload.model).toBe("up-sonnet");
    } finally {
      await gw.close();
    }
  });
});

test("openai-responses live gateway translates messages and streams", async () => {
  await withUpstream(async (request) => {
    if (!request.url.endsWith("/responses")) {
      return new Response("nope", { status: 404 });
    }
    const body = (await request.json()) as { model?: string; stream?: boolean };
    expect(body.model).toBe("up-sonnet");
    if (body.stream) {
      const sse = [
        'data: {"type":"response.output_text.delta","delta":"hello"}',
        'data: {"type":"response.completed"}',
        "",
      ].join("\n\n");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      id: "resp_1",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "pong-responses" }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }, async (baseUrl) => {
    const profile: Profile = {
      id: "p-resp",
      name: "responses",
      provider: "openai-responses",
      baseUrl,
      apiKey: "sk-test",
      models: { sonnet: "up-sonnet", opus: "up-opus", haiku: "up-haiku", fable: "" },
    };
    const gw = await listenGateway({ port: 0, authSecret: "secret", profile });
    const root = scienceBaseUrl(gw.port, gw.authSecret);
    try {
      const message = await fetch(`${root}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 32,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      expect(message.status).toBe(200);
      const sse = await message.text();
      expect(sse).toContain("event: message_start");
      expect(sse).toContain("hello");
      expect(sse).toContain("event: message_stop");
    } finally {
      await gw.close();
    }
  });
});
