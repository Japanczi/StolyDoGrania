# Learning notes – Node rewrite of Planszówkarz

These notes explain every technology the Node version of Planszówkarz uses, for someone who knows C#/.NET from
this project but is new to web development and to Node. They are written alongside the code, so each note matches
the code at the commit it was written in.

Every note follows the same shape:
1. **What it is and why we need it** – plain words, before code.
2. **Our code side by side with the C# app** – examples from Planszówkarz, not generic tutorials.
3. **How it differs from .NET**, and **whether it could be used with .NET**.
4. **Pitfalls** we actually hit, and links to official docs.

Code marked *sketch* was written before the app code existed (phase 0); it shows the idea and will be replaced
by links to the real files when they exist.

## Reading order

| # | Note | Phase | What you'll learn |
|---|---|---|---|
| 1 | [Node basics: the event loop and async/await](node-basics.md) | 0 | How one thread serves many users; Promises vs `Task`; what blocks the loop |
| 2 | [TypeScript vs C#](typescript-vs-csharp.md) | 0 | Types that disappear at runtime, `null`/`undefined`, unions instead of `out` parameters, how Node runs `.ts` |
| 3 | [npm vs NuGet](npm-vs-nuget.md) | 0, 1 | `package.json` vs `.csproj`, `node_modules`, lock files, scripts vs `dotnet` commands, native packages |
| 4 | [How a request flows: Fastify vs ASP.NET Core](http-request-flow.md) | 1 | Startup, hooks vs middleware, routes vs `@page`, 404 and error pages, no DI container |
| 5 | [Server-rendered HTML + plain JS vs Blazor Server](server-rendered-html.md) | 1 | The `html` tagged template, escaping, Razor side by side, the CSS-only drawer, scoped CSS |
| 6 | [Kysely + better-sqlite3 vs EF Core](kysely-vs-ef-core.md) | 1 | No change tracker, schema types, hand-written migrations, a synchronous driver |
| 7 | [Configuration and secrets](config-and-secrets.md) | 1 | `.env` vs appsettings/user-secrets, validating config at startup |
| 8 | [Testing with `node:test` vs xUnit](testing.md) | 1 | `describe`/`test`, assertions, `app.inject()`, in-memory SQLite |
| 9 | [Sessions, cookies, password hashing, CSRF vs ASP.NET Identity](sessions-and-passwords.md) | 2 | What the session cookie holds, Identity v3 hashes vs scrypt, lockout, e-mail tokens, why forms carry a hidden token |
| 10 | [Live updates: WebSocket vs Blazor's SignalR connection](live-updates.md) | 3 | "Notify, then fetch", catching up after a disconnect, why messages carry no user data, the Origin check |
| 11 | [Calling BGG: fetch, XML and throttling vs HttpClient](calling-bgg.md) | 3 | `fetch` + `AbortSignal`, a promise queue instead of `SemaphoreSlim`, stateless lookups, checking uploads by content |
| 12 | [Background jobs: timers vs BackgroundService](background-jobs.md) | 4 | `setInterval` jobs, no overlapping runs, catching up a missed Monday, time zones with Temporal |
| 13 | [Updating pages without flashing: fetch + morphing](no-flash.md) | 4+ | Why pages flashed, morphing vs Blazor's DOM diffing, links and forms via fetch, proving it with Playwright |
| – | [Comparison journal](journal.md) | every phase | What was easier, harder or different than in .NET |

## How to run the Node app (from `node-app/`)

| Command | What it does | .NET counterpart |
|---|---|---|
| `npm ci` | Install the exact packages from `package-lock.json` | `dotnet restore` |
| `copy .env.example .env` | Local settings (once) | user-secrets |
| `npm run dev` | Apply migrations, then run with auto-restart on file changes, at http://localhost:5180 | `dotnet watch` |
| `npm run check` | Type-check server and browser code | `dotnet build` |
| `npm test` | Run all tests | `dotnet test Planszowkarz.Tests` |
| `npm run test:e2e` | Browser tests with Playwright (two browsers, live updates) | – (Microsoft.Playwright exists for .NET too) |
| `npm run migrate` | Apply pending migrations | `dotnet ef database update` |
| `npm run import-dotnet-db -- <app.db copy> <new.db>` | One-time conversion of the .NET database (cutover) | – |

## Planned notes (added in the phase that introduces them)

- Building and deploying to Mikrus vs `dotnet publish` (phase 5)

## Related documents

- Phase 0 proposal (the choices these notes explain): [`docs/rewrite/phase0-proposal.md`](../rewrite/phase0-proposal.md)
- The branch's spec (decisions and phase status): [`Claude_Resources/Resources.txt`](../../Claude_Resources/Resources.txt)
- The brief (main checkout, git-ignored): `Claude_Resources/Rewrite/NodeRewrite.md`
