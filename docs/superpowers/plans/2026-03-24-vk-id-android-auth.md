# VK ID Android Auth Without SDK — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current server-side OAuth callback with VK's native Android deep link approach: the app opens `id.vk.ru/authorize`, VK redirects directly to `vk54501952://vk.ru` (intercepted natively), and the app sends `{code, codeVerifier, deviceId}` to the server for exchange.

**Architecture:** App generates PKCE and opens `id.vk.ru/authorize` with `redirect_uri=vk54501952://vk.ru/blank.html`. VK redirects back with `code + device_id + state` via Android intent. App verifies state, calls `POST /auth/vk/exchange` on the server. Server exchanges with `id.vk.ru/oauth2/auth` (no client_secret), fetches profile from `id.vk.ru/oauth2/user_info`, creates user, and returns a JWT. App stores JWT and calls `GET /auth/me` to verify before navigating home.

**Tech Stack:** Express (Node.js), supertest (server tests), expo-web-browser, expo-secure-store, expo-router, TypeScript, Web Crypto API (crypto.subtle — available in React Native 0.81+).

**Spec:** `docs/superpowers/specs/2026-03-24-vk-id-android-auth-design.md`

---

## File Structure

```
server/
  src/routes/auth.js          - Replace GET /vk/callback with POST /vk/exchange
  src/services/vk.js          - Update to id.vk.ru endpoints; fetchUserProfile gets deviceId param

app/
  app.json                    - Add intentFilter for vk54501952://vk.ru
  src/hooks/useVKAuth.ts      - Rewrite: PKCE + id.vk.ru + parse deep link + call POST /auth/vk/exchange
  src/services/api.ts         - Add exchangeVKCode(); keep getMe()
```

---

## Chunk 1: Server

### Task 1: Replace GET /vk/callback with POST /vk/exchange

**Files:**
- Modify: `server/src/routes/auth.js`
- Modify: `server/tests/routes/auth.test.js`

- [ ] **Step 1: Replace test file**

`server/tests/routes/auth.test.js`:
```js
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { createAuthRoutes } = require('../../src/routes/auth');

const TEST_FILE = path.join(__dirname, '../../data/users.route-test.json');
const JWT_SECRET = 'test-secret';

jest.mock('../../src/services/vk', () => ({
  exchangeCode: jest.fn(),
  fetchUserProfile: jest.fn(),
}));

const { exchangeCode, fetchUserProfile } = require('../../src/services/vk');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRoutes({
    jwtSecret: JWT_SECRET,
    vkAppId: '54501952',
    vkAppSecret: 'test-app-secret',
    usersFile: TEST_FILE,
  }));
  return app;
}

beforeEach(() => {
  fs.writeFileSync(TEST_FILE, '[]');
  exchangeCode.mockReset();
  fetchUserProfile.mockReset();
});

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe('POST /auth/vk/exchange', () => {
  test('returns JWT token on valid code exchange', async () => {
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345, idToken: null });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const res = await request(app).post('/auth/vk/exchange').send({
      code: 'valid-code',
      codeVerifier: 'test-verifier',
      deviceId: 'test-device',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.vkId).toBe(12345);
  });

  test('returns 400 when fields are missing', async () => {
    const app = createApp();
    const res = await request(app).post('/auth/vk/exchange').send({ code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  test('returns 401 when VK exchange fails', async () => {
    exchangeCode.mockRejectedValue(new Error('Code expired'));

    const app = createApp();
    const res = await request(app).post('/auth/vk/exchange').send({
      code: 'bad-code',
      codeVerifier: 'verifier',
      deviceId: 'device',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('vk_exchange_failed');
  });
});

describe('GET /auth/me', () => {
  test('returns user for valid token', async () => {
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345, idToken: null });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const exchangeRes = await request(app).post('/auth/vk/exchange').send({
      code: 'valid-code',
      codeVerifier: 'verifier',
      deviceId: 'device',
    });
    const { token } = exchangeRes.body;

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ vkId: 12345, firstName: 'Ivan' });
  });

  test('returns 401 for missing token', async () => {
    const app = createApp();
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest tests/routes/auth.test.js --no-coverage`
Expected: FAIL — `POST /auth/vk/exchange` returns 404 (route doesn't exist yet).

- [ ] **Step 3: Replace auth.js**

`server/src/routes/auth.js`:
```js
const express = require('express');
const jwt = require('jsonwebtoken');
const { exchangeCode, fetchUserProfile } = require('../services/vk');
const { findById, createUser } = require('../services/users');
const { createAuthMiddleware } = require('../middleware/auth');

function createAuthRoutes({ jwtSecret, vkAppId, vkAppSecret, usersFile }) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(jwtSecret);

  router.post('/vk/exchange', async (req, res) => {
    const { code, codeVerifier, deviceId } = req.body;

    if (!code || !codeVerifier || !deviceId) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'code, codeVerifier, and deviceId are required',
      });
    }

    try {
      const { accessToken } = await exchangeCode({
        code,
        codeVerifier,
        deviceId,
        redirectUri: `vk${vkAppId}://vk.ru/blank.html`,
        clientId: vkAppId,
      });

      const profile = await fetchUserProfile(accessToken, vkAppId, deviceId);
      const user = createUser(profile, usersFile);

      const token = jwt.sign(
        { userId: user.id, vkId: user.vkId },
        jwtSecret,
        { expiresIn: '7d' }
      );

      return res.json({ token });
    } catch (err) {
      return res.status(401).json({
        error: 'vk_exchange_failed',
        message: err.message || 'VK token exchange failed',
      });
    }
  });

  router.get('/me', authMiddleware, (req, res) => {
    const user = findById(req.user.userId, usersFile);
    if (!user) {
      return res.status(401).json({ error: 'invalid_token', message: 'User not found' });
    }
    return res.json({ user });
  });

  return router;
}

module.exports = { createAuthRoutes };
```

- [ ] **Step 4: Run route tests to verify they pass**

Run: `cd server && npx jest tests/routes/auth.test.js --no-coverage`
Expected: 5 tests pass.

---

### Task 2: Update vk.js to use id.vk.ru endpoints

**Files:**
- Modify: `server/src/services/vk.js`
- Modify: `server/tests/services/vk.test.js`

- [ ] **Step 1: Replace vk.test.js**

`server/tests/services/vk.test.js`:
```js
const { exchangeCode, fetchUserProfile } = require('../../src/services/vk');

global.fetch = jest.fn();

beforeEach(() => {
  fetch.mockReset();
});

describe('vk service', () => {
  describe('exchangeCode', () => {
    test('POSTs to id.vk.ru/oauth2/auth and returns tokens', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'vk-access-token',
          user_id: 12345,
          id_token: 'some-id-token',
        }),
      });

      const result = await exchangeCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        deviceId: 'device-123',
        redirectUri: 'vk54501952://vk.ru/blank.html',
        clientId: '54501952',
      });

      expect(result).toEqual({
        accessToken: 'vk-access-token',
        userId: 12345,
        idToken: 'some-id-token',
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://id.vk.ru/oauth2/auth',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('throws on VK error response', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Code expired',
        }),
      });

      await expect(
        exchangeCode({
          code: 'bad-code',
          codeVerifier: 'verifier',
          deviceId: 'device-123',
          redirectUri: 'vk54501952://vk.ru/blank.html',
          clientId: '54501952',
        })
      ).rejects.toThrow('Code expired');
    });
  });

  describe('fetchUserProfile', () => {
    test('POSTs to id.vk.ru/oauth2/user_info and returns parsed profile', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: {
            user_id: '12345',
            first_name: 'Ivan',
            last_name: 'Petrov',
          },
        }),
      });

      const profile = await fetchUserProfile('vk-access-token', '54501952', 'device-123');
      expect(profile).toEqual({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://id.vk.ru/oauth2/user_info'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
```

- [ ] **Step 2: Run vk.test.js to verify it fails**

Run: `cd server && npx jest tests/services/vk.test.js --no-coverage`
Expected: FAIL — tests expect `id.vk.ru` but implementation still calls `id.vk.com`.

- [ ] **Step 3: Replace vk.js**

`server/src/services/vk.js`:
```js
async function exchangeCode({ code, codeVerifier, deviceId, redirectUri, clientId }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    device_id: deviceId,
    redirect_uri: redirectUri,
  });

  const res = await fetch('https://id.vk.ru/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    userId: data.user_id,
    idToken: data.id_token || null,
  };
}

async function fetchUserProfile(accessToken, clientId, deviceId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    device_id: deviceId,
  });

  const res = await fetch(
    `https://id.vk.ru/oauth2/user_info?client_id=${encodeURIComponent(clientId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    }
  );
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error || 'VK API error');
  }

  const user = data.user;
  return {
    vkId: parseInt(user.user_id, 10),
    firstName: user.first_name,
    lastName: user.last_name,
  };
}

module.exports = { exchangeCode, fetchUserProfile };
```

- [ ] **Step 4: Run all server tests**

Run: `cd server && npx jest --no-coverage`
Expected: All tests pass (users + middleware + vk + routes).

---

## Chunk 2: App

### Task 3: Add Android intent filter for vk54501952://vk.ru

**Files:**
- Modify: `app/app.json`

- [ ] **Step 1: Add intentFilters to app.json**

In `app/app.json`, add `intentFilters` inside the `android` block:
```json
{
  "expo": {
    "name": "VK OAuth Demo",
    "slug": "vk-oauth-demo",
    "scheme": ["vkoauth", "vk54501952"],
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "platforms": ["android"],
    "android": {
      "package": "com.vkoauth.app",
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "vk54501952", "host": "vk.ru" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    "plugins": [
      "expo-web-browser",
      "expo-secure-store",
      "expo-router"
    ]
  }
}
```

Note: This change requires a prebuild. Run it as part of Task 6 (APK rebuild).

---

### Task 4: Rewrite useVKAuth.ts

**Files:**
- Modify: `app/src/hooks/useVKAuth.ts`

- [ ] **Step 1: Rewrite useVKAuth.ts**

`app/src/hooks/useVKAuth.ts`:
```ts
import { useCallback, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { VK_CLIENT_ID } from '../config';
import { exchangeVKCode } from '../services/api';

const REDIRECT_BASE = `vk${VK_CLIENT_ID}://vk.ru/blank.html`;

function base64urlEncode(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(hash));
}

function parseCallbackUrl(url: string) {
  const code = (url.match(/[?&]code=([^&]+)/) || [])[1];
  const state = (url.match(/[?&]state=([^&]+)/) || [])[1];
  const deviceId = (url.match(/[?&]device_id=([^&]+)/) || [])[1];
  return {
    code: code ? decodeURIComponent(code) : null,
    state: state ? decodeURIComponent(state) : null,
    deviceId: deviceId ? decodeURIComponent(deviceId) : null,
  };
}

export interface VKAuthResult {
  token: string;
}

export function useVKAuth(onSuccess: (result: VKAuthResult) => void) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const promptAsync = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const codeVerifier = await generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

      // oauth2_params encodes scope for VK ID
      const oauth2Params = btoa('scope="email"').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const redirectUri = `${REDIRECT_BASE}?oauth2_params=${oauth2Params}`;

      const params = new URLSearchParams({
        client_id: VK_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        lang_id: '3',
      });

      const result = await WebBrowser.openAuthSessionAsync(
        `https://id.vk.ru/authorize?${params.toString()}`,
        `vk${VK_CLIENT_ID}://`
      );

      if (result.type !== 'success') return; // user cancelled — no-op

      const { code, state: returnedState, deviceId } = parseCallbackUrl(result.url);

      if (!code || !deviceId) {
        setError('Missing code or device_id in VK response');
        return;
      }

      if (returnedState !== state) {
        setError('State mismatch — request may have been tampered with');
        return;
      }

      const { token } = await exchangeVKCode({ code, codeVerifier, deviceId });
      onSuccessRef.current({ token });
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { promptAsync, isLoading, isReady: true, error };
}
```

---

### Task 5: Update api.ts

**Files:**
- Modify: `app/src/services/api.ts`

- [ ] **Step 1: Add exchangeVKCode to api.ts**

`app/src/services/api.ts`:
```ts
import { API_URL } from '../config';

interface MeResponse {
  user: {
    id: string;
    vkId: number;
    firstName: string;
    lastName: string;
  };
}

export async function exchangeVKCode(params: {
  code: string;
  codeVerifier: string;
  deviceId: string;
}): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/auth/vk/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Token exchange failed');
  }

  return res.json();
}

export async function getMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Invalid token');
  }

  return res.json();
}
```

---

## Chunk 3: Build & Deploy

### Task 6: Rebuild APK

- [ ] **Step 1: Run prebuild to apply app.json changes**

```bash
cd app && npx expo prebuild --platform android --clean
```
Expected: `android/` directory regenerated with new intent filter in `AndroidManifest.xml`.

Verify the intent filter was added:
```bash
grep -A5 "vk54501952" app/android/app/src/main/AndroidManifest.xml
```
Expected: `android:scheme="vk54501952"` and `android:host="vk.ru"` visible.

- [ ] **Step 2: Build release APK**

```bash
cd app/android && JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot" ./gradlew assembleRelease
```
Expected: `BUILD SUCCESSFUL`

APK at: `app/android/app/build/outputs/apk/release/app-release.apk`

---

### Task 7: Deploy server to mz.ludentes.ru

- [ ] **Step 1: Copy server to remote**

```bash
scp -r c:/Work/antonov-media/vk-oauth/server/ user@mz.ludentes.ru:/opt/vk-oauth-server/
```

- [ ] **Step 2: SSH in and start Docker**

```bash
ssh user@mz.ludentes.ru
cd /opt/vk-oauth-server
docker compose up -d --build
```

- [ ] **Step 3: Verify server is running**

```bash
curl https://mz.ludentes.ru/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 4: Verify exchange endpoint exists**

```bash
curl -X POST https://mz.ludentes.ru/auth/vk/exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"test","codeVerifier":"v","deviceId":"d"}'
```
Expected: `{"error":"vk_exchange_failed",...}` (401 — real VK rejects fake code, but endpoint exists).

---

### Task 8: End-to-end test on device

- [ ] **Step 1: Install APK on Android device**

Transfer `app-release.apk` to device and install.

- [ ] **Step 2: End-to-end test checklist**

1. App opens → loading spinner → redirects to `/login`
2. Tap "Sign in with VK" → VK auth page opens in browser
3. Log in with VK credentials → browser closes automatically
4. App shows `/home` with user's first name and VK ID
5. Tap Logout → returns to `/login`
6. Reopen app → still logged in (JWT persisted in SecureStore)
7. Cancel browser mid-flow → stays on `/login`, no crash, no error message

- [ ] **Step 3: If auth fails — check server logs**

```bash
ssh user@mz.ludentes.ru
docker logs vk-oauth-server --tail 50
```
Common issues:
- `redirect_uri mismatch` → VK rejected our redirect_uri format; try adjusting oauth2_params encoding
- `invalid_grant` → code already used or expired; ensure single exchange attempt
- `user_info error` → device_id not passed correctly
