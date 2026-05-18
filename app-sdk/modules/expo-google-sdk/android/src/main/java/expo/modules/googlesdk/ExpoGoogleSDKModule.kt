package expo.modules.googlesdk

import androidx.activity.ComponentActivity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class GoogleAuthException(code: String, message: String) : CodedException(code, message, null)

class ExpoGoogleSDKModule : Module() {
    private var pendingPromise: Promise? = null
    private var pendingJob: Job? = null

    private fun resolvePending(result: Map<String, Any>) {
        val promise = pendingPromise ?: return
        pendingPromise = null
        pendingJob = null
        promise.resolve(result)
    }

    private fun rejectPending(code: String, message: String) {
        val promise = pendingPromise ?: return
        pendingPromise = null
        pendingJob = null
        promise.reject(GoogleAuthException(code, message))
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoGoogleSDK")

        // Args: webClientId (String) — the Google Cloud Web Client ID, becomes the ID
        // token's `aud` claim. nonce (String) — random base64 from JS, Google embeds
        // it verbatim in the token's `nonce` claim, server compares.
        //
        // We use GetSignInWithGoogleOption (button flow, always shows picker) — NOT
        // GetGoogleIdOption (bottom-sheet auto-prompt). See design doc Section 1.
        AsyncFunction("authorize") { webClientId: String, nonce: String, promise: Promise ->
            val activity = appContext.currentActivity as? ComponentActivity
            if (activity == null) {
                promise.reject(GoogleAuthException("NO_ACTIVITY", "No ComponentActivity available"))
                return@AsyncFunction
            }

            // Re-entrancy guard — prevents double-tap from launching two parallel picker
            // requests, matching the Yandex module's pendingPromise pattern.
            if (pendingPromise != null) {
                promise.reject(GoogleAuthException("IN_PROGRESS", "Authorization already in progress"))
                return@AsyncFunction
            }

            val signInOption = GetSignInWithGoogleOption.Builder(webClientId)
                .setNonce(nonce)
                .build()

            val request = GetCredentialRequest.Builder()
                .addCredentialOption(signInOption)
                .build()

            val credentialManager = CredentialManager.create(activity)

            pendingPromise = promise
            // Bind to the activity's lifecycle — if the activity dies mid-auth the
            // coroutine is cancelled instead of resolving/rejecting onto a dead JS bridge.
            pendingJob = activity.lifecycleScope.launch {
                try {
                    val response = credentialManager.getCredential(activity, request)
                    val credential = response.credential
                    if (credential is CustomCredential &&
                        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        try {
                            val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                            resolvePending(mapOf("idToken" to googleCredential.idToken))
                        } catch (e: GoogleIdTokenParsingException) {
                            rejectPending("INVALID_TOKEN", e.message ?: "Invalid Google ID token")
                        }
                    } else {
                        rejectPending("GOOGLE_AUTH_ERROR", "Unexpected credential type: ${credential::class.simpleName}")
                    }
                } catch (e: GetCredentialCancellationException) {
                    // User-initiated cancellation is NOT an error — resolve with a sentinel.
                    val p = pendingPromise
                    if (p != null) {
                        pendingPromise = null
                        pendingJob = null
                        p.resolve(mapOf("cancelled" to true))
                    }
                } catch (e: NoCredentialException) {
                    rejectPending("NO_GOOGLE_ACCOUNT", e.message ?: "No Google account on this device")
                } catch (e: GetCredentialException) {
                    rejectPending("GOOGLE_AUTH_ERROR", e.message ?: "Credential error")
                } catch (e: CancellationException) {
                    // Coroutine cancelled because the activity died — drop the promise
                    // silently rather than rejecting onto a dead bridge.
                    pendingPromise = null
                    pendingJob = null
                    throw e
                }
            }
        }
    }
}
