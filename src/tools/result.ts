import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolErrorCode = "bad_request" | "not_found" | "conflict" | "unavailable" | "server_error";

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function notFound(what: string): never {
  throw new ToolError("not_found", `${what} not found`);
}

export function badRequest(message: string): never {
  throw new ToolError("bad_request", message);
}

export function toolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Postgres/PostgREST errors are plain objects carrying a `code`: map the common ones to readable codes. */
export function toolErrorResult(error: unknown): CallToolResult {
  let code: ToolErrorCode = "server_error";
  let message = "Unexpected error";

  if (error instanceof ToolError) {
    code = error.code;
    message = error.message;
  } else if (error && typeof error === "object") {
    const pg = error as { code?: string; message?: string; details?: string };
    message = [pg.message, pg.details].filter(Boolean).join(" — ") || message;
    if (pg.code === "23505") code = "conflict";
    else if (pg.code === "23503" || pg.code === "23514" || pg.code === "22P02") code = "bad_request";
    else if (pg.code === "42P01" || pg.code === "PGRST205") {
      code = "unavailable";
      message = `${message} (a NovaFormation database migration is probably not applied yet)`;
    }
  }

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
  };
}
