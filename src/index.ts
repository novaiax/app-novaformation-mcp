import { loadConfig } from "./config.js";
import { createContextProvider } from "./context.js";
import { createHttpServer, SSE_PATH, STREAMABLE_PATH } from "./http.js";
import { createMcpServer } from "./server.js";

const config = loadConfig();
const getContext = createContextProvider(config);
const httpServer = createHttpServer(config, () => createMcpServer(getContext));

httpServer.listen(config.port, config.host, () => {
  const base = config.publicUrl ?? `http://${config.host}:${config.port}`;
  console.log(`[novaformation-mcp] listening on ${config.host}:${config.port}`);
  console.log(`[novaformation-mcp] SSE: ${base}${SSE_PATH} · Streamable HTTP: ${base}${STREAMABLE_PATH}`);
  if (!config.authToken) console.warn("[novaformation-mcp] MCP_AUTH_TOKEN is not set: the server is open to anyone.");
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.warn("[novaformation-mcp] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing: tools will return an error.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
