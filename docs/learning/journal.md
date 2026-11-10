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

---

## Phase 2 – accounts (2026-11-10)

**What happened.** Register (user name + e-mail), e-mail confirmation, resend confirmation, login (e-mail or user
name, old .NET password hashes accepted), lockout, logout, forgot/reset password, profile (phone number), e-mail
change with confirmation, change/set password, personal data download and delete, the Owner account from config and
the 4 Development-only test users. Sessions, CSRF protection, password hashing and e-mail sending written by hand.
142 tests (107 new), checked in the browser: register → confirm link → login → profile. Effort: one long session –
the biggest phase so far relative to its visible result.

**Harder than .NET – by far.** In .NET this whole phase was *one* template option (`--auth Individual`) plus
translating texts. Here, every piece Identity hid had to be written and tested: session storage and expiry, cookie
flags, CSRF tokens and origin checks, PBKDF2 header parsing, scrypt, lockout counters, one-time tokens, open-redirect
protection, the flash-message cookie, case-insensitive URLs. Each is small; together they're ~600 lines plus ~500
lines of tests. The upside is that each security property now has a test with its name on it.

**Easier.**
- **No render-mode puzzles.** Identity pages in Blazor had to be static SSR inside an interactive app
  (`ExcludeFromInteractiveRouting`, `HttpContext` as a cascading parameter, `[SupplyParameterFromForm]`). Here every
  page is just GET (show) + POST (check, then re-show or redirect).
- **Reading the real hashes was pleasant:** Identity's format is documented in its source, and `node:crypto` has
  PBKDF2 built in. Testing against real hashes from the .NET database proved compatibility directly.
- **Sessions in the database** made "log out everywhere" and "role change applies now" one-line queries.

**Different.**
- **Types don't validate input.** Every form field is a string (or missing) until checked – `readForm` + the
  `check*` helpers replaced `[Required]`, `[StringLength]`, `[Compare]` and model binding.
- **The ecosystem asks for fewer guarantees:** `nodemailer` doesn't ship TypeScript types (a separate
  `@types/nodemailer` package does); `@fastify/cookie` and `@fastify/formbody` are separate plugins.

**Bugs .NET would have prevented (or caused).**
- *Caused by .NET, found while porting:* the .NET login called `PasswordSignInAsync(…, lockoutOnFailure: false)`, so
  the lockout page could never appear – brute-force protection was effectively off. The Node app enables it.
- *A risk .NET removes:* every form must carry the hidden `_csrf` field by hand (`csrfField(request)`); Blazor's
  `<EditForm>` added the token automatically. A test checks forms carry it, and a POST without it gets 403.
- *Found by tests:* in production the CSRF cookie is named `__Host-csrf`, which the test helper didn't know about
  (a test bug, not an app bug).

**Surprises.**
- The `__Host-` cookie prefix exists, and matters on shared hosting domains like `wykr.es`.
- A mail scanner "clicking" a confirmation link first would use up a one-time token; handled by treating an
  already-confirmed address as success.
- Two small privacy wins came almost for free: the e-mail no longer appears in the RegisterConfirmation URL (and so
  not in server logs), and unknown logins take as long as wrong passwords.
