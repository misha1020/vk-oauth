import ExpoModulesCore
import YandexLoginSDK

public class ExpoYandexSDKAppDelegate: ExpoAppDelegateSubscriber {
  // Activation must happen on the main thread. ExpoYandexSDKModule.OnCreate runs on a
  // background thread, where YandexLoginSDK.activate throws a thread assertion that
  // `try?` silently swallows — leaving the SDK un-initialised when authorize() is called.
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "YandexClientID") as? String,
          !clientId.isEmpty else {
      ExpoYandexSDKModule.activationError = "YandexClientID missing from Info.plist"
      return true
    }
    do {
      try YandexLoginSDK.shared.activate(with: clientId)
      ExpoYandexSDKModule.isActivated = true
    } catch {
      ExpoYandexSDKModule.activationError = "YandexLoginSDK activate failed: \(error.localizedDescription)"
    }
    return true
  }

  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return YandexLoginSDK.shared.tryHandleOpenURL(url)
  }

  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return YandexLoginSDK.shared.tryHandleUserActivity(userActivity)
  }
}
