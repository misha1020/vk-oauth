const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withInfoPlist,
} = require("@expo/config-plugins");

function withVKSDKAndroid(config, { clientId, clientSecret }) {
  // 1. Add VK Maven repo to root build.gradle allprojects.repositories
  config = withProjectBuildGradle(config, (cfg) => {
    const vkRepo =
      "maven { url 'https://artifactory-external.vkpartner.ru/artifactory/vkid-sdk-android/' }";
    if (!cfg.modResults.contents.includes("vkid-sdk-android")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(allprojects\s*\{\s*repositories\s*\{)/,
        `$1\n        ${vkRepo}`
      );
    }
    return cfg;
  });

  // 2. Inject manifest placeholders into app/build.gradle defaultConfig
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

function withVKSDKIos(config, { clientId, clientSecret }) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.VKIDClientID = clientId;
    cfg.modResults.VKIDClientSecret = clientSecret;

    // VKID probes for the installed VK app via canOpenURL
    const requiredSchemes = ["vkauthorize-silent", "vk-share", "vkauthorize"];
    const existing = cfg.modResults.LSApplicationQueriesSchemes || [];
    cfg.modResults.LSApplicationQueriesSchemes = [
      ...new Set([...existing, ...requiredSchemes]),
    ];

    // VKID's RegisteredURLSchemeChecker fatalErrors at init unless our app
    // declares `vk{clientId}` under CFBundleURLTypes
    const ownScheme = `vk${clientId}`;
    const urlTypes = cfg.modResults.CFBundleURLTypes || [];
    const hasOwnScheme = urlTypes.some((t) =>
      (t.CFBundleURLSchemes || []).includes(ownScheme)
    );
    if (!hasOwnScheme) {
      cfg.modResults.CFBundleURLTypes = [
        ...urlTypes,
        { CFBundleURLName: "vkid", CFBundleURLSchemes: [ownScheme] },
      ];
    }
    return cfg;
  });
}

// Accept both per-platform `{ android: { clientId, clientSecret }, ios: {...} }`
// and the flat legacy `{ clientId, clientSecret }` (treated as shared across platforms).
function withVKSDK(config, opts) {
  if (!opts) throw new Error("withVKSDK: options are required");

  const android = opts.android || (opts.clientId ? opts : null);
  const ios = opts.ios || (opts.clientId ? opts : null);

  if (android) config = withVKSDKAndroid(config, android);
  if (ios) config = withVKSDKIos(config, ios);

  return config;
}

module.exports = withVKSDK;
