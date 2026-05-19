import * as Linking from "expo-linking";

/**
 * Expo Router 6 native intent redirector.
 *
 * Runs before any route mounts (cold start) and before any URL is dispatched
 * to React Navigation (hot URL events). Used here only to silently swallow VK
 * and Yandex OAuth callback URLs so Expo Router does not race the AppDelegate
 * hooks and strand the user on Unmatched Route.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const parsed = Linking.parse(path);

    // VKID iOS SDK returns via `<scheme>://vk-auth-callback?...`. VKAppDelegateSubscriber
    // consumes this synchronously; Linking would otherwise dispatch it to Unmatched Route.
    // Returning '' tells expo-router/build/link/linking.js to skip the listener call.
    if (parsed.hostname === "vk-auth-callback" || parsed.path === "vk-auth-callback") {
      return "";
    }

    // Yandex SDK 3.x native-app SSO redirects via `yx<clientId>://authorize/?code=...&state=...`
    // when the Yandex Browser / Yandex app is installed. ExpoYandexSDKAppDelegate consumes
    // it via tryHandleOpenURL; we swallow here to avoid the same race.
    if (parsed.scheme?.startsWith("yx") && parsed.hostname === "authorize") {
      return "";
    }

    return path;
  } catch {
    return path;
  }
}
