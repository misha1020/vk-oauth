import AuthenticationServices
import ExpoModulesCore
import YandexLoginSDK

public class ExpoYandexSDKModule: Module {
  private var pendingPromise: Promise?

  // Set by ExpoYandexSDKAppDelegate.didFinishLaunchingWithOptions (main thread).
  static var isActivated = false
  static var activationError: String? = nil

  public func definition() -> ModuleDefinition {
    Name("ExpoYandexSDK")

    OnCreate {
      // Activation is handled in ExpoYandexSDKAppDelegate.didFinishLaunchingWithOptions
      // (main thread). Observer registration is safe from any thread.
      YandexLoginSDK.shared.add(observer: self)
    }

    AsyncFunction("logout") { (promise: Promise) in
      // ASWebAuthenticationSession shares cookies with Safari, so a surviving Yandex
      // passport session makes the next authorize() auto-resume with no UI.
      // SDK 3.1.0 signature: `logout() throws` — best-effort, never block sign-out.
      DispatchQueue.main.async {
        try? YandexLoginSDK.shared.logout()
        promise.resolve(nil)
      }
    }

    AsyncFunction("authorize") { (promise: Promise) in
      if let err = Self.activationError {
        promise.reject("YANDEX_AUTH_ERROR", err)
        return
      }
      if !Self.isActivated {
        promise.reject("YANDEX_AUTH_ERROR", "YandexLoginSDK not activated — check YandexClientID in Info.plist")
        return
      }
      if self.pendingPromise != nil {
        promise.reject("YANDEX_AUTH_ERROR", "Authorization already in progress")
        return
      }
      self.pendingPromise = promise

      DispatchQueue.main.async {
        guard let rootVC = Self.topRootViewController() else {
          self.pendingPromise = nil
          promise.reject("YANDEX_AUTH_ERROR", "No root view controller")
          return
        }
        do {
          // .webOnly forces ASWebAuthenticationSession; without it the SDK falls back to
          // UIApplication.open(universalLinkURL), which iOS routes to whichever installed
          // app claims the OAuth applinks (Yandex Pay intercepts it and strands the user).
          try YandexLoginSDK.shared.authorize(with: rootVC, authorizationStrategy: .webOnly)
        } catch {
          self.pendingPromise = nil
          promise.reject("YANDEX_AUTH_ERROR", error.localizedDescription)
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

extension ExpoYandexSDKModule: YandexLoginSDKObserver {
  public func didFinishLogin(with result: Result<LoginResult, Error>) {
    guard let promise = pendingPromise else { return }
    pendingPromise = nil
    switch result {
    case .success(let r):
      // YandexLoginSDK 3.1.0 LoginResult exposes only `token` and `jwt` (both non-optional
      // String). No expiresIn field — resolve 0 to keep the shape Android produces.
      promise.resolve([
        "accessToken": r.token,
        "expiresIn": 0,
        "jwt": r.jwt
      ])
    case .failure(let err):
      if let asError = err as? ASWebAuthenticationSessionError, asError.code == .canceledLogin {
        promise.resolve(["cancelled": true])
      } else {
        promise.reject("YANDEX_AUTH_ERROR", err.localizedDescription)
      }
    }
  }
}
