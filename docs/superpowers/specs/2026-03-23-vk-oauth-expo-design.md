# VK OAuth for Expo Android App — Design Spec

## Summary

Mobile app (Expo, Android, local prebuild) with VK OAuth login, backed by an Express server at `https://mz.ludentes.ru/`. The app uses `expo-auth-session` with PKCE to get an authorization code from VK, sends it to the backend, which exchanges it for a VK token, creates/finds a user, and returns a JWT. File-based user storage. iOS support designed-in but not implemented yet.

**Approach A** (expo-auth-session + system browser) is implemented first. **Approach B** (native VK ID SDK) will follow as a second phase — the backend is designed to work unchanged for both.

## Prerequisites: VK ID Cabinet

- Android app registered in VK ID cabinet with `app_id` (already done)
- Package name registered (e.g. `com.vkoauth.app`)
- SHA-1 fingerprints added for both debug and release signing keys
- Custom scheme redirect URI (`vkoauth://auth/vk`) added as trusted redirect

## Architecture

```
+---------------------+         +--------------------------+
|   Expo Android App  |         |  Express Backend         |
|                     |         |  https://mz.ludentes.ru  |
|                     |         |                          |
|  1. User taps       |         |                          |
|     "Sign in with   |         |                          |
|      VK"            |         |                          |
|  2. expo-auth-      |         |                          |
|     session opens   |         |                          |
|     system browser  |         |                          |
|     -> VK auth page |         |                          |
|  3. VK redirects    |         |                          |
|     back via deep   |         |                          |
|     link with code  |         |                          |
|     + device_id     |         |                          |
|     + state         |         |                          |
|  4. App sends code  |-------->|  POST /auth/vk           |
|     + codeVerifier  |         |  5. Exchanges code ->    |
|     + deviceId      |         |     VK access token      |
|     + redirectUri   |         |                          |
|  7. Receives JWT,   |<--------|  6. Creates/finds user,  |
|     stores in       |         |     signs JWT, returns   |
|     SecureStore     |         |     { token, user }      |
+---------------------+         +--------------------------+
                                         |
                                    users.json
```

**Note on `device_id`:** VK generates and returns `device_id` in the redirect. The app does not generate it — it extracts it from VK's response and forwards it to the backend.

## VK OAuth Endpoints (Discovery)

- **Authorization:** `https://id.vk.com/authorize`
- **Token exchange:** `https://id.vk.com/oauth2/auth`

(Both `id.vk.com` and `id.vk.ru` may work, but `id.vk.com` is the canonical domain in VK's official docs.)

## Two Deployable Units

- `/app` — Expo project (Android build via `npx expo prebuild` + Android Studio)
- `/server` — Express API (Docker -> `mz.ludentes.ru`)

## Mobile App (`/app`)

### Dependencies

- `expo-auth-session` — OAuth flow with PKCE
- `expo-web-browser` — opens system browser for auth (must call `WebBrowser.maybeCompleteAuthSession()` at module level)
- `expo-secure-store` — encrypted JWT storage on device
- `expo-router` or `@react-navigation/native` — navigation between screens

### App Configuration (`app.json`)

```json
{
  "expo": {
    "scheme": "vkoauth",
    "android": {
      "package": "com.vkoauth.app"
    }
  }
}
```

The `scheme` field enables deep linking so Android handles `vkoauth://` URIs.

### Auth Flow

1. Call `WebBrowser.maybeCompleteAuthSession()` at module level (required for the auth browser to close properly)
2. `useAuthRequest` configured with VK endpoints, PKCE enabled, scopes: `email`, `profile`
3. Redirect URI: `vkoauth://auth/vk` (generated via `makeRedirectUri({ scheme: 'vkoauth', path: 'auth/vk' })`)
4. User taps button -> `promptAsync()` opens system browser to `https://id.vk.com/authorize`
5. `expo-auth-session` automatically generates and validates `state` parameter (CSRF protection)
6. VK authenticates, redirects to `vkoauth://auth/vk?code=...&device_id=...&state=...`
7. `expo-auth-session` validates `state`, extracts `code` and `device_id` from response params
8. App sends `POST https://mz.ludentes.ru/auth/vk` with `{ code, codeVerifier, deviceId, redirectUri }`
9. Backend returns `{ token, user }` -> app stores JWT in `expo-secure-store`
10. Subsequent API calls include `Authorization: Bearer <token>`

**Important:** The app sends its exact `redirectUri` to the backend so the backend can forward it to VK during code exchange. VK requires the `redirect_uri` in the token request to match exactly what was used in the authorization request.

### Screens

- **LoginScreen** — "Sign in with VK" button. Shown when no valid JWT exists.
- **HomeScreen** — Displays user profile (name, VK ID) + logout button.

Navigation switches based on JWT presence in secure storage.

### Logout

Delete JWT from SecureStore, navigate to LoginScreen.

### Error Handling (App)

- VK auth cancelled/failed -> show error message on LoginScreen
- Backend returns 4xx/5xx -> show "Login failed, try again" message
- `GET /auth/me` returns 401 -> clear stored JWT, show LoginScreen

## Backend (`/server`)

### Endpoints

#### `POST /auth/vk`

**Request:**
```json
{
  "code": "...",
  "codeVerifier": "...",
  "deviceId": "...",
  "redirectUri": "vkoauth://auth/vk"
}
```

**Logic:**
1. Validate that all required fields are present (400 if not)
2. Call `POST https://id.vk.com/oauth2/auth` with:
   - `grant_type=authorization_code`
   - `code`
   - `code_verifier` (from codeVerifier)
   - `device_id` (from deviceId)
   - `client_id` (from env)
   - `redirect_uri` (from request body — must match what the app sent to VK)
   - `client_secret` (from env — may be required server-side depending on VK app config)
3. If VK returns an error -> return 401 `{ "error": "vk_exchange_failed", "message": "..." }`
4. VK returns `access_token`, `user_id`, `id_token`
5. Decode `id_token` or call VK API to get user profile (name)
6. Find or create user in `users.json` by VK ID
7. Sign JWT with `{ userId, vkId }`, 7-day expiry
8. Return `{ token, user }`

**Success Response (200):**
```json
{
  "token": "eyJhbG...",
  "user": {
    "id": "uuid",
    "vkId": 12345,
    "firstName": "...",
    "lastName": "..."
  }
}
```

**Error Responses:**
- `400` — `{ "error": "missing_fields", "message": "code, codeVerifier, deviceId, redirectUri are required" }`
- `401` — `{ "error": "vk_exchange_failed", "message": "<VK error details>" }`
- `500` — `{ "error": "internal_error", "message": "..." }`

#### `GET /auth/me`

**Headers:** `Authorization: Bearer <token>`

**Logic:** Validates JWT, looks up user in `users.json` by ID from JWT payload, returns user object.

**Success Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "vkId": 12345,
    "firstName": "...",
    "lastName": "..."
  }
}
```

**Error Responses:**
- `401` — `{ "error": "invalid_token", "message": "Token is invalid or expired" }` (bad JWT or user not found in `users.json`)

### Data Storage

`users.json` — array of user objects:
```json
[
  {
    "id": "uuid-v4",
    "vkId": 12345,
    "firstName": "Ivan",
    "lastName": "Petrov",
    "createdAt": "2026-03-23T12:00:00Z"
  }
]
```

Read/write with `fs.readFileSync` / `fs.writeFileSync`. Not safe for concurrent writes — acceptable for this test project with single-user testing.

### Config (`.env`)

```
VK_APP_ID=your_app_id
VK_APP_SECRET=your_app_secret
JWT_SECRET=random_secret_string
PORT=3000
```

Note: `REDIRECT_URI` is no longer in `.env` — it comes from the app in the request body to avoid mismatch.

### Docker

- `Dockerfile` — Node.js image, copies server code, runs Express
- `docker-compose.yml`:
  - Maps port (e.g. `3000:3000`)
  - Mounts `.env`
  - Persists `users.json` via volume (e.g. `./data:/app/data`)

Deployed behind existing reverse proxy at `mz.ludentes.ru`.

## Security

- JWT signed with `JWT_SECRET`, 7-day expiry, no refresh tokens
- When JWT expires, user re-authenticates via VK
- JWT stored in `expo-secure-store` (hardware-backed encryption on Android)
- `client_secret` stays server-side only, never in the APK
- PKCE protects the authorization code exchange
- `state` parameter handled automatically by `expo-auth-session` (CSRF protection)
- `redirect_uri` passed from app to backend to ensure exact match with VK
- Stateless JWT — logout = delete from device

## Future: Approach B (Native VK ID SDK)

When implementing Approach B:
- Only the **app-side auth mechanism** changes (native SDK instead of expo-auth-session)
- The backend `POST /auth/vk` endpoint stays the same — it still receives `code + codeVerifier + deviceId + redirectUri`
- May add native Kotlin config via Expo config plugin
- Target VK ID SDK v2.x (OAuth 2.1 support)
- Separate design doc will cover Approach B specifics
