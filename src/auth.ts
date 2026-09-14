import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * The token comes from `Authorization: Bearer <token>` or, for clients that only
 * accept a URL (claude.ai connectors), from `?token=<token>`.
 */
export function extractToken(req: IncomingMessage, url: URL): string | null {
  const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return url.searchParams.get("token")?.trim() || null;
}

/** No MCP_AUTH_TOKEN configured = open server; otherwise the token must match exactly. */
export function isAuthorized(provided: string | null, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
