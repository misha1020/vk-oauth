const { withInfoPlist } = require("@expo/config-plugins");

// Android: nothing to do at the plugin level. The Kotlin module receives the Web Client ID
// as a runtime argument from JS, so no manifest placeholder is needed. Module Gradle deps
// are already declared in the module's own build.gradle.
//
// iOS: GoogleSignIn pod requires GIDClientID + GIDServerClientID + a URL scheme entry
// in Info.plist (the reversed iOS client ID). The pod handles the rest internally.
function withGoogleSDK(config, { iosClientId, webClientId }) {
  if (!iosClientId) throw new Error("withGoogleSDK: iosClientId is required");
  if (!webClientId) throw new Error("withGoogleSDK: webClientId is required");

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.GIDClientID = iosClientId;
    cfg.modResults.GIDServerClientID = webClientId;

    // Reversed iOS client ID format:
    //   "470263963924-ft3...xyz.apps.googleusercontent.com"
    //   → "com.googleusercontent.apps.470263963924-ft3...xyz"
    const reversedClientId = `com.googleusercontent.apps.${iosClientId.replace(
      ".apps.googleusercontent.com",
      ""
    )}`;

    cfg.modResults.CFBundleURLTypes = cfg.modResults.CFBundleURLTypes || [];
    const exists = cfg.modResults.CFBundleURLTypes.some((t) =>
      (t.CFBundleURLSchemes || []).includes(reversedClientId)
    );
    if (!exists) {
      cfg.modResults.CFBundleURLTypes.push({
        CFBundleURLSchemes: [reversedClientId],
      });
    }
    return cfg;
  });

  return config;
}

module.exports = withGoogleSDK;
