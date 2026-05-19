import type { YandexAuthResult } from "./ExpoYandexSDK.types";

let ExpoYandexSDK: any = null;
try {
  ExpoYandexSDK = require("expo-modules-core").requireNativeModule("ExpoYandexSDK");
} catch {
  // Native module not available (Expo Go) — authorize will throw
}

export async function authorize(): Promise<YandexAuthResult> {
  if (!ExpoYandexSDK) {
    throw new Error(
      "Yandex SDK is not available in Expo Go. Use a development build or release APK."
    );
  }
  return ExpoYandexSDK.authorize();
}

export async function logout(): Promise<void> {
  if (!ExpoYandexSDK) return;
  try {
    await ExpoYandexSDK.logout();
  } catch {
    // Best-effort: signOut must never block on Yandex logout (see iOS module rationale).
  }
}
