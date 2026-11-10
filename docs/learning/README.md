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
| 3 | [npm vs NuGet](npm-vs-nuget.md) | 0 | `package.json` vs `.csproj`, `node_modules`, lock files, scripts vs `dotnet` commands |
| – | [Comparison journal](journal.md) | every phase | What was easier, harder or different than in .NET |

## Planned notes (added in the phase that introduces them)

- How an HTTP request flows through Fastify vs ASP.NET Core middleware and routing (phase 1)
- Server-rendered HTML with the `html` tag + plain JS vs Blazor Server (phase 1)
- Data access and migrations with Kysely vs EF Core (phase 1)
- Configuration and secrets: `.env` vs `appsettings.json` / user-secrets (phase 1)
- Testing with `node:test` vs xUnit (phase 1)
- Sessions, cookies, password hashing, CSRF vs ASP.NET Identity (phase 2)
- WebSocket live updates vs Blazor's SignalR connection (phase 3)
- Calling BGG: `fetch`, XML and throttling vs `HttpClient` (phase 3)
- Background jobs vs `BackgroundService` (phase 4)
- Building and deploying to Mikrus vs `dotnet publish` (phase 5)

## Related documents

- Phase 0 proposal (the choices these notes explain): [`docs/rewrite/phase0-proposal.md`](../rewrite/phase0-proposal.md)
- The brief (main checkout, git-ignored): `Claude_Resources/Rewrite/NodeRewrite.md`
