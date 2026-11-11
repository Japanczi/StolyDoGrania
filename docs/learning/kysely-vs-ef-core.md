# Data access and migrations: Kysely + better-sqlite3 vs EF Core

*Phase 1. Files: [`node-app/src/db/`](../../node-app/src/db/) – `database.ts`, `schema.ts`, `migrations/`, `migrator.ts`, `migrate.ts`.*

## What it is and why we need it

The app keeps its data in one SQLite file. Two layers sit between our code and that file:

- the **driver** (`better-sqlite3`) opens the file and runs SQL – the role of `Microsoft.Data.Sqlite`;
- the **query builder** (`Kysely`) lets us write queries in TypeScript with column names checked by the compiler –
  the role LINQ plays over EF Core.

What's *missing* compared to EF Core is just as important: **no change tracker, no entities that save themselves,
no lazy loading, no automatic migrations.** Every read and every write is a query we wrote.

## Opening the database

```ts
// src/db/database.ts
const sqlite = new SqliteDatabase(path);
sqlite.pragma('journal_mode = WAL');   // readers don't block the writer
sqlite.pragma('foreign_keys = ON');    // SQLite ignores FOREIGN KEY unless told, per connection
sqlite.pragma('busy_timeout = 5000');  // wait for a lock instead of failing at once
return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
```

.NET: `builder.Services.AddDbContext<ApplicationDbContext>(o => o.UseSqlite(connectionString))`. EF Core creates a
`DbContext` **per request** (scoped) and sets pragmas like `foreign_keys` for you. Here there is **one** connection
for the whole app, created at startup and passed to whoever needs it. That fits SQLite (one writer at a time anyway)
and Node (one thread – see [node-basics.md](node-basics.md)).

## The schema in TypeScript

EF Core reads your entity classes (`Data/Table/BoardSettings.cs`) and *derives* the tables. Kysely does the opposite:
the tables are created by migrations, and `src/db/schema.ts` *describes* them so queries can be checked:

```ts
export type BoardSettingsTable = {
  id: number;
  auto_reset_enabled: number;           // SQLite has no boolean: 0/1
  auto_reset_checked_utc: string | null; // no date type either: ISO 8601 text
};
export type Database = { board_settings: BoardSettingsTable };
```

Now `db.selectFrom('board_settings').select('auto_reset_enabld')` (typo) is a compile error, just like a misspelt
property in LINQ. Because `schema.ts` is written by hand, a test (`test/db/migrations.test.ts`) compares it with the
real columns after migrating – the type of `expectedColumns` forces the test to list every column `schema.ts`
declares, and the test checks the database has exactly those.

## Queries: LINQ vs Kysely

The health check (`src/web/health.ts`):

```ts
const settings = await db.selectFrom('board_settings').select('id').executeTakeFirst();
```

LINQ equivalent: `await Db.BoardSettings.AsNoTracking().Select(s => s.Id).FirstOrDefaultAsync();`

| EF Core | Kysely | Note |
|---|---|---|
| `Db.PlayTables.Where(t => t.Id == id)` | `db.selectFrom('play_tables').where('id', '=', id)` | Reads like the SQL it produces |
| `.AsNoTracking()` | – | Nothing is ever tracked, so there's nothing to switch off |
| `.Include(t => t.Participants)` | a second query or a join | You decide how related rows are loaded (phase 3) |
| `Db.Add(x); await Db.SaveChangesAsync()` | `await db.insertInto('…').values({…}).execute()` | The write happens *now*, not at "save" |
| `Db.ChangeTracker.Clear()` before reloading | – | No cache of loaded objects: every read is fresh |
| `BeginTransactionAsync()` | `db.transaction().execute(async trx => …)` | Same idea |
| `DbUpdateException` | `SqliteError` with a `code` like `SQLITE_CONSTRAINT_UNIQUE` | Mapped to Polish messages in routes |

The CLAUDE.md rules `AsNoTracking()` and `ChangeTracker.Clear()` from the .NET app simply don't exist here – they
were workarounds for EF Core remembering objects; Kysely never remembers anything.

## Migrations

| | EF Core | Our setup |
|---|---|---|
| Create one | `dotnet ef migrations add AddBoardSettings` – EF diffs the model and **generates** C# | Write a numbered file by hand: `src/db/migrations/0001-board-settings.ts` with `up` and `down` |
| List | Found by reflection (attributes in the assembly) | Listed explicitly in `src/db/migrations/index.ts` |
| History table | `__EFMigrationsHistory` | `kysely_migration` (+ `kysely_migration_lock`) |
| Apply | `dotnet ef database update` | `npm run migrate` (`npm run dev` runs it first) |
| At app start | We didn't migrate automatically in .NET either | `server.ts` **refuses to start** if migrations are pending, and says which |

Side by side, the same table. EF (`Migrations/20261107202712_AddBoardSettings.cs`, generated):

```csharp
migrationBuilder.CreateTable(name: "BoardSettings", columns: table => new
{
    Id = table.Column<int>(type: "INTEGER", nullable: false),
    AutoResetEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
    AutoResetCheckedUtc = table.Column<DateTime>(type: "TEXT", nullable: true)
}, constraints: table => table.PrimaryKey("PK_BoardSettings", x => x.Id));
migrationBuilder.InsertData(table: "BoardSettings", columns: new[] { "Id", "AutoResetCheckedUtc", "AutoResetEnabled" },
    values: new object[] { 1, null, false });
```

Kysely (hand-written):

```ts
await db.schema.createTable('board_settings')
  .addColumn('id', 'integer', col => col.primaryKey().check(sql`id = 1`))
  .addColumn('auto_reset_enabled', 'integer', col => col.notNull().defaultTo(0).check(sql`auto_reset_enabled in (0, 1)`))
  .addColumn('auto_reset_checked_utc', 'text')
  .execute();
await sql`insert into board_settings (id, auto_reset_enabled) values (1, 0)`.execute(db);
```

Note the `CHECK` constraints: the database itself now refuses a second settings row or a "boolean" of 7 – rules
EF Core kept only in C#. Migrations take `Kysely<unknown>`, not `Kysely<Database>`, because a migration must keep
compiling after `schema.ts` changes in later phases.

## The driver is synchronous – on purpose

`better-sqlite3` runs each query to completion before returning – it **blocks the event loop** for that time. For a
local SQLite file and small queries that's microseconds, and it's faster than an async driver (no thread hand-off).
Kysely's API is still `async` (`await … .execute()`) so the code would look the same with an async database.

## Could these be used with .NET?

No – both are JavaScript libraries. .NET's counterparts: EF Core (what we had), Dapper (hand-written SQL mapped to
objects), SqlKata (a query builder much like Kysely). Migrations as hand-written numbered files exist in .NET too
(FluentMigrator, DbUp).

## Pitfalls we hit

- Kysely 0.29 moved the `Migrator` to a separate entry point: `import { Migrator } from 'kysely/migration'`
  (importing it from `'kysely'` gives a type error that says exactly that).
- `better-sqlite3` 13 bundles its native binaries for Windows, Linux and macOS inside the package, so its
  `node-gyp rebuild` install script isn't needed. npm 11 asks before running install scripts; we denied it
  (`"allowScripts": { "better-sqlite3": false }` in `package.json`). This also solves the "Linux binary when
  building on Windows" question from the proposal.

## Official docs

- Kysely: https://kysely.dev/docs/intro – migrations: https://kysely.dev/docs/migrations
- better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- SQLite pragmas: https://www.sqlite.org/pragma.html – WAL: https://www.sqlite.org/wal.html
- EF Core migrations (for comparison): https://learn.microsoft.com/ef/core/managing-schemas/migrations/
