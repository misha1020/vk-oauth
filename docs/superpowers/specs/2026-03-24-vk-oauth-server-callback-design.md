# VK OAuth Server-Side Callback — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Context:** Replaces the original client-side OAuth flow (Approach A from initial spec). VK requires HTTPS redirect URIs for Standalone apps, and Android app type blocks web-based OAuth entirely. This design routes the callback through the Express server instead.

> **Future migration:** Once this flow is working, the plan is to migrate from legacy `oauth.vk.com` to VK ID OAuth 2.1 (`id.vk.com`) with PKCE. This design is a working stepping stone, not the final state.

---

## Architecture

```
App                          Server                        VK
 │                              │                            │
 │  openAuthSessionAsync        │                            │
 │──────────────────────────────────────────────────────────▶│
 │  redirect_uri=               │                            │
 │  https://mz.ludentes.ru/     │                            │
 │  auth/vk/callback            │                            │
 │                              │                            │
 │                              │◀──── GET /auth/vk/callback │
 │                              │        ?code=xxx           │
 │                              │                            │
 │                              │  exchangeCode()            │
 │                              │  fetchUserProfile()        │
 │                              │  createUser()              │
 │                              │  sign JWT                  │
 │                              │                            │
 │◀─── 302 vkoauth://auth/success?token=JWT                  │
 │                              │                            │
 │  SecureStore.setItem(token)  │                            │
 │  GET /auth/me ──────────────▶│                            │
 │◀─── { user } ────────────────│                            │
 │  navigate /home              │                            │
```

---

## VK Developer Console Setup

- App type: **Standalone** (changed from Android)
- Registered redirect URI: `https://mz.ludentes.ru/auth/vk/callback`

---

## Server Changes

### New endpoint: `GET /auth/vk/callback`

Receives VK's redirect after authentication.

**Request (from VK):** `GET /auth/vk/callback?code=xxx` or `?error=xxx&error_description=yyy`

**Success flow:**
1. Call `exchangeCode({ code, redirectUri: SERVER_URL + '/auth/vk/callback', ... })`
2. Call `fetchUserProfile(accessToken)`
3. `createUser(profile)`
4. Sign JWT (7d expiry)
5. `302` → `vkoauth://auth/success?token=<JWT>`

**Error flow:**
- VK error param present → `302` → `vkoauth://auth/error?message=<encoded>`
- Exchange/profile throws → `302` → `vkoauth://auth/error?message=<encoded>`

### Removed: `POST /auth/vk`

No longer needed — server now handles the full exchange in the callback. `GET /auth/me` remains unchanged.

### New env var: `SERVER_URL`

```
SERVER_URL=https://mz.ludentes.ru
```

Used to construct the `redirect_uri` passed to `exchangeCode`.

---

## App Changes

### `useVKAuth.ts` — rewritten

Drops `expo-auth-session` entirely. Uses `WebBrowser.openAuthSessionAsync` directly.

```
openAuthSessionAsync(
  vkAuthUrl,   // https://oauth.vk.com/authorize?...&redirect_uri=SERVER_URL/auth/vk/callback
  'vkoauth://' // watch for this scheme to close the browser
)
```

- On `vkoauth://auth/success?token=xxx` → calls `onSuccess({ token })`
- On `vkoauth://auth/error?message=xxx` → calls `onError(message)`
- Browser dismissed without redirect → no-op

### `useAuth.ts`

`login` accepts `{ token: string }` instead of `{ code, redirectUri }`:
1. `SecureStore.setItemAsync(TOKEN_KEY, token)`
2. `GET /auth/me` to verify and get user object
3. Set `isLoggedIn: true`, `user`

On error: delete token from SecureStore, set `error` message.

### `api.ts`

- Remove `loginWithVK` (no longer called)
- `getMe` unchanged

### `config.ts`

```ts
export const API_URL = 'https://mz.ludentes.ru';
```

---

## Deployment

- Fresh server at `mz.ludentes.ru`
- Docker container exposed on port **5173**
- `.env` on server with real credentials:
  ```
  VK_APP_ID=54501952
  VK_APP_SECRET=neJqXQfaR9PBh68sYr9k
  JWT_SECRET=<random>
  PORT=5173
  SERVER_URL=https://mz.ludentes.ru
  ```
- No nginx needed for now — container listens directly on 5173

---

## Error Handling

| Scenario | Server action | App result |
|---|---|---|
| VK returns `error` in callback | Redirect to `vkoauth://auth/error?message=xxx` | Error shown on login screen |
| `exchangeCode` throws | Redirect to `vkoauth://auth/error?message=xxx` | Error shown on login screen |
| `fetchUserProfile` throws | Redirect to `vkoauth://auth/error?message=xxx` | Error shown on login screen |
| `GET /auth/me` fails after token received | Token deleted from SecureStore | Stay on login, show error |
| Browser dismissed (user cancels) | — | No-op, stay on login screen |

---

## Security Notes

- `client_secret` never leaves the server
- JWT briefly appears in the deep link URL — acceptable for a test project
- No PKCE (legacy `oauth.vk.com` doesn't support it) — mitigated by server-side exchange
- **Planned:** Migrate to VK ID OAuth 2.1 (`id.vk.com`) with PKCE after this flow is confirmed working
