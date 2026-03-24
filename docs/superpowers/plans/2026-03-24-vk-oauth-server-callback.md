# VK OAuth Server-Side Callback — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side VK OAuth flow with a server-side callback that receives the VK auth code, exchanges it for a token, and redirects the app via deep link with a ready-to-use JWT.

**Architecture:** App opens VK auth in a browser using `WebBrowser.openAuthSessionAsync`. VK redirects to the Express server at `https://mz.ludentes.ru/auth/vk/callback`. Server exchanges the code, creates a user, signs a JWT, and redirects to `vkoauth://auth/success?token=<JWT>`. App stores the token and calls `GET /auth/me` to verify before navigating home.

**Tech Stack:** Express (Node.js), supertest (server tests), expo-web-browser, expo-secure-store, expo-router, TypeScript.

**Spec:** `docs/superpowers/specs/2026-03-24-vk-oauth-server-callback-design.md`

---

## File Structure

```
server/
  src/routes/auth.js          - Add GET /vk/callback; remove POST /vk
  .env.example                - Add SERVER_URL, change PORT to 5173
  .env                        - Add SERVER_URL=https://mz.ludentes.ru, PORT=5173
  docker-compose.yml          - Change port mapping to 5173:5173

app/
  src/hooks/useVKAuth.ts      - Rewrite: drop expo-auth-session, use openAuthSessionAsync
  src/hooks/useAuth.ts        - login() accepts { token } instead of { code, redirectUri }
  src/services/api.ts         - Remove loginWithVK; keep getMe
  src/config.ts               - API_URL → https://mz.ludentes.ru
  app/login.tsx               - Use new hook interface
```

---

## Chunk 1: Server

### Task 1: Update auth routes — add callback, remove POST /vk

**Files:**
- Modify: `server/src/routes/auth.js`
- Modify: `server/tests/routes/auth.test.js`

- [ ] **Step 1: Replace test file with new tests**

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

beforeAll(() => {
  process.env.SERVER_URL = 'https://mz.ludentes.ru';
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRoutes({
    jwtSecret: JWT_SECRET,
    vkAppId: 'test-app-id',
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

describe('GET /auth/vk/callback', () => {
  test('redirects to success deep link with JWT on valid code', async () => {
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345 });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const res = await request(app).get('/auth/vk/callback?code=valid-code');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^vkoauth:\/\/auth\/success\?token=/);

    const tokenMatch = res.headers.location.match(/token=([^&]+)/);
    const token = decodeURIComponent(tokenMatch[1]);
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.vkId).toBe(12345);
  });

  test('redirects to error deep link when VK returns error param', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/auth/vk/callback?error=access_denied&error_description=User+denied+access');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^vkoauth:\/\/auth\/error/);
    expect(decodeURIComponent(res.headers.location)).toContain('User denied access');
  });

  test('redirects to error deep link when code is missing', async () => {
    const app = createApp();
    const res = await request(app).get('/auth/vk/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('vkoauth://auth/error?message=missing_code');
  });

  test('redirects to error deep link when exchange fails', async () => {
    exchangeCode.mockRejectedValue(new Error('Code expired'));

    const app = createApp();
    const res = await request(app).get('/auth/vk/callback?code=bad-code');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^vkoauth:\/\/auth\/error/);
    expect(decodeURIComponent(res.headers.location)).toContain('Code expired');
  });
});

describe('GET /auth/me', () => {
  test('returns user for valid token', async () => {
    // Seed a user first via the callback flow
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345 });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const callbackRes = await request(app).get('/auth/vk/callback?code=valid-code');
    const tokenMatch = callbackRes.headers.location.match(/token=([^&]+)/);
    const token = decodeURIComponent(tokenMatch[1]);

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

Run: `cd server && npx jest tests/routes/auth.test.js`
Expected: FAIL — tests for `GET /auth/vk/callback` fail since the route doesn't exist yet.

- [ ] **Step 3: Implement new routes**

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

  router.get('/vk/callback', async (req, res) => {
    const { code, error, error_description } = req.query;

    if (error) {
      const msg = encodeURIComponent(error_description || error);
      return res.redirect(`vkoauth://auth/error?message=${msg}`);
    }

    if (!code) {
      return res.redirect('vkoauth://auth/error?message=missing_code');
    }

    const callbackUrl = `${process.env.SERVER_URL}/auth/vk/callback`;

    try {
      const { accessToken } = await exchangeCode({
        code,
        redirectUri: callbackUrl,
        clientId: vkAppId,
        clientSecret: vkAppSecret,
      });

      const profile = await fetchUserProfile(accessToken);
      const user = createUser(profile, usersFile);

      const token = jwt.sign(
        { userId: user.id, vkId: user.vkId },
        jwtSecret,
        { expiresIn: '7d' }
      );

      return res.redirect(`vkoauth://auth/success?token=${encodeURIComponent(token)}`);
    } catch (err) {
      const msg = encodeURIComponent(err.message || 'auth_failed');
      return res.redirect(`vkoauth://auth/error?message=${msg}`);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest tests/routes/auth.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Run all server tests**

Run: `cd server && npx jest`
Expected: All 15 tests pass (7 users + 4 middleware + 3 vk + 6 routes — note: 3 POST /auth/vk tests removed, 4 callback + 2 me = 6 route tests).

---

### Task 2: Update env and Docker config

**Files:**
- Modify: `server/.env.example`
- Modify: `server/.env`
- Modify: `server/docker-compose.yml`

- [ ] **Step 1: Update .env.example**

`server/.env.example`:
```
VK_APP_ID=your_app_id
VK_APP_SECRET=your_app_secret
JWT_SECRET=random_secret_string
PORT=5173
SERVER_URL=https://your-domain.com
```

- [ ] **Step 2: Update .env**

`server/.env`:
```
VK_APP_ID=54501952
VK_APP_SECRET=neJqXQfaR9PBh68sYr9k
JWT_SECRET=vk-oauth-test-jwt-secret-2026
PORT=5173
SERVER_URL=https://mz.ludentes.ru
```

- [ ] **Step 3: Update docker-compose.yml**

`server/docker-compose.yml`:
```yaml
services:
  vk-oauth-server:
    build: .
    ports:
      - "5173:5173"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

---

## Chunk 2: Mobile App

### Task 3: Rewrite useVKAuth hook

**Files:**
- Modify: `app/src/hooks/useVKAuth.ts`

- [ ] **Step 1: Rewrite useVKAuth.ts**

`app/src/hooks/useVKAuth.ts`:
```ts
import { useCallback, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { VK_CLIENT_ID, API_URL } from '../config';

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
      const redirectUri = `${API_URL}/auth/vk/callback`;
      const params = new URLSearchParams({
        client_id: VK_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'email',
        display: 'mobile',
        v: '5.131',
        state: Math.random().toString(36).substring(2, 12),
      });

      const result = await WebBrowser.openAuthSessionAsync(
        `https://oauth.vk.com/authorize?${params.toString()}`,
        'vkoauth://'
      );

      if (result.type === 'success') {
        if (result.url.startsWith('vkoauth://auth/success')) {
          const tokenMatch = result.url.match(/token=([^&]+)/);
          const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
          if (token) {
            onSuccessRef.current({ token });
          } else {
            setError('Token missing from redirect');
          }
        } else if (result.url.startsWith('vkoauth://auth/error')) {
          const msgMatch = result.url.match(/message=([^&]+)/);
          setError(msgMatch ? decodeURIComponent(msgMatch[1]) : 'Authentication failed');
        }
      }
      // type === 'cancel' or 'dismiss' → user closed browser, no-op
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

### Task 4: Update useAuth hook

**Files:**
- Modify: `app/src/hooks/useAuth.ts`

- [ ] **Step 1: Update login to accept token directly**

`app/src/hooks/useAuth.ts`:
```ts
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { getMe } from '../services/api';
import { TOKEN_KEY } from '../config';

interface User {
  id: string;
  vkId: number;
  firstName: string;
  lastName: string;
}

interface AuthState {
  isLoading: boolean;
  isLoggedIn: boolean;
  user: User | null;
  error: string | null;
  login: (params: { token: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useAuthProvider() {
  const [state, setState] = useState<Omit<AuthState, 'login' | 'logout'>>({
    isLoading: true,
    isLoggedIn: false,
    user: null,
    error: null,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) {
        setState({ isLoading: false, isLoggedIn: false, user: null, error: null });
        return;
      }
      const { user } = await getMe(token);
      setState({ isLoading: false, isLoggedIn: true, user, error: null });
    } catch {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setState({ isLoading: false, isLoggedIn: false, user: null, error: null });
    }
  }

  const login = useCallback(async ({ token }: { token: string }) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      const { user } = await getMe(token);
      setState({ isLoading: false, isLoggedIn: true, user, error: null });
    } catch (err: any) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err.message || 'Login failed',
      }));
    }
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setState({ isLoading: false, isLoggedIn: false, user: null, error: null });
  }, []);

  return { ...state, login, logout };
}

export { AuthContext };
```

---

### Task 5: Update API service and config

**Files:**
- Modify: `app/src/services/api.ts`
- Modify: `app/src/config.ts`

- [ ] **Step 1: Remove loginWithVK from api.ts**

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

- [ ] **Step 2: Update config.ts**

`app/src/config.ts`:
```ts
export const API_URL = 'https://mz.ludentes.ru';
export const VK_CLIENT_ID = '54501952';
export const TOKEN_KEY = 'auth_token';
```

---

### Task 6: Update LoginScreen

**Files:**
- Modify: `app/app/login.tsx`

- [ ] **Step 1: Update login.tsx**

`app/app/login.tsx`:
```tsx
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useVKAuth } from '../src/hooks/useVKAuth';
import { useAuth } from '../src/hooks/useAuth';
import { router } from 'expo-router';

export default function LoginScreen() {
  const { login, isLoading: authLoading, error: authError } = useAuth();
  const { promptAsync, isLoading: vkLoading, isReady, error: vkError } = useVKAuth(
    async ({ token }) => {
      await login({ token });
      router.replace('/home');
    }
  );

  const isLoading = authLoading || vkLoading;
  const error = vkError || authError;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>VK OAuth Demo</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (!isReady || isLoading) && styles.buttonDisabled]}
        onPress={() => promptAsync()}
        disabled={!isReady || isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign in with VK</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#4680C2',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: 'red',
    marginBottom: 16,
    textAlign: 'center',
  },
});
```

---

## Chunk 3: Deploy & Test

### Task 7: Deploy server to mz.ludentes.ru

- [ ] **Step 1: Copy server to remote**

```bash
scp -r c:/Work/antonov-media/vk-oauth/server/ user@mz.ludentes.ru:/opt/vk-oauth-server/
```

- [ ] **Step 2: SSH into server and start Docker**

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

---

### Task 8: Update VK app settings

- [ ] **Step 1: Change app type to Standalone**

Go to `vk.com/dev` → app 54501952 → Settings → change type to **Standalone**.

- [ ] **Step 2: Register redirect URI**

In the redirect URIs field, add: `https://mz.ludentes.ru/auth/vk/callback`

Save.

---

### Task 9: Rebuild APK and end-to-end test

- [ ] **Step 1: Build release APK**

```bash
cd c:/Work/antonov-media/vk-oauth/app/android
JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot" ./gradlew assembleRelease
```
Expected: `BUILD SUCCESSFUL`

APK at: `app/android/app/build/outputs/apk/release/app-release.apk`

- [ ] **Step 2: Install APK on device and test full flow**

Test checklist:
1. App opens → loading spinner → redirects to `/login`
2. Tap "Sign in with VK" → browser opens VK auth page
3. Authenticate with VK → browser closes automatically
4. App shows `/home` with user name and VK ID
5. Tap Logout → returns to `/login`
6. Reopen app → still logged in (JWT persisted in SecureStore)
7. On error (cancel browser) → stays on `/login`, no crash
