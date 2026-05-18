import ExpoModulesCore
import GoogleSignIn

// Forwards the OAuth callback URL (com.googleusercontent.apps.<iosClientId>://...) to
// GIDSignIn so the native Google sign-in flow can complete.
public class ExpoGoogleSDKAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return GIDSignIn.sharedInstance.handle(url)
  }
}
