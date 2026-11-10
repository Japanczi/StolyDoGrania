# Sessions, cookies, password hashing and CSRF vs ASP.NET Identity

*Phase 2. Files: [`node-app/src/auth/`](../../node-app/src/auth/) – `sessions.ts`, `request-auth.ts`, `csrf.ts`,
`password-hash.ts`, `login-flow.ts`, `seed.ts`; pages in [`src/web/pages/account/`](../../node-app/src/web/pages/account/).*

## What it is and why we need it

HTTP has no memory: every request arrives on its own. To know *who* is clicking, a site gives the browser a
**cookie** after login – a small value the browser sends back with every request to that site. The server
recognises the value and knows the user. Everything else in this note is about doing that safely:

- **Sessions**: what the cookie contains, and how the server looks it up.
- **Password hashing**: storing passwords so a stolen database doesn't reveal them.
- **CSRF**: stopping *other* websites from using your cookie behind your back.

In the .NET app, **ASP.NET Identity** did all of it: `SignInManager`, `UserManager`, cookie authentication, the
antiforgery system, token providers for e-mail links, `PasswordHasher`. We wrote each piece by hand (~600 lines plus
tests), which is the point: every security property is now visible in our code.

## 1. Sessions: a random id in a cookie, a row in the database

```
login form ──▶ checkLogin() ──▶ createSession(): random id ──▶ Set-Cookie: session=<id>; HttpOnly; SameSite=Lax
                                     │
                                     └── INSERT INTO sessions (id_hash = SHA-256(id), user_id, expires_utc, …)

next request ── Cookie: session=<id> ──▶ onRequest hook ──▶ loadSession(): SHA-256(id) → row → user → request.user
```

| | ASP.NET Identity (cookie auth) | Ours |
|---|---|---|
| What the cookie holds | An **encrypted ticket** with your user id and claims (Data Protection keys) – the server stores nothing | A **random id** (32 bytes); the server stores only its SHA-256 hash |
| Log out | Delete the cookie (the ticket stays valid until it expires, unless the security stamp changes) | Delete the row: the id is dead everywhere, at once |
| "Log out other devices" after a password change | Security stamp + periodic revalidation | `deleteUserSessions(db, userId, exceptCurrent)` |
| Role changed by an admin | Takes effect at the next revalidation | Takes effect on the next request: the user row is read every time |
| Lifetime | 14 days, sliding | 14 days, sliding (renewed when less than half is left) |
| "Zapamiętaj mnie" | Persistent cookie | Cookie with `Max-Age`; without it, a session cookie that ends with the browser |

Side by side – logging in. .NET (`Components/Account/Pages/Login.razor`):

```csharp
result = await SignInManager.PasswordSignInAsync(userName, Input.Password, Input.RememberMe, lockoutOnFailure: false);
if (result.Succeeded) { RedirectManager.RedirectTo(ReturnUrl); }
```

Node (`src/web/pages/account/routes.ts`):

```ts
const result = await checkLogin(db, login, password);
switch (result.kind) {
  case 'success': {
    const session = await createSession(db, result.user.id, { persistent, authLevel: 'full' });
    setSessionCookie(reply, config, session.id, persistent);
    return reply.redirect(safeReturnUrl(ReturnUrl), 303);
  }
  // 'invalid', 'locked-out', 'email-not-confirmed' …
}
```

`checkLogin` returns a **discriminated union** (see [typescript-vs-csharp.md](typescript-vs-csharp.md)): the
compiler checks that every outcome is handled, like Identity's `SignInResult` flags but exhaustive.

### Cookie flags, and why each matters

- `HttpOnly` – page JavaScript can't read the cookie, so an XSS bug can't steal it.
- `SameSite=Lax` – the browser doesn't send it with POSTs started by other sites (half of the CSRF defence).
- `Secure` (production) – only over HTTPS.
- `__Host-` name prefix (production) – the browser only accepts the cookie from this exact host over HTTPS. This
  matters on Mikrus: `srv72-30347.wykr.es` shares `wykr.es` with other customers, who could otherwise try to plant
  cookies for the whole domain.

### Ready for 2FA (brief 7.6)

Each session row has an `auth_level`: `'full'` = logged in, `'password'` = password checked, second step missing.
Only `'full'` sessions log you in (tested). Adding 2FA later = `checkLogin` returns a new result kind, the page
creates a `'password'` session and redirects to the code page, which upgrades it to `'full'`. No 2FA code exists yet.

## 2. Password hashing

A **hash** is a one-way function: easy to compute from the password, impossible to reverse. We store the hash; at
login we hash the typed password again and compare. A **salt** (random bytes stored next to the hash) makes equal
passwords hash differently, and a deliberately **slow** function makes guessing billions of passwords expensive.

**Old hashes – ASP.NET Identity v3.** Every existing user has one, e.g.
`AQAAAAIAAYagAAAAEK5F…`. Decoded from base64, its first bytes are a header:

| Bytes | Meaning | Our users |
|---|---|---|
| 0 | format marker | `01` = v3 |
| 1–4 | PRF (which HMAC) | `2` = SHA-512 |
| 5–8 | iterations | `100000` |
| 9–12 | salt length | `16` |
| then | salt, then the derived key | |

`verifyIdentityV3` reads those values (it doesn't assume them) and recomputes the key with
`crypto.pbkdf2` from Node's built-in `node:crypto`. The tests use real hashes from a local `app.db` – of the
Development-only test users, whose password ("gracz") is public anyway.

**New hashes – scrypt**, also built into `node:crypto`. Stored as `scrypt$N$r$p$salt$key`, so the cost settings
travel with each hash, like Identity's header. scrypt is *memory-hard* (each guess needs 16 MiB here), which hurts
attackers with graphics cards far more than PBKDF2 does.

**Re-hash on login:** after an old-format password verifies, `checkLogin` stores a new scrypt hash. Users never
notice; after a while every active account has moved over.

**Timing:** for an unknown login we still run one scrypt check against a dummy hash, so the response time doesn't
reveal which user names exist.

## 3. Lockout

5 wrong passwords in a row lock the account for 5 minutes (Identity's defaults). Note: the .NET app called
`PasswordSignInAsync(..., lockoutOnFailure: false)`, so its lockout page existed but was never reached. The Node
app turns it on – recorded in the branch spec as a deliberate change.

## 4. One-time tokens in e-mail links

Confirm e-mail, change e-mail and reset password links carry a `code`. Identity made these with its
DataProtectorTokenProvider (signed data, valid 1 day). Ours: a random token, stored as SHA-256 in `user_tokens`
with a *purpose*, an expiry (1 day) and, for e-mail change, the new address. Using a token deletes it, so a link
works once. A mail scanner that "clicks" a confirmation link before the user does would use the token – so if the
address is already confirmed, the page still says thank you.

## 5. CSRF: why a form needs a hidden token

Imagine you're logged in to Planszówkarz and visit `evil.example`, which contains:

```html
<form action="https://planszowkarz.toadres.pl/Account/Manage/DeletePersonalData" method="post">…</form>
<script>document.forms[0].submit()</script>
```

Your browser would send the request **with your cookie**. That's cross-site request forgery. Blazor/Identity blocked
it with `app.UseAntiforgery()` and `<AntiforgeryToken />`, invisibly. Ours, in `src/auth/csrf.ts` and the hooks in
`request-auth.ts`, has two independent checks on every POST:

1. **Same origin.** Browsers add `Sec-Fetch-Site: cross-site` (or an `Origin` header) to requests started by other
   sites. Those are refused. "same-site" is refused too – a neighbour on `wykr.es` is same-site.
2. **Token.** Every form has `<input type="hidden" name="_csrf" value="…">` equal to our `csrf` cookie. Another site
   can't read our cookies or pages, so it can't fill the field in. The token is **signed** with `APP_SECRET`, so a
   cookie planted by someone else isn't accepted either.

Fastify runs the check in a `preHandler` hook – after the form body is parsed, before any route code. A failed check
answers 403 with a Polish message and the route never runs (tested: no account is created, no session deleted).

## 6. Other details ported from Identity

- **Open redirects:** `?ReturnUrl=https://evil.example` must not send users to another site after login.
  `safeReturnUrl` only allows paths starting with a single `/` (ASP.NET Core's `LocalRedirect` did this).
- **Account probing:** "forgot password" and "resend confirmation" answer the same whether or not the address exists.
- **Flash messages:** "Hasło zostało zmienione." survives the redirect in a short-lived cookie, like Identity's
  `Identity.StatusMessage` cookie.
- **Case-insensitive URLs:** ASP.NET Core matches `/account/login` to `/Account/Login`; Fastify doesn't by default,
  so `routerOptions: { caseSensitive: false }` keeps old links working.

## Could these be used with .NET?

The ideas – yes, they're HTTP and cryptography, not Node. ASP.NET Core can also store sessions server-side
(`ITicketStore`), and scrypt/Argon2 exist as NuGet packages. The code itself is JavaScript-only; in .NET, Identity
is the built-in, well-tested way, and writing this by hand there would be unusual.

## Pitfalls we hit

- `@fastify/cookie` must be registered before anything reads `request.cookies`; the CSRF hook must be a
  `preHandler` (not `onRequest`), because the form body isn't parsed yet at `onRequest`.
- `promisify(crypto.scrypt)` loses the overload with options – `password-hash.ts` wraps it by hand.
- `nodemailer` has no TypeScript types of its own: the `@types/nodemailer` dev package adds them.
- `Max-Age` vs no `Max-Age` is the whole difference between "Zapamiętaj mnie" and a browser-session login.

## Official docs

- OWASP Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Password Storage (scrypt parameters): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP CSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- MDN, cookies (`__Host-`, SameSite): https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies
- Node `crypto.scrypt`: https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback
- ASP.NET Identity password hasher (for comparison): https://learn.microsoft.com/aspnet/core/security/authentication/identity
