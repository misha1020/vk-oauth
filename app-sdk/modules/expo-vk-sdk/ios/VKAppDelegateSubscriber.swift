import ExpoModulesCore

public class VKAppDelegateSubscriber: ExpoAppDelegateSubscriber {

#if os(iOS) || os(tvOS)
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return ExpoVKSDKModule.handleOpenURL(url)
  }
#endif
}
