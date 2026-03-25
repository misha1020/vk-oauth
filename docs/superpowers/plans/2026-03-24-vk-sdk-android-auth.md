# VK ID Android Auth With SDK — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new Expo app (`/app-sdk`) that uses the VK ID SDK for Android with backend token exchange, sharing the existing `/server` backend with the no-SDK app.

**Architecture:** App generates PKCE in TypeScript (expo-crypto), passes `code_challenge` to a Kotlin native module wrapping VK ID SDK's `authorize()`. SDK handles the auth UI (WebView), returns `code + device_id` via callback. App sends `code + code_verifier + device_id` to the existing server for VK token exchange and JWT creation.

**Tech Stack:** Expo SDK 54, TypeScript, Expo Modules API (Kotlin), VK ID SDK 2.6.1, expo-crypto, expo-secure-store, expo-router

**Spec:** `docs/superpowers/specs/2026-03-24-vk-sdk-android-auth-design.md`

**Existing server docs:** `server/src/routes/auth.js` — `POST /auth/vk/exchange` accepts `{ code, code_verifier, device_id }` (snake_case), returns `{ token }`

**VK SDK reference:** `docs/superpowers/apiDocs/AndroidVkIdAuth.md`, `docs/superpowers/apiDocs/AndroidHowAuthWorks.md`

---

## File Structure

```
app-sdk/
  package.json
  tsconfig.json
  app.json
  build-version.json                          — { "build": 1 }
  scripts/
    increment-build.ts                        — Bumps build number
  plugins/
    withVKSDK.js                              — Config plugin: Maven repo + manifest placeholders
  app/
    _layout.tsx                               — AuthContext provider + Stack
    index.tsx                                 — Auth check → redirect
    login.tsx                                 — VK login button + build version
    home.tsx                                  — User profile + logout
    +not-found.tsx                            — Redirect to /
  src/
    config.ts                                 — API_URL, VK_CLIENT_ID
    hooks/
      useAuth.ts                              — JWT in SecureStore, login/logout/getMe
      useVKSDKAuth.ts                         — PKCE + native module + backend exchange
    services/
      api.ts                                  — exchangeVKCode, getMe
  modules/
    expo-vk-sdk/
      expo-module.config.json                 — Expo module registration
      index.ts                                — Re-export from src/
      src/
        ExpoVKSDK.types.ts                    — AuthCodeResult type
        index.ts                              — requireNativeModule + TS wrapper
      android/
        build.gradle                          — VK SDK dependency + Maven repo
        src/main/
          AndroidManifest.xml                 — Module manifest (empty, placeholders in app)
          java/expo/modules/vksdk/
            ExpoVKSDKModule.kt                — VKID.init + authorize → Promise
```

---

## Chunk 1: Project Setup + Native Module

### Task 1: Create Expo project and install dependencies

**Files:**
- Create: `app-sdk/` (entire project scaffold)

- [ ] **Step 1: Create the Expo project**

```bash
cd c:/Work/antonov-media/vk-oauth && npx create-expo-app@latest app-sdk --template blank-typescript
```

- [ ] **Step 2: Install dependencies**

```bash
cd app-sdk && npx expo install expo-router expo-crypto expo-secure-store expo-status-bar react-native-safe-area-context react-native-screens expo-constants
```

- [ ] **Step 3: Update package.json main entry to use expo-router**

In `app-sdk/package.json`, change `"main"` to:
```json
{
  "main": "expo-router/entry"
}
```

- [ ] **Step 4: Update tsconfig.json**

`app-sdk/tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  }
}
```

- [ ] **Step 5: Verify project runs**

```bash
cd app-sdk && npx expo start
```
Expected: Metro bundler starts without errors. Press Ctrl+C to stop.

---

### Task 2: Build version counter

**Files:**
- Create: `app-sdk/build-version.json`
- Create: `app-sdk/scripts/increment-build.ts`

- [ ] **Step 1: Create build-version.json**

`app-sdk/build-version.json`:
```json
{
  "build": 0
}
```

Note: starts at 0 — the increment script runs before each build, so first build will be v1.

- [ ] **Step 2: Create increment script**

`app-sdk/scripts/increment-build.ts`:
```typescript
import * as fs from "fs";
import * as path from "path";

const filePath = path.join(__dirname, "..", "build-version.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
data.build += 1;
fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
console.log(`Build version incremented to v${data.build}`);
```

- [ ] **Step 3: Test the script**

```bash
cd app-sdk && npx ts-node scripts/increment-build.ts
```
Expected: `Build version incremented to v1`

Verify `build-version.json` now shows `"build": 1`.

---

### Task 3: Native module scaffold

**Files:**
- Create: `app-sdk/modules/expo-vk-sdk/expo-module.config.json`
- Create: `app-sdk/modules/expo-vk-sdk/index.ts`
- Create: `app-sdk/modules/expo-vk-sdk/android/build.gradle`
- Create: `app-sdk/modules/expo-vk-sdk/android/src/main/AndroidManifest.xml`

- [ ] **Step 1: Create expo-module.config.json**

`app-sdk/modules/expo-vk-sdk/expo-module.config.json`:
```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.vksdk.ExpoVKSDKModule"]
  }
}
```

- [ ] **Step 2: Create module index.ts (temporary placeholder)**

`app-sdk/modules/expo-vk-sdk/index.ts`:
```typescript
export { authorize } from "./src";
export type { AuthCodeResult } from "./src/ExpoVKSDK.types";
```

- [ ] **Step 3: Create android/build.gradle**

`app-sdk/modules/expo-vk-sdk/android/build.gradle`:
```groovy
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'
apply plugin: 'org.jetbrains.kotlin.android'

group = 'expo.modules.vksdk'

def safeExtGet(prop, fallback) {
    rootProject.ext.has(prop) ? rootProject.ext.get(prop) : fallback
}

android {
    namespace "expo.modules.vksdk"
    compileSdkVersion safeExtGet("compileSdkVersion", 35)

    defaultConfig {
        minSdkVersion safeExtGet("minSdkVersion", 24)
        targetSdkVersion safeExtGet("targetSdkVersion", 35)
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

repositories {
    maven { url 'https://artifactory-external.vkpartner.ru/artifactory/vkid-sdk-android/' }
}

dependencies {
    implementation project(':expo-modules-core')
    implementation "com.vk.id:vkid:2.6.1"
}
```

- [ ] **Step 4: Create android/src/main/AndroidManifest.xml**

`app-sdk/modules/expo-vk-sdk/android/src/main/AndroidManifest.xml`:
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
</manifest>
```

This is intentionally empty — VK SDK metadata and placeholders are added to the app's manifest via the config plugin (Task 6).

---

### Task 4: Kotlin native module

**Files:**
- Create: `app-sdk/modules/expo-vk-sdk/android/src/main/java/expo/modules/vksdk/ExpoVKSDKModule.kt`

- [ ] **Step 1: Create the Kotlin module**

`app-sdk/modules/expo-vk-sdk/android/src/main/java/expo/modules/vksdk/ExpoVKSDKModule.kt`:
```kotlin
package expo.modules.vksdk

import android.app.Activity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import com.vk.id.VKID
import com.vk.id.VKIDAuthFail
import com.vk.id.auth.VKIDAuthCallback
import com.vk.id.auth.VKIDAuthParams
import com.vk.id.auth.AuthCodeData
import com.vk.id.AccessToken

class ExpoVKSDKModule : Module() {
    private var initialized = false

    private fun ensureInitialized() {
        if (initialized) return
        val context = appContext.reactContext
            ?: throw CodedException("ERR_NO_CONTEXT", "React context not available", null)
        VKID.init(context)
        initialized = true
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoVKSDK")

        AsyncFunction("authorize") { codeChallenge: String, state: String, promise: Promise ->
            try {
                ensureInitialized()
            } catch (e: Exception) {
                promise.reject("ERR_VK_INIT", e.message ?: "VK SDK init failed", e)
                return@AsyncFunction
            }

            val activity: Activity = appContext.currentActivity
                ?: run {
                    promise.reject("ERR_NO_ACTIVITY", "No current activity", null)
                    return@AsyncFunction
                }

            activity.runOnUiThread {
                try {
                    VKID.instance.authorize(
                        activity,
                        VKIDAuthParams {
                            this.codeChallenge = codeChallenge
                            this.state = state
                            this.scopes = setOf("email")
                        },
                        object : VKIDAuthCallback {
                            override fun onAuthCode(data: AuthCodeData, isCompletion: Boolean) {
                                promise.resolve(
                                    mapOf(
                                        "code" to data.code,
                                        "deviceId" to data.deviceId
                                    )
                                )
                            }

                            override fun onFail(fail: VKIDAuthFail) {
                                promise.reject(
                                    "ERR_VK_AUTH",
                                    fail.description ?: "VK auth failed",
                                    null
                                )
                            }

                            override fun onAuth(accessToken: AccessToken) {
                                // Frontend exchange path — should not be called
                                // when custom PKCE (codeChallenge) is provided.
                                // If it does fire, reject — we need onAuthCode.
                                promise.reject(
                                    "ERR_VK_WRONG_FLOW",
                                    "Received access token instead of auth code. " +
                                        "Ensure codeChallenge is provided.",
                                    null
                                )
                            }
                        }
                    )
                } catch (e: Exception) {
                    promise.reject("ERR_VK_AUTH", e.message ?: "authorize() failed", e)
                }
            }
        }
    }
}
```

**Important:** The exact VK SDK class names (`VKIDAuthParams`, `AuthCodeData`, `VKIDAuthCallback`, etc.) may differ from the actual SDK API. After installing the SDK, check the actual imports. The overall structure is correct per VK docs — the specific builder/callback API may use slightly different class names or patterns. Adjust imports if the build fails.

---

### Task 5: TypeScript module wrapper

**Files:**
- Create: `app-sdk/modules/expo-vk-sdk/src/ExpoVKSDK.types.ts`
- Create: `app-sdk/modules/expo-vk-sdk/src/index.ts`

- [ ] **Step 1: Create types**

`app-sdk/modules/expo-vk-sdk/src/ExpoVKSDK.types.ts`:
```typescript
export interface AuthCodeResult {
  code: string;
  deviceId: string;
}
```

- [ ] **Step 2: Create TypeScript wrapper**

`app-sdk/modules/expo-vk-sdk/src/index.ts`:
```typescript
import { requireNativeModule } from "expo-modules-core";
import type { AuthCodeResult } from "./ExpoVKSDK.types";

const ExpoVKSDK = requireNativeModule("ExpoVKSDK");

export async function authorize(
  codeChallenge: string,
  state: string
): Promise<AuthCodeResult> {
  return ExpoVKSDK.authorize(codeChallenge, state);
}
```

---

## Chunk 2: Config Plugin + App Code

### Task 6: Expo config plugin for VK SDK Android setup

**Files:**
- Create: `app-sdk/plugins/withVKSDK.js`

- [ ] **Step 1: Create the config plugin**

`app-sdk/plugins/withVKSDK.js`:
```js
const {
  withSettingsGradle,
  withAppBuildGradle,
} = require("@expo/config-plugins");

function withVKSDK(config, { clientId, clientSecret }) {
  // 1. Add VK Maven repo to settings.gradle repositories
  config = withSettingsGradle(config, (cfg) => {
    const vkRepo =
      'maven { url "https://artifactory-external.vkpartner.ru/artifactory/vkid-sdk-android/" }';
    if (!cfg.modResults.contents.includes("vkid-sdk-android")) {
      // Insert into the first `repositories {` block inside dependencyResolutionManagement
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/,
        `$1\n        ${vkRepo}`
      );
    }
    return cfg;
  });

  // 2. Add manifest placeholders to app/build.gradle defaultConfig
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("VKIDClientID")) {
      const placeholders = [
        `        manifestPlaceholders["VKIDClientID"] = "${clientId}"`,
        `        manifestPlaceholders["VKIDClientSecret"] = "${clientSecret}"`,
        `        manifestPlaceholders["VKIDRedirectHost"] = "vk.ru"`,
        `        manifestPlaceholders["VKIDRedirectScheme"] = "vk${clientId}"`,
      ].join("\n");

      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(defaultConfig\s*\{)/,
        `$1\n${placeholders}`
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withVKSDK;
```

---

### Task 7: App config and API service

**Files:**
- Create: `app-sdk/src/config.ts`
- Create: `app-sdk/src/services/api.ts`

- [ ] **Step 1: Create config.ts**

`app-sdk/src/config.ts`:
```typescript
export const API_URL = "http://192.168.87.125:5173";
export const VK_CLIENT_ID = "54501952";
export const TOKEN_KEY = "auth_token";
```

- [ ] **Step 2: Create api.ts**

`app-sdk/src/services/api.ts`:
```typescript
import { API_URL } from "../config";

interface MeResponse {
  user: {
    id: string;
    vkId: number;
    firstName: string;
    lastName: string;
  };
}

interface ExchangeVKCodeParams {
  code: string;
  codeVerifier: string;
  deviceId: string;
}

interface ExchangeVKCodeResponse {
  token: string;
}

export async function exchangeVKCode(
  params: ExchangeVKCodeParams
): Promise<ExchangeVKCodeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(`${API_URL}/auth/vk/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: params.code,
      code_verifier: params.codeVerifier,
      device_id: params.deviceId,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || "Token exchange failed");
  }

  return res.json();
}

export async function getMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error("Invalid token");
  }

  return res.json();
}
```

---

### Task 8: Auth hook

**Files:**
- Create: `app-sdk/src/hooks/useAuth.ts`

- [ ] **Step 1: Create useAuth.ts**

`app-sdk/src/hooks/useAuth.ts`:
```typescript
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import * as SecureStore from "expo-secure-store";
import { getMe } from "../services/api";
import { TOKEN_KEY } from "../config";

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
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useAuthProvider() {
  const [state, setState] = useState<Omit<AuthState, "login" | "logout">>({
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
        error: err.message || "Login failed",
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

### Task 9: VK SDK auth hook

**Files:**
- Create: `app-sdk/src/hooks/useVKSDKAuth.ts`

- [ ] **Step 1: Create useVKSDKAuth.ts**

`app-sdk/src/hooks/useVKSDKAuth.ts`:
```typescript
import { useCallback, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { authorize } from "../../modules/expo-vk-sdk";
import { exchangeVKCode } from "../services/api";

function base64urlEncode(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  Crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface VKAuthResult {
  token: string;
}

export function useVKSDKAuth(onSuccess: (result: VKAuthResult) => void) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const promptAsync = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Generate PKCE
      const codeVerifier = await generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // 2. Generate state
      const stateArray = new Uint8Array(16);
      Crypto.getRandomValues(stateArray);
      const state = base64urlEncode(stateArray);

      // 3. Call VK SDK native module — opens VK auth WebView
      const { code, deviceId } = await authorize(codeChallenge, state);

      // 4. Exchange code on backend
      const { token } = await exchangeVKCode({
        code,
        codeVerifier,
        deviceId,
      });

      // 5. Success
      onSuccessRef.current({ token });
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { promptAsync, isLoading, isReady: true, error };
}
```

---

### Task 10: App screens

**Files:**
- Create: `app-sdk/app/_layout.tsx`
- Create: `app-sdk/app/index.tsx`
- Create: `app-sdk/app/login.tsx`
- Create: `app-sdk/app/home.tsx`
- Create: `app-sdk/app/+not-found.tsx`

- [ ] **Step 1: Create _layout.tsx**

`app-sdk/app/_layout.tsx`:
```typescript
import { Stack } from "expo-router";
import { AuthContext, useAuthProvider } from "../src/hooks/useAuth";

export default function RootLayout() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="home" />
      </Stack>
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 2: Create index.tsx**

`app-sdk/app/index.tsx`:
```typescript
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../src/hooks/useAuth";

export default function IndexScreen() {
  const { isLoading, isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      router.replace(isLoggedIn ? "/home" : "/login");
    }
  }, [isLoading, isLoggedIn]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
```

- [ ] **Step 3: Create login.tsx**

`app-sdk/app/login.tsx`:
```typescript
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useVKSDKAuth } from "../src/hooks/useVKSDKAuth";
import { useAuth } from "../src/hooks/useAuth";
import { router } from "expo-router";
import buildVersion from "../build-version.json";

export default function LoginScreen() {
  const { login, isLoading: authLoading, error: authError } = useAuth();
  const {
    promptAsync,
    isLoading: vkLoading,
    isReady,
    error: vkError,
  } = useVKSDKAuth(async ({ token }) => {
    await login({ token });
    router.replace("/home");
  });

  const isLoading = authLoading || vkLoading;
  const error = vkError || authError;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>VK OAuth SDK Demo v{buildVersion.build}</Text>

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
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#f5f5f5",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 40,
  },
  button: {
    backgroundColor: "#4680C2",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 200,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "red",
    marginBottom: 16,
    textAlign: "center",
  },
});
```

- [ ] **Step 4: Create home.tsx**

`app-sdk/app/home.tsx`:
```typescript
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useAuth } from "../src/hooks/useAuth";
import { router } from "expo-router";

export default function HomeScreen() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome!</Text>

      {user && (
        <View style={styles.profile}>
          <Text style={styles.name}>
            {user.firstName} {user.lastName}
          </Text>
          <Text style={styles.info}>VK ID: {user.vkId}</Text>
          <Text style={styles.info}>User ID: {user.id}</Text>
        </View>
      )}

      <Pressable style={styles.button} onPress={handleLogout}>
        <Text style={styles.buttonText}>Logout</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#f5f5f5",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  profile: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    width: "100%",
    marginBottom: 30,
    elevation: 3,
  },
  name: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  info: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  button: {
    backgroundColor: "#e53935",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 200,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
```

- [ ] **Step 5: Create +not-found.tsx**

`app-sdk/app/+not-found.tsx`:
```typescript
import { useEffect } from "react";
import { router } from "expo-router";

export default function NotFoundScreen() {
  useEffect(() => {
    router.replace("/");
  }, []);

  return null;
}
```

---

## Chunk 3: Build & Test

### Task 11: Configure app.json, prebuild, and build APK

**Files:**
- Modify: `app-sdk/app.json`

- [ ] **Step 1: Update app.json**

Replace `app-sdk/app.json` with:
```json
{
  "expo": {
    "name": "VK OAuth SDK Demo",
    "slug": "vk-oauth-sdk-demo",
    "scheme": ["vkoauthsdk", "vk54501952"],
    "version": "1.0.0",
    "orientation": "portrait",
    "platforms": ["android"],
    "android": {
      "package": "com.vkoauth.appsdk",
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE"
      }
    },
    "plugins": [
      "expo-secure-store",
      "expo-router",
      [
        "./plugins/withVKSDK",
        {
          "clientId": "54501952",
          "clientSecret": "neJqXQfaR9PBh68sYr9k"
        }
      ]
    ]
  }
}
```

- [ ] **Step 2: Increment build version**

```bash
cd app-sdk && npx ts-node scripts/increment-build.ts
```
Expected: `Build version incremented to v1` (or v2 if run before)

- [ ] **Step 3: Run prebuild**

```bash
cd app-sdk && npx expo prebuild --platform android --clean
```
Expected: `android/` directory created.

- [ ] **Step 4: Verify VK SDK config was applied**

Check manifest placeholders:
```bash
grep -A2 "VKIDClientID" app-sdk/android/app/build.gradle
```
Expected: Lines with `manifestPlaceholders["VKIDClientID"]`, `VKIDClientSecret`, etc.

Check Maven repo:
```bash
grep "vkid-sdk-android" app-sdk/android/settings.gradle
```
Expected: VK Maven repository URL present.

- [ ] **Step 5: Recreate local.properties if missing**

```bash
echo 'sdk.dir=C\:\\Users\\Mukhtar\\AppData\\Local\\Android\\Sdk' > app-sdk/android/local.properties
```

- [ ] **Step 6: Add usesCleartextTraffic for local HTTP testing**

Edit `app-sdk/android/app/src/main/AndroidManifest.xml` — add `android:usesCleartextTraffic="true"` to the `<application>` tag.

- [ ] **Step 7: Build release APK**

```bash
cd app-sdk/android && JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot" ./gradlew assembleRelease
```
Expected: `BUILD SUCCESSFUL`

APK at: `app-sdk/android/app/build/outputs/apk/release/app-release.apk`

**Note:** If the build fails with VK SDK import errors in `ExpoVKSDKModule.kt`, the SDK's class names may differ from what's in the plan. Check the VK SDK source/docs for exact class names (`VKIDAuthParams`, `AuthCodeData`, `VKIDAuthCallback`, etc.) and adjust the imports.

---

### Task 12: E2E test on device

- [ ] **Step 1: Start the server**

```bash
cd server && node src/index.js
```
Expected: `Server running on port 5173`

- [ ] **Step 2: Install APK on device**

Transfer `app-sdk/android/app/build/outputs/apk/release/app-release.apk` to Android device and install.

Ensure device is on the same WiFi as PC (192.168.87.x subnet).

- [ ] **Step 3: Run E2E test checklist**

1. App opens → loading spinner → redirects to `/login`
2. Login screen shows `VK OAuth SDK Demo v1` in title
3. Tap "Sign in with VK" → VK SDK auth WebView opens (not Chrome Custom Tab)
4. Authenticate with VK credentials → WebView closes
5. Brief loading state → navigates to `/home`
6. Home shows user's first name, last name, VK ID
7. Tap Logout → returns to `/login`
8. Reopen app → still logged in (JWT persisted in SecureStore)
9. Cancel VK auth mid-flow → stays on `/login`, no crash, error may show briefly

- [ ] **Step 4: Check server logs**

Verify the server console shows:
```
POST /auth/vk/exchange
```
when login completes successfully.

**Note on VK Console:** The VK app (ID 54501952) may need the new package name `com.vkoauth.appsdk` added in VK console settings, plus the SHA-256 fingerprint of the APK signing key. If VK rejects the auth request, check the VK app settings at https://id.vk.com/about/business/go/my-apps/.
