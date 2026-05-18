require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json'))) rescue {}

Pod::Spec.new do |s|
  s.name           = 'ExpoGoogleSDK'
  s.version        = '0.1.0'
  s.summary        = 'Google Sign-In SDK wrapper for Expo'
  s.author         = ''
  s.homepage       = 'https://github.com/your/repo'
  s.platforms      = { :ios => '13.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # GoogleSignIn 9.x adds the `nonce:` parameter to signIn(withPresenting:...) — required
  # for our design's nonce-binding. Verify pod resolves on first production iOS build.
  s.dependency 'GoogleSignIn', '~> 9.0'

  s.swift_version  = '5.4'
  s.source_files = "**/*.{h,m,swift}"
end
