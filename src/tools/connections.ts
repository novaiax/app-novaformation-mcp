import { z } from "zod";
import type { ToolContext } from "../context.js";
import type { ConnectionEntityType, ConnectionRef } from "../domain/database.js";
import { defineTool, id, limit, throwIf } from "./define.js";
import { ownedActivity, ownedBook, ownedExercise, ownedModuleItem, ownedProgram } from "./ownership.js";
import { badRequest } from "./result.js";

const ENTITY_TYPES = ["program", "book", "exercise", "activity", "item"] as const;
const entityType = z.enum(ENTITY_TYPES).describe("program | book | exercise | activity | item (a module_items element in a program week)");
const entityInput = { entity_type: entityType, entity_id: id("Source element") };
const target = z.object({ type: entityType, id: id("Target element") });
const targets = z.array(target).min(1).max(100)
  .describe("Elements to connect or disconnect (max 100). Planning items may also link to distinct planning items.");

const ownership = {
  program: ownedProgram,
  book: ownedBook,
  exercise: ownedExercise,
  activity: ownedActivity,
  item: ownedModuleItem,
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

/** Resolve all item links in one query, preserving the existing nested program response. */
export async function getProgramItemConnections(ctx: ToolContext, programId: string) {
  await ownedProgram(ctx, programId);
  const { data, error } = await ctx.supabase.rpc("nf_get_program_item_connections", {
    p_program_id: programId, p_user_id: ctx.userId,
  });
  throwIf(error);
  return data ?? {};
}

async function changeConnections(ctx: ToolContext, type: ConnectionEntityType, entityId: string,
  values: ConnectionRef[], connect: boolean) {
  await ownership[type](ctx, entityId);
  if (values.some((value) => value.type === type && (type !== "item" || value.id === entityId))) {
    badRequest("Connections must link different sections or distinct planning items; an element cannot link to itself");
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
    description: "Liste les liens bidirectionnels d’un programme, livre, exercice, activité ou élément de semaine (item). " +
      "direct indique un lien explicite ; in_planning indique un livre ou exercice déjà présent dans le planning d’un programme.",
    input: entityInput,
    handler: async ({ entity_type, entity_id }, ctx) => ({
      entity_type, entity_id, connections: await getEntityConnections(ctx, entity_type, entity_id),
    }),
  }),
  defineTool({
    name: "connect_entities", title: "Connect elements", kind: "write",
    description: "Connecte en lot des programmes, livres, exercices, activités et éléments de semaines (item). " +
      "Un item peut aussi être relié à un autre item distinct, avec son contexte programme/semaine/module. " +
      "Les liens sont bidirectionnels et idempotents : connecter deux fois ne crée aucun doublon. Aucun élément n’est copié.",
    input: { ...entityInput, targets },
    handler: async ({ entity_type, entity_id, targets: values }, ctx) =>
      changeConnections(ctx, entity_type, entity_id, values, true),
  }),
  defineTool({
    name: "disconnect_entities", title: "Disconnect elements", kind: "write",
    description: "Retire en lot les connexions explicites entre sections, sans supprimer les éléments. " +
      "Opération réversible et idempotente. Les livres ou exercices agrégés depuis le planning d’un programme restent visibles " +
      "avec in_planning=true. Déconnecter un item de son livre/exercice retire aussi sa référence historique, sans supprimer l’item.",
    input: { ...entityInput, targets },
    handler: async ({ entity_type, entity_id, targets: values }, ctx) =>
      changeConnections(ctx, entity_type, entity_id, values, false),
  }),
  defineTool({
    name: "search_connection_targets", title: "Search elements to connect", kind: "read",
    description: "Recherche par nom les programmes, livres, exercices, activités et éléments de semaines du compte. " +
      "types filtre les sections ; entity_type exclut la section source sauf pour item (autres items autorisés). " +
      "entity_id vérifie la propriété de la source et exclut cet item précis. Pagination avec offset/max_results.",
    input: {
      query: z.string().trim().max(200).default(""),
      types: z.array(entityType).min(1).max(5).optional(),
      entity_type: entityType.optional().describe("Source section; other planning items remain available for an item source"),
      entity_id: id("Optional source element; requires entity_type").optional(),
      offset: z.number().int().min(0).max(1_000_000).default(0),
      max_results: limit(50, 200),
    },
    handler: async ({ query, types, entity_type, entity_id, offset, max_results }, ctx) => {
      if (entity_id && !entity_type) badRequest("entity_id requires entity_type");
      if (entity_id && entity_type) await ownership[entity_type](ctx, entity_id);
      let request = ctx.supabase.from("nf_connection_catalog")
        .select("type,id,title,subtitle,icon,color,status,program_id,week_id,week_number,module_id", { count: "exact" })
        .eq("user_id", ctx.userId);
      if (types) request = request.in("type", [...new Set(types)]);
      if (entity_type && entity_type !== "item") request = request.neq("type", entity_type);
      if (entity_type === "item" && entity_id) request = request.or(`type.neq.item,id.neq.${entity_id}`);
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
