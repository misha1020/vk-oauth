async function exchangeCode({ code, codeVerifier, deviceId, redirectUri, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    device_id: deviceId,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    userId: data.user_id,
    idToken: data.id_token,
  };
}

async function fetchUserProfile(accessToken, clientId) {
  const body = new URLSearchParams({
    access_token: accessToken,
    client_id: clientId,
  });

  const res = await fetch('https://id.vk.com/oauth2/user_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  const user = data.user;

  return {
    vkId: Number(user.user_id),
    firstName: user.first_name,
    lastName: user.last_name,
  };
}

module.exports = { exchangeCode, fetchUserProfile };
