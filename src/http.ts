import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractToken, isAuthorized } from "./auth.js";
import type { Config } from "./config.js";
import { SERVER_NAME, SERVER_VERSION } from "./server.js";

export const SSE_PATH = "/sse";
export const MESSAGES_PATH = "/messages";
export const STREAMABLE_PATH = "/mcp";

// Base64-encoded private activity attachments may be up to 10 MB.
const MAX_BODY_BYTES = 15 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

/**
 * Two transports over the same tools:
 *  - GET /sse + POST /messages?sessionId=…  legacy SSE (claude.ai connectors)
 *  - POST /mcp                               Streamable HTTP, stateless (ChatGPT, Claude Code…)
 * Auth: MCP_AUTH_TOKEN via `Authorization: Bearer` or `?token=`. /health stays public;
 * /messages is accepted for session ids handed out by an authenticated /sse stream.
 */
export function createHttpServer(config: Config, buildServer: () => McpServer): Server {
  const sseSessions = new Map<string, SSEServerTransport>();

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;

    try {
      if (pathname === "/health" || pathname === "/") {
        return sendJson(res, 200, {
          status: "ok",
          name: SERVER_NAME,
          version: SERVER_VERSION,
          configured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
          auth: Boolean(config.authToken),
          sse_sessions: sseSessions.size,
        });
      }

      // No OAuth provider: answer discovery probes with a clean 404 so clients fall back to the token.
      if (pathname.startsWith("/.well-known/")) {
        return sendJson(res, 404, { error: "not_found" });
      }

      if (pathname === MESSAGES_PATH || pathname === `${MESSAGES_PATH}/`) {
        if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
        const sessionId = url.searchParams.get("sessionId") ?? url.searchParams.get("session_id");
        const transport = sessionId ? sseSessions.get(sessionId) : undefined;
        if (!transport) return sendJson(res, 404, { error: "unknown_session" });
        const body = await readJsonBody(req);
        await transport.handlePostMessage(req, res, body);
        return;
      }

      const isSse = pathname === SSE_PATH || pathname === `${SSE_PATH}/`;
      const isStreamable = pathname === STREAMABLE_PATH || pathname === `${STREAMABLE_PATH}/`;
      if (!isSse && !isStreamable) return sendJson(res, 404, { error: "not_found" });

      if (!isAuthorized(extractToken(req, url), config.authToken)) {
        return sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      }

      if (isSse) {
        if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
        const transport = new SSEServerTransport(MESSAGES_PATH, res);
        sseSessions.set(transport.sessionId, transport);
        const server = buildServer();
        res.on("close", () => {
          sseSessions.delete(transport.sessionId);
          void server.close();
        });
        await server.connect(transport);
        return;
      }

      // Streamable HTTP, stateless: a fresh server + transport per request.
      if (req.method !== "POST") {
        return sendJson(
          res,
          405,
          { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
          { Allow: "POST" },
        );
      }
      const body = await readJsonBody(req);
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      if (status >= 500) console.error("[novaformation-mcp]", error);
      sendJson(res, status, { error: status === 500 ? "server_error" : (error as Error).message });
    }
  });
}
