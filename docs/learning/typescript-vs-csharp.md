# TypeScript vs C#

*Phase 0. TypeScript code in this note is a sketch until phase 1 writes the real files.*

## What it is and why we need it

**JavaScript** is the only language Node and browsers run. It has no type checking: `table.maxPlayer` (typo)
is simply `undefined` at runtime, and you find out when a user clicks. **TypeScript** is JavaScript plus type
annotations, checked by a compiler (`tsc`) *before* running – the safety you're used to from C#.

The key difference from C#: **TypeScript's types exist only while checking. At runtime they are gone.**
C# compiles to IL that still knows every type (that's why reflection, `is`, `typeof(T)`, model binding and EF Core
work). TypeScript is turned into plain JavaScript by *deleting* the types; nothing of them is left to inspect.

## How our `.ts` files run (decision 10.1 in the proposal)

| Step | .NET | Node (our setup) |
|---|---|---|
| Check types | `dotnet build` (compiler) | `npm run check` → `tsc --noEmit` (checks, writes nothing) |
| Produce runnable code | `dotnet build` writes `.dll` files | Nothing to produce: Node **strips the types** from each `.ts` file as it loads it |
| Run | `dotnet run` | `node src/server.ts` |

"Type stripping" literally replaces the annotations with spaces and runs what's left. That's why only TS syntax
that can be *deleted* is allowed: no `enum` (it generates an object), no `namespace`, no constructor parameter
properties (`constructor(private db: Db)` – C#'s primary constructors look like this, but in TS they generate
code). `tsconfig.json` enforces this with `"erasableSyntaxOnly": true`.

Pitfall: Node runs a file **even if it has type errors** – it doesn't check, it only strips. So `npm run check`
must pass before tests and before every commit.

## Side by side: `PlayTable.TryTakeSlot`

Today (`Data/Table/PlayTable.cs`, shortened):

```csharp
public bool TryTakeSlot(int slot, string participantName, string userId, out string? error)
{
    error = null;
    if (slot < 1 || slot > MaxPlayers || IsSlotTaken(slot))
    {
        error = "Nie można zająć tego miejsca.";
        return false;
    }
    if (Participants.Any(p => p.UserId == userId))
    {
        error = "Masz już miejsce przy tym stole.";
        return false;
    }
    // ...
    Participants.Add(new TableSlot { SlotNumber = slot, ParticipantName = participantName.Trim(), UserId = userId });
    return true;
}
```

TypeScript (*sketch* of `src/domain/play-table.ts`):

```ts
export type TableSlot = {
  slotNumber: number;
  participantName: string;
  userId: string | null;      // null = a name typed by the owner, not a registered user
  isImported: boolean;
};

export type PlayTable = {
  id: number;
  maxPlayers: number;
  takenSlots: number;
  ownerUserId: string | null;
  participants: TableSlot[];
  // ...
};

export type Result = { ok: true } | { ok: false; error: string };

export function tryTakeSlot(table: PlayTable, slot: number, participantName: string, userId: string): Result {
  if (slot < 1 || slot > table.maxPlayers || isSlotTaken(table, slot)) {
    return { ok: false, error: 'Nie można zająć tego miejsca.' };
  }
  if (table.participants.some(p => p.userId === userId)) {
    return { ok: false, error: 'Masz już miejsce przy tym stole.' };
  }
  // ...
  table.participants.push({ slotNumber: slot, participantName: participantName.trim(), userId, isImported: false });
  return { ok: true };
}
```

What changed and why:

- **No `out` parameters** in JavaScript. Instead the function returns a **union type**: either `{ ok: true }` or
  `{ ok: false, error }`. After `if (!result.ok)`, TypeScript *knows* `result.error` exists – this is called
  *narrowing*, and it replaces C#'s `[NotNullWhen(true)] out` attributes with something the compiler checks.
- **Plain data + functions instead of a class with methods.** Rows come from the database as plain objects
  (there is no EF to create `PlayTable` instances), so rules are functions that take the table. A class would
  also work; plain objects keep "what's stored" and "what the rules do" visibly separate.
- **LINQ → array methods:** `Any` → `some`, `All` → `every`, `Where` → `filter`, `Select` → `map`,
  `FirstOrDefault` → `find` (returns `undefined`, not `null`), `OrderBy` → `toSorted((a, b) => a.x - b.x)`,
  `Count()` → `.length`. They run immediately on arrays (no deferred execution like `IEnumerable`, and no
  translation to SQL like `IQueryable`).
- **`===` instead of `==`.** JavaScript's `==` converts types (`'1' == 1` is true); always use `===`.

## Types: the main differences

| Topic | C# | TypeScript |
|---|---|---|
| Type system | **Nominal**: `PlayTable` is a `PlayTable` because it was declared/constructed as one | **Structural**: any object with the right shape fits the type, whatever created it |
| At runtime | Types exist (reflection, `is`, `GetType()`) | **Gone.** `x is PlayTable` is impossible; you check fields (`'maxPlayers' in x`) |
| Numbers | `int`, `long`, `decimal`, `double` … | **One `number`** (a 64-bit double); `bigint` for huge integers |
| Missing values | `null` (+ nullable reference types as warnings) | **`null` and `undefined`**; with `strict` on, using a possibly-missing value is an **error** |
| Enums | `enum TableKind { Small, Large }` | Union of strings: `type TableKind = 'small' \| 'large'` |
| Records | `record BggSearchResult(int Id, string Name, int? Year)` | `type BggSearchResult = { id: number; name: string; year: number \| null }` |
| Dates | `DateTime`, `DateOnly`, `TimeOnly`, `TimeZoneInfo` | `Date` (a UTC instant only), `Intl` for time zones; no `TimeOnly` – we store the hour as `"HH:MM"` or minutes |
| Overloads | Several methods with one name | Not really; use optional parameters or unions |
| Exceptions | Typed `catch (DbUpdateException)` | `catch (err)` – `err` is `unknown`; check what it is yourself |
| Non-null assertion | `null!` | `value!` – same idea, same rule in CLAUDE.md: avoid unless justified |

### `null` vs `undefined`

JavaScript has two "nothing" values. `undefined` = "never set" (missing property, missing argument, `find()`
found nothing). `null` = "deliberately empty". C# has only `null`. Our rule (CLAUDE.md draft): **our own types use
`null`** (it matches SQL `NULL`), `undefined` only at the edges (optional parameters, a form field that wasn't
sent). `x ?? y` and `x?.y` work as in C#, and treat both `null` and `undefined` as missing.

### Types vanish → input must be validated by hand

ASP.NET Core model binding and `[Required]`/`[Range]` check form data for you, using runtime types. In Node a
posted form arrives as strings in an object TypeScript knows nothing about (`unknown`). Writing
`request.body as { slot: number }` *tells* the compiler a lie it can't check – the browser may send `"abc"`.
So every route validates its input (Fastify's JSON Schema per route, or a small parse function) before it reaches
`domain/`. This is the most important habit change from C#.

## Pitfalls that will bite us (known in advance)

- **`decimal` doesn't exist.** BGG weight `2.0488` is a C# `decimal`, which EF Core stores in SQLite as **TEXT**
  (see `Migrations/ApplicationDbContextModelSnapshot.cs`, `Difficulty` → `HasColumnType("TEXT")`). The brief says
  to show it exactly as BGG gives it, so we keep it as a **string** in TS rather than risk float rounding.
- **`DateTime` is stored as TEXT too** (`Start`), in .NET's format; the migration script must parse it.
- `Array.prototype.sort` sorts **as strings** by default: `[10, 9, 1].sort()` → `[1, 10, 9]`. Always pass a compare
  function, or use `toSorted`.
- `typeof null === 'object'` (a famous historical bug).

## Could TypeScript be used with .NET?

Not for server code – C# is .NET's typed language. But TypeScript is widely used *alongside* .NET for browser
code (an ASP.NET Core app with TS in `wwwroot`, compiled by `tsc` or a bundler). In our Node app the browser code
stays plain JS checked with `// @ts-check` and JSDoc comments – TypeScript's checker without a build step.

## Official docs

- TypeScript handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- TypeScript for C# programmers (the handbook's own comparison):
  https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes-oop.html
- Narrowing (how `if (!result.ok)` works): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- Node's built-in TypeScript support: https://nodejs.org/api/typescript.html
