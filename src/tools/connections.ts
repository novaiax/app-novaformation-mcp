import { z } from "zod";
import type { ToolContext } from "../context.js";
import type { ConnectionEntityType, ConnectionRef } from "../domain/database.js";
import { defineTool, id, limit, throwIf } from "./define.js";
import { ownedActivity, ownedBook, ownedExercise, ownedProgram } from "./ownership.js";
import { badRequest } from "./result.js";

const ENTITY_TYPES = ["program", "book", "exercise", "activity"] as const;
const entityType = z.enum(ENTITY_TYPES).describe("program | book | exercise | activity");
const entityInput = { entity_type: entityType, entity_id: id("Source element") };
const target = z.object({ type: entityType, id: id("Target element") });
const targets = z.array(target).min(1).max(100)
  .describe("Elements from other sections to connect or disconnect (max 100)");

const ownership = {
  program: ownedProgram,
  book: ownedBook,
  exercise: ownedExercise,
  activity: ownedActivity,
} satisfies Record<ConnectionEntityType, (ctx: ToolContext, entityId: string) => Promise<unknown>>;

/** The service-role client bypasses RLS; resolve every source and target for this user. */
export async function getEntityConnections(ctx: ToolContext, type: ConnectionEntityType, entityId: string) {
  await ownership[type](ctx, entityId);
  const { data, error } = await ctx.supabase.rpc("nf_get_entity_connections", {
    p_entity_type: type, p_entity_id: entityId, p_user_id: ctx.userId,
  });
  throwIf(error);
  return data ?? [];
}

async function changeConnections(ctx: ToolContext, type: ConnectionEntityType, entityId: string,
  values: ConnectionRef[], connect: boolean) {
  await ownership[type](ctx, entityId);
  if (values.some((value) => value.type === type)) {
    badRequest("Connections must link elements from different sections");
  }
  const unique = [...new Map(values.map((value) => [`${value.type}:${value.id}`, value])).values()];
  await Promise.all(unique.map((value) => ownership[value.type](ctx, value.id)));
  const { data, error } = await ctx.supabase.rpc("nf_change_entity_connections", {
    p_entity_type: type, p_entity_id: entityId, p_targets: unique,
    p_connect: connect, p_user_id: ctx.userId,
  });
  throwIf(error);
  return { entity_type: type, entity_id: entityId, connections: data ?? [] };
}

export const connectionTools = [
  defineTool({
    name: "list_entity_connections", title: "List connected elements", kind: "read",
    description: "Liste les liens bidirectionnels d’un programme, livre, exercice ou activité avec les autres sections. " +
      "direct indique un lien explicite ; in_planning indique un livre ou exercice déjà présent dans le planning d’un programme.",
    input: entityInput,
    handler: async ({ entity_type, entity_id }, ctx) => ({
      entity_type, entity_id, connections: await getEntityConnections(ctx, entity_type, entity_id),
    }),
  }),
  defineTool({
    name: "connect_entities", title: "Connect elements", kind: "write",
    description: "Connecte en lot des éléments de sections différentes (programmes, livres, exercices, activités). " +
      "Les liens sont bidirectionnels et idempotents : connecter deux fois ne crée aucun doublon. Aucun élément n’est copié.",
    input: { ...entityInput, targets },
    handler: async ({ entity_type, entity_id, targets: values }, ctx) =>
      changeConnections(ctx, entity_type, entity_id, values, true),
  }),
  defineTool({
    name: "disconnect_entities", title: "Disconnect elements", kind: "write",
    description: "Retire en lot les connexions explicites entre sections, sans supprimer les éléments. " +
      "Opération réversible et idempotente. Les livres ou exercices inscrits au planning restent visibles avec in_planning=true.",
    input: { ...entityInput, targets },
    handler: async ({ entity_type, entity_id, targets: values }, ctx) =>
      changeConnections(ctx, entity_type, entity_id, values, false),
  }),
  defineTool({
    name: "search_connection_targets", title: "Search elements to connect", kind: "read",
    description: "Recherche par nom les programmes, livres, exercices et activités du compte. " +
      "types filtre les sections ; entity_type exclut la section de l’élément source. Pagination avec offset/max_results.",
    input: {
      query: z.string().trim().max(200).default(""),
      types: z.array(entityType).min(1).max(4).optional(),
      entity_type: entityType.optional().describe("Source section, excluded from search results"),
      offset: z.number().int().min(0).max(1_000_000).default(0),
      max_results: limit(50, 200),
    },
    handler: async ({ query, types, entity_type, offset, max_results }, ctx) => {
      let request = ctx.supabase.from("nf_connection_catalog")
        .select("type,id,title,subtitle,icon,color,status", { count: "exact" })
        .eq("user_id", ctx.userId);
      if (types) request = request.in("type", [...new Set(types)]);
      if (entity_type) request = request.neq("type", entity_type);
      // ilike is a structured filter, not raw PostgREST expression text.
      if (query) request = request.ilike("title", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
      const { data, error, count } = await request.order("type").order("title").order("id")
        .range(offset, offset + max_results - 1);
      throwIf(error);
      return { total: count ?? 0, offset, max_results,
        has_more: offset + (data?.length ?? 0) < (count ?? 0), targets: data ?? [] };
    },
  }),
];
