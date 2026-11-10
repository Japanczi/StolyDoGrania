# Comparison journal: Node vs .NET

One entry per phase: what was easier, harder or just different than in .NET, rough effort, bugs that .NET would
have prevented (or caused), and surprises. Newest entry last.

---

## Phase 0 – proposal (2026-11-10)

**What happened.** No app code. Chose the pieces of the stack (proposal: `docs/rewrite/phase0-proposal.md`),
drafted the branch's CLAUDE.md, wrote the first three learning notes. Effort: one session.

**Different: in .NET the stack came with the template; in Node you assemble it.**
`dotnet new blazor --auth Individual` gave us, in one command, a web server, routing, Razor, Identity (login,
register, e-mail confirmation, lockout, 2FA, passkeys), EF Core with migrations, antiforgery and a live UI
connection. For Node, the proposal had to choose **nine** separate things (HTTP framework, templates, data access,
SQLite driver, sessions, password hashing, CSRF, WebSocket, test runner) plus how TypeScript even runs. That's
the first big lesson: .NET is "batteries included and decided for you"; Node is "pick your batteries". The upside
is that every piece is small enough to understand; the downside is more decisions and more glue code.

**Harder (expected): things Identity did invisibly.** Writing sessions, CSRF and password-hash handling ourselves
is the largest "hidden" area. Listing them showed how much Identity did: the security stamp, lockout counters,
token providers for e-mail links, the revalidating auth state provider, antiforgery tokens.

**Easier (expected): fewer layers to learn.** No circuits, render modes (`InteractiveServer` vs static SSR),
`ExcludeFromInteractiveRouting`, or change tracker. A request comes in, a function returns HTML.

**New capability, not a port:** live updates for *other* users. Blazor Server already had a WebSocket per user but
only redrew that user's own page; the Node app will use its WebSocket to tell everyone that something changed.

**Bugs .NET would have prevented (predicted, to check later):**
- Form input is untyped at runtime (no model binding); every route must validate.
- Forgetting `await` crashes the process on an error instead of being silently ignored.
- No `decimal`: the BGG weight must stay a string to be shown exactly as BGG gives it.

**Surprises so far.**
- Node can run TypeScript files directly now (type stripping) – no build output at all, unlike `dotnet build`.
- EF Core stored `decimal` and `DateTime` as TEXT in SQLite – only visible once you look at the database from
  outside .NET, which a rewrite forces you to do.
- "One thread" doesn't remove race conditions: the BGG throttle still needs a queue, because requests interleave
  at every `await`.

---

## Phase 1 – skeleton (2026-11-10)

**What happened.** `node-app/` now has: config with validation, the Fastify server, static files, the layout
(ribbon, CSS-only drawer, dark board theme) via our `html` tag, a placeholder board at `/` and `/stoly`, Polish
404 and error pages, SQLite through Kysely with a migration runner and the first migration (`board_settings`), a
`/health` endpoint, and 35 tests. Checked in the browser at desktop and phone width. Effort: about one session,
most of it on deciding small things (folder names, how config flows) rather than code.

**Easier than .NET.**
- **Startup is visible.** `server.ts` + `app.ts` are ~120 lines you can read top to bottom; nothing is created by a
  DI container behind your back. Following "where does `db` come from?" takes one click.
- **Tests start fast.** The whole suite runs in under a second, including 20 HTTP-level tests through `inject()`.
  No test project, no separate build.
- **No build output.** Node ran the `.ts` files directly; `npm run check` is a pure checker. Editing and
  re-running had no "rebuild" step at all.
- **Porting static parts was copy-paste.** `app.css`, Bootstrap and the CSS-only drawer moved unchanged, because
  the .NET layout was already static HTML.

**Harder / more work than .NET.**
- **Installing the toolchain.** Node wasn't on the PC; the winget install failed once (the Windows admin prompt
  wasn't accepted in time) and worked on the retry. The .NET SDK came with Visual Studio.
- **Every default is ours to write:** 404 page, error page (with the stack only in development), security headers,
  graceful shutdown on Ctrl+C. ASP.NET Core's template had all of these.
- **Scoped CSS had to be flattened** into one file (`::deep` removed), since there's no Blazor build step.
- **Two type-check configs** (server code vs browser code), because one TypeScript project can't have both the DOM
  and Node's types without mixing them up.

**Different.**
- **Migrations are hand-written** and listed in an index file; the server refuses to start with pending migrations
  instead of the app silently having an old schema. The database now enforces rules EF kept only in C# (a `CHECK`
  that only one settings row exists).
- **The ecosystem moves fast:** compared with what the proposal assumed, Kysely had moved its `Migrator` to
  `kysely/migration`, TypeScript 7 (rewritten in Go) was the default install, and better-sqlite3 13 bundled its
  binaries. All good changes, but tutorials lag behind. .NET's yearly release rhythm is calmer.

**Bugs .NET would have prevented (or caused).** None hit yet. Prevented in advance by tests: the error page
leaking the stack trace in production (it's escaped and development-only), and unescaped user names in the layout.

**Surprises.**
- **better-sqlite3 13 ships Windows and Linux binaries inside the package** – the deploy worry from phase 0
  (building on Windows, running on Linux) disappeared. npm 11 also *asks* before running install scripts now
  (`allowScripts`), so we denied the package's compile-from-source fallback.
- The .NET app's 404 and error pages were still the template's English text; the Node versions are Polish.
- The .NET app has 35 tests – and so, by coincidence, does phase 1 (different tests: those arrive with their code).
