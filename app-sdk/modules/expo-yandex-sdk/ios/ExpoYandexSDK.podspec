require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json'))) rescue {}

Pod::Spec.new do |s|
  s.name           = 'ExpoYandexSDK'
  s.version        = '0.1.0'
  s.summary        = 'Yandex ID SDK wrapper for Expo'
  s.author         = ''
  s.homepage       = 'https://github.com/your/repo'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Pinned to 3.x: 3.1.0 exposes LoginResult.jwt directly, .webOnly authorization strategy,
  # and the `authorize(with:authorizationStrategy:)` signature this module relies on.
  # If `pod install` fails to resolve YandexLoginSDK, add the Yandex podspec repo source
  # line to the host app's Podfile.
  s.dependency 'YandexLoginSDK', '~> 3.0'

  s.swift_version  = '5.9'
  s.source_files = "**/*.{h,m,swift}"
end
