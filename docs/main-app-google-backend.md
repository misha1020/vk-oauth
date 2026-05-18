# Google ID-Token Auth — Production Backend Implementation

**Audience:** Backend dev integrating Google Sign-In into the production AM GraphQL service.

**Status:** Spec, ready to implement. Based on the `social-oauth` test app's Google flow, which
was **implemented and verified end-to-end on a physical Android device on 2026-05-18**
(release APK build 4, `users.json` shows a `provider: 'google'` entry from a live login).

**Companion docs:**
- Yandex equivalent (read first if porting both): [`docs/main-app-yandex-jwt-backend.md`](./main-app-yandex-jwt-backend.md).
- Mobile side of this flow: [`docs/main-app-google-mobile.md`](./main-app-google-mobile.md).

**Reference implementation (working, tested):**
- [`server/src/services/google.js`](../server/src/services/google.js) — `verifyGoogleIdToken`
- [`server/src/routes/auth.js`](../server/src/routes/auth.js) — the `/auth/google/exchange-jwt` route
- [`server/tests/services/google.test.js`](../server/tests/services/google.test.js),
  [`server/tests/routes/auth.google-jwt.test.js`](../server/tests/routes/auth.google-jwt.test.js) — tests

The test backend is REST/Express; the production service is GraphQL. The verification logic
translates 1:1 — this doc gives the GraphQL-shaped resolver, the reference files give the
proven version.

---

## 0. The flow at a glance

```
[Mobile] tap "Sign in with Google"
  → [Native module] Credential Manager (Android) / GoogleSignIn (iOS)
    user picks account, consents, gets back an ID token signed RS256
  → [Mobile] result.idToken           (the JWT — payload includes `aud`, `nonce`, `sub`, `email`, …)
  → [GraphQL] socialAuthByJwt(provider:"google", jwt: idToken, nonce: nonce)
  → [Backend] google-auth-library verifies signature + iss + aud + exp against Google's JWKS
              (auto-fetched, auto-cached) → we additionally check nonce + email_verified
  → [Backend] AuthPayload (same shape as VK + Yandex)
  → [Mobile] store tokens, navigate home
```

**Two things make this different from the Yandex JWT flow:**

1. **RS256, not HS256** — Google signs ID tokens with their **private key**; verification uses
   their **public JWKS** at `https://www.googleapis.com/oauth2/v3/certs`. No shared secret. The
   `google-auth-library` fetches and caches the JWKS for you.
2. **Nonce binding** — the mobile client generates a random nonce, sends it both to Google (which
   embeds it verbatim in the ID token) **and** to your backend in the same request body. You
   compare. This is what stops a stolen ID token from being replayed by an attacker (you'd reject
   it because the attacker doesn't know the nonce that paired with that token).

---

## 1. Prerequisites

| Need | Notes |
|---|---|
| **`GOOGLE_WEB_CLIENT_ID`** env var | **The Web client ID from Google Cloud Console** — NOT the Android one and NOT the iOS one. Why Web: the mobile SDKs ask Google for an ID token whose `aud` claim is the Web client ID specifically, so backend verification works the same across platforms. Web client is registered against your Google Cloud project — no SHA-1, no bundle ID, just the OAuth-consent-screen config. |
| `google-auth-library` npm package | Currently v10.x/11.x. Provides `OAuth2Client.verifyIdToken` which does signature + `iss` + `aud` + `exp` validation and auto-caches Google's JWKS on the client instance. |
| Same `AuthPayload` schema VK + Yandex use | This flow upserts the same `{provider, providerId}` user shape, so there's no new client contract beyond the new mutation argument. |

> ⚠️ **You do NOT need a `client_secret`** — RS256 verification is **public-key**, the library
> fetches Google's public keys for you. This is the main operational delta from the Yandex flow.

---

## 2. New / extended GraphQL mutation

The Yandex backend doc says:

> **Provider-generic on purpose.** Google and Apple sign-in also hand the client a JWT
> (`id_token`). They'd land in this same mutation later — *but* their JWTs are **RS256**,
> verified against the provider's **public JWKS**, not HS256 with a shared secret. So the
> mutation signature is generic; the resolver branches per provider.

That's exactly what happens here. Extend `socialAuthByJwt` with an **optional `nonce`** argument:

```graphql
extend type Mutation {
  socialAuthByJwt(
    provider: String!
    jwt: String!
    nonce: String        # required for google; ignored for yandex
  ): AuthPayload!
}
```

- For `provider: "yandex"` — `nonce` is unused, resolver ignores it.
- For `provider: "google"` — `nonce` is **required**; resolver returns `BAD_USER_INPUT` if absent.

If you'd rather not pollute the generic mutation with a Google-specific argument, the alternative
is a dedicated `socialAuthByGoogleIdToken(idToken: String!, nonce: String!)` mutation. The
trade-off is two more mutations on every future provider (Apple, etc.) vs. one shared mutation
with an optional arg. The test app's REST equivalent (`POST /auth/google/exchange-jwt` with
`{ idToken, nonce }`) is a thin wrapper around the dedicated approach; either translation works.
**Recommendation: extend `socialAuthByJwt`** for consistency with the existing Yandex doc.

---

## 3. ID-token verification — the core

### 3.1 The library does most of the work

`google-auth-library`'s `OAuth2Client.verifyIdToken` validates, in this order:

1. JWT format + RS256 signature against Google's JWKS (auto-fetched + cached).
2. `iss` is `accounts.google.com` or `https://accounts.google.com`.
3. `aud` matches the `audience` you pass in.
4. `exp` is in the future.

If any step fails it throws. **What you still own:**

- `aud` is the **Web** client ID (passed to `verifyIdToken`).
- `nonce` matches what the mobile client put in the request body.
- `email_verified === true` — Google ID tokens carry an unverified email field for unverified
  accounts; rejecting them here keeps junk out of the user table.
- Mapping the payload to the canonical profile shape.

### 3.2 Reference implementation (production form)

```javascript
// services/google.js
const { OAuth2Client } = require('google-auth-library');

// SINGLETON — the library caches Google's JWKS on the OAuth2Client INSTANCE
// (certificateCache / certificateExpiry fields). A fresh client per request
// would refetch https://www.googleapis.com/oauth2/v3/certs on every login.
const oauthClient = new OAuth2Client();

async function verifyGoogleIdToken({ idToken, audience, expectedNonce }) {
  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({ idToken, audience });
  } catch (err) {
    throw new Error(`google_id_token_invalid: ${err.message}`);
  }

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('google_id_token_invalid: empty payload');
  }
  if (payload.nonce !== expectedNonce) {
    throw new Error(`google_nonce_mismatch: payload.nonce=${payload.nonce} expected=${expectedNonce}`);
  }
  if (payload.email_verified !== true) {
    throw new Error('google_email_not_verified');
  }
  return payload;
}

module.exports = { verifyGoogleIdToken };
```

**Non-negotiables:**

- **`audience` MUST be the Web client ID.** Not Android, not iOS. The mobile SDK is configured
  to request an ID token with `aud = Web client ID` (see the mobile doc). A mismatch here is the
  most common cause of `google_id_token_invalid: Wrong recipient`.
- **Compare `nonce` exactly.** Don't normalize (no trim, no case-fold) — the mobile client sends
  the *same string* that went into the native SDK call, and Google echoes it verbatim.
- **`email_verified !== true`** — strict, not truthy. Google's claim is a boolean.
- **Re-use the `OAuth2Client` across requests.** Per-call instantiation = JWK cache miss = an
  HTTPS round trip on every login.

> Note on cache invalidation: Google rotates their JWKS roughly daily. `verifyIdToken` honours
> the `Cache-Control` header on Google's certs endpoint and refetches on its own — you don't
> need cron or TTL management.

---

## 4. Claim → profile mapping

A typical Google ID-token payload:

| Claim | Use | Note |
|---|---|---|
| `sub` | `providerId` (stringify) | Google's stable user ID. Always a string, but coerce defensively. |
| `email` | `email` (optional) | Always present for Sign in with Google flows, but technically scope-gated. |
| `email_verified` | gate, not stored | Reject if `!== true`. |
| `given_name` | `firstName` | First name. Unlike Yandex, Google **does** split first/last for you. |
| `family_name` | `lastName` | Family name. |
| `name` | — | Display name. We don't store it because we already have first/last; can fall back if either is missing. |
| `picture` | `avatarId` (optional) | URL string. Stored verbatim — this is a fully-qualified HTTPS URL, unlike Yandex's `avatar_id` which is a CDN slug. |
| `nonce` | checked in §3 | Replay-prevention — see §3 + §9. |
| `iss`, `aud`, `exp`, `iat` | asserted by library | — |

```javascript
function googlePayloadToProfile(payload) {
  return {
    provider: 'google',
    providerId: String(payload.sub),
    firstName: payload.given_name || '',
    lastName: payload.family_name || '',
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.picture ? { avatarId: payload.picture } : {}),
  };
}
```

> ⚠️ **`avatarId` is a URL, not a slug.** Yandex's `avatar_id` is something like `xyz123` (you
> build the URL yourself with `https://avatars.yandex.net/get-yapic/{avatar_id}/islands-200`).
> Google's `picture` is already `https://lh3.googleusercontent.com/a/xyz` — store as-is, do not
> wrap. If your frontend assumes the avatar column needs a URL builder for *all* providers,
> add a per-provider branch.

---

## 5. User upsert + token issuance

Identical to the Yandex flow. Once the profile is in the canonical
`{ provider, providerId, firstName, lastName, email?, avatarId? }` shape, reuse the
`upsertByProvider` + `issueTokens` you already wrote for VK + Yandex. No provider-specific
logic past the resolver branch.

---

## 6. User schema migration ⚠

**Unchanged from [`main-app-yandex-jwt-backend.md §6`](./main-app-yandex-jwt-backend.md#6-user-schema-migration-)** —
if you already migrated for Yandex, Google needs nothing extra (`provider = 'google'` is just
another value in the `provider` TEXT column).

If you haven't migrated yet: do it once, then both providers + future Apple sign-in land in the
same shape.

---

## 7. Resolver wiring (Node / Apollo reference)

```javascript
const { GraphQLError } = require('graphql');
const { verifyYandexJwt } = require('./services/yandex');
const { verifyGoogleIdToken } = require('./services/google');

const resolvers = {
  Mutation: {
    socialAuthByJwt: async (_, { provider, jwt: providerJwt, nonce }, ctx) => {
      let profile;

      if (provider === 'yandex') {
        // (unchanged from main-app-yandex-jwt-backend.md §7)
        const secret = process.env.YANDEX_CLIENT_SECRET;
        if (!secret) {
          throw new GraphQLError('Server misconfigured: YANDEX_CLIENT_SECRET unset', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
        let claims;
        try {
          claims = verifyYandexJwt(providerJwt, secret);
        } catch {
          throw new GraphQLError('Invalid Yandex JWT', {
            extensions: { code: 'UNAUTHENTICATED', reason: 'YANDEX_JWT_INVALID' },
          });
        }
        profile = yandexClaimsToProfile(claims);

      } else if (provider === 'google') {
        if (!nonce) {
          throw new GraphQLError('nonce is required for google', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        const audience = process.env.GOOGLE_WEB_CLIENT_ID;
        if (!audience) {
          throw new GraphQLError('Server misconfigured: GOOGLE_WEB_CLIENT_ID unset', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
        let payload;
        try {
          payload = await verifyGoogleIdToken({
            idToken: providerJwt,
            audience,
            expectedNonce: nonce,
          });
        } catch (err) {
          const msg = err.message || '';
          if (msg.startsWith('google_id_token_invalid')) {
            throw new GraphQLError('Invalid Google ID token', {
              extensions: { code: 'UNAUTHENTICATED', reason: 'GOOGLE_ID_TOKEN_INVALID' },
            });
          }
          if (msg.startsWith('google_nonce_mismatch')) {
            throw new GraphQLError('Nonce mismatch', {
              extensions: { code: 'UNAUTHENTICATED', reason: 'GOOGLE_NONCE_MISMATCH' },
            });
          }
          if (msg.startsWith('google_email_not_verified')) {
            throw new GraphQLError('Email not verified', {
              extensions: { code: 'FORBIDDEN', reason: 'GOOGLE_EMAIL_NOT_VERIFIED' },
            });
          }
          throw new GraphQLError('Google sign-in failed', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
        profile = googlePayloadToProfile(payload);

      } else {
        throw new GraphQLError(`Unsupported provider for JWT auth: ${provider}`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const user   = await ctx.users.upsertByProvider(profile);
      const tokens = await ctx.auth.issueTokens(user);
      return { success: true, user, tokens };
    },
  },
};
```

---

## 8. Error mapping

| Situation | GraphQL error |
|---|---|
| `jwt` or (for google) `nonce` arg empty / missing | `BAD_USER_INPUT` |
| `GOOGLE_WEB_CLIENT_ID` unset on server | `INTERNAL_SERVER_ERROR` (reason `SERVER_MISCONFIGURED`) |
| Signature / `aud` / `iss` / `exp` check fails | `UNAUTHENTICATED`, reason `GOOGLE_ID_TOKEN_INVALID` |
| `payload.nonce !== expectedNonce` | `UNAUTHENTICATED`, reason `GOOGLE_NONCE_MISMATCH` |
| `payload.email_verified !== true` | `FORBIDDEN`, reason `GOOGLE_EMAIL_NOT_VERIFIED` |
| `provider` not in `{vk, yandex, google}` | `BAD_USER_INPUT` |
| Upsert / token-issuance failure | `INTERNAL_SERVER_ERROR` — same as VK + Yandex paths |

Don't echo raw library messages to clients (they can leak Google's internal timing — e.g.
`Token used too late, 1234 > 1230`). Log them server-side; return the coded reason only.

**Never log the raw `idToken`** — anyone with it can impersonate the user against your backend
until it expires (typically 1 hour for Google's). The `nonce` is fine to log (it's
single-use anyway).

---

## 9. Security notes & hardening

- **Nonce is the replay defense.** Unlike the Yandex JWT (~1-year `exp` window), a Google ID
  token only lives ~1 hour, but during that hour anyone with the token could replay it. The
  nonce check makes the token usable exactly once with the request that paired with it. Don't
  skip this check — it's the design's main security win over a naive verifier.

- **Optional: track used nonces.** If you want defense-in-depth, store `{nonce, used_at}` in a
  short-lived table (TTL ~5 min) and reject any nonce seen before. The mobile client generates
  a fresh nonce per attempt (`Crypto.randomUUID()`), so collisions are practically zero.
  Without this, a single replay of the same `{idToken, nonce}` pair within an hour would
  succeed twice; the user-facing impact is small (a duplicate session for the same user) but it
  closes a real window.

- **`aud` must be the Web client ID.** A token issued for another OAuth client (e.g. a
  malicious app that registered its own Android client with your bundle ID and SHA) would have
  a different `aud` and fail verification. Don't accept multiple audiences "to be flexible" —
  this is the primary client-identity check.

- **HTTPS only.** Like Yandex's JWT, the Google ID token is a bearer credential in transit. The
  test app's cleartext HTTP to a LAN dev server is dev-only.

- **`email_verified` matters.** Google allows unverified `@gmail.com`-style accounts in some
  edge cases (account recovery in progress, etc.). Rejecting `email_verified !== true` prevents
  account-merge attacks via an unverified email that matches an existing verified user.

- **Don't trust the `email` claim as a primary key.** Always upsert by `(provider, providerId)`,
  never by `email`. A Google user could change their primary email; `sub` is the only stable
  identifier.

- **Strip any `_debug` echo** from the response shape (the test route returns just `{ token }`;
  keep it that way in production).

---

## 10. What you do NOT need

- ❌ **No `client_secret`** — RS256 is public-key, the library fetches Google's public keys.
- ❌ **No call to `https://www.googleapis.com/oauth2/v3/tokeninfo`** — that's the legacy
  remote-validation endpoint. `verifyIdToken` does it locally. No latency on the critical path.
- ❌ **No JWKS-refresh cron** — the library handles cache + rotation via `Cache-Control`.
- ❌ **No PKCE** — that's VK's code flow.
- ❌ **No Android / iOS client IDs in the backend** — they're never sent to the server.
- ❌ **No support for One Tap / bottom-sheet credentials** at the backend level — the verifier
  doesn't care which UI surfaced the ID token, only that it verifies.

---

## 11. Test plan

**Unit** — port [`server/tests/services/google.test.js`](../server/tests/services/google.test.js).
Mock `OAuth2Client.verifyIdToken` (the test app uses `jest.mock('google-auth-library', ...)`).
Coverage: happy → normalized profile; nonce mismatch → throws `google_nonce_mismatch`;
`email_verified: false` → throws `google_email_not_verified`; library error → wrapped as
`google_id_token_invalid`.

**Resolver** — port [`server/tests/routes/auth.google-jwt.test.js`](../server/tests/routes/auth.google-jwt.test.js).
Mock `verifyGoogleIdToken`, exercise:
- `BAD_USER_INPUT` (empty `jwt` / empty `nonce`)
- `SERVER_MISCONFIGURED` (no `GOOGLE_WEB_CLIENT_ID`)
- `UNAUTHENTICATED/GOOGLE_ID_TOKEN_INVALID`
- `UNAUTHENTICATED/GOOGLE_NONCE_MISMATCH`
- `FORBIDDEN/GOOGLE_EMAIL_NOT_VERIFIED`
- happy path → tokens returned, user upserted
- dedupe → two logins → one user row

**Manual end-to-end** — three GraphQL calls before mobile is wired:

```bash
# 1. Missing nonce → BAD_USER_INPUT
curl -X POST $API_URL/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation { socialAuthByJwt(provider:\"google\", jwt:\"x.y.z\") { success } }"}'

# 2. Garbage token → UNAUTHENTICATED / GOOGLE_ID_TOKEN_INVALID
curl -X POST $API_URL/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation { socialAuthByJwt(provider:\"google\", jwt:\"not.a.real.jwt\", nonce:\"nonce-1\") { success } }"}'

# 3. Real token (grab one from the mobile dev build's logs — the hook can log result.idToken)
#    Send the SAME nonce the mobile sent natively, otherwise GOOGLE_NONCE_MISMATCH.
curl -X POST $API_URL/graphql -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation { socialAuthByJwt(provider:\\\"google\\\", jwt:\\\"$REAL_TOKEN\\\", nonce:\\\"$REAL_NONCE\\\") { success user { id } tokens { accessToken } } }\"}"
# → success: true, user.id present
```

Then: mobile dev build → real device → "Sign in with Google" → expect navigation to home.

---

## 12. Delta from `main-app-yandex-jwt-backend.md`

| Yandex JWT (HS256) | Google ID token (RS256) |
|---|---|
| Algorithm: **HS256** (symmetric) | Algorithm: **RS256** (asymmetric) |
| Key: `client_secret` as UTF-8 string | Key: Google's public JWKS (library auto-fetches) |
| Library: `jsonwebtoken` | Library: `google-auth-library` |
| Env: `YANDEX_CLIENT_SECRET` | Env: `GOOGLE_WEB_CLIENT_ID` |
| `iss` = `login.yandex.ru` | `iss` = `accounts.google.com` (library asserts) |
| `aud` not checked (no `aud` claim in Yandex JWT) | `aud` = Web client ID (library asserts) |
| `exp` ~1 year — replay window is the main weakness | `exp` ~1 hour — short window, but **nonce** is the replay defense |
| `name` is one field → split on whitespace | `given_name` + `family_name` are separate |
| `avatar_id` is a CDN slug → build URL client-side | `picture` is a full URL → store verbatim |
| Mutation: `socialAuthByJwt(provider, jwt)` | Mutation: `socialAuthByJwt(provider, jwt, nonce)` — extend the existing one |
| Error codes: `YANDEX_JWT_INVALID` | Error codes: `GOOGLE_ID_TOKEN_INVALID`, `GOOGLE_NONCE_MISMATCH`, `GOOGLE_EMAIL_NOT_VERIFIED` |

User schema, upsert path, AuthPayload shape, and token issuance are **all identical**.

---

## 13. References

- Mobile side: [`docs/main-app-google-mobile.md`](./main-app-google-mobile.md)
- Working reference backend: [`server/src/services/google.js`](../server/src/services/google.js),
  [`server/src/routes/auth.js`](../server/src/routes/auth.js)
- Design + plan (history): [`docs/google/2026-05-15-design.md`](./google/2026-05-15-design.md),
  [`docs/google/2026-05-18-plan.md`](./google/2026-05-18-plan.md)
- `google-auth-library`: https://github.com/googleapis/google-auth-library-nodejs
- Google Identity — Verify the ID token on your server:
  https://developers.google.com/identity/sign-in/web/backend-auth
- Google Cloud Console (where Web/Android/iOS client IDs are minted):
  https://console.cloud.google.com/apis/credentials

If this doc ever conflicts with the reference `server/` code at runtime, **trust the `server/`
code** — it's the artifact verified against a real Google ID token on 2026-05-18.
