import { z } from "zod";
import type { ToolContext } from "../context.js";

/**
 * read   → no side effect
 * write  → creates or changes data
 * delete → removes data; every delete tool requires `confirm: true`
 */
export type ToolKind = "read" | "write" | "delete";

export interface McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  input: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<Shape extends z.ZodRawShape>(tool: McpTool<Shape>): McpTool {
  return tool as unknown as McpTool;
}

// ------------------------------------------------------------ shared schemas

export const id = (what: string) => z.string().uuid().describe(`${what} id (uuid)`);

export const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .describe("Date, YYYY-MM-DD");

export const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "expected an ISO 8601 date or date-time")
  .describe("ISO 8601 date-time, e.g. 2026-09-14T18:30:00+02:00 (a bare YYYY-MM-DD also works)");

export const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "expected a hex color like #6366f1")
  .describe("Hex color, e.g. #6366f1");

export const icon = z
  .string()
  .min(1)
  .max(60)
  .describe("Lucide icon name, e.g. Rocket, BookOpen, Dumbbell, Target, Brain, Briefcase");

export const limit = (fallback: number, max: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`Max rows (default ${fallback}, max ${max})`);

/** Deletions are irreversible: the caller has to acknowledge it explicitly. */
export const confirm = z
  .literal(true)
  .describe("Must be true: deletion is permanent. Only delete when the user explicitly asked for it.");

/** Drops `undefined` values so a partial update only touches the fields that were sent. */
export function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function percent(ratio: number) {
  return Math.round(ratio * 1000) / 10;
}

export function throwIf(error: unknown) {
  if (error) throw error;
}
