Настройка авторизации VK ID для Android
По умолчанию параметры PKCE, которые прeдотвращают последствия возможного перехвата кода авторизации, генерируются в SDK. Если вы используете схему авторизации через SDK с обменом кода на фронтенде, этого достаточно.
Если вы используете схему авторизации через SDK с обменом кода на бэкенде, сгенерируйте параметры PKCE в приложении вашего сервиса согласно схеме и затем передать их в SDK — в этой статье расскажем, как это сделать.
Кроме того, необходимо явно указывать нужные доступы, например phone, email в scope, чтобы получать соответствующие данные пользователя. Эти доступы должны быть включены в настройках приложения.

Генерация параметров PKCE
Передавать параметры PKCE можно в следующие методы:
vkid.authorize()
vkid.refreshToken()
vkid.exchangeTokenToV2()
В каждом из методов есть опция params, в которой можно указать необходимые параметры авторизации. Вы можете сгенерировать state, codeChallenge и codeVerifier сами, а SDK будет их использовать при работе.
Также для этой опции есть аналог authParams. Ее можно указать в OneTap, OneTapBottomSheet, OAuthListWidget — классах кнопки One Tap, шторки авторизации, виджета 3 в 1.

Требования к параметрам PKCE
codeVerifier — случайно сгенерированная строка, новая на каждый запрос авторизации. Формат a-z, A-Z, 0-9, _, -, длина от 43 до 128 символов;
codeChallenge — значение codeVerifier, преобразованное с помощью метода S256 и закодированное в base64. Порядок преобразований: BASE64-ENCODE(SHA256(codeVerifier)) RFC-7636 Code Challenge;
state — произвольная строка, которая состоит из символов a-z, A-Z, 0-9, _, -, длина не менее 32 символа. Допустимо использовать генератор UUID v4.
Пример генерации codeChallenge на kotlin
val SHA256Digester = MessageDigest.getInstance("SHA-256")
val input = codeVerifier.toByteArray(Charset.forName("ISO_8859_1"))
SHA256Digester.update(input)
val digestBytes = SHA256Digester.digest()
Base64.encodeToString(digestBytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
Если вы предоставляете параметры PKCE в authorize извне, SDK не сможет обменять авторизационный код на токен — вам нужно будет сделать это самостоятельно.
При получении callback onAuthCode с авторизационным кодом сделайте запрос /oauth2/auth.
В callback вы получите параметр data, в котором находятся code и deviceId — передайте их в запрос обмена кода на токены.
Пример запроса
curl "https://id.vk.ru/oauth2/auth" -d "client_id=7915193&grant_type=authorization_code&code_verifier=KnHKAdqyW57MUbjRcScaZRU9Bw26Kez9zwBgti...&device_id=1111&code=1f06e0c317b5b524c6&redirect_uri=vk7915193://vk.ru/blank.html"
Параметры запроса
Название Описание
grant_type Всегда имеет значение authorization_code
code Код авторизации, полученный из callback onAuthCode
code_verifier code_verifier, для которого был сгенерирован code_challenge
client_id Идентификатор приложения. Должен совпадать с VKIDClientID, который вы указали в Manifest Placeholders
device_id Уникальный идентификатор вашего мобильного устройства, полученный из callback onAuthCode
redirect_uri Адрес для редиректа после авторизации. Должен быть в формате VKIDRedirectScheme://VKIDRedirectHost/blank.html, где VKIDRedirectScheme и VKIDRedirectHost — параметры, которые вы указали в Manifest Placeholders
state Уникальная строка, сгенерированная по тем же правилам, что и для авторизации. Подробнее см. в подразделе Требования к параметрам PKCE
Пример ответа
{
"access_token": "\***\*",
"refresh_token": "\*\***",
"id_token": "\*\*\*\*",
"expires_in": 0,
"user_id": 1234567890,
"state": "XXX"
}

Настройка доступов
Права доступа определяют возможность использования Access token для работы с тем или иным разделом данных — за это отвечает параметр scopes. Права доступа могут быть изменены в настройках приложения.
Если вы не указывали доступы при настройке приложения, будут использоваться базовые: фамилия и имя, фото профиля, пол и дата рождения (параметр vkid.personal_info).
VKID.instance.authorize(
...
scopes = setOf("scope_1", ... , "scope_n")
...
)
Также scopes можно указать в OneTap и OneTapBottomSheet — классах кнопки и шторки авторизации:
Compose
@Composable
OneTap(
...
scopes = setOf("scope_1", ... , "scope_n")
...
)
XML в коде
val view = findViewById<OneTap>(R.id.onetap)
view.scopes = setOf("scope_1", ... , "scope_n")
XML в вёрстке
<com.vk.id.onetap.xml.OneTap
...
app:vkid_onetapScopes="scope_1,scope_2,...,scope_n"
/>
Обратите внимание, что после получения Access token происходит его привязка к IP-адресу:
если вы используете авторизацию через SDK с обменом кода на фронтенде, Access token привязывается к IP-адресу пользователя. Этот токен можно использовать только с того клиентского устройства, на котором прошла авторизация;
если вы используете авторизацию через SDK с обменом кода на бэкенде, Access token привязывается к IP-адресу бэкенда сервиса. Токен можно использовать только на одном бэкенд-сервере — на том, который получил этот токен. Если передать токен на другой бэкенд-сервер или на фронтенд, возникнет ошибка.

Дальнейшие шаги
Получите информацию о пользователе.
