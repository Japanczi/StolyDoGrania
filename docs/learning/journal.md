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

---

## Own user name in the profile (2026-11-11)

**What happened.** The "Nazwa użytkownika" field on Profil was read-only (as in the .NET Identity template); now
everyone can change their own name there. The admin rename and the profile share one query function,
`renameUser()` in `db/queries/users.ts`: the new name, the seats' names and the Dziennik entry are written in one
transaction (like `await using var tx = await db.Database.BeginTransactionAsync()` in EF Core), and a UNIQUE-index
error from a race maps to "name taken". Both now also tell open boards to refresh (`hub.notify`), so seats show the
new name at once – the admin rename didn't do that before. The Profil page opted into `enhance` (no reload).

**Caught before it shipped.** The startup seed looked the Owner up by user name only. After an Owner renamed
themselves, the next restart would not find them and try to create the account again (refused, since the e-mail is
taken, but logged as an error every start). The seed now falls back to the e-mail. Identity's seeder had the same
weakness; it never showed because the .NET app never let anyone change their name.

**Lesson.** When something that used to be fixed becomes editable, look for code that used it as a key.

---

## Table kind and player count in the new-table row (2026-11-22)

**What happened.** The new-table row showed a "Stół" (kind) select that couldn't really be changed: every
`update()` of the row copied the looked-up game's kind into it again, so the user's choice snapped straight back.
Now the game's defaults (kind and player count) are copied only when the looked-up game *changes* (`appliedGame` in
`public/js/board.js`). The "Graczy" cell became an `<input type="number">` (the browser's own up/down arrows) while
creating a table; existing rows still show the count as text. The server (`POST /api/tables`) now accepts the chosen
count for any game – a whole number from 1 to 20 – and no longer forces BGG's count onto the table. The catalog game
keeps BGG's count: table creation never writes to a known game's `max_players`.

**Different from .NET.** In Blazor the select would have been `@bind="draft.Kind"`: the component's field is the
single source of truth and re-rendering never overwrites it. With plain DOM code, the DOM *is* the state, and a
"redraw everything from the data" function like `update()` must be careful not to re-apply defaults over what the
user typed. The fix is the same idea Blazor has built in: remember what you last applied, and only apply on change.

**Lesson.** A render function that both *derives* values and *sets defaults* needs to tell the two apart.

---

## Sheet import finds its games on BGG (2026-11-22)

**What happened.** Games imported from the Google sheet used to become sheet-only catalog entries (no cover, no BGG
data). Now each title is looked up on BGG and the game added to the catalog with its details and cover. The sheet's
BGG link says which game it is: that's how "Nieświadomy umysł" became *Unconscious Mind* and "Inventions: Ewolucja
Idei" *Inventions: Evolution of Ideas* – no name search could have found those. Without a link, a title is searched
and used only when there is one clear match. A real import against BGG matched all 6 games in about 16 seconds.

**Surprise: the link wasn't in the data we read.** The JSON feed gives only the cell's text, "Link". The URLs are in
the sheet's HTML view, so the import downloads that too and scrapes it (`src/import/sheet-links.ts`) – fragile by
nature, so any failure there just falls back to searching by name.

**Different from .NET.** Two things DI used to do invisibly: the BGG client must be one object for the whole process
(its throttle queue lives inside it – in ASP.NET Core a singleton registration gave us that), so `server.ts` creates
it once and passes it to both users. And the shared "fetch from BGG and save" step moved out of the board's lookup
into `integrations/bgg/add-to-catalog.ts`, so the import reuses it instead of copying it.

**Lesson.** Keep slow external calls out of database transactions: BGG work happens first, then one short sync
transaction. See the BGG note's new sections.

---

## The board on phones, step 1: one line per table + a bottom sheet (2026-11-23)

**What happened.** A phone audit (Design/ApplicationDesign.md, "Mobile audit") showed the board unusable below about
1000px: a 10-column grid scrolling sideways, seats 700px off-screen. Of three sketches, variant C was chosen: one line
per table (hour, name, "2/4", kind dot, a gold edge when you hold a seat) and a bottom sheet with the whole table. Step 1
builds both for widths below 992px. The sheet is a native `<dialog>` holding a copy of the row, kept in step with
morph after every refresh; Back closes it via the History API; the hour picker fills the screen's width inside it.
New note: [phone-layout.md](phone-layout.md). Still to do: the new-table row on phones, a "⋯" menu for admin actions,
the smaller audit fixes.

**Different from .NET.** Nothing here is Node – it is CSS, HTML and browser APIs, usable from Blazor as is. The real
difference is *where state lives*: in Blazor "which table is open" would be a C# field and the dialog rendered from
it on the server; here it is purely the browser's business, and the server keeps rendering rows exactly as before.

**Easier than expected:** `<dialog>` + `showModal()` replaced what our older popups do by hand (backdrop, Escape,
focus, blocking the rest of the page). **Harder than expected:** small interactions between features – the modal
made our `<body>`-level popups unclickable, Escape closed two layers at once, and `history.back()` turned out to be
asynchronous, so a quick close-and-reopen closed the new sheet.

**Lesson.** When one piece of UI must appear in two places, keep one source of truth (the server-rendered row) and
derive the other from it, rather than rendering it twice.

---

## The board on phones, step 2: the new-table form, and three races a test found (2026-11-23)

**What happened.** On phones the new-table row is no longer squeezed into the list: "+ Nowy stół" opens it in the
bottom sheet. Unlike a table row (copied into the sheet and kept in step), this row is *moved* there and back, so what
the user typed and the row's listeners survive. Creating a table closes the sheet and shows the new line. See
[phone-layout.md](phone-layout.md).

**The surprise: a new test made an old test flaky – and it was right.** Once the phone test created a table at the
same moment, `board.spec.ts` failed about one run in ten. Looping the suite until it failed and reading Playwright's
page snapshot showed three real races in `board.js`, all older than this step: an armed ❌ reset by a live update
(its confirming click then hit the invisible backdrop), a click dropped because `busy` also covered the refresh, and
refreshes finishing out of order. Fixed and explained in [live-updates.md](live-updates.md#pitfalls-we-hit); 40 runs
in a row pass. The first fix for the armed ❌ (hold every refresh while it's armed) passed all tests but failed the
user's own test – taking a seat and clicking ❌ right after made the seat look ignored. The final fix skips only that
button when patching (`data-morph-skip` in morph.js); its regression test now fails against the first fix.
The user then clicked even faster – alternating ❌ and a seat – and found two older habits ported from .NET: clicks
made while a request was on its way were *dropped* (a "busy" flag), and the armed ❌'s invisible backdrop *swallowed*
the next click. Both make sense for a slow server round-trip in Blazor Server, but feel broken on a fast local
page. Now actions queue up (a double click on one seat is still sent once), and a click next to an armed ❌ disarms
it and goes through. Each regression test was first checked to fail against the old code – one passed at first,
because Playwright politely waited for the backdrop to disappear.

**Different from .NET.** Blazor Server would have serialized all of this for us: one circuit handles one event at a
time, and its renderer never applies an older render after a newer one. With plain JavaScript, "one at a time" has to
be built – here a promise chain, the JS cousin of awaiting each `Task` in turn.

**Lesson.** "Flaky" tests deserve a root cause; this one would have been a user saying "I clicked delete and nothing
happened".

---

## The board on phones, step 3: the "⋯" menu (2026-11-23)

**What happened.** In the phone sheet, the owner's/admin's tiny emoji buttons became a "⋯" menu: tapping it shows
"❌ Usuń stół" and "🏷️ Zmień grę" as full-width, labelled buttons; the disabled placeholders are hidden. It is pure
CSS over the row's existing buttons (a class toggled by board.js), with labels from each button's `title` via
`content: attr(title)` – so the armed delete's "Kliknij ponownie…" shows up in the menu by itself.

**Different from .NET.** In Blazor this would have been a menu component with its own `@onclick` handlers calling
the same methods as the row buttons. Here the cheapest correct option was to *reuse the very same elements* and
change only how they look – one set of buttons, one set of listeners, one place where rights are decided (the server
rendering the row).

**Lesson.** Before writing a new UI piece, check whether an existing element can be restyled into it.
Follow-up the same day: the user asked for the menu to float *over* the sheet instead of pushing its content down;
now it's an absolutely positioned layer under ⋯ that closes on a tap outside or Escape. Re-running the suite also
caught a bug the action queue had introduced: the kind select's queued action read the select's value when it ran,
after a refresh had reset it – now values are captured at the moment of the change.
Second follow-up: the rename popup is now a layer attached to the "Zmień grę" button (above it, away from the
on-screen keyboard), re-placed after the sheet's slide-in animation and on scroll/resize. A test measuring the
sheet's height compared floats exactly and failed once on 397.5 vs 397.50006 – layout sizes need "close to".
