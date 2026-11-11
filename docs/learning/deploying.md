# Building and deploying to Mikrus vs `dotnet publish`

*Phase 5. Files: [`deploy.ps1`](../../deploy.ps1), [`deploy/`](../../deploy/) (`server-setup-node.sh`, `convert-env.sh`,
`convert-live-db.sh`, `planszowkarz-node.service`, [`CUTOVER.md`](../../deploy/CUTOVER.md)).*

## What it is and why we need it

"Deploying" = getting the app from the PC onto the server and running it there as a service that starts on boot and
restarts after a crash. Both versions use the same Mikrus server, the same systemd mechanism and the same settings
idea (an environment file, `chmod 600`, never in git). What differs is *what* is copied and what the server needs.

## Side by side

| Step | .NET (`dotnet` branch) | Node (now) |
|---|---|---|
| Build | `dotnet publish -c Release -r linux-x64 --self-contained` → compiled `.dll`s **plus the .NET runtime** | Nothing to compile: copy `src/`, `public/`, `scripts/` + `npm ci --omit=dev` (production packages only) |
| Runtime on the server | None needed (self-contained build carries it) | **Node itself** installed once in `/opt/node` (official build, SHA-256 checked) |
| Native parts | .NET's ICU library for Polish formatting (`libicu74`) | `libatomic1` (Node needs it); better-sqlite3's Linux binary ships inside its npm package |
| Package size | ~100 MB (runtime included) | ~17 MB (app + 97 packages) |
| Start command | `/opt/planszowkarz/app/Planszowkarz` | `/opt/node/bin/node src/server.ts` |
| Settings names | `Bgg__Token`, `Email__Host` (`__` = `:` in .NET config) | `BGG_TOKEN`, `EMAIL_HOST` (converted on the server by `convert-env.sh`, secrets never printed) |
| Database schema | migrations run **at startup** | migrations run **by the deploy script** before the restart; the app refuses to start on an outdated schema |

## The cutover (what happened on 2026-11-11)

1. **Trial beside .NET.** The Node app was installed as a second service on the free port 20347
   (`https://srv72-20347.wykr.es`) while .NET kept serving the public address on 30347.
2. **Live data.** `convert-live-db.sh` took a consistent online backup of the live `app.db` (SQLite's backup API, so
   a write in progress can't produce a half-written copy), then converted that copy with `import-dotnet-db.ts`.
3. **Switch.** Both services stopped; a fresh conversion (so nothing typed meanwhile was lost); Node's `PORT` set to
   30347; .NET disabled (not removed); Node enabled. A few seconds of downtime.
4. **Switching back** is two commands (CUTOVER.md section 3), because the .NET files, service, settings and database
   are all still there.

## Pitfalls we hit (all fixed in the scripts)

- **`libatomic.so.1: cannot open shared object file`**: Node's official Linux build needs a library that minimal
  Ubuntu images lack. The .NET build had the same kind of issue with ICU.
- **Windows' `tar.exe` crashed** packing `node_modules` (access violation). Git for Windows' GNU tar works; it needs
  its own folder on `PATH` (for `gzip`), `--owner=0 --group=0` when packing and `--no-same-owner` when unpacking as
  root.
- **Loading an env file with bash (`. file`) breaks on values with spaces** – e.g. a Gmail app password shown in
  groups of four. systemd's `EnvironmentFile` and Node's `--env-file` read the whole line, so the deploy now uses
  `node --env-file=…`.
- **PowerShell 5.1 + `$ErrorActionPreference = "Stop"`** treats any line a remote command writes to stderr (like
  systemd's "Created symlink …") as a fatal error. Remote commands now send stderr to stdout.

## Could this be used with .NET?

Mostly the same: .NET could also be deployed framework-dependent (runtime installed once on the server, smaller
uploads – like Node), or both could run in containers. The self-contained build is .NET's convenience that Node
doesn't have: Node always needs its runtime on the machine.

## Official docs

- Node downloads and checksums: https://nodejs.org/en/download
- systemd service files: https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
- SQLite online backup: https://www.sqlite.org/backup.html
- `dotnet publish` (for comparison): https://learn.microsoft.com/dotnet/core/tools/dotnet-publish
