const {
  withAppBuildGradle,
  withInfoPlist,
} = require("@expo/config-plugins");

function withYandexSDKAndroid(config, { clientId }) {
  // The Yandex SDK's bundled AndroidManifest declares
  //   <meta-data android:name="com.yandex.auth.CLIENT_ID" android:value="${YANDEX_CLIENT_ID}"/>
  // (plus deep-link entries that interpolate the same placeholder). Supply it via
  // manifestPlaceholders in the host app's build.gradle.
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('manifestPlaceholders["YANDEX_CLIENT_ID"]')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(defaultConfig\s*\{)/,
        `$1\n        manifestPlaceholders["YANDEX_CLIENT_ID"] = "${clientId}"`
      );
    }
    return cfg;
  });
}

function withYandexSDKIos(config, { clientId }) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.YandexClientID = clientId;

    // Native-app SSO callback scheme — not currently hit with .webOnly, but the SDK
    // still requires the entry to be registered.
    const callbackScheme = `yx${clientId}`;
    const urlTypes = cfg.modResults.CFBundleURLTypes || [];
    if (
      !urlTypes.some((t) =>
        (t.CFBundleURLSchemes || []).includes(callbackScheme)
      )
    ) {
      cfg.modResults.CFBundleURLTypes = [
        ...urlTypes,
        { CFBundleURLName: "yandex-id", CFBundleURLSchemes: [callbackScheme] },
      ];
    }

    // MANDATORY — SDK's ActivationValidator runs at activate() and throws
    // ActivationError.absentQueriesScheme (NSError code 0) if these are missing,
    // regardless of which strategy is used at authorize() time. `try?` in the
    // AppDelegate swallows the error and Yandex login fails with no diagnostic.
    const required = ["primaryyandexloginsdk", "secondaryyandexloginsdk"];
    const existing = cfg.modResults.LSApplicationQueriesSchemes || [];
    const missing = required.filter((s) => !existing.includes(s));
    if (missing.length) {
      cfg.modResults.LSApplicationQueriesSchemes = [...existing, ...missing];
    }

    return cfg;
  });
}

// Accept both per-platform `{ android: { clientId }, ios: { clientId } }` and
// the flat legacy `{ clientId }` (used for both platforms).
function withYandexSDK(config, opts) {
  if (!opts) throw new Error("withYandexSDK: options are required");

  const android = opts.android || (opts.clientId ? { clientId: opts.clientId } : null);
  const ios = opts.ios || (opts.clientId ? { clientId: opts.clientId } : null);

  if (android && !android.clientId)
    throw new Error("withYandexSDK: android.clientId is required");
  if (ios && !ios.clientId)
    throw new Error("withYandexSDK: ios.clientId is required");

  if (android) config = withYandexSDKAndroid(config, android);
  if (ios) config = withYandexSDKIos(config, ios);

  return config;
}

module.exports = withYandexSDK;
