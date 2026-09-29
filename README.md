# NovaFormation — serveur MCP

Serveur MCP distant de **NovaFormation** (programmes de formation, exercices,
activités réelles, livres, objectifs, XP). Il donne à un client MCP un accès complet en **lecture et écriture**
aux données de l'application, avec les mêmes règles que l'interface.

- Lit et écrit directement la base Supabase de l'application (clé `service_role`),
  chaque requête étant limitée au compte NovaFormation.
- Les règles métier de l'app sont reprises à l'identique (`src/domain`, `src/services`) :
  XP accordée une seule fois et retirée à l'annulation, progression des programmes,
  objectifs d'exercice franchis enregistrés une seule fois.
- Toute suppression est définitive et exige `confirm: true`. Pour ranger sans rien perdre :
  `update_program` avec `status: "archived"`, `update_exercise` avec `archived: true`.
- Les sections Today et Habits, masquées dans l'app, ne sont pas exposées.

## Outils

| Domaine | Outils |
|---|---|
| Vue d'ensemble | `get_overview`, `get_statistics`, `list_xp_events`, `search` |
| Programmes | `list_programs`, `get_program`, `create_program` (structure complète en un appel), `update_program`, `delete_program`, `add_weeks`, `update_week`, `delete_week`, `add_modules`, `update_module`, `delete_module`, `add_module_items`, `update_module_item`, `set_module_items_completed`, `reorder_module_items`, `delete_module_items` |
| Livres | `list_books`, `get_book`, `create_book`, `update_book`, `update_book_progress`, `delete_book` |
| Exercices | `list_exercises`, `get_exercise`, `create_exercise`, `update_exercise`, `list_exercise_sessions`, `log_exercise_session`, `update_exercise_session`, `delete_exercise_session` |
| Activités | `list_activities`, `get_activity`, `search_activities`, `create_activity`, `update_activity`, `archive_activity`, `duplicate_activity`, `reorder_activities`, `delete_activity`, `set_activity_recurrence`, `set_one_off_event_days`, `set_activity_links`, `restore_activity_occurrence` |
| Séances d’activité | `list_activity_sessions`, `add_activity_session`, `update_activity_session`, `update_activity_session_schedule`, `set_activity_session_status`, `set_activity_sessions_status`, `move_activity_sessions`, `duplicate_activity_sessions`, `delete_activity_sessions`, `reorder_activity_sessions`, `set_activity_session_skills` |
| Compétences et fichiers | `list_activity_skills`, `create_activity_skill`, `update_activity_skill`, `duplicate_activity_skill`, `reorder_activity_skills`, `delete_activity_skill`, `read_activity_attachment`, `upload_activity_attachment`, `remove_activity_attachment` |
| Statistiques d’activité | `get_activity_statistics` (filtres par activité, catégorie, compétence, programme et période) |
| Objectifs | `add_exercise_objectives`, `set_exercise_objectives`, `update_exercise_objective`, `delete_exercise_objective`, `list_milestones` |
| Réglages | `get_settings`, `update_settings`, `update_profile`, `list_categories`, `create_category`, `update_category`, `merge_categories`, `delete_category` |

Un échec renvoie un résultat `isError` contenant
`{"error": {"code": "not_found", "message": "..."}}` — codes : `bad_request`,
`not_found`, `conflict`, `unavailable`, `server_error`.

## Points d'entrée

| Chemin | Rôle |
|---|---|
| `GET /sse` + `POST /messages` | transport SSE (connecteurs claude.ai) |
| `POST /mcp` | transport Streamable HTTP, sans état |
| `GET /health` | état du serveur (public) |

### Authentification

Avec `MCP_AUTH_TOKEN`, le client fournit le jeton par l'en-tête
`Authorization: Bearer <jeton>` ou, s'il n'accepte qu'une URL, dans l'adresse :
`https://mcp.exemple.fr/sse?token=<jeton>` ou `https://mcp.exemple.fr/mcp?token=<jeton>`.
`/health` reste public ; `/.well-known/*` répond 404 (pas de fournisseur OAuth).

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `SUPABASE_URL` | — (obligatoire) | URL du projet Supabase de NovaFormation |
| `SUPABASE_SERVICE_ROLE_KEY` | — (obligatoire) | Clé `service_role` (Project Settings › API) |
| `NOVAFORMATION_USER_ID` | vide | Compte ciblé ; vide = l'unique compte de l'app |
| `MCP_AUTH_TOKEN` | vide | Jeton exigé ; vide = serveur ouvert |
| `MCP_HOST` / `MCP_PORT` | `0.0.0.0` / `8080` | Écoute |
| `MCP_PUBLIC_URL` | vide | Adresse publique (affichée au démarrage) |

La base doit avoir les migrations de l'application appliquées, dont
`0004_exercise_goals.sql` pour les objectifs et milestones (sans elle, les outils
d'objectifs répondent `unavailable` et le reste fonctionne). La migration
`0007_reconcile_exercise_goals.sql` répare les jalons historiques manquants et
enregistre les nouveaux franchissements directement en base. Le MCP les lit
après la création d'une session et calcule les périodes selon Europe/Paris.
`0008_activities.sql` crée les entités dédiées aux activités, séances,
récurrences versionnées, compétences, liens et fichiers privés. Les fonctions SQL
recalculent les occurrences futures sans modifier les séances déjà réalisées ni
les exceptions déplacées par l’utilisateur. Une suppression ponctuelle d’une
occurrence est mémorisée pour qu’elle ne réapparaisse pas lors du recalcul.
Le taux de présence exclut les annulations par l’organisateur et les reports.
Les pièces jointes MCP sont échangées en base64, sans URL avec jeton.
Les compétences travaillées sont figées sur chaque séance réalisée pour
conserver des statistiques historiques cohérentes si les liens de l’activité changent.
La migration `0009_activity_history.sql` génère aussi les occurrences passées
depuis la date de début d’une activité récurrente. Elles peuvent ensuite être
marquées réalisées par le MCP, y compris en lot.
La migration `0010_one_off_events.sql` ajoute les événements ponctuels multi-jours :
`set_one_off_event_days` règle séparément chaque date en journée entière,
plage horaire ou durée. Les journées entières occupent le calendrier sans
être comptées comme 24 heures de pratique.
La migration `0011_exercise_session_cleanup.sql` supprime les XP liés à une
séance d’exercice dans la même transaction que sa suppression. Le jalon déjà
atteint reste historique et la progression courante est recalculée.

## Développement

```bash
npm install
cp .env.example .env    # puis renseigner les variables
npm run build && node --env-file=.env dist/index.js
npm test                # logique métier + protocole MCP (SSE et Streamable HTTP)
```

## Déploiement (Docker / Coolify)

```bash
docker build -t novaformation-mcp .
docker run -p 8080:8080 --env-file .env novaformation-mcp
```

Coolify : ressource depuis ce dépôt, build pack **Dockerfile**, port exposé `8080`,
variables ci-dessus. Le healthcheck de l'image interroge `/health`.
