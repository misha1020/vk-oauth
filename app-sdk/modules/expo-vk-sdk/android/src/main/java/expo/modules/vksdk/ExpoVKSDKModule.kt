package expo.modules.vksdk

import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import com.vk.id.VKID
import com.vk.id.VKIDAuthFail
import com.vk.id.auth.VKIDAuthCallback
import com.vk.id.auth.VKIDAuthParams
import com.vk.id.auth.AuthCodeData
import com.vk.id.AccessToken

class ExpoVKSDKModule : Module() {
    private var initialized = false

    private fun ensureInitialized() {
        if (initialized) return
        val context = appContext.reactContext
            ?: throw CodedException("ERR_NO_CONTEXT", "React context not available", null)
        VKID.init(context)
        initialized = true
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoVKSDK")

        AsyncFunction("authorize") { codeChallenge: String, state: String, promise: Promise ->
            try {
                ensureInitialized()
            } catch (e: Exception) {
                promise.reject("ERR_VK_INIT", e.message ?: "VK SDK init failed", e)
                return@AsyncFunction
            }

            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject("ERR_NO_ACTIVITY", "No current activity", null)
                return@AsyncFunction
            }

            val lifecycleOwner = activity as? LifecycleOwner
            if (lifecycleOwner == null) {
                promise.reject("ERR_NO_LIFECYCLE", "Activity is not a LifecycleOwner", null)
                return@AsyncFunction
            }

            activity.runOnUiThread {
                try {
                    val callback = object : VKIDAuthCallback {
                        override fun onAuthCode(data: AuthCodeData, isCompletion: Boolean) {
                            promise.resolve(
                                mapOf(
                                    "code" to data.code,
                                    "deviceId" to data.deviceId
                                )
                            )
                        }

                        override fun onFail(fail: VKIDAuthFail) {
                            promise.reject(
                                "ERR_VK_AUTH",
                                fail.description ?: "VK auth failed",
                                null
                            )
                        }

                        override fun onAuth(accessToken: AccessToken) {
                            promise.reject(
                                "ERR_VK_WRONG_FLOW",
                                "Received access token instead of auth code. Ensure codeChallenge is provided.",
                                null
                            )
                        }
                    }

                    val params = VKIDAuthParams {
                        this.codeChallenge = codeChallenge
                        this.state = state
                        this.scopes = setOf("email")
                    }

                    VKID.instance.authorize(lifecycleOwner, callback, params)
                } catch (e: Exception) {
                    promise.reject("ERR_VK_AUTH", e.message ?: "authorize() failed", e)
                }
            }
        }
    }
}
