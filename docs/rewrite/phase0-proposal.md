# Node rewrite – phase 0 proposal

Status: **waiting for your approval** (2026-11-10). No app code is written until you approve or change the choices below.
Brief: `Claude_Resources/Rewrite/NodeRewrite.md` (draft 3, in the main checkout). Issue: https://github.com/Japanczi/StolyDoGrania/issues/2

How to read this: each section is one open item from brief section 4. It explains the problem in plain words,
lists 2–3 options, compares each with what the .NET app does today, and ends with a **recommendation**.
Section 10 adds a few decisions the brief didn't list but that phase 1 needs. Section 11 is the folder layout,
section 12 the npm packages I'd ask to add. Each recommendation favours options that *show how things work*
(brief section 1); where a more automatic option exists, it says what that option would have done for us.

To approve: reply with the section numbers you accept, and the letter you prefer where you disagree
(e.g. "all OK, but 3 → B").

---

## Summary of recommendations

| # | Topic | Recommendation | .NET counterpart today |
|---|---|---|---|
| 1 | HTTP framework | **Fastify** | ASP.NET Core (Kestrel + middleware + routing) |
| 2 | HTML templating | **Hand-written `html` tagged templates** in TypeScript (auto-escaping) | Razor components |
| 3 | Data access + driver | **Kysely** (typed SQL query builder) + **better-sqlite3** | EF Core + Microsoft.Data.Sqlite |
| 4 | Sessions, auth, CSRF | **Hand-written** DB sessions on `@fastify/cookie`; Identity v3 hash verify + **scrypt** (built into Node) for new hashes; token + Origin check for CSRF | ASP.NET Identity + cookie auth + antiforgery |
| 5 | WebSocket | **`@fastify/websocket`**, "notify, then fetch the fragment", hand-written reconnect | Blazor's SignalR circuit |
| 6 | Tests | **`node:test`** (built in) + Fastify `inject()`; **a few Playwright** tests from phase 3 | xUnit + in-memory SQLite |
| 7 | Schema | **New clean schema + tested migration script** (your lean), keeping existing ids | EF Core migrations, Identity tables |
| 8 | Background jobs | **In-process timers** (`setTimeout` loop) + pure "is it due?" functions | `BackgroundService` + `PeriodicTimer` |
| 9 | Old 2FA/passkey data | **Not migrated**; the script reports any account that had 2FA on | – |
| 10 | Extra: how TS runs, Node version, config, browser JS | **Node runs `.ts` directly** (type stripping), `tsc` only checks types; Node LTS; `--env-file`; plain JS with `// @ts-check` in the browser | `dotnet build`, `appsettings.json` + user-secrets |

---

## 1. HTTP framework

**What it is.** Node itself can only say "a request arrived, here are its bytes". A framework adds what
ASP.NET Core gives you out of the box: routing (`/gry` → this function), parsing forms and cookies, a pipeline
of steps that run before your handler (like middleware), error pages, static files.

| | A. Express 5 | B. **Fastify 5** | C. Hono 4 |
|---|---|---|---|
| Idea | The classic: a list of middleware functions `(req, res, next)` run in order | Plugins + a fixed request **lifecycle** (onRequest → preParsing → preValidation → preHandler → handler → onSend) | Built on web standards (`Request`/`Response`, the same objects as `fetch` in the browser); runs on Node, Deno, Cloudflare… |
| Closest .NET idea | `app.Use(...)` middleware, nothing else | ASP.NET Core middleware **plus** endpoint filters and model validation; plugins ≈ `builder.Services.Add...` | Minimal APIs |
| Built-in validation | No (add a library) | Yes: JSON Schema per route (like `[Required]`/`[Range]` on a model) | Via add-on validators |
| Official plugins we need | Third-party, uneven quality | First-party: cookie, formbody, multipart (with size limits), static, websocket, rate-limit | Some built in, some community |
| TypeScript | Types added by the community | Written with TS in mind | Written in TS |
| Learning value | Very transparent, but you assemble everything yourself and old tutorials (Express 4) are everywhere | Explicit and documented lifecycle; you can see *when* each step runs | Teaches web-standard APIs, but Node is not its main target |

**Recommendation: B – Fastify.** Its lifecycle maps cleanly onto what you know from ASP.NET Core
(`UseAuthentication` → an `onRequest` hook that loads the session; `[Authorize]` → a `preHandler` check), its
first-party plugins cover everything in section 6 of the brief without hunting for packages, and `app.inject()`
lets tests send fake requests without a network (like `WebApplicationFactory`). Express would teach the same
concepts but with more DIY glue; Hono is great but optimised for edge runtimes we don't use.
*Could it be used with .NET?* No – it's a JavaScript library; ASP.NET Core is the .NET equivalent.

## 2. HTML templating

**What it is.** The server builds each page as an HTML string. Razor does this today: `.razor` files mix HTML
with C#, are compiled, type-checked, and **escape** every value (so a user named `<script>` can't inject code).
Whatever we pick must escape by default.

| | A. **`html` tagged templates** (hand-written, ~40 lines) | B. JSX/TSX to string (`@kitajs/html`) | C. Eta (EJS-style template files) |
|---|---|---|---|
| Looks like | ``html`<td class="slot">${slot.name}</td>` `` inside ordinary `.ts` functions | `<td class="slot">{slot.name}</td>` in `.tsx` files (React-like syntax, no React) | `<td class="slot"><%= it.name %></td>` in `.eta` files |
| Type-checked | **Yes** – it's just TypeScript | Yes | No (`it` is untyped) |
| Escaping | Our tag escapes every `${…}` unless wrapped in `raw(…)`; we test it | Only with a `safe` attribute / careful setup – easy to forget (a known XSS pitfall) | `<%= %>` escapes, `<%~ %>` doesn't |
| Build step | None | Needs JSX compilation (Node's built-in TS support can't run `.tsx`, see 10.1) | None |
| Closest to Razor | Components are functions: `slotCell(slot)` ≈ `<SlotCell Slot="slot" />` | Closest look | Closest to old MVC `.cshtml` views |
| Magic | None: you can read the whole engine | Compiler transform | Template parser |

**Recommendation: A – our own `html` tag.** A "tagged template" is a normal JavaScript feature: a function that
receives the fixed text parts and the `${…}` values separately, so it can escape each value. Writing it is a
small, very instructive piece of code (and the first learning note on rendering), it needs no build step, and every
template is type-checked like Razor. Downsides: HTML inside strings gets less editor help (the VS Code extension
"es6-string-html" adds highlighting), and it's easy to forget `raw()` is dangerous – the rule will be "only
`raw()` on output of another `html` call". If you'd rather have Razor-like markup, B is the alternative.
*With .NET?* Tagged templates are JS-only; Razor is .NET's built-in equivalent.

## 3. Data access and SQLite driver

**What it is.** Two layers: the **driver** talks to the SQLite file (like `Microsoft.Data.Sqlite`), and the
**data access library** turns TypeScript calls into SQL (like EF Core's LINQ → SQL).

### 3a. Data access

| | A. **Kysely** | B. Drizzle ORM | C. Prisma |
|---|---|---|---|
| What | Type-safe **query builder**: `db.selectFrom('table_slots').where('user_id', '=', id)` – reads like SQL | Schema written in TS + SQL-like builder + a relational "ORM" API; generates migration SQL | Full ORM: own schema language (`schema.prisma`), generated client, migrations |
| Change tracking (EF's `ChangeTracker`) | None – you write `insert`/`update`/`delete` yourself | None | None (but hides more) |
| Migrations | Hand-written TS files run by Kysely's `Migrator` (records them in a table, like `__EFMigrationsHistory`) | `drizzle-kit generate` diffs the schema → readable `.sql` file (closest to `dotnet ef migrations add`) | `prisma migrate dev` – automatic |
| Learning value | **High**: every query maps 1:1 to SQL you can predict | Medium-high | Low: most "magic", heaviest install |
| Fit for our rules | Load a table + its slots, run `PlayTable` rules in TS, write the changes back | Same | Same |

**Recommendation: A – Kysely.** The biggest lesson of leaving EF Core is that *nothing* tracks your objects:
you decide which rows change. Kysely makes that visible while still type-checking column names (a typo is a
compile error, as with LINQ). Server-side authorization stays "in the query" as CLAUDE.md requires –
`TableSlot.RemovableBy` becomes a reusable `where` clause. Drizzle is a fine alternative if you'd like migrations
generated for you; Prisma hides too much for this project's goal.
*With .NET?* No; .NET's equivalents are EF Core (ORM), Dapper (raw SQL mapping) or SqlKata (query builder).

### 3b. SQLite driver

| | A. **better-sqlite3** | B. `node:sqlite` (built into Node) |
|---|---|---|
| Install | npm package with a native (C) part; **prebuilt binaries for Linux x64 and Windows** for current Node LTS versions, so nothing is compiled | Nothing to install |
| Maturity | Very mature; Kysely's official SQLite dialect uses it | Newer; still marked as under active development in Node's docs; Kysely needs a community dialect |
| API | **Synchronous** (see note below) | Synchronous |

**Recommendation: A – better-sqlite3.** Note for the learning notes: it is *synchronous* – a query blocks the
event loop (see `docs/learning/node-basics.md`). For SQLite on the same disk with small queries this is
actually faster than an async driver, and it's the documented reason the library is designed that way.
Deployment detail for phase 5: the PC is Windows and the server Linux, so the deploy script must ship the
**Linux** prebuilt binary (either `npm ci --omit=dev` on the server, which only downloads a prebuilt file, or
fetching the Linux prebuild on the PC). Decided in phase 5; both work without compiling on the server.

## 4. Sessions, authentication, password hashing, CSRF

**What it is.** HTTP forgets you after every request. A **session** is how the server remembers you: after login
it gives the browser a cookie with a random id; every later request sends it back; the server looks the id up.
ASP.NET Identity does all of this for us today (cookie, claims, security stamp, lockout, tokens, antiforgery).

### 4a. Sessions and login

| | A. **Hand-written sessions** on `@fastify/cookie` | B. `@fastify/session` / `@fastify/secure-session` | C. Full auth library (Better Auth) |
|---|---|---|---|
| How | `sessions` table in SQLite (id hash, user id, created, expires, *auth level*); an `onRequest` hook reads the cookie, loads session + user | Plugin manages the session object; storage pluggable (secure-session stores it encrypted in the cookie itself) | Library brings its own tables, routes, password rules, e-mail flows |
| .NET counterpart | What `AddIdentity` + cookie authentication do internally | Like ASP.NET Core's `AddSession` | Like Identity itself |
| Log out everywhere / invalidate on password change (security stamp) | Yes: delete the user's rows | With a DB store, yes; with cookie-only storage, no | Yes |
| 2FA later (brief 7.6) | Session row gets `auth_level = 'password' \| 'full'`; v1 always goes straight to `full`; 2FA inserts a step | Possible | Built-in plugin |
| Old Identity hashes | We write the check | We write the check | Needs a custom hasher hook |
| Learning value | **Highest**: ~150 lines, every security property visible and tested | Medium | Low |

**Recommendation: A – hand-written**, following the well-known open guide by the author of the former Lucia
library (it was turned from a library into a "how to write it yourself" guide for exactly this reason). Only the
**hash** of the session id is stored, so a stolen DB copy can't be used to log in. The cookie is `HttpOnly`,
`Secure` (in production), `SameSite=Lax`. Roles and the user record are re-read on every request, so an admin's
role change applies at once (Identity needed the revalidating auth state provider for this). Lockout counters,
e-mail confirmation, confirmation/reset tokens (random, stored hashed, with purpose and expiry) are ported as
small, tested functions.

### 4b. Password hashes

- **Reading old hashes:** ASP.NET Identity v3 stores, in one base64 string: format byte `0x01`, PRF id, iteration
  count, salt length, salt, then the derived key. We read those fields from the header (not hard-coded, as the
  brief requires) and verify with `crypto.pbkdf2` from Node's built-in `node:crypto`. Tested against real hashes
  from a local copy of `app.db`.
- **New hashes** (on register, password change, and re-hash after a successful old-format login):

| | A. **scrypt** (built into `node:crypto`) | B. Argon2id (`@node-rs/argon2`, prebuilt native) | C. PBKDF2-SHA512 (built in, same as Identity) |
|---|---|---|---|
| Strength | Memory-hard; OWASP-listed | OWASP's first choice | Weakest of the three (not memory-hard) |
| Dependency | None | Native package | None |
| Memory per hash | Tunable; ~16 MiB with OWASP's `N=2^14, r=8, p=5` – fine on 1 GB | ~19 MiB at OWASP minimum | ~0 |

**Recommendation: A – scrypt**, stored self-describing (`scrypt$N$r$p$salt$hash`) so parameters can be raised
later – the same idea as Identity's header.

### 4c. CSRF (cross-site request forgery)

**What it is.** Another website could make your browser POST to Planszówkarz with your cookie attached
("delete this table"). Blazor/Identity block this with antiforgery tokens (`app.UseAntiforgery()`), invisibly.

| | A. **Token + Origin check, hand-written** | B. `@fastify/csrf-protection` | C. Only `SameSite=Lax` + Origin check |
|---|---|---|---|
| How | A random token per session, in a hidden form field and in a header for `fetch`; plus every non-GET request must come from our own `Origin` (or `Sec-Fetch-Site: same-origin`) | Plugin generates/validates tokens | Modern browsers already don't send Lax cookies on cross-site POSTs |
| Learning value | High, ~30 lines | Medium | High but relies on browser behaviour only |

**Recommendation: A** – two independent defences, both visible. The **WebSocket** upgrade gets the same Origin
check (browsers send cookies with WebSockets, so this matters – "cross-site WebSocket hijacking").

## 5. WebSocket live updates

**What it is.** A WebSocket is a connection the browser keeps open, so the server can send messages at any time.
Blazor Server already uses one (SignalR) – but only to update *your own* page. Here we add pushing changes to
*everyone* (brief 7.1).

### 5a. Library

| | A. `ws` directly | B. **`@fastify/websocket`** (built on `ws`) | C. Socket.IO |
|---|---|---|---|
| What | The standard low-level library | `ws` plugged into Fastify routing: the upgrade request runs our normal hooks (session cookie, Origin check) | Own protocol on top of WebSocket: rooms, auto-reconnect, fallback to long-polling, needs its client library |
| .NET counterpart | `System.Net.WebSockets` | ASP.NET Core `app.UseWebSockets()` | **SignalR** (almost the same idea) |
| Reconnect | Write it | Write it (~40 lines of browser JS) | Automatic |

**Recommendation: B.** It shows the real protocol and reuses our auth hooks. Socket.IO would hide what SignalR
already hid from you; writing the reconnect (with growing delays: 1 s, 2 s, 4 s … max 30 s) is a good lesson.

### 5b. What is pushed (brief 7.1)

| | A. **"Notify, then fetch"** | B. Push rendered HTML per viewer | C. Push JSON, render in the browser |
|---|---|---|---|
| How | Server sends `{"type":"table-changed","id":12,"version":431}`; the page fetches `GET /fragments/table/12` with its own cookie and swaps the row | Server renders the row for each connected user with their rights and sends it | Server sends data; plain JS builds the HTML |
| Rights (no admin-only data to normal users) | **Automatic**: the fragment is rendered by the same code as the page, for that viewer | Must render per connection | Duplicates rendering logic in JS |
| Catch-up after reconnect | Compare `version`; if anything was missed, fetch the whole board fragment | Same | Same |

**Recommendation: A.** The message itself carries no user data, so it can safely go to everyone; rights are
applied by the normal request path. Your *own* actions use `fetch` POSTs that return the updated row directly
(no full reload); without JS, forms still work as normal POST + redirect. Everything runs in one process, so the
list of open sockets is just a `Set` in memory (fine for one server).

## 6. Tests

| | A. **`node:test`** (built in) | B. Vitest | C. Jest |
|---|---|---|---|
| What | Node's own runner: `node --test`, `assert`, mocks, **fake timers** | Popular modern runner, nice watch mode and output | Older standard; awkward with ESM/TypeScript |
| .NET counterpart | xUnit (built into the toolchain feel of `dotnet test`) | xUnit with extra tooling | – |
| Dependency | None | Yes | Yes |

**Recommendation: A – `node:test`**, plus Fastify's `app.inject()` for HTTP-level tests and SQLite `:memory:`
databases (as the current tests do – real SQL, no mocks). The 35 xUnit tests are ported first (brief section 9).
Fake timers make the weekly reset testable without waiting for Monday.

**Playwright (browser end-to-end):** recommend **yes, a few tests from phase 3**: login, take/free a seat, and
**two browsers seeing each other's change live** – the one feature no unit test can prove. It downloads browser
builds (a few hundred MB, dev machine only). *With .NET?* Yes – Playwright has an official .NET version
(`Microsoft.Playwright`); the current app could use it too.

## 7. Schema: keep EF/Identity tables or new schema + migration

| | A. Keep the EF/Identity layout | B. **New clean schema + migration script** | C. New schema, sync both ways during cutover |
|---|---|---|---|
| How | Node opens today's `app.db`: `AspNetUsers`, `PlayTables`, `TableSlots`… | `snake_case` tables designed for this app (`users`, `sessions`, `user_tokens`, `play_tables`, `table_slots`…); a script copies `app.db` → `planszowkarz.db` once, at cutover | B plus a reverse script |
| Pros | No script; instant rollback (both apps could even share the file) | Clean names, only columns we use, migrations owned by Node; the script is tested on a copy of the live DB | Safest rollback |
| Cons | Inherits ~15 Identity columns we don't use, `ConcurrencyStamp`, EF's history table; two tools would "own" one schema | Rolling back after cutover loses changes made in the Node app (acceptable: few users, short window) | Most work, little value |

**Recommendation: B (your lean)**, with two details:
- **Keep the existing ids** (user GUID strings, table and game ids), so action-log entries and feedback files
  (`userId:` in front matter) still point at the right users.
- **Roles as one column** `role` = `owner` / `admin` / `user` instead of Identity's many-to-many tables, since the
  app only ever uses the hierarchy (`AppRoles.MainRole`). Owner ⇒ admin stays true by definition.
- Covers stay as BLOBs in the database (one file to back up), as today.

The script is a TypeScript file in `scripts/`, re-runnable, with tests that compare counts and spot-check rows.

## 8. Background jobs (weekly reset, sheet import)

| | A. **In-process timers** | B. Cron library (`croner`, `node-cron`) | C. systemd timers running a script |
|---|---|---|---|
| How | A loop with `setTimeout`: run the check, wait 1 minute (reset) / 30 minutes (import), repeat; a "running" flag prevents overlap | Cron expression `0 0 * * 1` with time zone `Europe/Warsaw` | OS starts a separate process on schedule |
| .NET counterpart | `BackgroundService` + `PeriodicTimer` (what we have) | Hangfire/Quartz-like | Same on Linux for any app |
| Missed Monday catch-up | Kept: the pure function "last Monday 00:00 in Warsaw > last check?" (ported from `BoardSettings.IsAutoResetDue`) | Cron alone doesn't catch up; we'd still need our check | Same |
| Live update after reset | Easy (same process holds the sockets) | Easy | Hard (other process) |

**Recommendation: A.** Same design as today, the time logic is a tested pure function, and Node's fake timers
test the loop. Time zone: computed with the built-in `Intl` API for `Europe/Warsaw` (not the server's zone,
brief 7.5); if our Node version ships the new `Temporal` date API unflagged, we'll use that instead and note it.

## 9. Existing 2FA / passkey data

Not migrated, as the brief decides: authenticator keys, recovery codes, passkeys and external logins are dropped;
the `TwoFactorEnabled` flag is ignored. The migration script **prints a warning** listing any account that had 2FA
switched on, so you know who (if anyone) loses that protection. Nothing else to decide.

## 10. Extra decisions phase 1 needs (not in the brief)

1. **How TypeScript runs.** Recommend: **Node runs `.ts` files directly** ("type stripping", built into current
   Node versions: it deletes the type annotations and runs the rest), and `tsc --noEmit` only *checks* types
   (an npm script, run before tests and deploy). No build output folder, no extra runner. Cost: only "erasable"
   TS syntax – no `enum`, no `namespace`, no constructor parameter properties; we use union types like
   `'small' | 'large'` instead of enums (enforced by `erasableSyntaxOnly` in `tsconfig.json`).
   Alternatives: compile with `tsc` to a `dist/` folder (classic), or the `tsx` runner (more magic).
   Explained in `docs/learning/typescript-vs-csharp.md`.
2. **Node version:** the current **LTS** line (checked with `node -v` at the start of phase 1; same version on PC
   and Mikrus, pinned in `package.json` `engines` and an `.nvmrc` file).
3. **Configuration and secrets:** Node's built-in `--env-file=.env` (local, git-ignored, with a committed
   `.env.example`), real environment variables on the server (the existing `planszowkarz.env` file read by
   systemd). One `config.ts` reads and **validates** everything at startup and fails fast with a clear message –
   the role `appsettings.json` + `IOptions<T>` + user-secrets play today.
4. **Browser JavaScript:** plain `.js` files in `public/js/`, with `// @ts-check` and JSDoc type comments so `tsc`
   checks them too – no bundler, no build step for the browser.
5. **Logging:** Fastify's built-in logger (pino, JSON lines) – the `ILogger` counterpart; on Mikrus it lands in
   `journalctl` as today.
6. **Where the Node app lives on the branch:** in a subfolder **`node-app/`**, next to the untouched .NET code, so
   both can run side by side from one checkout and the learning notes can link to the C# files. Whether the .NET
   code moves out at cutover is decided in phase 5.

## 11. Proposed folder layout

```
node-app/
  package.json            scripts: dev, start, check (tsc), test, test:e2e, migrate, import-dotnet-db
  package-lock.json       exact versions (like NuGet's lock file / resolved PackageReferences)
  tsconfig.json           type-check settings (noEmit, strict, erasableSyntaxOnly)
  .env.example            every setting, no secrets (.env itself is git-ignored)
  src/
    server.ts             entry point: config → database → app → jobs → listen   (Program.cs, bottom half)
    app.ts                builds the Fastify app: plugins, hooks, routes; tests use it too (Program.cs, top half)
    config.ts             reads + validates environment                       (appsettings.json, IOptions)
    domain/               pure business rules, no I/O, fully unit-tested       (Data/Table/*.cs, AppRoles.cs …)
      play-table.ts         TryCreate, TryTakeSlot, TryAddPlayer, TrySetTakenSlots, IsSlotTaken, ApplyImport …
      table-slot.ts         removableBy (as a Kysely where-clause builder)
      roles.ts              mainRole, canManage
      game.ts  table-phrase.ts  board-settings.ts  user-name.ts  email-format.ts
    db/
      database.ts           opens SQLite (WAL mode, foreign keys on), creates the Kysely instance
      schema.ts             TypeScript types of every table
      migrations/           0001-initial.ts, …                              (Migrations/)
      queries/              boards.ts, games.ts, users.ts, logs.ts – reads/writes used by routes
    auth/
      password-hash.ts      Identity v3 verify, scrypt hash/verify, "needs rehash"
      sessions.ts           create/validate/invalidate sessions, cookie settings
      login-flow.ts         step-by-step login (password → [2FA later] → full session)
      tokens.ts             e-mail confirmation / reset tokens
      csrf.ts               token + Origin check
      polish-errors.ts      Polish texts for account errors                 (PolishIdentityErrorDescriber)
    web/
      html.ts               the html`` tag, escape(), raw()
      layout.ts             ribbon, menu drawer, feedback box, admin dock     (MainLayout.razor, NavMenu.razor)
      components/           confirm-button.ts, hour-picker.ts, admin-toolbox.ts …
      pages/
        board/              routes.ts (handlers) + view.ts (templates)        (Tables.razor)
        games/  admin/  account/  errors/
    live/                   websocket hub: connections, broadcast, versions
    jobs/                   scheduler.ts (the timer loop), weekly-reset.ts    (WeeklyBoardResetService.cs)
    integrations/
      bgg/                  client with 5-second throttle, XML parsing        (Data/Bgg/BggClient.cs)
      email/                SMTP sender + Polish templates                     (Data/Email/)
    features/               feedback-archive.ts, disk-usage.ts, normal-user-mode.ts
    import/                 TEMPORARY Google sheet import, isolated: removing this folder + one line in server.ts removes it
    dev/                    Development only: page designer endpoint, 4 test users (checked on the server)
  public/                   served as static files                            (wwwroot/)
    app.css                 ported as-is
    js/                     board.js, live.js, confirm-button.js, feedback.js … (plain JS, // @ts-check)
    lib/bootstrap/          Bootstrap 5 files, as today
    tools/designer.js       dev-only page designer (same JSON format)
  test/                     mirrors src/: domain/play-table.test.ts, auth/password-hash.test.ts …  (Planszowkarz.Tests/)
    e2e/                    Playwright tests (from phase 3)
  scripts/
    import-dotnet-db.ts     one-time app.db → new schema migration (+ its tests in test/scripts/)
docs/
  learning/                 learning notes + journal (section 11 of the brief)
  rewrite/                  this proposal, the draft CLAUDE.md
```

Rules behind the layout: **`domain/` never imports from `db/`, `web/` or Fastify** (so rules are testable and
can't be bypassed by a page); routes call `domain/` for every decision and `db/queries` for every read/write;
authorization lives in the queries (e.g. `removableBy`) and is re-checked for HTTP and WebSocket alike.

## 12. npm packages I'd ask to add (phase 1 unless noted)

CLAUDE.md says to ask before adding packages; this list is that question. Everything else uses Node's built-ins
(`node:crypto`, `node:test`, `fetch`, `Intl`, `--env-file`).

| Package | Why | .NET counterpart |
|---|---|---|
| `fastify`, `@fastify/cookie`, `@fastify/formbody`, `@fastify/static` | HTTP server, cookies, form posts, static files | ASP.NET Core |
| `@fastify/multipart` (phase 3) | Cover upload with size limit at receive time | `IBrowserFile` / `IFormFile` |
| `@fastify/websocket` (phase 3) | Live updates | SignalR (Blazor) |
| `kysely`, `better-sqlite3` | Data access + driver | EF Core + Microsoft.Data.Sqlite |
| `nodemailer` (phase 2) | SMTP e-mail | MailKit |
| `fast-xml-parser` (phase 3) | BGG XML API | `System.Xml.Linq` (built in) |
| dev: `typescript`, `@types/node`, `@types/better-sqlite3` | Type checking | the C# compiler |
| dev: `@playwright/test` (phase 3) | Browser tests | Microsoft.Playwright |

Not proposed: a linter/formatter (ESLint, Prettier) – useful but optional; ask if you want one.

## 13. Next step

After your approval: update the branch's `CLAUDE.md` from `docs/rewrite/CLAUDE.node.draft.md`, close issue #2,
and open the phase 1 issue (skeleton: server, layout, SQLite access, test setup, local run script).
