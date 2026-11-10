# npm vs NuGet

*Phase 0. The `package.json` below is a sketch; phase 1 creates the real `node-app/package.json`.*

## What it is and why we need it

**npm** is Node's package manager – the counterpart of NuGet. It downloads libraries other people wrote
(Fastify, Kysely…), records which versions we use, and runs project commands ("scripts"). It's installed together
with Node.

## Side by side: the project file

Today, `Planszowkarz.csproj` says which framework we target and which packages we use:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="MailKit" Version="4.18.2" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.14" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.14" PrivateAssets="all" />
  </ItemGroup>
</Project>
```

In Node, `package.json` does the same job (*sketch*):

```json
{
  "name": "planszowkarz",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "node --env-file=.env --watch src/server.ts",
    "start": "node src/server.ts",
    "check": "tsc --noEmit",
    "test": "node --test \"test/**/*.test.ts\"",
    "migrate": "node --env-file=.env src/db/migrate.ts"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "kysely": "^0.28.0",
    "better-sqlite3": "^12.0.0",
    "nodemailer": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@types/node": "^24.0.0"
  }
}
```

(Version numbers are placeholders; phase 1 installs current ones and the lock file pins them.)

| `.csproj` / .NET | `package.json` / npm | Note |
|---|---|---|
| `<PackageReference>` | `"dependencies"` | Needed at runtime |
| `PrivateAssets="all"` (e.g. EF Design, build-time only) | `"devDependencies"` | Tools for development: TypeScript, test helpers. `npm ci --omit=dev` skips them on the server |
| `<TargetFramework>net10.0` | `"engines": { "node": … }` + `.nvmrc` | npm only *warns* on a wrong version by default |
| `Sdk="Microsoft.NET.Sdk.Web"` | – | No SDK concept; the framework is just another package |
| `<Nullable>enable</Nullable>` etc. | `tsconfig.json` | Compiler settings live in their own file |
| `"type": "module"` | – | Use modern `import`/`export` (ES modules), not the old `require` |

## Where packages live

| | NuGet | npm |
|---|---|---|
| Download location | One shared cache for the whole PC (`%USERPROFILE%\.nuget\packages`) | **A `node_modules/` folder inside each project**, with every package *and all their dependencies* |
| Size | Small per project | Often tens or hundreds of MB; never committed (git-ignored) |
| Dependencies of dependencies | Resolved, usually few | Usually **many** small packages (Fastify brings a few dozen) |
| Exact versions recorded | `packages.lock.json` (opt-in) | **`package-lock.json`**, always created – commit it |
| Restore exactly | `dotnet restore --locked-mode` | **`npm ci`** (deletes `node_modules`, installs exactly the lock file) |

### Version ranges

`"fastify": "^5.0.0"` means "5.0.0 or any newer 5.x" (the caret allows minor and patch updates, not a new major).
NuGet's `Version="4.18.2"` means "4.18.2 or newer" as a minimum. In both worlds the **lock file** is what makes
every machine get the same versions: `npm install` may update the lock file, `npm ci` never does. Rule for us:
`npm ci` on fresh checkouts and in the deploy script, `npm install <pkg>` only when adding a package (after asking).

## Commands side by side

| Task | .NET | Node |
|---|---|---|
| Restore packages | `dotnet restore` | `npm ci` (or `npm install`) |
| Add a package | `dotnet add package MailKit` | `npm install nodemailer` (`-D` for dev only) |
| Remove a package | `dotnet remove package X` | `npm uninstall x` |
| Build / type-check | `dotnet build` | `npm run check` (our script → `tsc --noEmit`) |
| Run | `dotnet run` / `dotnet watch` | `npm start` / `npm run dev` (Node's `--watch` restarts on change) |
| Test | `dotnet test Planszowkarz.Tests` | `npm test` |
| Migrations | `dotnet ef migrations add X`, `dotnet ef database update` | `npm run migrate` (our script; migrations are hand-written files) |
| Run a tool once | `dotnet tool run` / `dnx` | `npx <tool>` |
| Outdated / vulnerable packages | `dotnet list package --outdated` / `--vulnerable` | `npm outdated` / `npm audit` |

`npm run <name>` runs whatever command is written in `"scripts"`, with `node_modules/.bin` on the PATH – so the
project documents its own commands. .NET has no exact equivalent; the closest is the fixed set of `dotnet` verbs.

## Native packages (relevant for better-sqlite3)

Most npm packages are pure JavaScript. A few contain compiled C/C++ code – **better-sqlite3** is one (SQLite itself
is C). Its install step downloads a **prebuilt binary for your OS and Node version**; only if none exists does it
try to compile (which needs build tools). That's why the binary on the Windows PC differs from the one Mikrus
(Linux) needs, and why the deploy script must handle it (proposal, section 3b). NuGet solves the same problem
with "runtime-specific assets" (`runtimes/linux-x64/native/…` inside the package – that's how
`Microsoft.Data.Sqlite` ships SQLite for Linux in today's self-contained build).

## Pitfalls

- **Install scripts run code from the internet** on your machine (that's how better-sqlite3 fetches its binary).
  Fewer packages = less risk; this is one reason the proposal prefers Node built-ins where they exist.
- Committing `node_modules/` by accident – it must be in `.gitignore`.
- Running `npm install` on a fresh checkout and getting a modified `package-lock.json` – use `npm ci`.
- Tutorials mixing `require(...)` (CommonJS, old) and `import` (ES modules, ours).

## Could npm be used with .NET?

Not for .NET libraries – those are NuGet packages. But .NET web projects often use npm for **front-end** assets
(Bootstrap, JS libraries, build tools). Our current app doesn't: Bootstrap was copied into `wwwroot/lib/` by the
project template. In the Node app we'll copy Bootstrap's files the same way, into `public/lib/bootstrap/`
(no front-end build), so the browser side stays as simple as today.

## Official docs

- npm docs, `package.json`: https://docs.npmjs.com/cli/configuring-npm/package-json
- `npm ci`: https://docs.npmjs.com/cli/commands/npm-ci
- Semantic versioning ranges: https://docs.npmjs.com/about-semantic-versioning
- NuGet package references (for comparison): https://learn.microsoft.com/nuget/consume-packages/package-references-in-project-files
