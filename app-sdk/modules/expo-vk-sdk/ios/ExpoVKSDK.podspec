require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json'))) rescue {}

Pod::Spec.new do |s|
  s.name           = 'ExpoVKSDK'
  s.version        = '0.1.0'
  s.summary        = 'VK ID SDK wrapper for Expo'
  s.author         = ''
  s.homepage       = 'https://github.com/your/repo'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'VKID', '~> 2.6'

  s.swift_version  = '5.9'
  s.source_files = "**/*.{h,m,swift}"
end
