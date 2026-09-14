export interface Config {
  host: string;
  port: number;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  userId: string | undefined;
  authToken: string | undefined;
  publicUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number.parseInt(env.MCP_PORT ?? env.PORT ?? "8080", 10);
  return {
    host: env.MCP_HOST ?? env.HOST ?? "0.0.0.0",
    port: Number.isFinite(port) ? port : 8080,
    supabaseUrl: env.SUPABASE_URL?.trim() || undefined,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    userId: env.NOVAFORMATION_USER_ID?.trim() || undefined,
    authToken: env.MCP_AUTH_TOKEN?.trim() || undefined,
    publicUrl: env.MCP_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined,
  };
}
