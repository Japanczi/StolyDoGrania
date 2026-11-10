# Configuration and secrets: `.env` vs appsettings.json / user-secrets

*Phase 1. Files: [`node-app/src/config.ts`](../../node-app/src/config.ts), [`node-app/.env.example`](../../node-app/.env.example).*

## What it is and why we need it

Some values differ between your PC and the server (port, database path, log level) or must never be in git
(SMTP password, BGG token). .NET layers several sources for this – `appsettings.json`, `appsettings.Development.json`,
user-secrets on your PC, environment variables on the server – and binds them to typed classes (`IOptions<T>`).

Node has one built-in source: **environment variables** (`process.env`, all strings). Everything else is convention:

| Where | .NET | Node (ours) |
|---|---|---|
| Defaults | `appsettings.json` | Defaults in `src/config.ts` (`PORT ?? '5180'`) |
| Local values and secrets | `appsettings.Development.json`, `dotnet user-secrets` | `node-app/.env` – git-ignored, loaded by `node --env-file-if-exists=.env` (built into Node, no `dotenv` package) |
| Documented list of settings | the JSON files themselves | `node-app/.env.example` (committed, no secrets) |
| Server | environment variables from `/opt/planszowkarz/planszowkarz.env` (systemd) | the same mechanism |
| Typed access | `IOptions<EmailSettings>` / `Configuration["Bgg:Token"]` | the `Config` object returned by `loadConfig()` |
| Environment name | `ASPNETCORE_ENVIRONMENT` / `IsDevelopment()` | `NODE_ENV` (`development` / `production` / `test`) |

## Validate once, at startup

```ts
// src/config.ts (shortened)
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const port = Number(env.PORT ?? '5180');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be a whole number from 1 to 65535 (got "${env.PORT}").`);
  }
  // … every other setting …
  if (problems.length > 0) throw new ConfigError(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  return { environment, host, port, databasePath, logLevel };
}
```

The rest of the app never touches `process.env`; it gets a typed `Config`. A typo like `PORT=50a0` stops the app
at once with a message listing *all* problems, instead of failing later. .NET does the same with
`services.AddOptions<T>().ValidateDataAnnotations().ValidateOnStart()`, which our .NET app didn't use – the
`Bgg:Token` and `Email` settings were checked where they were read.

Because `loadConfig` takes the environment as a parameter, tests pass a plain object (`test/config.test.ts`)
instead of changing real environment variables.

## Order of precedence

`node --env-file-if-exists=.env` does **not** overwrite variables that are already set. So a value set in the real
environment (the server's systemd file, or `"env"` in `.claude/launch.json` for the preview) beats `.env`, which
beats the defaults in `config.ts` – the same "later source wins, environment wins" idea as .NET's configuration
layering.

## Could this be used with .NET?

Environment variables, yes: .NET reads them too (`Email__Host` for `Email:Host`). `.env` files aren't built into .NET,
but user-secrets solve the same problem there.

## Pitfalls

- Everything in `process.env` is a **string**: `"false"` is truthy. Always parse (`Number(...)`, compare to
  `'true'`), never use the raw value as a boolean.
- `.env` must stay out of git (`node-app/.gitignore`); `.env.example` is the template.
- `--env-file` (without `-if-exists`) fails when the file is missing – fine locally, wrong on the server, where the
  values come from systemd. Hence `--env-file-if-exists` in the scripts and plain `node src/server.ts` for `npm start`.

## Official docs

- Node, `--env-file`: https://nodejs.org/api/cli.html#--env-fileconfig
- `process.env`: https://nodejs.org/api/process.html#processenv
- ASP.NET Core configuration (for comparison): https://learn.microsoft.com/aspnet/core/fundamentals/configuration/
