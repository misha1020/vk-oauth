import ExpoModulesCore
import GoogleSignIn

public class ExpoGoogleSDKModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoGoogleSDK")

    // Args: webClientId (String) — accepted for API parity with Android, but on iOS
    // the GoogleSignIn pod reads GIDServerClientID from Info.plist directly, so this
    // value is unused at the Swift layer. nonce (String) — passed to signIn's nonce: param.
    AsyncFunction("authorize") { (webClientId: String, nonce: String, promise: Promise) in
      DispatchQueue.main.async {
        guard let rootVC = Self.topRootViewController() else {
          promise.reject("NO_VIEW_CONTROLLER", "No root view controller")
          return
        }

        GIDSignIn.sharedInstance.signIn(
          withPresenting: rootVC,
          hint: nil,
          additionalScopes: nil,
          nonce: nonce
        ) { result, error in
          if let nsErr = error as NSError? {
            // Use the SDK's typed enum rather than a magic literal for cancellation —
            // GIDSignInError.canceled bridges to NSError with domain "com.google.GIDSignIn".
            if nsErr.domain == kGIDSignInErrorDomain && nsErr.code == GIDSignInError.canceled.rawValue {
              promise.resolve(["cancelled": true])
            } else {
              promise.reject("GOOGLE_AUTH_ERROR", nsErr.localizedDescription)
            }
            return
          }
          guard let idToken = result?.user.idToken?.tokenString else {
            // Defensive: should not happen when GIDServerClientID is set in Info.plist.
            promise.reject("NO_ID_TOKEN", "Sign-in succeeded but no ID token in result")
            return
          }
          promise.resolve(["idToken": idToken])
        }
      }
    }
  }

  private static func topRootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let activeScene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
    let keyWindow = activeScene?.windows.first(where: { $0.isKeyWindow }) ?? activeScene?.windows.first
    return keyWindow?.rootViewController
  }
}
