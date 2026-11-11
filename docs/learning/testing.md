# Testing with `node:test` vs xUnit

*Phase 1. Files: [`node-app/test/`](../../node-app/test/) – `helpers.ts`, `config.test.ts`, `db/migrations.test.ts`,
`web/html.test.ts`, `web/app.test.ts`.*

## What it is and why we need it

Automated tests check the app without clicking through it, and cost no AI tokens (the .NET app's rule from
`Resources.txt`: "automate the rest, let the tester only test the diff"). In .NET we used **xUnit** in a separate
project (`Planszowkarz.Tests/`). Node has a test runner **built in**: `node:test`, with assertions from `node:assert`.
No package needed.

Run: `npm test` (= `node --test "test/**/*.test.ts"`). Each `*.test.ts` file runs in its own process.

## Side by side

xUnit (`Planszowkarz.Tests/PlayTableTests.cs`, shape):

```csharp
public class PlayTableTests
{
    [Fact]
    public void TryTakeSlot_RejectsTakenSlot()
    {
        var table = …;
        Assert.False(table.TryTakeSlot(2, "Ola", "u2", out var error));
        Assert.Equal("Nie można zająć tego miejsca.", error);
    }
}
```

`node:test` (`test/web/html.test.ts`):

```ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('html tag', () => {
  test('escapes interpolated text', () => {
    const name = '<script>alert("x")</script>';
    assert.equal(html`<td>${name}</td>`.value, '<td>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</td>');
  });
});
```

| xUnit | `node:test` |
|---|---|
| test class | `describe('…', () => { … })` |
| `[Fact]` method | `test('…', () => { … })` – the name is a sentence |
| `[Theory]` + `[InlineData]` | a `for` loop creating `test(...)` calls (see `app.test.ts` static files) |
| `Assert.Equal(expected, actual)` | `assert.equal(actual, expected)` – **note the order** |
| `Assert.Equivalent` / deep equality | `assert.deepEqual` (strict mode: types must match too) |
| `Assert.Throws<T>` / `ThrowsAsync` | `assert.throws` / `await assert.rejects` |
| `IDisposable` / `IAsyncLifetime` cleanup | `t.after(() => …)` inside the test |
| `dotnet test` | `npm test` |

## HTTP tests without a network: `app.inject()`

ASP.NET Core has `WebApplicationFactory` to run the app in memory. Fastify has `inject()`:

```ts
const { app, close } = await createTestApp();   // fresh in-memory database, migrated
t.after(close);
const res = await app.inject({ method: 'GET', url: '/stoly' });
assert.equal(res.statusCode, 200);
assert.match(res.body, /<title>Zapisy na gry<\/title>/);
```

The request goes through the whole pipeline – hooks, routing, layout, error handlers – but no port is opened.
This is possible because `app.ts` builds the app and `server.ts` (which listens) is separate.

## Databases in tests

Same approach as the .NET tests: a real SQLite database **in memory** (`':memory:'`), so SQL is really executed –
no mocks. `createTestDb()` in `test/helpers.ts` opens one and applies every migration. Each test gets its own, so
tests can't affect each other.

## What phase 1 tests cover (35 tests)

- `html` tag: escaping text and attributes, nesting, arrays, `null`/`false`, numbers, Polish letters, `raw`.
- Config: defaults, reading every variable, all errors reported at once.
- Migrations: pending → applied → nothing pending; `schema.ts` matches the real columns; the settings row exists and
  a second one is refused; every migration rolls back.
- Pages: `/` and `/stoly` render the board in the layout (Polish `lang`, title, logged-out buttons, active menu
  entry); Polish 404; security headers; static files served; files outside `public/` unreachable; the error page
  shows the stack only in development; `/health`.
- Layout: signed-in and admin variants, and that the title and user name are escaped.

(Coincidence: the .NET app also has 35 tests. Those – PlayTable, authorization, sheet import, e-mail format – are
ported in the phases that bring their code.)

## Could `node:test` be used with .NET?

No – it runs JavaScript. xUnit, NUnit and MSTest are the .NET runners.

## Pitfalls

- `assert.equal(actual, expected)` – reversed compared to xUnit; the failure message labels them, so a swap
  makes messages confusing rather than tests wrong.
- Import `node:assert/strict`, not `node:assert`: the non-strict version's `equal` uses `==` (`1 == '1'` passes).
- Forgetting `await` on an async assertion (`assert.rejects`) lets the test finish before the check runs.
- `node:test` doesn't type-check: run `npm run check` too (both run before every commit).

## Official docs

- `node:test`: https://nodejs.org/api/test.html
- `node:assert`: https://nodejs.org/api/assert.html
- Fastify testing guide: https://fastify.dev/docs/latest/Guides/Testing/
- xUnit (for comparison): https://xunit.net/docs/getting-started/v3/getting-started
