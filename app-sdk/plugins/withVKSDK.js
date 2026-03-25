const {
  withProjectBuildGradle,
  withAppBuildGradle,
} = require("@expo/config-plugins");

function withVKSDK(config, { clientId, clientSecret }) {
  // 1. Add VK Maven repo to root build.gradle allprojects.repositories
  config = withProjectBuildGradle(config, (cfg) => {
    const vkRepo =
      "maven { url 'https://artifactory-external.vkpartner.ru/artifactory/vkid-sdk-android/' }";
    if (!cfg.modResults.contents.includes("vkid-sdk-android")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(allprojects\s*\{\s*repositories\s*\{)/,
        `$1\n    ${vkRepo}`
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
