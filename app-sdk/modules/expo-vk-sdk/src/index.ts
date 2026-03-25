import { requireNativeModule } from "expo-modules-core";
import type { AuthCodeResult } from "./ExpoVKSDK.types";

const ExpoVKSDK = requireNativeModule("ExpoVKSDK");

export async function authorize(
  codeChallenge: string,
  state: string
): Promise<AuthCodeResult> {
  return ExpoVKSDK.authorize(codeChallenge, state);
}
