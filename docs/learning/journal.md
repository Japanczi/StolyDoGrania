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

---

## Phase 3 – the board (2026-11-10)

**What happened.** The board "Zapisy na gry" works: tables with all PlayTable rules (ported with their tests),
create via catalog/BGG lookup, rename, quarter-hour picker, table kind, "Zajęte" counter, add player and choose
owner (right-click), two-click delete, cover upload, the JoinedTable log, `?nowy=` highlighting – and the new
part: **live updates** over WebSocket. 208 server tests plus one Playwright test with two real browsers.
Checked in the browser: creating a table, the hour picker, and a second tab updating live. The BGG client was
ported by a helper agent (Sonnet) and checked; it needed no fixes. Effort: one long session.

**Harder than .NET.**
- **Blazor did the client side for us.** `Tables.razor` is 1 600 lines of mostly C# with `@onclick`; there was no
  JavaScript. Here the same behaviour is split three ways: rows rendered on the server (`view.ts`), actions as HTTP
  routes (`routes.ts`), and ~700 lines of browser JavaScript (`board.js`) for clicks, popups, the lookup panel, the
  hour picker and the live connection. The lookup state that sat in the circuit now lives in the page.
- **Persisting a changed table by hand.** EF tracked which seats were added or removed; here `saveTable` replaces the
  table's seats inside a transaction. Simple, but it had to be designed.

**Easier / better than .NET.**
- **Live updates were straightforward** once the design was clear ("notify, then fetch"): ~100 lines on the server,
  ~50 in the browser. Rights stay correct automatically, because each page fetches its own HTML.
- **Rules as plain functions** ported almost line by line from C#, and their tests too.
- **Clicks no longer depend on a live connection.** If the WebSocket drops, actions still work (they're plain HTTP);
  in Blazor a lost circuit froze the page behind the reconnect dialog.

**Different.**
- The meeting hour is stored as `"HH:MM"` (the .NET app stored a full date-time and only showed the hour).
- Covers are served from `/covers/:id` (cacheable) instead of being embedded as base64 `data:` URLs in every page.
- Uploaded covers are checked by their bytes, not by the browser's label.

**Bugs .NET would have prevented (or caused).**
- *Prevented by .NET:* in Blazor the page couldn't send a forged seat count – the value lived on the server. Over
  HTTP the browser sends it, so the server re-checks it (a hand-added game: 1–6; a BGG game: BGG's count). Tested.
- *Found by tests:* a WebSocket test hung because the plugin's `injectWS` helper never resolved; the tests now use a
  real listening server. And Node's own WebSocket client sends no `Origin` header – our server rightly refused it.

**Surprises.**
- Playwright's first run passed: two browsers, create → take a seat → free it → delete, each seen live by the other.
- The `display: contents` CSS trick let live updates swap all rows at once without changing the grid layout.

---

## Phase 4 – the rest (2026-11-10)

**What happened.** Everything left from the .NET app: Baza gier (`/gry`), the admin users page with the Owner rules,
Dziennik (`/admin/logs`), the admin dock on the board (permissions note; toolbox with "Wyczyść listę stołów", the
"Auto" weekly reset, disk usage and the feedback zip download), the admin "normal user mode", the weekly reset job,
the feedback box on every page, the temporary Google sheet import, the Development-only page designer, and the
one-time `app.db` → new schema conversion script, tried on a copy of the local .NET database (a migrated user logged
in with their old password). 275 server tests + the Playwright test. Effort: one long session, interrupted once by the
usage limit.

**Working with helper agents.** Four pieces ran in parallel as helper agents, each in its own files, while I did the
security-sensitive parts (users page, normal user mode) and the wiring: Baza gier, Dziennik, feedback/designer
(Sonnet) and the sheet import (Opus – it changes the data model). Splitting by *files* worked: no agent touched
another's code. What needed fixing afterwards: their tests registered routes themselves, which clashed once the routes
were wired into the app (15 failures, all "route already declared"), and one type error in `feedback.js`. The sheet
import agent was cut off by the usage limit halfway and resumed from where it stopped.

**Easier than .NET.**
- **Normal user mode** became one line where the session is loaded (the role reads as 'user'); every check in the
  app – menu, board, admin pages, toolbox – respects it automatically. .NET needed an `IClaimsTransformation`.
- **Temporal** made the time-zone rule as readable as the C# `TimeZoneInfo` version.
- **Role changes apply at the user's next click**, because the session reads the user from the database every time
  (.NET had to update the security stamp and wait for revalidation).

**Harder.**
- **No ZIP writer in Node.** The feedback download needed a small hand-written ZIP encoder (zlib does the
  compression); .NET has `System.IO.Compression.ZipArchive` built in.
- **Downloading in two steps.** Blazor streamed the zip through its circuit and knew when the browser had it. Over
  HTTP the page downloads the zip, then asks the server to delete exactly the files listed in a response header.
- **Migrating data by hand.** EF's text formats (decimal weights, `DateTime` without a zone, `DateTimeOffset` with one,
  `0001-01-01` meaning "no hour") each needed an explicit conversion, and .NET's missing foreign key on seat user ids
  meant cleaning dangling ids.

**Different.**
- Deleting an account keeps its seats and tables (your decision); the .NET users page freed the seats.
- Baza gier, Dziennik and the users page are plain forms and links with query parameters (search, sort, page) – the
  URL can be bookmarked or shared; Blazor kept that state in the circuit.

**Bugs .NET would have prevented (or caused).** None reached the app. The duplicate-route test failures were a
coordination slip between helpers and wiring, not an app bug.

**Surprises.** Node 26 has Temporal built in, and TypeScript 7 already knows its types.

---

## Phase 5 – going live (2026-11-11)

**What happened.** The .NET app was saved on the `dotnet` branch, `master` became the Node app (PR #7, merge commit),
and the public site switched to Node: trial on port 20347 beside .NET with a converted copy of the live database, then
a fresh conversion and the switch of port 30347 (a few seconds of downtime). .NET is stopped and disabled but
installed, so switching back is two commands (deploy/CUTOVER.md). Live data: 2 accounts (incl. the Owner), 10 games,
5 tables, 14 seats, 11 phrases, 6 log entries.

**Easier than .NET.** The upload is ~17 MB instead of a ~100 MB self-contained build, and there's no build step at all.
Running both versions side by side on one small server was easy: the Node service uses about 80 MB of RAM
(systemd's count right after the switch).

**Harder.** Node has to be installed on the server (and needed `libatomic1`), and four small Windows/PowerShell/bash
quirks broke the first deploy runs (see the learning note on deploying). Each was a one-line fix, but none of them
existed with `dotnet publish`.

**Surprise.** Everything that mattered for users – passwords, the Owner, the imported sheet tables, covers – came
across on the first conversion; the hard part of the cutover was tooling, not data.

---

## After going live – hidden e-mails on the users page (2026-11-11)

**What happened.** In production, renaming a user on the admin users page turned every e-mail address into
"[email protected]". Cause: Cloudflare's e-mail obfuscation rewrites addresses in HTML responses and decodes them only
on a full page load, and our in-place updates (fetch + morph) bring fresh HTML without that decoding. Addresses are now
hidden by default; "Pokaż e-mail" fetches one address as JSON (`GET /admin/users/:id/email`, admin-only) and writes it
into the cell. Details in the no-flash note's pitfalls.

**Different from .NET.** Blazor's updates travelled over SignalR, which a proxy doesn't rewrite, so the .NET app
never showed the problem. Replacing a framework's transport with plain HTTP means every proxy feature that touches
HTML now applies to our updates too.

**Lesson.** Things between the server and the browser (CDN, proxy) are part of the system; test in-place updates
behind them too, not only locally.
