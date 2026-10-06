import http from "node:http";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 3000);
const UPSTREAM =
  process.env.LUCKIN_MCP_URL ||
  "https://gwmcp.lkcoffee.com/order/user/mcp";
const TOKEN = process.env.LUCKIN_MCP_TOKEN;

if (!TOKEN) {
  console.error("[BOOT] Missing LUCKIN_MCP_TOKEN");
  process.exit(1);
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

function safeRequestInfo(req) {
  return {
    method: req.method,
    url: req.url,
    contentType: req.headers["content-type"] || null,
    accept: req.headers["accept"] || null,
    protocolVersion: req.headers["mcp-protocol-version"] || null,
    sessionId: req.headers["mcp-session-id"] ? "[present]" : null,
    userAgent: req.headers["user-agent"] || null
  };
}

function copyRequestHeaders(req) {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(name.toLowerCase())) continue;

    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v);
    } else {
      headers.set(name, value);
    }
  }

  // Never log this value.
  headers.set("authorization", `Bearer ${TOKEN}`);

  return headers;
}

function copyResponseHeaders(upstream, res) {
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  });

  res.setHeader("cache-control", "no-store");
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();

  console.log("[IN]", JSON.stringify(safeRequestInfo(req)));

  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({ ok: true }));

    console.log("[OUT]", JSON.stringify({
      path: "/health",
      status: 200,
      ms: Date.now() - started
    }));

    return;
  }

  if (req.url !== "/mcp") {
    res.writeHead(404, {
      "content-type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({
      error: "Not found",
      mcp: "/mcp"
    }));

    console.log("[OUT]", JSON.stringify({
      status: 404,
      ms: Date.now() - started
    }));

    return;
  }

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.writeHead(405, {
      allow: "GET, POST, DELETE"
    });

    res.end();

    console.log("[OUT]", JSON.stringify({
      status: 405,
      ms: Date.now() - started
    }));

    return;
  }

  try {
    const init = {
      method: req.method,
      headers: copyRequestHeaders(req),
      redirect: "manual"
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = Readable.toWeb(req);
      init.duplex = "half";
    }

    console.log("[UPSTREAM]", JSON.stringify({
      method: req.method,
      target: "Luckin MCP",
      token: "[REDACTED]"
    }));

    const upstream = await fetch(UPSTREAM, init);

    console.log("[UPSTREAM RESPONSE]", JSON.stringify({
      status: upstream.status,
      contentType: upstream.headers.get("content-type"),
      sessionId: upstream.headers.get("mcp-session-id")
        ? "[present]"
        : null,
      location: upstream.headers.get("location") || null,
      ms: Date.now() - started
    }));

    res.statusCode = upstream.status;
    copyResponseHeaders(upstream, res);

    if (!upstream.body) {
      res.end();

      console.log("[OUT]", JSON.stringify({
        status: upstream.status,
        body: false,
        ms: Date.now() - started
      }));

      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);

    res.on("finish", () => {
      console.log("[OUT]", JSON.stringify({
        status: upstream.status,
        body: true,
        ms: Date.now() - started
      }));
    });

  } catch (err) {
    console.error("[PROXY ERROR]", JSON.stringify({
      name: err?.name || "Error",
      message: err?.message || String(err)
    }));

    if (!res.headersSent) {
      res.writeHead(502, {
        "content-type": "application/json; charset=utf-8"
      });
    }

    res.end(JSON.stringify({
      error: "Upstream MCP request failed"
    }));
  }
});

server.requestTimeout = 0;
server.headersTimeout = 125000;
server.keepAliveTimeout = 65000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[BOOT] Luckin MCP debug proxy listening on :${PORT}`);
});
