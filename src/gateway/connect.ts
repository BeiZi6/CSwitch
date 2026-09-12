import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export function isBlockedHost(host: string): boolean {
  const name = host.trim().replace(/^\.+|\.+$/g, "").toLowerCase();
  return (
    name === "anthropic.com" ||
    name.endsWith(".anthropic.com") ||
    name === "claude.ai" ||
    name.endsWith(".claude.ai") ||
    name === "claude.com" ||
    name.endsWith(".claude.com")
  );
}

export function parseConnectTarget(target: string): { host: string; port: number } | undefined {
  const raw = target.trim();
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 2) {
      return undefined;
    }
    const host = raw.slice(1, close);
    const port = Number(raw.slice(close + 1).replace(/^:/, ""));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined;
    }
    return { host, port };
  }
  const colon = raw.lastIndexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  const host = raw.slice(0, colon);
  const port = Number(raw.slice(colon + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  return { host, port };
}

function writeStatus(socket: Duplex, code: number, reason: string): void {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
  socket.end();
}

function parentProxyOrigin(): { host: string; port: number } | undefined {
  const raw = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    if (!url.hostname || url.hostname === "claude.ai" || isBlockedHost(url.hostname)) {
      return undefined;
    }
    return { host: url.hostname, port };
  } catch {
    return undefined;
  }
}

function waitProxyConnectOk(proxy: net.Socket, done: (ok: boolean) => void): void {
  let buf = "";
  const onData = (chunk: Buffer) => {
    buf += chunk.toString("latin1");
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) {
      return;
    }
    proxy.off("data", onData);
    done(/^HTTP\/1\.[01] 200 /i.test(buf));
  };
  proxy.on("data", onData);
}

export function handleConnect(req: IncomingMessage, client: Duplex, head: Buffer): void {
  const parsed = parseConnectTarget(req.url ?? "");
  if (!parsed) {
    writeStatus(client, 400, "Bad Request");
    return;
  }
  if (isBlockedHost(parsed.host)) {
    writeStatus(client, 401, "Unauthorized");
    return;
  }
  const chain = parentProxyOrigin();
  const fail = () => {
    if (!client.destroyed) {
      writeStatus(client, 502, "Bad Gateway");
    }
  };
  const stitch = (upstream: net.Socket) => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) {
      upstream.write(head);
    }
    client.pipe(upstream);
    upstream.pipe(client);
  };
  if (chain && !(chain.host === parsed.host && chain.port === parsed.port)) {
    const proxy = net.connect(chain.port, chain.host, () => {
      proxy.write(`CONNECT ${parsed.host}:${parsed.port} HTTP/1.1\r\nHost: ${parsed.host}:${parsed.port}\r\n\r\n`);
      waitProxyConnectOk(proxy, (ok) => {
        if (!ok) {
          proxy.destroy();
          fail();
          return;
        }
        stitch(proxy);
      });
    });
    proxy.on("error", fail);
    client.on("error", () => proxy.destroy());
    return;
  }
  const upstream = net.connect(parsed.port, parsed.host, () => stitch(upstream));
  upstream.on("error", fail);
  client.on("error", () => {
    upstream.destroy();
  });
}
