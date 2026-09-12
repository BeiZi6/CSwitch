import http from "node:http";
import { dequery, stripPathSecret } from "./auth.js";
import { handleConnect } from "./connect.js";
import { adapterFor, modelsResponse, resolveUpstream } from "./catalog.js";
import { anthropicMessagesUrl } from "./endpoints.js";
import { postAnthropic, postOpenAI, sseEvent, anthropicToOpenAI, streamOpenAIToAnthropic } from "./openai-chat.js";
import {
  anthropicToResponses,
  postResponses,
  streamResponsesToAnthropic,
} from "./openai-responses.js";
import {
  MAX_BODY_BYTES,
  MAX_CONNECTIONS,
  USER_AGENT,
  type GatewayConfig,
} from "./types.js";

export interface RunningGateway {
  port: number;
  authSecret: string;
  close(): Promise<void>;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function pipeUpstream(res: http.ServerResponse, upstream: Response): Promise<void> {
  const contentType = upstream.headers.get("content-type") || "application/json";
  const headers: http.OutgoingHttpHeaders = {
    "content-type": contentType,
    "cache-control": "no-store",
  };
  res.writeHead(upstream.status, headers);
  res.flushHeaders();
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value && !res.write(value)) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
}

export function createGateway(config: GatewayConfig): http.Server {
  let active = 0;
  const server = http.createServer(async (req, res) => {
    if (active >= MAX_CONNECTIONS) {
      json(res, 503, { type: "error", error: { type: "overloaded_error", message: "too many connections" } });
      return;
    }
    active += 1;
    try {
      await handleRequest(config, req, res);
    } catch (error) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : "internal_error";
        json(res, 500, { type: "error", error: { type: "api_error", message } });
      } else {
        res.end();
      }
    } finally {
      active -= 1;
    }
  });
  server.on("connect", (req, socket, head) => {
    handleConnect(req, socket, head);
  });
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.requestTimeout = 1_800_000;
  return server;
}

async function handleRequest(
  config: GatewayConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const rawPath = dequery(req.url ?? "/");
  const auth = stripPathSecret(rawPath, config.authSecret);
  if (!auth.ok) {
    json(res, 403, { type: "error", error: { type: "authentication_error", message: "forbidden" } });
    return;
  }
  const path = auth.path;

  if (method === "GET" && path === "/health") {
    json(res, 200, {
      status: "ok",
      gateway: "cswitch",
      provider: config.profile.provider,
      adapter: adapterFor(config.profile),
    });
    return;
  }

  if (method === "GET" && path === "/v1/models") {
    json(res, 200, modelsResponse(config));
    return;
  }

  if (method === "POST" && path === "/v1/messages") {
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    } catch {
      json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "invalid json" } });
      return;
    }
    const requested = typeof body.model === "string" ? body.model : "claude-sonnet-5";
    const route = resolveUpstream(config.profile, requested);
    const adapter = adapterFor(config.profile);
    body.stream = true;

    if (adapter === "anthropic") {
      const payload = { ...body, model: route.upstreamModel };
      const upstream = await postAnthropic(
        config.profile,
        payload,
        anthropicMessagesUrl(config.profile.baseUrl),
      );
      await pipeUpstream(res, upstream);
      return;
    }

    if (adapter === "openai-chat") {
      const payload = anthropicToOpenAI({ ...body, model: route.upstreamModel }, route.upstreamModel);
      const upstream = await postOpenAI(config.profile, payload);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.flushHeaders();
      if (!upstream.ok) {
        res.write(
          sseEvent("error", {
            type: "error",
            error: { type: "api_error", message: `upstream ${upstream.status}` },
          }),
        );
        res.end();
        return;
      }
      await streamOpenAIToAnthropic(upstream, requested, (chunk) => {
        res.write(chunk);
      });
      res.end();
      return;
    }

    const responsesPayload = anthropicToResponses(
      { ...body, model: route.upstreamModel },
      route.upstreamModel,
    );
    const upstream = await postResponses(config.profile, responsesPayload);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.flushHeaders();
    if (!upstream.ok) {
      res.write(
        sseEvent("error", {
          type: "error",
          error: { type: "api_error", message: `upstream ${upstream.status}` },
        }),
      );
      res.end();
      return;
    }
    await streamResponsesToAnthropic(upstream, requested, (chunk) => {
      res.write(chunk);
    });
    res.end();
    return;
  }

  json(res, 404, { type: "error", error: { type: "not_found_error", message: path } });
}

export async function listenGateway(config: GatewayConfig): Promise<RunningGateway> {
  const server = createGateway(config);
  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  return {
    port,
    authSecret: config.authSecret,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function scienceBaseUrl(port: number, secret: string): string {
  return `http://127.0.0.1:${port}/${secret}`;
}

export function gatewayBanner(): string {
  return USER_AGENT;
}
