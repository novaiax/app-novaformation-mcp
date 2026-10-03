import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import type { McpTool } from "./tools/define.js";
import { bookTools } from "./tools/books.js";
import { exerciseTools } from "./tools/exercises.js";
import { overviewTools } from "./tools/overview.js";
import { programTools } from "./tools/programs.js";
import { settingsTools } from "./tools/settings.js";
import { activityTools, activitySessionTools, activityStatisticsTools, activitySkillTools } from "./tools/activities.js";
import { connectionTools, getEntityConnections, getProgramItemConnections } from "./tools/connections.js";
import type { ConnectionEntityType } from "./domain/database.js";
import { toolErrorResult, toolResult } from "./tools/result.js";

export const SERVER_NAME = "novaformation";
export const SERVER_VERSION = "1.3.1";

const connectionDetails: Record<string, { type: ConnectionEntityType; idKey: string }> = {
  get_program: { type: "program", idKey: "program_id" },
  get_book: { type: "book", idKey: "book_id" },
  get_exercise: { type: "exercise", idKey: "exercise_id" },
  get_activity: { type: "activity", idKey: "activity_id" },
};

function withConnections(tool: McpTool): McpTool {
  const source = connectionDetails[tool.name];
  if (!source) return tool;
  return {
    ...tool,
    description: `${tool.description} Inclut connections, les éléments liés des autres sections.${source.type === "program" ? " Chaque weeks[].modules[].items[] inclut aussi ses propres connections." : ""}`,
    handler: async (args, ctx) => {
      const detail = await tool.handler(args, ctx);
      const connections = await getEntityConnections(ctx, source.type, args[source.idKey] as string);
      const record = detail as Record<string, unknown>;
      if (source.type !== "program") return { ...record, connections };
      const itemConnections = await getProgramItemConnections(ctx, args[source.idKey] as string);
      type ModuleDetail = Record<string, unknown> & { items: (Record<string, unknown> & { id: string })[] };
      type WeekDetail = Record<string, unknown> & { modules: ModuleDetail[] };
      return { ...record, connections,
        weeks: (record.weeks as WeekDetail[]).map((week) => ({ ...week,
          modules: week.modules.map((module) => ({ ...module,
            items: module.items.map((item) => ({ ...item, connections: itemConnections[item.id] ?? [] })),
          })),
        })),
      };
    },
  };
}

export const ALL_TOOLS: McpTool[] = [
  ...overviewTools,
  ...programTools,
  ...bookTools,
  ...exerciseTools,
  ...activityTools,
  ...activitySessionTools,
  ...activityStatisticsTools,
  ...activitySkillTools,
  ...connectionTools,
  ...settingsTools,
].map(withConnections);

const INSTRUCTIONS = `Acces complet (lecture et ecriture) a NovaFormation, l'app de progression personnelle de l'utilisateur :
programmes de formation (semaines > modules > elements), exercices deliberes, activites reelles
(seances, recurrence, exceptions, competences et programmes lies), livres, objectifs, XP et statistiques.
Les programmes, livres, exercices, activites et elements des semaines (entity_type=item) peuvent etre connectes sans duplication.

Reperes :
- Commencer par get_overview ; search retrouve un element par son texte et renvoie les ids.
- search_connection_targets trouve les elements a relier ; connect_entities et disconnect_entities gerent
  des liens bidirectionnels en lot. list_entity_connections et les get_* les affichent avec direct/in_planning.
  get_program inclut aussi connections sur chaque weeks[].modules[].items[]. Les cibles item ont leur contexte
  program_id, week_id, week_number, module_id ; deux items distincts peuvent etre connectes entre eux.
  Deconnecter est reversible et ne supprime aucun element. Un lien agrege programme/ressource inscrit au planning
  reste visible ; deconnecter directement un item de sa ressource retire sa reference sans supprimer l'item.
- Les ecritures suivent exactement les regles de l'app : XP accordee une seule fois (element coche, session, livre termine),
  retiree quand on annule ; objectifs d'exercice franchis enregistres une seule fois.
- Les scores d'exercice sont sur l'echelle de l'exercice (score_max : 5, 10, 20, 100...).
- Les activites sont independantes des programmes et exercices. Une seance annulee par l'organisateur
  ne penalise pas la presence ; les seances deja realisees et exceptions sont preservees lors d'un changement de serie.
- Les evenements ponctuels ont des journees propres (journee entiere, plage horaire OU duree).
  Une journee entiere occupe le calendrier sans etre comptee comme 24 heures de pratique.
- Toute suppression est definitive et exige confirm=true : ne supprimer que sur demande explicite. Pour ranger sans perdre,
  archiver (update_program status=archived, update_exercise archived=true).
- Les sections Today et Habits sont masquees dans l'app : elles ne sont pas exposees ici.
- Dates au format YYYY-MM-DD, horodatages en ISO 8601.
- En cas d'echec, le resultat est {"error": {"code", "message"}}.`;

export function createMcpServer(getContext: () => Promise<ToolContext>): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.kind === "read",
          destructiveHint: tool.kind === "delete",
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const ctx = await getContext();
          return toolResult(await tool.handler(args as never, ctx));
        } catch (error) {
          return toolErrorResult(error);
        }
      },
    );
  }

  return server;
}
