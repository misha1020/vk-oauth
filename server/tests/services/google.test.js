const { OAuth2Client } = require('google-auth-library');

jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: mockVerifyIdToken,
    })),
    __mockVerifyIdToken: mockVerifyIdToken,
  };
});

const { __mockVerifyIdToken } = require('google-auth-library');
const { verifyGoogleIdToken } = require('../../src/services/google');

const AUD = 'web-client-id.apps.googleusercontent.com';
const NONCE = 'nonce-abc-123';

function makeTicket(payload) {
  return { getPayload: () => payload };
}

const VALID_PAYLOAD = {
  sub: '1234567890',
  email: 'user@example.com',
  email_verified: true,
  name: 'Test User',
  given_name: 'Test',
  family_name: 'User',
  picture: 'https://lh3.googleusercontent.com/a/xyz',
  iss: 'https://accounts.google.com',
  aud: AUD,
  nonce: NONCE,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

beforeEach(() => {
  __mockVerifyIdToken.mockReset();
});

describe('verifyGoogleIdToken', () => {
  test('resolves with normalized profile shape on a valid payload', async () => {
    __mockVerifyIdToken.mockResolvedValue(makeTicket(VALID_PAYLOAD));

    const result = await verifyGoogleIdToken({
      idToken: 'fake-id-token',
      audience: AUD,
      expectedNonce: NONCE,
    });

    expect(result).toEqual({
      sub: '1234567890',
      email: 'user@example.com',
      emailVerified: true,
      name: 'Test User',
      givenName: 'Test',
      familyName: 'User',
      picture: 'https://lh3.googleusercontent.com/a/xyz',
    });
  });

  test('calls verifyIdToken with audience: webClientId', async () => {
    __mockVerifyIdToken.mockResolvedValue(makeTicket(VALID_PAYLOAD));

    await verifyGoogleIdToken({
      idToken: 'fake-id-token',
      audience: AUD,
      expectedNonce: NONCE,
    });

    expect(__mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'fake-id-token',
      audience: AUD,
    });
  });

  test('throws google_nonce_mismatch when payload.nonce !== expectedNonce', async () => {
    __mockVerifyIdToken.mockResolvedValue(
      makeTicket({ ...VALID_PAYLOAD, nonce: 'a-different-nonce' })
    );

    await expect(
      verifyGoogleIdToken({ idToken: 't', audience: AUD, expectedNonce: NONCE })
    ).rejects.toThrow(/google_nonce_mismatch/);
  });

  test('throws google_email_not_verified when email_verified is false', async () => {
    __mockVerifyIdToken.mockResolvedValue(
      makeTicket({ ...VALID_PAYLOAD, email_verified: false })
    );

    await expect(
      verifyGoogleIdToken({ idToken: 't', audience: AUD, expectedNonce: NONCE })
    ).rejects.toThrow(/google_email_not_verified/);
  });

  test('wraps library errors as google_id_token_invalid', async () => {
    __mockVerifyIdToken.mockRejectedValue(new Error('Wrong recipient'));

    await expect(
      verifyGoogleIdToken({ idToken: 'bad', audience: AUD, expectedNonce: NONCE })
    ).rejects.toThrow(/google_id_token_invalid/);
  });
});
