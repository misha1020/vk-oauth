# Google Sign-In — Production Mobile Implementation

**Audience:** Mobile dev adding "Sign in with Google" to the production AM Expo app
(React Native + GraphQL).

**Status:** Spec, ready to implement. **Verified on a physical Android device 2026-05-18** in
the `social-oauth` test app (release APK build 4). iOS code is written but **never compiled in
the test app** (no Apple Developer Team ID); production app is where iOS gets its first build.

**Companion docs:**
- Yandex equivalent (read first if porting both): [`docs/main-app-yandex-jwt-mobile.md`](./main-app-yandex-jwt-mobile.md).
- Backend side of this flow: [`docs/main-app-google-backend.md`](./main-app-google-backend.md).

**Reference implementation (working, tested on Android):**
- [`app-sdk/modules/expo-google-sdk/`](../app-sdk/modules/expo-google-sdk/) — the native module
  (Android Kotlin verified; iOS Swift written but uncompiled).
- [`app-sdk/plugins/withGoogleSDK.js`](../app-sdk/plugins/withGoogleSDK.js) — config plugin
  (writes `GIDClientID` + `GIDServerClientID` + reversed-client-id URL scheme into Info.plist).
- [`app-sdk/src/hooks/useGoogleAuth.ts`](../app-sdk/src/hooks/useGoogleAuth.ts) — the app-side hook.
- [`app-sdk/src/services/api.ts`](../app-sdk/src/services/api.ts) — `exchangeGoogleJwt` REST
  call (production should call the GraphQL mutation instead — see §4).

---

## 0. The flow

```
[App] tap "Sign in with Google"
  → [JS hook] generate nonce = Crypto.randomUUID()
  → [Native module] authorize(webClientId, nonce)
       Android: Credential Manager + GetSignInWithGoogleOption
       iOS:     GIDSignIn.signIn(withPresenting:hint:additionalScopes:nonce:)
       user picks account, consents
  → [Native module] returns { idToken } (or { cancelled: true })
  → [GraphQL] socialAuthByJwt(provider:"google", jwt: idToken, nonce: nonce)
  → [Backend] verifies sig + aud + nonce + email_verified, returns AuthPayload
  → [App] store tokens, navigate home
```

**The nonce flow is the design's main security feature** — the JS hook generates it, the native
SDK forwards it to Google, Google embeds it in the ID token, and the backend compares the
embedded nonce against the one your client sent in the request body. Stolen tokens don't
replay because the attacker doesn't know which nonce was paired with which token.

---

## 1. OAuth client registration — what's different from VK/Yandex

Google requires **three separate OAuth client IDs** per Google Cloud project — one per platform:

| Client type | Bound to | Used by |
|---|---|---|
| **Web** | nothing (no SHA, no bundle) | Both Android and iOS native SDKs as `serverClientId` / `GIDServerClientID`. **Also used by the backend as `audience`.** |
| **Android** | Android package + release-keystore SHA-1 | Internally by the Android client at install time. Not passed in code anywhere. |
| **iOS** | iOS bundle identifier | iOS SDK reads from Info.plist as `GIDClientID`. **Also drives the reversed URL scheme.** |

**Pre-requisites before mobile build:**

1. **OAuth consent screen** configured (External; Internal needs a Google Workspace org and is
   the wrong choice for a consumer app).
2. **Web client created** — copy the client ID; this is `GOOGLE_WEB_CLIENT_ID` on the backend
   and `webClientId` in the mobile code.
3. **Android client created** with the production **package name** + **release-keystore SHA-1**
   (`keytool -list -v -keystore <release.keystore>`). The debug-keystore SHA used in the test
   app will NOT work for production.
4. **iOS client created** with the production **bundle identifier**. Apple Developer Team ID is
   *not* a Google Console field, but Apple will only let you use the bundle on a profile that
   matches your Team ID, so you do need an Apple Developer account active to actually build iOS.

> ⚠️ The test app's Google client IDs are bound to `com.vkoauth.appsdk` + a debug keystore SHA.
> Do **not** ship them. Mint new ones for production.

---

## 2. Expo native module setup (delta from VK/Yandex pattern)

The structure mirrors `expo-yandex-sdk` exactly — same file layout, same `expo-module.config.json`,
same `requireNativeModule` shim. If you've already shipped Yandex in the production app, you
already know this pattern. Differences:

| | Yandex SDK module | Google SDK module |
|---|---|---|
| Android library | `com.yandex.android:authsdk:3.2.0` | `androidx.credentials:credentials:1.7.0-alpha02` + `androidx.credentials:credentials-play-services-auth:1.7.0-alpha02` + `com.google.android.libraries.identity.googleid:googleid:1.1.1` |
| iOS pod | `YandexLoginSDK ~> 3.0` | `GoogleSignIn ~> 9.0` (9.x adds the `nonce:` parameter we need) |
| Config plugin needs | manifest placeholder for `YANDEX_CLIENT_ID` | Info.plist keys (`GIDClientID`, `GIDServerClientID`) + reversed-client-id URL scheme |
| Runtime args from JS | none | `webClientId`, `nonce` |

The full Kotlin / Swift / podspec / plugin files in [`app-sdk/modules/expo-google-sdk/`](../app-sdk/modules/expo-google-sdk/)
and [`app-sdk/plugins/withGoogleSDK.js`](../app-sdk/plugins/withGoogleSDK.js) work as-is —
copy them into the production app and update the OAuth client IDs.

---

## 3. Android — Credential Manager + Sign in with Google

### 3.1 Why Credential Manager (and not the older `GoogleSignInClient`)

The legacy `com.google.android.gms.auth.api.signin.GoogleSignInClient` was deprecated by Google
in 2023. The current 2026 path is **Credential Manager** (`androidx.credentials`) + the
**Google ID Token** credential type from `com.google.android.libraries.identity.googleid`.

There are two ways to surface the picker:

| | `GetGoogleIdOption` | `GetSignInWithGoogleOption` |
|---|---|---|
| UX | Bottom-sheet "One Tap" auto-prompt | Full picker, only triggered by user-tap on a Sign-In button |
| Use it when | You want the prompt to auto-appear (e.g. on app start) | The user explicitly taps "Sign in with Google" |
| `filterByAuthorizedAccounts` | yes (and gotcha-prone — first sign-in needs `false`, repeat sign-in needs `true`) | n/a |

**This module uses `GetSignInWithGoogleOption`** — the button flow. Always shows the picker,
matches the "Sign in with Google" button on the login screen, no first-time/repeat-time
divergence.

### 3.2 The Kotlin module (reference)

See [`ExpoGoogleSDKModule.kt`](../app-sdk/modules/expo-google-sdk/android/src/main/java/expo/modules/googlesdk/ExpoGoogleSDKModule.kt).
Key implementation points (already applied in the test app — copy verbatim):

- **Re-entrancy guard:** `pendingPromise: Promise?` field; reject second call with
  `IN_PROGRESS` if non-null. Prevents double-tap from launching two parallel pickers
  (matches `ExpoYandexSDKModule.kt`).
- **Lifecycle-bound coroutine:** `activity.lifecycleScope.launch { ... }`, not a free
  `CoroutineScope(Dispatchers.Main)`. If the activity dies mid-auth, the coroutine is
  cancelled cleanly — no `promise.resolve/reject` onto a dead JS bridge.
- **Cancellation sentinel:** `GetCredentialCancellationException` → `resolve({ cancelled: true })`
  rather than reject. The JS hook treats this as "user backed out" and stays silent.
- **`NoCredentialException` → `NO_GOOGLE_ACCOUNT` rejection.** Fires when no Google account is
  signed in on the device. Show a helpful UI for this code, not a generic error.
- **The `CancellationException` catch** at the end of the coroutine is for activity-death
  cancellation only (it rethrows after clearing the pending promise). Don't confuse it with
  `GetCredentialCancellationException` (user cancel) earlier in the chain.

### 3.3 Gradle deps (in the module's own `build.gradle`)

```groovy
dependencies {
    implementation project(':expo-modules-core')
    implementation "androidx.appcompat:appcompat:1.6.1"
    implementation "androidx.activity:activity-ktx:1.8.2"
    // Credential Manager + Sign in with Google — alpha at time of writing; check
    // https://developer.android.com/jetpack/androidx/releases/credentials for current stable
    implementation "androidx.credentials:credentials:1.7.0-alpha02"
    implementation "androidx.credentials:credentials-play-services-auth:1.7.0-alpha02"
    implementation "com.google.android.libraries.identity.googleid:googleid:1.1.1"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3"
}
```

> ⚠️ The `androidx.credentials:1.7.0-alpha02` line is the version verified on-device
> 2026-05-18. If a later **stable** release is available when you ship, prefer it. The 1.6.x
> stable line works but the alpha exposes the most current `GetSignInWithGoogleOption` API.

### 3.4 No manifest changes in the module

The module's [`AndroidManifest.xml`](../app-sdk/modules/expo-google-sdk/android/src/main/AndroidManifest.xml)
is empty. The Web Client ID is passed at runtime from JS (`authorize(webClientId, nonce)`) — no
manifest placeholder, no merged meta-data entry. Matches the Yandex pattern of "config plugin
doesn't need to touch the Android manifest".

---

## 4. iOS — `GoogleSignIn` pod + nonce flow

### 4.1 First-build status

**The Swift module exists in the test app but has never been compiled** — same convention as
the Yandex iOS module. Treat this section as "written, pending first iOS build" rather than
"verified".

### 4.2 The Swift module (reference)

See [`ExpoGoogleSDKModule.swift`](../app-sdk/modules/expo-google-sdk/ios/ExpoGoogleSDKModule.swift).
Key calls:

```swift
GIDSignIn.sharedInstance.signIn(
  withPresenting: rootVC,
  hint: nil,
  additionalScopes: nil,
  nonce: nonce            // ← THIS is why we pin GoogleSignIn ~> 9.0
) { result, error in ... }
```

The `nonce:` parameter on `signIn(withPresenting:hint:additionalScopes:nonce:)` was added in
GoogleSignIn 9.0. Older versions (7.x, 8.x) do not have it — pinning 9.0+ is essential.

### 4.3 Cancellation handling

```swift
if nsErr.domain == kGIDSignInErrorDomain && nsErr.code == GIDSignInError.canceled.rawValue {
  promise.resolve(["cancelled": true])
} else {
  promise.reject("GOOGLE_AUTH_ERROR", nsErr.localizedDescription)
}
```

Uses the SDK's exported `kGIDSignInErrorDomain` constant and the typed `GIDSignInError.canceled`
enum case — no magic numbers. Verify both symbols are exported by the version you pin (they
have been since GoogleSignIn 5.x).

### 4.4 AppDelegate URL-callback forwarding

The native Google sign-in flow opens a `com.googleusercontent.apps.<iosClientId>://` URL when
returning from Safari / the Google app. That URL must be forwarded to `GIDSignIn.handle(url:)`.
See [`ExpoGoogleSDKAppDelegate.swift`](../app-sdk/modules/expo-google-sdk/ios/ExpoGoogleSDKAppDelegate.swift)
— it's an `ExpoAppDelegateSubscriber`:

```swift
public func application(
  _ app: UIApplication,
  open url: URL,
  options: [UIApplication.OpenURLOptionsKey: Any] = [:]
) -> Bool {
  return GIDSignIn.sharedInstance.handle(url)
}
```

The subscriber is registered in `expo-module.config.json` under `ios.appDelegateSubscribers` —
do not skip this, or sign-in will hang on the redirect.

### 4.5 Config plugin — Info.plist and URL scheme

[`withGoogleSDK.js`](../app-sdk/plugins/withGoogleSDK.js) writes three things into Info.plist
during `expo prebuild`:

```js
cfg.modResults.GIDClientID = iosClientId;
cfg.modResults.GIDServerClientID = webClientId;

const reversedClientId = `com.googleusercontent.apps.${iosClientId.replace(
  ".apps.googleusercontent.com", ""
)}`;
// add a CFBundleURLTypes entry with [reversedClientId] in CFBundleURLSchemes
```

- `GIDClientID` is the **iOS** client ID — what GoogleSignIn uses to identify the app.
- `GIDServerClientID` is the **Web** client ID — drives what `aud` Google puts in the ID token.
  **The backend verifies against the Web client ID, so this MUST match the server's
  `GOOGLE_WEB_CLIENT_ID`.**
- The reversed URL scheme is the OAuth callback URL Google will open when returning from
  Safari; the AppDelegate subscriber forwards it.

Wire the plugin in `app.json`:

```json
[
  "./plugins/withGoogleSDK",
  {
    "iosClientId": "<production iOS client ID>.apps.googleusercontent.com",
    "webClientId": "<production Web client ID>.apps.googleusercontent.com"
  }
]
```

The plugin **throws** if either argument is missing — no silent misconfiguration.

### 4.6 First-build verifications (iOS)

1. **`kGIDSignInErrorDomain` + `GIDSignInError.canceled.rawValue` are exported** by the
   GoogleSignIn 9.x headers (they are at time of writing, but pod headers do change).
2. **`pod install` resolves `GoogleSignIn ~> 9.0`** — should come from CocoaPods trunk, no
   private spec source needed.
3. **`GIDClientID` + `GIDServerClientID` keys** end up in the prebuilt `Info.plist` after
   `expo prebuild --clean`. Open `ios/<App>/Info.plist` and check.
4. **The reversed URL scheme** is present in `CFBundleURLTypes` (also in Info.plist).
5. The native picker actually appears on tap — if Safari opens to a Google sign-in page
   instead of the in-app picker, GoogleSignIn fell back to the browser flow, which usually
   means `GIDClientID` isn't being read at startup. Re-check Info.plist after the build.

---

## 5. App-side hook + GraphQL mutation

### 5.1 `useGoogleAuth.ts` (adapt for GraphQL)

The test app's hook uses a REST call (`exchangeGoogleJwt` in `api.ts`). For the GraphQL prod
app, swap that for the mutation. Otherwise the hook is correct as-is:

```typescript
import { useCallback, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { authorize as googleAuthorize } from "../../modules/expo-google-sdk";
// import { useSocialAuthByJwtMutation } from "../generated/graphql";
import { GOOGLE_WEB_CLIENT_ID } from "../config";

export interface GoogleAuthSuccess {
  accessToken: string;
  refreshToken?: string;
}

export function useGoogleAuth(onSuccess: (result: GoogleAuthSuccess) => void) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  // const [socialAuthByJwt] = useSocialAuthByJwtMutation();

  const authorize = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const nonce = Crypto.randomUUID();   // 36-char UUID v4 — uniform random, single-use
      const result = await googleAuthorize(GOOGLE_WEB_CLIENT_ID, nonce);
      if ("cancelled" in result && result.cancelled) {
        return; // user backed out — silent
      }

      // const { data } = await socialAuthByJwt({
      //   variables: { provider: "google", jwt: result.idToken, nonce },
      // });
      // if (!data?.socialAuthByJwt?.success) {
      //   throw new Error("Backend rejected Google ID token");
      // }
      // onSuccessRef.current({
      //   accessToken: data.socialAuthByJwt.tokens.accessToken,
      //   refreshToken: data.socialAuthByJwt.tokens.refreshToken,
      // });

      throw new Error("TODO: wire socialAuthByJwt mutation here");
    } catch (err: any) {
      setError(err.message || "Google authentication failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { authorize, isLoading, error };
}
```

**Three things that MUST be the same call:**
- The nonce passed into `googleAuthorize(webClientId, nonce)` MUST be the same nonce sent to
  `socialAuthByJwt`. Don't regenerate it after the native call — the value in the token will
  no longer match what you send.
- `webClientId` is the **Web** client ID, not Android. The mobile native SDKs need this to
  request the cross-platform-verifiable ID token.
- The mutation argument is named **`jwt`** (sharing the generic `socialAuthByJwt` mutation),
  even though Google calls it an ID token. Both refer to the same string.

### 5.2 The GraphQL mutation (defined backend-side — see backend doc §2)

```graphql
socialAuthByJwt(provider: "google", jwt: $idToken, nonce: $nonce) {
  success
  user { id provider providerId firstName lastName email avatarId }
  tokens { accessToken refreshToken }
}
```

### 5.3 Login button

A `Pressable` calling `authorize()` — see [`app-sdk/app/login.tsx`](../app-sdk/app/login.tsx).
Style with Google's signature `#4285F4` background per Google's brand guidelines (use a
"Sign in with Google" Material button if your design system has one).

---

## 6. Sign-out — clearCredentialState (NOT yet done in the test app)

**Status:** ⚠️ Known follow-up. The test app's `useAuth.logout` does NOT call
`CredentialManager.clearCredentialState()`. As a result, after sign-out the next "Sign in with
Google" tap can return the previously-used account silently without re-showing the picker
(see design doc Section 5).

For production, expose `clearCredentialState` from the native module and call it from
`logout()`:

```kotlin
// In ExpoGoogleSDKModule.kt
AsyncFunction("clearCredentialState") { promise: Promise ->
    val activity = appContext.currentActivity as? ComponentActivity
    if (activity == null) {
        promise.reject(GoogleAuthException("NO_ACTIVITY", "No ComponentActivity available"))
        return@AsyncFunction
    }
    val credentialManager = CredentialManager.create(activity)
    activity.lifecycleScope.launch {
        try {
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
            promise.resolve(null)
        } catch (e: ClearCredentialException) {
            promise.reject(GoogleAuthException("CLEAR_FAILED", e.message ?: "Clear failed"))
        }
    }
}
```

For iOS, the equivalent is `GIDSignIn.sharedInstance.signOut()` — wrap it in a parallel
`AsyncFunction("signOut")` in `ExpoGoogleSDKModule.swift`.

Call both from the JS hook on app logout. The test app skipped this because the manual test
checklist's #6 still passes by uninstalling/reinstalling the APK between runs — the production
app obviously cannot rely on that.

---

## 7. Build & test

**Build.** Editing the native module *source* (Kotlin/Swift/JS shim) does **not** require
`expo prebuild`. Run `prebuild` only when `app.json`, the config plugin, `expo-module.config.json`,
or a native dependency changes (e.g. the first time you add the module).

```bash
# Android release APK:
cd app-sdk
npx expo prebuild --no-install         # only the first time / when config changes
cd android
JAVA_HOME="<jdk-17-path>" ./gradlew assembleRelease
# APK at: android/app/build/outputs/apk/release/app-release.apk
```

(The test app's machine doesn't have a device attached during build — APK is installed manually.
Adapt to your CI / device-attached workflow as appropriate.)

**Manual test checklist** (the 8 items from the design doc, only #1 was passed on 2026-05-18):

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Happy path: tap button, pick account, consent | App receives session JWT, home screen loads |
| 2 | Dismiss picker (back / outside tap) | No error UI, button returns idle (the `cancelled: true` sentinel) |
| 3 | No Google account on device | Error UI: "No Google account on this device" (the `NO_GOOGLE_ACCOUNT` code from native) |
| 4 | Airplane mode after picker | Error UI: network error; UI doesn't crash |
| 5 | Tamper nonce | Server `UNAUTHENTICATED/GOOGLE_NONCE_MISMATCH`; app error UI |
| 6 | Sign out, sign in again | Account picker re-appears (requires §6's `clearCredentialState`) |
| 7 | Sign in twice with same account | No duplicate in users table |
| 8 | Sign in with different account | Picker shows both; second user created |

---

## 8. Delta from `main-app-yandex-jwt-mobile.md`

| Yandex | Google |
|---|---|
| Native module returns `{ accessToken, expiresIn, jwt }` | Returns `{ idToken }` or `{ cancelled: true }` |
| One OAuth client (Android), iOS not yet registered | Three OAuth clients (Web, Android, iOS) — Web is the audience server-side |
| Manifest placeholder `YANDEX_CLIENT_ID` from config plugin | No manifest changes; `webClientId` is a runtime arg from JS |
| iOS reads `YANDEX_CLIENT_ID` from `Info.plist` | iOS reads `GIDClientID` + `GIDServerClientID` from `Info.plist`; needs reversed-client-id URL scheme + AppDelegate subscriber |
| Hook has no nonce | Hook generates `Crypto.randomUUID()` nonce per attempt; same nonce goes natively + to backend |
| `getJwt()` is a blocking network call on Android (worker thread required) | `getCredential` is suspend (coroutine on `lifecycleScope`) |
| Mutation: `socialAuthByJwt(provider, jwt)` | Mutation: `socialAuthByJwt(provider, jwt, nonce)` (extend the existing one) |
| Cancellation: `YandexAuthResult.Cancelled` branch | Cancellation: `GetCredentialCancellationException` (Android) or `GIDSignInError.canceled` (iOS) |
| Sign-out: SDK has no first-class clear (re-tap re-uses cached token by design) | Sign-out: must call `CredentialManager.clearCredentialState()` / `GIDSignIn.signOut()` — see §6 |

---

## 9. References

- Backend side: [`docs/main-app-google-backend.md`](./main-app-google-backend.md)
- Design + plan (history): [`docs/google/2026-05-15-design.md`](./google/2026-05-15-design.md),
  [`docs/google/2026-05-18-plan.md`](./google/2026-05-18-plan.md)
- Working reference module + plugin + hook:
  [`app-sdk/modules/expo-google-sdk/`](../app-sdk/modules/expo-google-sdk/),
  [`app-sdk/plugins/withGoogleSDK.js`](../app-sdk/plugins/withGoogleSDK.js),
  [`app-sdk/src/hooks/useGoogleAuth.ts`](../app-sdk/src/hooks/useGoogleAuth.ts)
- Android Credential Manager: https://developer.android.com/identity/sign-in/credential-manager-siwg
- GoogleSignIn iOS pod: https://developers.google.com/identity/sign-in/ios/start-integrating
- Google Cloud Console (OAuth clients): https://console.cloud.google.com/apis/credentials

If this doc conflicts with the reference `app-sdk/` code at runtime, **trust the `app-sdk/`
code** — the Android path is the artifact verified on a physical device 2026-05-18. (The iOS
path is unverified everywhere; the first iOS build is where it gets confirmed.)
