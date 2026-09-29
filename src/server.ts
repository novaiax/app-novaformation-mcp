import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import type { McpTool } from "./tools/define.js";
import { bookTools } from "./tools/books.js";
import { exerciseTools } from "./tools/exercises.js";
import { overviewTools } from "./tools/overview.js";
import { programTools } from "./tools/programs.js";
import { settingsTools } from "./tools/settings.js";
import { activityTools, activitySessionTools, activityStatisticsTools, activitySkillTools } from "./tools/activities.js";
import { toolErrorResult, toolResult } from "./tools/result.js";

export const SERVER_NAME = "novaformation";
export const SERVER_VERSION = "1.1.1";

export const ALL_TOOLS: McpTool[] = [
  ...overviewTools,
  ...programTools,
  ...bookTools,
  ...exerciseTools,
  ...activityTools,
  ...activitySessionTools,
  ...activityStatisticsTools,
  ...activitySkillTools,
  ...settingsTools,
];

const INSTRUCTIONS = `Acces complet (lecture et ecriture) a NovaFormation, l'app de progression personnelle de l'utilisateur :
programmes de formation (semaines > modules > elements), exercices deliberes, activites reelles
(seances, recurrence, exceptions, competences et programmes lies), livres, objectifs, XP et statistiques.

Reperes :
- Commencer par get_overview ; search retrouve un element par son texte et renvoie les ids.
- Les ecritures suivent exactement les regles de l'app : XP accordee une seule fois (element coche, session, livre termine),
  retiree quand on annule ; objectifs d'exercice franchis enregistres une seule fois.
- Les scores d'exercice sont sur l'echelle de l'exercice (score_max : 5, 10, 20, 100...).
- Les activites sont independantes des programmes et exercices. Une seance annulee par l'organisateur
  ne penalise pas la presence ; les seances deja realisees et exceptions sont preservees lors d'un changement de serie.
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
