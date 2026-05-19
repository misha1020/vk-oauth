import AuthenticationServices
import ExpoModulesCore
import ObjectiveC.runtime
import UIKit
import VKID

private final class ASWebAuthStartSuppressor {
  static let install: Void = {
    let cls: AnyClass = ASWebAuthenticationSession.self
    let originalSelector = NSSelectorFromString("start")
    let swizzledSelector = NSSelectorFromString("expo_vk_suppress_start")
    guard
      let original = class_getInstanceMethod(cls, originalSelector),
      let swizzled = class_getInstanceMethod(cls, swizzledSelector)
    else {
      NSLog("ExpoVKSDK suppressor: swizzle FAILED — method not found on ASWebAuthenticationSession")
      return
    }
    method_exchangeImplementations(original, swizzled)
  }()
}

extension ASWebAuthenticationSession {
  @objc func expo_vk_suppress_start() -> Bool {
    if ExpoVKSDKModule.recentlySucceeded() {
      NSLog("ExpoVKSDK suppressed post-success ASWebAuthSession.start()")
      return false
    }
    return self.expo_vk_suppress_start()
  }
}

public class ExpoVKSDKModule: Module {
  private static var configuredOnce = false

  private static let successLock = NSLock()
  private static var lastAuthSuccessAt: Date?
  private static let suppressionWindow: TimeInterval = 5.0

  static func markAuthSuccess() {
    successLock.lock(); defer { successLock.unlock() }
    lastAuthSuccessAt = Date()
  }

  static func recentlySucceeded() -> Bool {
    successLock.lock(); defer { successLock.unlock() }
    guard let t = lastAuthSuccessAt else { return false }
    return Date().timeIntervalSince(t) < suppressionWindow
  }

  static func clearAuthSuccess() {
    successLock.lock(); defer { successLock.unlock() }
    lastAuthSuccessAt = nil
  }

  private static func configureVKIDIfNeeded() throws {
    if configuredOnce { return }

    guard
      let clientId = Bundle.main.object(forInfoDictionaryKey: "VKIDClientID") as? String,
      !clientId.isEmpty
    else {
      throw NSError(domain: "ExpoVKSDK", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "VKIDClientID missing from Info.plist"
      ])
    }

    guard
      let clientSecret = Bundle.main.object(forInfoDictionaryKey: "VKIDClientSecret") as? String,
      !clientSecret.isEmpty
    else {
      throw NSError(domain: "ExpoVKSDK", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "VKIDClientSecret missing from Info.plist"
      ])
    }

    let credentials = AppCredentials(
      clientId: clientId,
      clientSecret: clientSecret
    )
    let config = Configuration(appCredentials: credentials)
    try VKID.shared.set(config: config)
    configuredOnce = true
  }

  public static func handleOpenURL(_ url: URL) -> Bool {
    guard configuredOnce else { return false }
    return VKID.shared.open(url: url)
  }

  private func topMostViewController() -> UIViewController? {
    let rootVC = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })?
      .rootViewController
    var top = rootVC
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoVKSDK")

    OnCreate {
      _ = ASWebAuthStartSuppressor.install
    }

    AsyncFunction("authorize") { (codeChallenge: String, state: String, promise: Promise) in
      Self.clearAuthSuccess()

      DispatchQueue.main.async {
        do {
          try Self.configureVKIDIfNeeded()
        } catch {
          promise.reject("ERR_VK_INIT", error.localizedDescription)
          return
        }

        guard let presenter = self.topMostViewController() else {
          promise.reject("ERR_NO_PRESENTER", "No view controller available to present VK auth")
          return
        }

        let pkce = PKCESecrets(
          codeVerifier: nil,
          codeChallenge: codeChallenge,
          codeChallengeMethod: .s256,
          state: state
        )
        let exchanger = JSPromiseCodeExchanger(promise: promise)
        let authConfig = AuthConfiguration(
          flow: .confidentialClientFlow(codeExchanger: exchanger, pkce: pkce),
          scope: Scope("email")
        )

        VKID.shared.authorize(
          with: authConfig,
          oAuthProvider: .vkid,
          using: .uiViewController(presenter)
        ) { result in
          if exchanger.didResolve { return }
          if case .failure(let error) = result {
            switch error {
            case .cancelled:
              promise.reject("ERR_VK_CANCELLED", "Авторизация ВК отменена пользователем (cancelled)")
            case .authCodeExchangedOnYourBackend:
              break
            default:
              promise.reject("ERR_VK_AUTH", "\(error)")
            }
          }
        }
      }
    }
  }
}

private final class JSPromiseCodeExchanger: AuthCodeExchanging {
  private let promise: Promise
  private(set) var didResolve = false

  init(promise: Promise) {
    self.promise = promise
  }

  func exchangeAuthCode(
    _ code: AuthorizationCode,
    completion: @escaping (Result<AuthFlowData, Error>) -> Void
  ) {
    if !didResolve {
      didResolve = true
      promise.resolve([
        "code": code.code,
        "deviceId": code.deviceId,
      ])
      ExpoVKSDKModule.markAuthSuccess()
    }
    completion(.failure(NSError(
      domain: "ExpoVKSDK",
      code: 0,
      userInfo: [NSLocalizedDescriptionKey: "Code exchanged on backend"]
    )))
  }
}
