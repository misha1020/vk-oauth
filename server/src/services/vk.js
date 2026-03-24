async function exchangeCode({ code, redirectUri, clientId, clientSecret, codeVerifier, deviceId }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
    device_id: deviceId,
  });

  const res = await fetch('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    userId: data.user_id,
    idToken: data.id_token || null,
  };
}

async function fetchUserProfile(accessToken) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'first_name,last_name',
    v: '5.131',
  });

  const res = await fetch(`https://api.vk.com/method/users.get?${params.toString()}`);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.error_msg || 'VK API error');
  }

  const user = data.response[0];
  return {
    vkId: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
  };
}

module.exports = { exchangeCode, fetchUserProfile };
