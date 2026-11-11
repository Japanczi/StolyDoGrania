# Planszówkarz – project instructions

> Node.js app since 2026-11-11 (the rewrite's phase 5). The previous ASP.NET Core / Blazor app is preserved on the
> `dotnet` branch; C# files mentioned in the learning notes live there.

## Repository and deployment
- `master` is the Node app (`node-app/`), live at https://planszowkarz.toadres.pl. Don't edit the `dotnet` branch.
- Deploy with `.\deploy.ps1` (Mikrus, service `planszowkarz-node`). Cutover and switching back to .NET:
  `deploy/CUTOVER.md`. Ask before deploying or touching the server.
- The spec is `Claude_Resources/Resources.txt` (tracked): features, wording, rules, and the Node app's decisions.
  When a decision is made in conversation, write it back there in the same work.
- The rest of `Claude_Resources/` is git-ignored (except `Tools/`) and mostly not in worktrees: read the design log,
  rewrite brief and feedback from the main checkout by absolute path
  (`C:\Users\xerov\source\repos\StolyDoGrania\Claude_Resources\`).

## Goal: learning
- The rewrite exists so the user can learn Node and compare it with .NET. Explaining is part of every task.
- Every phase updates the learning notes in `docs/learning/` (index: `docs/learning/README.md`) and adds a
  `docs/learning/journal.md` entry. Notes follow the brief's section 11: what and why first, examples from our
  code side by side with the C# from this repo, differences from .NET, whether it could be used with .NET,
  pitfalls we hit, official doc links.
- When introducing something new, explain it briefly in the reply and point to the note.
- Between otherwise equal options, prefer the one that shows how things work over "magic".

## Stack
- Node.js (current LTS, pinned in `node-app/package.json` `engines` and `.nvmrc`), TypeScript run directly by
  Node (type stripping); `npm run check` (`tsc`, noEmit) type-checks server code and `public/js`. Only erasable TS syntax: no `enum`,
  `namespace` or constructor parameter properties – use union types and plain fields.
- Fastify (HTTP), server-rendered HTML with our `html` tagged template (`src/web/html.ts`), Bootstrap 5,
  plain browser JS in `public/js/` (`// @ts-check` + JSDoc types, no bundler, no front-end framework, no htmx).
- No full page reloads for in-page actions (decided 2026-11-11: "I do not want to see this flashing"). Use
  JavaScript freely for this: actions go through `fetch()`, and the page is updated in place with the morph helper
  (`public/js/morph.js`) – never by replacing big chunks with `innerHTML`/`outerHTML` or by reloading. Server-rendered
  pages with links/forms opt in with `sendPage(…, { enhance: true })` (`public/js/enhance.js`); the plain link/form
  behaviour stays as the no-JavaScript fallback. Moving to *another* page may still load normally. Prove it with a
  Playwright test (see `test/e2e/no-flash.spec.ts`: a `window` marker survives, unchanged elements stay the same nodes).
- SQLite via better-sqlite3 + Kysely. WebSocket via `@fastify/websocket`. Tests: `node:test`, Playwright for a
  few end-to-end tests.

## Language conventions
- User-facing strings (labels, errors, status messages, e-mails): Polish.
- Code comments and doc comments (JSDoc/TSDoc): English.
- Identifiers: English. Files and folders: kebab-case (`play-table.ts`). Types/classes PascalCase,
  functions/variables camelCase, DB tables and columns snake_case.
- Migration file names: English, numbered (`0002-add-user-action-logs.ts`).
- Learning notes and the journal: English.
- Reply to me in English unless I write in Polish.

## Project layout
- `node-app/src/domain/`   – business rules, pure TS, no imports from db/web/Fastify.
- `node-app/src/db/`       – database setup, schema types, `migrations/`, `queries/`.
- `node-app/src/auth/`     – sessions, password hashing (Identity v3 verify + scrypt), CSRF, login flow.
- `node-app/src/web/`      – `html` tag, layout, components, `pages/<area>/{routes,view}.ts`.
- `node-app/src/live/`     – WebSocket hub. `src/jobs/` – timers. `src/integrations/` – BGG, e-mail.
- `node-app/src/import/`   – TEMPORARY Google sheet import; keep isolated, nothing else may depend on it.
- `node-app/src/dev/`      – Development-only tools (page designer, test users); guarded on the server.
- `node-app/public/`       – static files (`app.css`, `js/`, `lib/bootstrap/`, `tools/designer.js`).
- `node-app/test/`         – mirrors `src/`; `test/e2e/` for Playwright.
- `node-app/scripts/`      – one-off scripts, e.g. `import-dotnet-db.ts` (app.db → new schema).
- `docs/learning/`         – learning notes + journal. `docs/rewrite/` – proposals and decisions for the rewrite.

## Domain model
- Business rules live in `src/domain/play-table.ts` (tryCreate / tryTakeSlot / tryAddPlayer / tryAssignOwner /
  tryChangeGame / trySetTakenSlots / isSlotTaken / applyImport) and the other `domain/` modules, ported from
  `Data/Table/*.cs`, `Data/AppRoles.cs`, `Data/Valid*Attribute.cs` (on the `dotnet` branch). Prefer extending these over duplicating logic
  in routes, views or browser JS.
- Rule functions return `{ ok: true, ... } | { ok: false, error: string }` (Polish error) instead of throwing,
  mirroring the C# `TryX(out error)` pattern.

## Code conventions
- `strict` TypeScript; no `any`, no non-null `!` unless justified in a comment. Model "missing" as `null` in our
  own types (DB nulls); treat `undefined` only at edges (optional params, missing form fields).
- ES modules; relative imports include the `.ts` extension.
- Data access: routes call `db/queries/*`; never build SQL from strings – use Kysely or `sql` templates with
  parameters. Every write that must be atomic runs in one transaction (e.g. a seat + its action-log entry).
- Wrap writes in try/catch, map constraint errors (SQLite `SQLITE_CONSTRAINT…`) to a Polish error message.
- HTML: every value goes through the `html` tag (escaped). `raw()` only on the output of another `html` call.
- No secrets in code or committed files; config only via environment (`.env` locally, git-ignored;
  `.env.example` committed). `src/config.ts` validates all settings at startup.

## Security / authorization rules
- Only logged-in users may add/remove table participants.
- A user may only remove slots where the slot's user id == their own id, or any slot at a table they own
  (play_tables.owner_user_id == their own id). Admins may remove any slot. Enforce on the server side
  (in the query, `domain/table-slot.ts` `removableBy`), not just by hiding buttons – for HTTP and WebSocket alike.
- Every action re-checks rights against the database; never trust ids, roles or flags sent by the browser.
- Roles: Owner (main admin, always also Admin), Admin, User. Only the Owner may revoke another admin's role or
  delete an admin's account; nobody can change or delete the Owner. Check on the server.
- Never display a full e-mail address publicly (displayName = part before '@').
- Validate uploaded covers on the server when received: allowed MIME types (PNG/JPEG/WebP/GIF, checked by the
  file's magic bytes too), max 2 MB enforced while streaming.
- Sessions: random ids, only their hash stored; cookies `HttpOnly`, `SameSite=Lax`, `Secure` in production.
  Invalidate a user's sessions on password change.
- CSRF: every non-GET request needs the session's CSRF token and a same-origin `Origin`/`Sec-Fetch-Site`;
  the WebSocket upgrade checks `Origin` too.
- WebSocket messages carry no user-specific or admin-only data; pages fetch fragments over HTTP with their own rights.
- Development-only tools are guarded by checking the environment on the server, not by hiding UI.

## Workflow
- Schema changes: add a new numbered migration in `src/db/migrations/` (never edit one that has run on any
  database), list it in `src/db/migrations/index.ts`, update `src/db/schema.ts` and the `expectedColumns` list in
  `test/db/migrations.test.ts`, run `npm run migrate`. Mention every migration explicitly.
- Run commands from `node-app/`. Node lives in `C:\Program Files\nodejs` (installed 2026-11-10); a shell started
  before that may need it added to PATH.
- "Let me test": start the dev server yourself (`npm run dev` in `node-app/`, in the background; it migrates, then
  runs with `--watch`), wait until it listens, then open http://localhost:5180 (`PORT` from `.env`) in my default
  browser (`Start-Process http://localhost:5180`), not the in-app browser pane. Leave it running for me.
- Show only changed code (full function when small, otherwise a clear diff). Don't rewrite whole files for small changes.
- Ask before adding npm packages (say what it does, its .NET counterpart, and whether a Node built-in would do).
- Before committing: `npm run check` and `npm test` in `node-app/` must pass; run `npm run test:e2e` (Playwright) when the board or its JavaScript changed.
- You may delegate work to other agents (subagents) whenever that helps, e.g. broad searches or independent
  pieces of a change; you stay responsible for checking their results. Log each delegation in the agent log of
  Claude_Resources/Design/ApplicationDesign.md, including the model used.
- Model choice when delegating (always set the model explicitly; forks always use your own model):
  - haiku: read-only searches and listings.
  - sonnet: mechanical edits that follow an existing pattern, and independent pieces of a feature.
  - opus (or don't delegate): security/authorization logic, data model changes, reviews, learning notes.
  - fable: only when I ask for it.
  Judge by how much judgment the task needs and how costly an unnoticed mistake is, not by price alone.
  If a delegation's result needed fixing, note it in the agent log's Outcome column.
- Task board: GitHub Issues + Project "Planszówkarz" (https://github.com/users/Japanczi/projects/1,
  owner Japanczi, project number 1, linked to Japanczi/StolyDoGrania). Use the `gh` CLI.
  - One issue per rewrite phase, label `area:rewrite-node`; create other issues only for tasks I ask for
    (or after I approve a proposed list); issue text in English.
  - Every new issue: add it to the project (`gh project item-add 1 --owner Japanczi --url <issue url>`).
  - Starting a task: set Status to "In Progress"; when it's done, close it from the commit with
    `Fixes #N` (the project moves closed items to Done). Note: `Fixes #N` closes the issue only when the commit
    reaches `master`, so on this branch close phase issues with `gh issue close` after I approve the phase.
  - Delegated work: add the matching `model:haiku|sonnet|opus` label; add `needs-fix` if the result
    needed fixing. Keep logging delegations in ApplicationDesign.md too.
  - Status field id: PVTSSF_lAHOAp97Q84Bq_aSzhpUD3Y; options Todo f75ad846, In Progress 47fc9ee4,
    Done 98236657 (project id PVT_kwHOAp97Q84Bq_aS), for `gh project item-edit`.
- When I say "review latest feedback", read only the newest file in Claude_Resources/Feedback/
  (file names start with a timestamp) and ignore older ones.
