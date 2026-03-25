# VK ID Android Auth With SDK — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Context

The existing `/app` implements VK auth **without** the VK ID SDK — it opens `id.vk.ru/authorize` in a Chrome Custom Tab, catches the redirect via deep link, and exchanges the code on the backend. This works but has limitations (one-tap modal can't be suppressed, `openAuthSessionAsync` doesn't reliably intercept redirects on Android, Cloudflare blocks React Native fetch).

This spec describes a **second Expo app** (`/app-sdk`) that uses the **VK ID SDK** for Android. The SDK handles the auth UI natively (WebView, session management, one-tap), providing a more reliable auth flow. The app uses **backend token exchange** per VK's recommendation — the app generates PKCE, passes `code_challenge` to the SDK, receives `code + device_id` in the callback, and sends `code + code_verifier + device_id` to our backend for exchange.

Both apps share the same `/server` backend.

---

## Architecture

```
app-sdk (Expo + TypeScript)          server/ (existing, shared)
┌──────────────────────────┐         ┌──────────────────────────┐
│  useVKSDKAuth hook (TS)  │         │  POST /auth/vk/exchange  │
│    1. Generate PKCE      │         │  {code, code_verifier,   │
│       (expo-crypto)      │         │   device_id}             │
│    2. Call native module │         │                          │
│                          │         │  → id.vk.ru/oauth2/auth  │
│  ExpoVKSDKModule.kt     │         │    (PKCE exchange)       │
│    3. VKID.authorize()   │         │  → id.vk.ru/oauth2/     │
│       with codeChallenge │         │    user_info             │
│    4. onAuthCode callback│         │  → createUser + sign JWT │
│       {code, deviceId}   │         │                          │
│                          │         │  ← { token }             │
│  5. POST to server ──────┼────────►│                          │
│     {code, code_verifier,│         │                          │
│      device_id}          │         │                          │
│                          │         │                          │
│  6. Store JWT (secure),  │         │                          │
│     navigate /home       │         │                          │
└──────────────────────────┘         └──────────────────────────┘
```

**Key difference from no-SDK app:** Steps 2–4 use the VK ID SDK native module instead of `WebBrowser.openAuthSessionAsync` + deep link handling. No `+not-found.tsx` fallback needed — the SDK handles the redirect internally.

---

## Project Structure

```
app-sdk/
  app.json                          — Expo config (scheme, plugins)
  build-version.json                — { "build": 1 } — auto-incremented
  scripts/
    increment-build.ts              — Increments build counter before APK build
  app/
    _layout.tsx                     — AuthContext provider + Stack
    index.tsx                       — Auth check → login or home
    login.tsx                       — "Sign in with VK" button + build version
    home.tsx                        — Authenticated screen
    +not-found.tsx                  — Redirect to /
  src/
    config.ts                       — API_URL, VK_CLIENT_ID
    hooks/
      useVKSDKAuth.ts               — PKCE generation, calls native module,
                                      sends code+code_verifier to backend
      useAuth.ts                    — JWT storage (SecureStore), login/logout, getMe
    services/
      api.ts                        — exchangeVKCode (POST, snake_case, 15s timeout),
                                      getMe
  modules/
    expo-vk-sdk/
      expo-module.config.json       — Expo module registration
      index.ts                      — Module exports
      src/
        ExpoVKSDK.types.ts          — TypeScript types for the module
        index.ts                    — TS wrapper around native module
      android/
        build.gradle                — VK ID SDK dependency (com.vk.id)
        src/main/
          AndroidManifest.xml       — VKIDClientID, VKIDRedirectHost,
                                      VKIDRedirectScheme manifest placeholders
          java/expo/modules/vksdk/
            ExpoVKSDKModule.kt      — Native module: init VKID, authorize(),
                                      onAuthCode → resolve Promise to JS

server/                              — Existing, unchanged, shared by both apps
```

---

## Native Module: `expo-vk-sdk`

### Kotlin Module (`ExpoVKSDKModule.kt`)

Exposes one async method to TypeScript:

```kotlin
// Simplified signature
fun authorize(codeChallenge: String, state: String): Promise<AuthCodeResult>
// Returns: { code: String, deviceId: String }
```

**Initialization:**
- `VKID.init()` called in module's `definition.onCreate` block
- Reads `VKIDClientID` from AndroidManifest metadata (set via Expo config plugin)

**authorize() flow:**
1. Calls `VKID.instance.authorize()` with:
   - `AuthParams(codeChallenge = codeChallenge, state = state)`
   - Scopes: `setOf("email")` (or configurable)
2. Registers `VKIDAuthCallback`:
   - `onAuthCode(data)` → resolves Promise with `{ code: data.code, deviceId: data.deviceId }`
   - `onFail(fail)` → rejects Promise with error description
3. If user cancels → rejects Promise

### Android Configuration

**`build.gradle`** adds VK ID SDK dependency:
```groovy
dependencies {
    implementation "com.vk.id:vkid:2.x.x"  // latest stable
}
```

**`AndroidManifest.xml`** metadata:
```xml
<meta-data android:name="VKIDClientID" android:value="54501952" />
<meta-data android:name="VKIDRedirectHost" android:value="vk.ru" />
<meta-data android:name="VKIDRedirectScheme" android:value="vk54501952" />
```

### TypeScript Interface

```typescript
// modules/expo-vk-sdk/src/ExpoVKSDK.types.ts
export interface AuthCodeResult {
  code: string;
  deviceId: string;
}

// modules/expo-vk-sdk/src/index.ts
export function authorize(codeChallenge: string, state: string): Promise<AuthCodeResult>;
```

---

## App TypeScript Code

### `useVKSDKAuth.ts`

```typescript
// 1. Generate PKCE (code_verifier + code_challenge) using expo-crypto
// 2. Generate random state
// 3. Call ExpoVKSDK.authorize(codeChallenge, state)
// 4. SDK opens auth WebView, user authenticates
// 5. Receive { code, deviceId } from native module
// 6. POST { code, code_verifier, device_id } to server
// 7. Receive { token }, call onSuccess
```

Returns: `{ promptAsync, isLoading, error, isReady }`

### `api.ts`

Same as no-SDK app:
- `exchangeVKCode({ code, codeVerifier, deviceId })` → POST `/auth/vk/exchange` with snake_case keys and 15s AbortController timeout
- `getMe(token)` → GET `/auth/me`

### `useAuth.ts`

Same as no-SDK app — JWT in SecureStore, login/logout/checkAuth.

---

## Build Version Counter

- `build-version.json`: `{ "build": 1 }`
- `scripts/increment-build.ts`: reads file, increments `build`, writes back
- Login screen title: `VK OAuth SDK Demo v{build}`
- Run `npx ts-node scripts/increment-build.ts` before each `./gradlew assembleRelease`

---

## Backend

**No changes needed.** The existing `/server` already handles:
- `POST /auth/vk/exchange` with `{ code, code_verifier, device_id }` (snake_case)
- Exchanges with `id.vk.ru/oauth2/auth` using PKCE (no client_secret)
- Fetches profile from `id.vk.ru/oauth2/user_info`
- Returns `{ token }` (7-day JWT)

Both `/app` (no-SDK) and `/app-sdk` (SDK) share this backend.

---

## VK App Configuration

Same VK app as no-SDK version:
- App ID: `54501952`
- App type: Android
- Package: `com.vkoauth.appsdk` (different from no-SDK `com.vkoauth.app`)
- Redirect URI: `vk54501952://vk.ru/blank.html` (auto-whitelisted)

**Note:** The VK app may need the new package name (`com.vkoauth.appsdk`) added in VK console settings, plus SHA-256 fingerprint of the signing key.

---

## Error Handling

| Scenario | Caught by | Result |
|---|---|---|
| User cancels VK auth | Native module rejects Promise | `useVKSDKAuth` resets loading |
| VK SDK init fails | Native module rejects | Error on login screen |
| PKCE generation fails | `useVKSDKAuth` catch | Error on login screen |
| Backend unreachable | `exchangeVKCode` (15s timeout) | "Aborted" error |
| VK rejects code | Server returns 401 | Error from server shown |
| JWT expired | `useAuth.checkAuth` | Token deleted, redirect to login |

---

## Testing

**Server:** Existing 19 tests unchanged — both apps use the same backend contract.

**App:** Manual E2E on device:
1. App opens → login screen with `v{N}` in title
2. Tap "Sign in with VK" → VK SDK auth WebView opens
3. Authenticate → WebView closes, "Signing in..." shown
4. Home screen with user name and VK ID
5. Logout → back to login
6. Reopen → still logged in (JWT in SecureStore)

---

## Security Notes

- PKCE generated in TypeScript (expo-crypto), `code_challenge` passed to SDK, `code_verifier` sent to backend — never exposed to VK
- VK SDK handles its own WebView and auth session securely
- JWT stored in expo-secure-store (encrypted)
- Backend exchange means VK access_token is bound to backend IP, never sent to the app
- snake_case keys in app→server API match VK convention
