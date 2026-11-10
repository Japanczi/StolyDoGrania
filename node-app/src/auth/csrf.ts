// CSRF protection (cross-site request forgery), written by hand. What app.UseAntiforgery() + <AntiforgeryToken />
// did in the .NET app. Two independent checks on every request that changes something (POST etc.):
//
// 1. Same origin: browsers say where a request comes from (Sec-Fetch-Site, Origin). A form on another site
//    posting to us is refused here.
// 2. Token: every form carries a hidden `_csrf` field (fetch calls send an `x-csrf-token` header) that must equal
//    the value in our `csrf` cookie. Another site can't read our cookie, so it can't fill in the field.
//    The token is signed with APP_SECRET, so a cookie planted by a neighbouring subdomain can't be a valid one.
// See docs/learning/sessions-and-passwords.md.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomToken } from './random.ts';

/** A new token: random value + "." + HMAC of it. */
export function createCsrfToken(secret: string): string {
  const value = randomToken();
  return `${value}.${sign(value, secret)}`;
}

/** True when the token was made by createCsrfToken with this secret. */
export function isValidCsrfToken(token: string, secret: string): boolean {
  const [value, signature, extra] = token.split('.');
  if (!value || !signature || extra !== undefined) {
    return false;
  }
  return safeEqual(signature, sign(value, secret));
}

/** The submitted token must match the cookie's token, and the cookie's token must be ours. */
export function csrfTokensMatch(cookieToken: string | undefined, submitted: string | undefined, secret: string): boolean {
  return cookieToken !== undefined && submitted !== undefined
    && isValidCsrfToken(cookieToken, secret) && safeEqual(cookieToken, submitted);
}

/**
 * Same-origin check from the request headers. Modern browsers send Sec-Fetch-Site; older ones at least Origin
 * on POST. Requests with neither (old browsers, tests, curl) are left to the token check.
 * "same-site" is refused too: on a shared domain (srv72-30347.wykr.es) a *neighbour's* subdomain is same-site.
 */
export function isSameOrigin(
  headers: { secFetchSite?: string | undefined; origin?: string | undefined },
  allowedHosts: readonly string[],
): boolean {
  if (headers.secFetchSite !== undefined) {
    return headers.secFetchSite === 'same-origin' || headers.secFetchSite === 'none';
  }
  if (headers.origin !== undefined) {
    try {
      // The request's own Host, or the public address (a proxy in front of the app may change Host).
      return allowedHosts.includes(new URL(headers.origin).host);
    } catch {
      return false;
    }
  }
  return true;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${value}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
