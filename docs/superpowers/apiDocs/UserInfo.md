Получение данных пользователя и работа с токенами
Получение информации о пользователе
Если приложению нужно получить данные пользователя, необходимо использовать метод vkid.getUserData(). Этот метод применяет сохраненный Access token и делает запрос к /user_info в API VK ID.
VKID.instance.getUserData(
callback = object : VKIDGetUserCallback {
override fun onSuccess(user: VKIDUser) {
// Использование данных пользователя.
}
override fun onFail(fail: VKIDGetUserFail) {
when (fail) {
is VKIDGetUserFail.FailedApiCall -> fail.description // Использование текста ошибки.
is VKIDGetUserFail.IdTokenTokenExpired -> fail.description // Использование текста ошибки.
is VKIDGetUserFail.NotAuthenticated -> fail.description // Использование текста ошибки.
}
}
}
)

Обновление токена
Время жизни Access token ограничено. Его нужно периодически обновлять. Для этого используется метод vkid.refreshToken(). Он обновляет сохраненные Access token и Refresh token.
// Suspend-версия
VKID.instance.refreshToken(
callback = object : VKIDRefreshTokenCallback {
override fun onSuccess(token: AccessToken) {
// Использование AT
}
override fun onFail(fail: VKIDRefreshTokenFail) {
when (fail) {
is VKIDRefreshTokenFail.FailedApiCall -> fail.description // Использование текста ошибки.
is VKIDRefreshTokenFail.FailedOAuthState -> fail.description // Использование текста ошибки.
is VKIDRefreshTokenFail.RefreshTokenExpired -> fail // Ошибка истечения срока жизни RT. Это уведомление о том, что пользователю нужно перелогиниться.
is VKIDRefreshTokenFail.NotAuthenticated -> fail // Ошибка отсутствия авторизации у пользователя. Это уведомление о том, что пользователю нужно авторизоваться.
}
}
}
)
// Plain-версия
VKID.instance.refreshToken(
lifecycleOwner = MainActivity@this,
callback = ... // Такой же, как в Suspend-версии.
)

Выход из аккаунта
За выход из аккаунта отвечает метод vkid.logout(). Также этот метод инвалидирует Access token, удаляет Refresh token из EncryptedSharedPreferences.
// Suspend-версия
VKID.instance.logout(
callback = object : VKIDLogoutCallback {
override fun onSuccess() {
// Пользователю отправляется уведомление, что произошел выход из аккаунта.
}
override fun onFail(fail: VKIDLogoutFail) {
when (fail) {
is VKIDLogoutFail.FailedApiCall -> fail.description // Использование текста ошибки.
is VKIDLogoutFail.NotAuthenticated -> fail.description // Использование текста ошибки.
is VKIDLogoutFail.AccessTokenTokenExpired -> fail // Ошибка истечения срока жизни AT. Это уведомление о том, что токен уже просрочен и разлогиниваться не нужно.
}
}
}
)
// Plain-версия
VKID.instance.logout(
lifecycleOwner = MainActivity@this,
callback = ... // Такой же, как в Suspend-версии.
)
