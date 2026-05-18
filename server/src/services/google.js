const { OAuth2Client } = require('google-auth-library');

// google-auth-library auto-validates signature, iss, aud, exp inside verifyIdToken.
// It also auto-caches Google's JWKs on instance fields (certificateCache,
// certificateExpiry) — re-using a single client across requests avoids refetching
// https://www.googleapis.com/oauth2/v3/certs on every login.
//
// What we own (and what the unit tests cover):
//   - audience parameter is the Web Client ID (server-side .env)
//   - nonce matches what the mobile client sent in the request body
//   - email_verified is true
//   - payload is mapped to a normalized profile shape
//   - errors from the library are surfaced as google_id_token_invalid

const oauthClient = new OAuth2Client();

async function verifyGoogleIdToken({ idToken, audience, expectedNonce }) {
  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({ idToken, audience });
  } catch (err) {
    throw new Error(`google_id_token_invalid: ${err.message}`);
  }

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('google_id_token_invalid: empty payload');
  }

  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error(`google_nonce_mismatch: payload.nonce=${payload.nonce} expected=${expectedNonce}`);
  }

  if (payload.email_verified !== true) {
    throw new Error('google_email_not_verified');
  }

  return {
    sub: String(payload.sub),
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name,
    givenName: payload.given_name,
    familyName: payload.family_name,
    picture: payload.picture,
  };
}

module.exports = { verifyGoogleIdToken };
