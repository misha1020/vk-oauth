# VK ID Android Auth Without SDK — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Replaces:** `2026-03-24-vk-oauth-server-callback-design.md`

---

## Context

VK's documentation for Android auth without SDK (`id.vk.ru`) describes a native deep link approach:
- Redirect URI is `vk{APP_ID}://vk.ru/blank.html` — a native Android deep link, not HTTPS
- VK automatically whitelists `vk{APP_ID}://vk.ru` for Android apps — no Standalone app type required
- Token exchange uses `id.vk.ru/oauth2/auth` (POST, PKCE, no `client_secret` required)
- Previous approach used `id.vk.com` (wrong domain) and server-side redirect (unnecessary complexity)

---

## Architecture

```
App                           VK                   Server
 │                              │                      │
 │  Generate:                   │                      │
 │    code_verifier (random)    │                      │
 │    code_challenge (SHA-256)  │                      │
 │    state (random)            │                      │
 │                              │                      │
 │  WebBrowser.openAuthSessionAsync                    │
 │  → id.vk.ru/authorize        │                      │
 │    client_id=54501952        │                      │
 │    redirect_uri=             │                      │
 │      vk54501952://vk.ru/     │                      │
 │      blank.html?oauth2_params│                      │
 │    code_challenge=...        │                      │
 │    state=...                 │                      │
 │    response_type=code        │                      │
 │──────────────────────────────►                      │
 │                              │                      │
 │◄── vk54501952://vk.ru?───────│                      │
 │      code=...                │                      │
 │      state=...               │                      │
 │      device_id=...           │                      │
 │      type=code_v2            │                      │
 │                              │                      │
 │  Verify state matches        │                      │
 │                              │                      │
 │  POST /auth/vk/exchange ─────────────────────────►  │
 │  { code, codeVerifier,       │  POST id.vk.ru/      │
 │    deviceId }                │  oauth2/auth         │
 │                              │◄─────────────────────│
 │                              │── access_token ─────►│
 │                              │  POST user_info       │
 │                              │  createUser()         │
 │                              │  sign JWT (7d)        │
 │◄── { token } ────────────────────────────────────── │
 │                              │                      │
 │  SecureStore(token)          │                      │
 │  GET /auth/me ───────────────────────────────────►  │
 │◄── { user } ─────────────────────────────────────── │
 │  navigate /home              │                      │
```

---

## VK Console Setup

- App type: **Android** (unchanged — `vk{APP_ID}://vk.ru` is automatically whitelisted)
- No redirect URI registration needed

---

## Server Changes

### New endpoint: `POST /auth/vk/exchange`

Replaces `GET /auth/vk/callback`.

**Request body:**
```json
{ "code": "...", "codeVerifier": "...", "deviceId": "..." }
```

**Success flow:**
1. Validate `code`, `codeVerifier`, `deviceId` present — else 400
2. `exchangeCode({ code, codeVerifier, deviceId, redirectUri: 'vk54501952://vk.ru/blank.html', clientId })`
3. `fetchUserProfile(accessToken)`
4. `createUser(profile)`
5. Sign JWT (7d)
6. Return `{ token }`

**Error responses:** JSON `{ error, message }` — 400 for missing fields, 401 for VK rejection, 500 for unexpected errors.

### Removed: `GET /auth/vk/callback`

No longer needed — redirect is handled natively by the Android app.

### `GET /auth/me` — unchanged

### `vk.js` changes

**`exchangeCode`:**
- `POST https://id.vk.ru/oauth2/auth`
- Params: `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `device_id`, `redirect_uri`
- No `client_secret`
- Returns `{ accessToken, userId, idToken }`

**`fetchUserProfile`:**
- `POST https://id.vk.ru/oauth2/user_info`
- Params: `access_token`, `client_id`
- Returns `{ vkId, firstName, lastName }`

---

## App Changes

### `app.json` — intent filter

Add to `android.intentFilters`:
```json
{
  "action": "VIEW",
  "autoVerify": true,
  "data": [{ "scheme": "vk54501952", "host": "vk.ru" }],
  "category": ["BROWSABLE", "DEFAULT"]
}
```

Requires prebuild after this change.

### `useVKAuth.ts` — rewritten

1. Generate `code_verifier` (32 random bytes, base64url)
2. Generate `code_challenge` (`base64url(SHA-256(code_verifier))` via `crypto.subtle`)
3. Generate `state` (random string for CSRF)
4. Build `oauth2_params = base64(scope="email")`
5. Build auth URL: `id.vk.ru/authorize?client_id=...&redirect_uri=vk54501952://vk.ru/blank.html?oauth2_params=...&code_challenge=...&code_challenge_method=S256&state=...&response_type=code`
6. `WebBrowser.openAuthSessionAsync(authUrl, 'vk54501952://')`
7. On `result.type === 'success'`: parse `code`, `device_id`, `state` from URL
8. Verify `state` matches — error if not
9. Call `exchangeVKCode({ code, codeVerifier, deviceId })` from `api.ts`
10. Call `onSuccess({ token })`

Returns: `{ promptAsync, isLoading, isReady: true, error }`

### `api.ts` — add `exchangeVKCode`

```ts
export async function exchangeVKCode(params: {
  code: string;
  codeVerifier: string;
  deviceId: string;
}): Promise<{ token: string }>
// POST /auth/vk/exchange
```

`getMe` unchanged.

### No changes needed

`useAuth.ts`, `login.tsx`, `config.ts` — all unchanged.

---

## Error Handling

| Scenario | Caught by | Result |
|---|---|---|
| User cancels browser | `useVKAuth` (`result.type === 'cancel'/'dismiss'`) | No-op, stay on login |
| State mismatch | `useVKAuth` | Error shown on login screen |
| `POST /auth/vk/exchange` fails | `useVKAuth` | Error shown on login screen |
| VK rejects code | Server returns 401 JSON | App shows error message |
| `GET /auth/me` fails on startup | `useAuth.checkAuth` | Token deleted, stay on login |

---

## Testing

**Server (Jest + supertest):**
- `POST /auth/vk/exchange`: success case, missing fields (400), VK exchange failure (401)
- `GET /auth/me`: valid token, missing token (401)
- `vk.js`: `exchangeCode` POSTs to `id.vk.ru/oauth2/auth`, throws on error; `fetchUserProfile` POSTs to `id.vk.ru/oauth2/user_info`

**App:** No automated tests — verified manually on device after APK rebuild.

---

## Security Notes

- `client_secret` not needed for token exchange (PKCE replaces it) — but kept in `.env` for future use
- `state` verified client-side to prevent CSRF
- `device_id` comes from VK (returned in callback) — used in all subsequent requests
- JWT stored in SecureStore (encrypted)
