import type { GoogleAuthResult } from "./ExpoGoogleSDK.types";

let ExpoGoogleSDK: any = null;
try {
  ExpoGoogleSDK = require("expo-modules-core").requireNativeModule("ExpoGoogleSDK");
} catch {
  // Native module not available (Expo Go) — authorize will throw.
}

export async function authorize(
  webClientId: string,
  nonce: string
): Promise<GoogleAuthResult> {
  if (!ExpoGoogleSDK) {
    throw new Error(
      "Google SDK is not available in Expo Go. Use a development build or release APK."
    );
  }
  return ExpoGoogleSDK.authorize(webClientId, nonce);
}
