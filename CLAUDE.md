# Planszówkarz – project instructions

## Stack
- No JS framework; Bootstrap 5 for styling.

## Language conventions
- User-facing strings (labels, errors, status messages): Polish.
- XML doc comments and inline comments: English.
- Identifiers (classes, methods, properties): English.
- EF migration names: English, PascalCase (e.g. AddUserIdToTableSlots).
- Reply to me in english unless I write in polish.

## Project layout
- Components/Pages/        – app pages (Tables.razor, at /stoly, is the main page)
- Components/Account/      – scaffolded Identity UI. Do NOT edit unless I ask.
- Migrations/              – generated. Never hand-edit; tell me the `dotnet ef` command instead.
- Claude_Resources/        – the "resources folder" / "res folder": reference material I save for you
  (e.g. BGG Site/ pages, Resources.txt, Feedback/).

## Domain model
- Business rules live in PlayTable (Join/Leave/TrySetTakenSlots/IsSlotTaken). Prefer extending these
  over duplicating logic in components.

## Code conventions
- File-scoped namespaces and primary constructors where already used.
- Nullable reference types are on; no `!` unless justified.
- Data access in components: inject ApplicationDbContext, use AsNoTracking() for reads,
  call Db.ChangeTracker.Clear() before reloading after writes (current pattern).
- Wrap SaveChanges in try/catch (DbUpdateException) and show a Polish error message.
- Interactive pages use `@rendermode InteractiveServer`; Identity pages are static SSR
  (ExcludeFromInteractiveRouting) – keep it that way.

## Security / authorization rules
- Only logged-in users may add/remove table participants.
- A user may only remove slots where TableSlot.UserId == their own id, or any slot at a table they
  own (PlayTable.OwnerUserId == their own id). Admins may remove any slot. Enforce on the server side
  (in the query), not just by hiding buttons.
- Roles: Owner (main admin, always also Admin), Admin, User. Only the Owner may revoke another
  admin's role or delete an admin's account; nobody can change or delete the Owner. Check on the server.
- Never display a full e-mail address publicly (displayName = part before '@').
- Validate uploaded covers: allowed MIME types, max 2 MB.

## Workflow
- Schema changes: edit entities/DbContext, then give me the commands:
  dotnet ef migrations add <EnglishName> && dotnet ef database update
- Show only changed code (full method/component when small, otherwise a clear diff).
  Don't rewrite whole files for small changes.
- Mention any needed migration explicitly.
- Ask before adding NuGet packages.
- You may delegate work to other agents (subagents) whenever that helps, e.g. broad searches or
  independent pieces of a change; you stay responsible for checking their results. Log each delegation
  in the agent log of Claude_Resources/Design/ApplicationDesign.md, including the model used.
- Model choice when delegating (always set the model explicitly; forks always use your own model):
  - haiku: read-only searches and listings (e.g. "which pages inject ApplicationDbContext?").
  - sonnet: mechanical edits that follow an existing pattern, and independent pieces of a feature.
  - opus (or don't delegate): security/authorization logic, data model changes, reviews.
  - fable: only when I ask for it.
  Judge by how much judgment the task needs and how costly an unnoticed mistake is, not by price alone.
  If a delegation's result needed fixing, note it in the agent log's Outcome column.
- Task board: GitHub Issues + Project "Planszówkarz" (https://github.com/users/Japanczi/projects/1,
  owner Japanczi, project number 1, linked to Japanczi/StolyDoGrania). Use the `gh` CLI.
  - Create issues only for tasks I ask for (or after I approve a proposed list); issue text in English.
  - Every new issue: add it to the project (`gh project item-add 1 --owner Japanczi --url <issue url>`)
    and give it one `area:*` label.
  - Starting a task: set Status to "In Progress"; when it's done, close it from the commit with
    `Fixes #N` (the project moves closed items to Done).
  - Delegated work: add the matching `model:haiku|sonnet|opus` label; add `needs-fix` if the result
    needed fixing. Keep logging delegations in ApplicationDesign.md too.
  - Status field id: PVTSSF_lAHOAp97Q84Bq_aSzhpUD3Y; options Todo f75ad846, In Progress 47fc9ee4,
    Done 98236657 (project id PVT_kwHOAp97Q84Bq_aS), for `gh project item-edit`.
- When I say "review latest feedback", read only the newest file in Claude_Resources/Feedback/
  (file names start with a timestamp) and ignore older ones.
