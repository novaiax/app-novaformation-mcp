import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../../src/context.js";
import type { ConnectionRef, ConnectionTarget } from "../../src/domain/database.js";
import { ALL_TOOLS } from "../../src/server.js";
import { connectionTools } from "../../src/tools/connections.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const BOOK = "44444444-4444-4444-8444-444444444444";
const EXERCISE = "55555555-5555-4555-8555-555555555555";
const ACTIVITY = "66666666-6666-4666-8666-666666666666";
const PRIVATE_BOOK = "77777777-7777-4777-8777-777777777777";

const key = (value: ConnectionRef) => `${value.type}:${value.id}`;
const edge = (source: ConnectionRef, target: ConnectionRef) => [key(source), key(target)].sort().join("|");

function context() {
  const catalog = [
    { type: "program", id: PROGRAM, user_id: USER, title: "Éloquence" },
    { type: "book", id: BOOK, user_id: USER, title: "Rhétorique" },
    { type: "exercise", id: EXERCISE, user_id: USER, title: "Simulation" },
    { type: "activity", id: ACTIVITY, user_id: USER, title: "Impro" },
    { type: "book", id: PRIVATE_BOOK, user_id: OTHER, title: "Livre privé" },
  ].map((row) => ({ ...row, subtitle: "", icon: "BookOpen", color: "#3366ff", status: "active" }));
  const queries: { table: string; filters: [string, unknown][]; ranges: [number, number][] }[] = [];
  const direct = new Set<string>();
  const planning = new Set<string>();
  const connections = (source: ConnectionRef): ConnectionTarget[] => catalog
    .filter((row) => row.user_id === USER && row.type !== source.type)
    .flatMap((row) => {
      const connection = edge(source, row as ConnectionRef);
      return direct.has(connection) || planning.has(connection)
        ? [{ ...row, direct: direct.has(connection), in_planning: planning.has(connection) } as ConnectionTarget]
        : [];
    });
  const rpc = vi.fn(async (name: string, args: {
    p_entity_type: ConnectionRef["type"]; p_entity_id: string; p_user_id: string;
    p_targets?: ConnectionRef[]; p_connect?: boolean;
  }) => {
    expect(args.p_user_id).toBe(USER);
    const source = { type: args.p_entity_type, id: args.p_entity_id };
    if (name === "nf_change_entity_connections") {
      for (const value of args.p_targets ?? []) {
        if (args.p_connect) direct.add(edge(source, value));
        else direct.delete(edge(source, value));
      }
    } else expect(name).toBe("nf_get_entity_connections");
    return { data: connections(source), error: null };
  });
  const supabase = {
    rpc,
    from(table: string) {
      const trace = { table, filters: [] as [string, unknown][], ranges: [] as [number, number][] };
      queries.push(trace);
      let rows = catalog.filter((row) => table === "nf_connection_catalog" ||
        (row.type === "activity" ? "activities" : `${row.type}s`) === table);
      let range: [number, number] | undefined;
      const result = () => ({ data: range ? rows.slice(range[0], range[1] + 1) : rows,
        error: null, count: rows.length });
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          trace.filters.push([column, value]);
          rows = rows.filter((row) => row[column as keyof typeof row] === value);
          return builder;
        },
        neq(column: string, value: unknown) {
          trace.filters.push([`neq:${column}`, value]);
          rows = rows.filter((row) => row[column as keyof typeof row] !== value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          trace.filters.push([`in:${column}`, values]);
          rows = rows.filter((row) => values.includes(row[column as keyof typeof row]));
          return builder;
        },
        ilike(column: string, value: string) {
          trace.filters.push([`ilike:${column}`, value]);
          return builder;
        },
        order: () => builder,
        range(from: number, to: number) { range = [from, to]; trace.ranges.push(range); return builder; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
  };
  return { ctx: { supabase, userId: USER } as unknown as ToolContext, rpc, queries, direct, planning };
}

async function run(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const tool = connectionTools.find((row) => row.name === name)!;
  return tool.handler(z.object(tool.input).parse(args), ctx);
}

describe("cross-section connection tools", () => {
  it("checks ownership of every source and target before the batch RPC, deduplicating targets", async () => {
    const { ctx, rpc, queries } = context();
    const targets = [{ type: "book", id: BOOK }, { type: "activity", id: ACTIVITY }, { type: "book", id: BOOK }];
    await run("connect_entities", { entity_type: "program", entity_id: PROGRAM, targets }, ctx);
    expect(rpc).toHaveBeenCalledWith("nf_change_entity_connections", {
      p_entity_type: "program", p_entity_id: PROGRAM, p_user_id: USER,
      p_targets: targets.slice(0, 2), p_connect: true,
    });
    expect(queries.map((row) => row.table)).toEqual(["programs", "books", "activities"]);
    for (const query of queries) expect(query.filters).toContainEqual(["user_id", USER]);
  });

  it("blocks another user's source before reading connections", async () => {
    const { ctx, rpc } = context();
    await expect(run("list_entity_connections", { entity_type: "book", entity_id: PRIVATE_BOOK }, ctx))
      .rejects.toMatchObject({ code: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks a batch containing another user's target without making any write", async () => {
    const { ctx, rpc } = context();
    await expect(run("connect_entities", { entity_type: "program", entity_id: PROGRAM,
      targets: [{ type: "book", id: BOOK }, { type: "book", id: PRIVATE_BOOK }] }, ctx))
      .rejects.toMatchObject({ code: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects connections inside one section", async () => {
    const { ctx, rpc } = context();
    await expect(run("connect_entities", { entity_type: "book", entity_id: BOOK,
      targets: [{ type: "book", id: BOOK }] }, ctx)).rejects.toMatchObject({ code: "bad_request" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads connections in both directions and repeated connects remain one link", async () => {
    const { ctx, direct } = context();
    const args = { entity_type: "program", entity_id: PROGRAM, targets: [{ type: "book", id: BOOK }] };
    await run("connect_entities", args, ctx);
    await run("connect_entities", args, ctx);
    expect(direct.size).toBe(1);
    await expect(run("list_entity_connections", { entity_type: "book", entity_id: BOOK }, ctx))
      .resolves.toMatchObject({ connections: [{ type: "program", id: PROGRAM, direct: true, in_planning: false }] });
  });

  it("disconnects reversibly while reporting the planning reference that remains", async () => {
    const { ctx, planning, direct } = context();
    const args = { entity_type: "program", entity_id: PROGRAM, targets: [{ type: "book", id: BOOK }] };
    planning.add(edge({ type: "program", id: PROGRAM }, { type: "book", id: BOOK }));
    await run("connect_entities", args, ctx);
    await expect(run("disconnect_entities", args, ctx)).resolves.toMatchObject({
      connections: [{ type: "book", id: BOOK, direct: false, in_planning: true }],
    });
    expect(direct.size).toBe(0);
    expect(connectionTools.find((row) => row.name === "disconnect_entities")?.kind).toBe("write");
  });

  it("searches only the current user's catalogue with stable bounded pagination and type filters", async () => {
    const { ctx, queries } = context();
    await expect(run("search_connection_targets", { entity_type: "program", types: ["book", "activity"],
      offset: 1, max_results: 1 }, ctx)).resolves.toMatchObject({ total: 2, offset: 1, has_more: false,
        targets: [{ id: ACTIVITY }] });
    expect(queries[0].filters).toContainEqual(["user_id", USER]);
    expect(queries[0].filters).toContainEqual(["in:type", ["book", "activity"]]);
    expect(queries[0].ranges).toEqual([[1, 1]]);
  });

  it("treats wildcard characters in a search as literal text", async () => {
    const { ctx, queries } = context();
    await run("search_connection_targets", { query: "100%_", max_results: 25 }, ctx);
    expect(queries[0].filters).toContainEqual(["ilike:title", "%100\\%\\_%"]);
  });

  it("rejects oversized batches, invalid UUIDs and unbounded pages at input validation", async () => {
    const { ctx } = context();
    await expect(run("connect_entities", { entity_type: "book", entity_id: BOOK,
      targets: Array.from({ length: 101 }, () => ({ type: "program", id: PROGRAM })) }, ctx)).rejects.toThrow();
    await expect(run("list_entity_connections", { entity_type: "book", entity_id: "other" }, ctx)).rejects.toThrow();
    await expect(run("search_connection_targets", { max_results: 201 }, ctx)).rejects.toThrow();
  });

  it("enriches the existing book detail tool with live connected elements", async () => {
    const { ctx } = context();
    await run("connect_entities", { entity_type: "book", entity_id: BOOK,
      targets: [{ type: "exercise", id: EXERCISE }] }, ctx);
    const tool = ALL_TOOLS.find((row) => row.name === "get_book")!;
    await expect(tool.handler(z.object(tool.input).parse({ book_id: BOOK }), ctx)).resolves.toMatchObject({
      id: BOOK, connections: [{ type: "exercise", id: EXERCISE, title: "Simulation" }],
    });
  });
});
