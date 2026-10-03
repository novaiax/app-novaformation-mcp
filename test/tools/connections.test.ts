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
const ITEM = "88888888-8888-4888-8888-888888888888";
const ITEM_TWO = "99999999-9999-4999-8999-999999999999";
const PRIVATE_ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRIVATE_PROGRAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WEEK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MODULE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PRIVATE_WEEK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRIVATE_MODULE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const key = (value: ConnectionRef) => `${value.type}:${value.id}`;
const edge = (source: ConnectionRef, target: ConnectionRef) => [key(source), key(target)].sort().join("|");

function context() {
  const catalog = [
    { type: "program", id: PROGRAM, user_id: USER, title: "Éloquence" },
    { type: "book", id: BOOK, user_id: USER, title: "Rhétorique" },
    { type: "exercise", id: EXERCISE, user_id: USER, title: "Simulation" },
    { type: "activity", id: ACTIVITY, user_id: USER, title: "Impro" },
    { type: "book", id: PRIVATE_BOOK, user_id: OTHER, title: "Livre privé" },
    { type: "program", id: PRIVATE_PROGRAM, user_id: OTHER, title: "Programme privé" },
    { type: "item", id: ITEM, user_id: USER, title: "Lire Rhétorique" },
    { type: "item", id: ITEM_TWO, user_id: USER, title: "Préparer une présentation" },
    { type: "item", id: PRIVATE_ITEM, user_id: OTHER, title: "Élément privé" },
  ].map((row) => ({ ...row,
    subtitle: row.type === "item" ? "Éloquence · Semaine 2 · Lecture" : "",
    icon: "BookOpen", color: "#3366ff", status: "active",
    program_id: row.type === "item" ? row.user_id === USER ? PROGRAM : PRIVATE_PROGRAM : null,
    week_id: row.type === "item" ? row.user_id === USER ? WEEK : PRIVATE_WEEK : null,
    week_number: row.type === "item" ? 2 : null,
    module_id: row.type === "item" ? row.user_id === USER ? MODULE : PRIVATE_MODULE : null,
  }));
  const programItems = catalog.filter((row) => row.type === "item").map((row) => ({
    id: row.id, module_id: row.module_id, title: row.title, type: "custom_task", description: "Lecture planifiée",
    xp_value: 10, is_completed: false, completed_at: null, sort_order: row.id === ITEM ? 0 : 1,
  }));
  const modules = [{ id: MODULE, week_id: WEEK, title: "Lecture", sort_order: 0,
    module_items: programItems.filter((row) => row.module_id === MODULE) },
    { id: PRIVATE_MODULE, week_id: PRIVATE_WEEK, title: "Privé", sort_order: 0,
      module_items: programItems.filter((row) => row.module_id === PRIVATE_MODULE) }];
  const weeks = [{ id: WEEK, program_id: PROGRAM, title: "Présentation", week_number: 2, sort_order: 0,
    program_modules: modules.filter((row) => row.week_id === WEEK) },
    { id: PRIVATE_WEEK, program_id: PRIVATE_PROGRAM, title: "Privé", week_number: 2, sort_order: 0,
      program_modules: modules.filter((row) => row.week_id === PRIVATE_WEEK) }];
  const programs = catalog.filter((row) => row.type === "program").map((row) => ({ ...row,
    duration_weeks: 2, description: "Programme test", created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z",
    program_weeks: weeks.filter((week) => week.program_id === row.id),
  }));
  const queries: { table: string; filters: [string, unknown][]; ranges: [number, number][] }[] = [];
  const direct = new Set<string>();
  const planning = new Set<string>();
  const connections = (source: ConnectionRef): ConnectionTarget[] => catalog
    .filter((row) => row.user_id === USER && key(row as ConnectionRef) !== key(source) &&
      (row.type !== source.type || source.type === "item"))
    .flatMap((row) => {
      const connection = edge(source, row as ConnectionRef);
      return direct.has(connection) || planning.has(connection)
        ? [{ ...row, direct: direct.has(connection), in_planning: planning.has(connection) } as ConnectionTarget]
        : [];
    });
  const rpc = vi.fn(async (name: string, args: {
    p_entity_type: ConnectionRef["type"]; p_entity_id: string; p_user_id: string;
    p_targets?: ConnectionRef[]; p_connect?: boolean; p_program_id?: string;
  }) => {
    expect(args.p_user_id).toBe(USER);
    if (name === "nf_get_program_item_connections") return {
      data: Object.fromEntries(catalog.filter((row) => row.type === "item" && row.program_id === args.p_program_id)
        .map((row) => [row.id, connections(row as ConnectionRef)])), error: null,
    };
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
      let rows: Record<string, unknown>[] = table === "programs" ? programs : table === "program_weeks" ? weeks :
        table === "program_modules" ? modules : table === "module_items" ? programItems :
          catalog.filter((row) => table === "nf_connection_catalog" ||
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
        or(expression: string) {
          trace.filters.push(["or", expression]);
          const sourceId = expression.slice("type.neq.item,id.neq.".length);
          rows = rows.filter((row) => row.type !== "item" || row.id !== sourceId);
          return builder;
        },
        order: () => builder,
        range(from: number, to: number) { range = [from, to]; trace.ranges.push(range); return builder; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: null }),
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
  it("connects a planning item to every section and another item in both directions", async () => {
    const { ctx, queries, direct } = context();
    const targets = [{ type: "book", id: BOOK }, { type: "activity", id: ACTIVITY },
      { type: "exercise", id: EXERCISE }, { type: "program", id: PROGRAM }, { type: "item", id: ITEM_TWO }];
    await run("connect_entities", { entity_type: "item", entity_id: ITEM, targets }, ctx);
    expect(direct.size).toBe(5);
    expect(queries.slice(0, 4).map((query) => query.table))
      .toEqual(["module_items", "program_modules", "program_weeks", "programs"]);
    expect(queries[3].filters).toContainEqual(["user_id", USER]);
    for (const target of targets) {
      await expect(run("list_entity_connections", { entity_type: target.type, entity_id: target.id }, ctx))
        .resolves.toMatchObject({ connections: expect.arrayContaining([expect.objectContaining({
          type: "item", id: ITEM, program_id: PROGRAM, week_id: WEEK, week_number: 2, module_id: MODULE,
        })]) });
    }
  });

  it("rejects a planning item connecting to itself", async () => {
    const { ctx, rpc } = context();
    await expect(run("connect_entities", { entity_type: "item", entity_id: ITEM,
      targets: [{ type: "item", id: ITEM }] }, ctx)).rejects.toMatchObject({ code: "bad_request" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks foreign planning sources and targets through their owning program", async () => {
    const { ctx, rpc } = context();
    await expect(run("list_entity_connections", { entity_type: "item", entity_id: PRIVATE_ITEM }, ctx))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(run("connect_entities", { entity_type: "book", entity_id: BOOK,
      targets: [{ type: "item", id: PRIVATE_ITEM }] }, ctx)).rejects.toMatchObject({ code: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("searches other planning items with their context, excludes the source, and paginates", async () => {
    const { ctx, queries } = context();
    await expect(run("search_connection_targets", { entity_type: "item", entity_id: ITEM,
      types: ["item"], offset: 0, max_results: 1 }, ctx)).resolves.toMatchObject({
      total: 1, has_more: false, targets: [{ id: ITEM_TWO, program_id: PROGRAM, week_id: WEEK,
        week_number: 2, module_id: MODULE, subtitle: "Éloquence · Semaine 2 · Lecture" }],
    });
    expect(queries.at(-1)?.filters).toContainEqual(["or", `type.neq.item,id.neq.${ITEM}`]);
    expect(queries.at(-1)?.filters).toContainEqual(["user_id", USER]);
  });

  it("validates optional search source ownership and requires its type", async () => {
    const { ctx, queries } = context();
    await expect(run("search_connection_targets", { entity_type: "item", entity_id: PRIVATE_ITEM }, ctx))
      .rejects.toMatchObject({ code: "not_found" });
    expect(queries.some((query) => query.table === "nf_connection_catalog")).toBe(false);
    await expect(run("search_connection_targets", { entity_id: ITEM }, ctx))
      .rejects.toMatchObject({ code: "bad_request" });
  });

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

  it("preserves get_program's weeks/modules/items shape and adds item connections in one batch", async () => {
    const { ctx, rpc } = context();
    await run("connect_entities", { entity_type: "item", entity_id: ITEM,
      targets: [{ type: "book", id: BOOK }] }, ctx);
    rpc.mockClear();
    const tool = ALL_TOOLS.find((row) => row.name === "get_program")!;
    await expect(tool.handler(z.object(tool.input).parse({ program_id: PROGRAM }), ctx)).resolves.toMatchObject({
      id: PROGRAM, title: "Éloquence", progress: { total: 2, completed: 0, percent: 0 }, connections: [],
      weeks: [{ id: WEEK, week_number: 2, modules: [{ id: MODULE, title: "Lecture", items: [
        { id: ITEM, title: "Lire Rhétorique", description: "Lecture planifiée", type: "custom_task",
          is_completed: false, connections: [{ type: "book", id: BOOK }] },
        { id: ITEM_TWO, title: "Préparer une présentation", connections: [] },
      ] }] }],
    });
    expect(rpc.mock.calls.map(([name]) => name))
      .toEqual(["nf_get_entity_connections", "nf_get_program_item_connections"]);
    expect(rpc).toHaveBeenCalledWith("nf_get_program_item_connections", { p_program_id: PROGRAM, p_user_id: USER });
  });
});
