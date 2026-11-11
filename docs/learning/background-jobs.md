# Background jobs: timers vs BackgroundService (and dates with Temporal)

*Phase 4. Files: [`node-app/src/jobs/weekly-reset.ts`](../../node-app/src/jobs/weekly-reset.ts),
[`node-app/src/domain/board-settings.ts`](../../node-app/src/domain/board-settings.ts),
[`node-app/src/import/sheet-import-job.ts`](../../node-app/src/import/sheet-import-job.ts), started in
[`node-app/src/server.ts`](../../node-app/src/server.ts).*

## What it is and why we need it

Some work isn't triggered by a request: clearing the board every Monday at midnight, and importing the Google
sign-up sheet every 30 minutes. In .NET these were **hosted services**: classes deriving from `BackgroundService`,
registered with `builder.Services.AddHostedService<…>()`; the host started them with the app and cancelled them on
shutdown.

Node has no host and no hosted-service concept. A background job is just **a timer in the same process**:
`setInterval(fn, ms)` calls `fn` again and again on the event loop, between requests.

## Side by side

.NET (`Data/Table/WeeklyBoardResetService.cs`):

```csharp
public sealed class WeeklyBoardResetService(...) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do { try { await ResetIfDueAsync(stoppingToken); } catch (...) { logger.LogError(...); } }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
// Program.cs: builder.Services.AddHostedService<WeeklyBoardResetService>();
```

Node (`src/jobs/weekly-reset.ts`, shortened):

```ts
export function startWeeklyReset(deps: WeeklyResetDeps): { stop(): void } {
  let running = false;
  const check = async () => {
    if (running) return;              // a slow check never overlaps the next one
    running = true;
    try { await resetIfDue(deps); }
    catch (err) { deps.log.error({ err }, 'The weekly reset … failed; it will be retried at the next check.'); }
    finally { running = false; }
  };
  void check();                        // once at startup: catches up on a Monday missed while the app was down
  const timer = setInterval(() => void check(), 60_000);
  return { stop: () => clearInterval(timer) };
}
// server.ts: const weeklyReset = startWeeklyReset({ db, hub, log: app.log }); … weeklyReset.stop() on shutdown
```

| .NET | Node |
|---|---|
| `BackgroundService` base class + `AddHostedService` | a function returning `{ stop() }`, called from `server.ts` |
| `PeriodicTimer` + `CancellationToken` | `setInterval` + `clearInterval` in `stop()` |
| A new DI scope per run for the `DbContext` | the app's one database connection, passed in |
| Exceptions caught so the service keeps running | same – and essential: an unhandled promise rejection would stop the **whole server** |
| Runs on a thread-pool thread | runs on the event loop, between requests – so each run must be short (it is: one transaction) |

The **`running` flag** matters for the sheet import, which downloads from Google and can take seconds: if a run is
still busy when the timer fires again, the new run is skipped. In .NET, `PeriodicTimer` waited for the previous
`await` by construction.

**Tests** don't wait for real minutes: `resetIfDue` takes an injectable clock (`now`), and the import job's tests use
`node:test`'s mock timers. That's the counterpart of injecting `TimeProvider` in .NET 8+.

## Dates and time zones: Temporal

"The most recent Monday 00:00 in Warsaw" is the tricky part. JavaScript's old `Date` only knows UTC and the
*server's* zone. .NET had `TimeZoneInfo`; the .NET app used the server's local zone (Mikrus is set to Warsaw).
The brief (7.5) says not to rely on that.

Node 26 ships the new **Temporal** API without a flag, so the rule reads like the C#:

```ts
const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO('Europe/Warsaw');
const monday = local.toPlainDate().subtract({ days: local.dayOfWeek - 1 });   // dayOfWeek: 1 = Monday
return new Date(monday.toZonedDateTime({ timeZone: 'Europe/Warsaw' }).epochMilliseconds);
```

```csharp
var local = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, timeZone);
var monday = local.Date.AddDays(-(((int)local.DayOfWeek + 6) % 7));
return TimeZoneInfo.ConvertTimeToUtc(monday, timeZone);
```

Tests cover winter (UTC+1), summer (UTC+2), the week the clocks change, and "Sunday 23:30 UTC is already Monday in
Warsaw". The Dziennik page formats times with `Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw' })`, which
also doesn't depend on the server's zone.

## Could this be used with .NET?

The approach – an in-process timer – is what `BackgroundService` already is; .NET's version is more structured
(host, DI scopes, cancellation). Temporal is JavaScript-only; .NET's equivalent is `TimeZoneInfo` / `DateTimeOffset`
(or the NodaTime library, which Temporal resembles).

## Pitfalls

- Forgetting `stop()` keeps the process alive (`setInterval` holds the event loop open): tests and shutdown must
  call it.
- `setInterval` drifts and doesn't run while the process is down; that's why the rule is "a Monday has passed since
  the last check" (catch-up), not "it is Monday 00:00 now".
- TypeScript 7 already has Temporal's types in its `esnext` library; older TypeScript versions needed a polyfill's
  types.

## Official docs

- Node timers: https://nodejs.org/api/timers.html
- `node:test` mock timers: https://nodejs.org/api/test.html#class-mocktimers
- MDN, Temporal: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal
- .NET hosted services (for comparison): https://learn.microsoft.com/aspnet/core/fundamentals/host/hosted-services
