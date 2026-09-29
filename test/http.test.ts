import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";
import { createContextProvider } from "../src/context.js";
import { createHttpServer } from "../src/http.js";
import { ALL_TOOLS, createMcpServer } from "../src/server.js";

const TOKEN = "test-token-123";
let server: Server;
let base: string;

beforeAll(async () => {
  // No Supabase credentials: the protocol works, tool calls report "unavailable".
  const config = loadConfig({ MCP_AUTH_TOKEN: TOKEN, MCP_PORT: "0", MCP_HOST: "127.0.0.1" });
  const getContext = createContextProvider(config);
  server = createHttpServer(config, () => createMcpServer(getContext));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function connect(transport: SSEClientTransport | StreamableHTTPClientTransport) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("http endpoints", () => {
  it("serves a public health check", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", configured: false, auth: true });
  });

  it("rejects MCP requests without the token", async () => {
    expect((await fetch(`${base}/sse`)).status).toBe(401);
    const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    expect((await fetch(`${base}/sse?token=nope`)).status).toBe(401);
  });

  it("answers OAuth discovery probes with 404", async () => {
    expect((await fetch(`${base}/.well-known/oauth-protected-resource`)).status).toBe(404);
  });

  it("refuses messages for an unknown SSE session", async () => {
    const res = await fetch(`${base}/messages?sessionId=unknown`, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});

describe("MCP over Streamable HTTP", () => {
  it("lists every tool with a bearer token", async () => {
    const client = await connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
    await client.close();
  });

  it("returns a structured error when the database is not configured", async () => {
    const client = await connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?token=${TOKEN}`)));
    const result = await client.callTool({ name: "get_overview", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toMatchObject({ error: { code: "unavailable" } });
    await client.close();
  });

  it("validates tool input before running it", async () => {
    const client = await connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?token=${TOKEN}`)));
    const result = await client.callTool({ name: "get_book", arguments: { book_id: "not-a-uuid" } });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe("MCP over SSE", () => {
  it("connects with ?token= in the URL and lists tools", async () => {
    const client = await connect(new SSEClientTransport(new URL(`${base}/sse?token=${TOKEN}`)));
    const { tools } = await client.listTools();
    expect(tools.length).toBe(ALL_TOOLS.length);
    await client.close();
  });
});

describe("tool catalogue", () => {
  it("has unique names", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes the complete activity lifecycle in the MCP catalogue", () => {
    const names = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of ["create_activity", "update_activity", "archive_activity",
      "set_activity_recurrence", "set_one_off_event_days", "add_activity_session", "update_activity_session",
      "delete_activity_sessions", "set_activity_session_status", "list_activities",
      "list_activity_sessions", "get_activity_statistics", "search_activities",
      "set_activity_links", "set_activity_session_skills", "create_activity_skill",
      "upload_activity_attachment", "read_activity_attachment"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("requires confirm=true on every delete tool", () => {
    for (const tool of ALL_TOOLS.filter((t) => t.kind === "delete")) {
      expect(tool.input, tool.name).toHaveProperty("confirm");
    }
  });

  it("never exposes the hidden Today and Habits sections", () => {
    expect(ALL_TOOLS.some((t) => /habit|today|task_template/i.test(t.name))).toBe(false);
  });
});
