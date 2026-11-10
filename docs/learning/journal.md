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
