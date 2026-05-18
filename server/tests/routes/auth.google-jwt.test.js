const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { createAuthRoutes } = require('../../src/routes/auth');

const TEST_FILE = path.join(__dirname, '../../data/users.google-route-test.json');
const JWT_SECRET = 'test-secret';
const GOOGLE_WEB_CLIENT_ID = 'web-client-id.apps.googleusercontent.com';

jest.mock('../../src/services/google', () => ({
  verifyGoogleIdToken: jest.fn(),
}));
const { verifyGoogleIdToken } = require('../../src/services/google');

function createApp({ withClientId = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRoutes({
    jwtSecret: JWT_SECRET,
    vkAppId: '54501952',
    vkAppSecret: 'irrelevant',
    yandexClientSecret: 'irrelevant',
    ...(withClientId ? { googleWebClientId: GOOGLE_WEB_CLIENT_ID } : {}),
    usersFile: TEST_FILE,
  }));
  return app;
}

let logSpy;
let errorSpy;

beforeAll(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

beforeEach(() => {
  fs.writeFileSync(TEST_FILE, '[]');
  verifyGoogleIdToken.mockReset();
});

describe('POST /auth/google/exchange-jwt', () => {
  test('returns 400 missing_fields when idToken is absent', async () => {
    const res = await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ nonce: 'n' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  test('returns 400 missing_fields when nonce is absent', async () => {
    const res = await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'tok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  test('returns 500 server_misconfigured when GOOGLE_WEB_CLIENT_ID is not set', async () => {
    const res = await request(createApp({ withClientId: false }))
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'tok', nonce: 'n' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_misconfigured');
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  test('returns 401 google_id_token_invalid when service throws verification error', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(
      new Error('google_id_token_invalid: bad sig')
    );
    const res = await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'tok', nonce: 'n' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('google_id_token_invalid');
  });

  test('returns 401 google_nonce_mismatch when service throws nonce error', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(
      new Error('google_nonce_mismatch: ...')
    );
    const res = await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'tok', nonce: 'n' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('google_nonce_mismatch');
  });

  test('returns 403 google_email_not_verified when service throws email error', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(
      new Error('google_email_not_verified')
    );
    const res = await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'tok', nonce: 'n' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('google_email_not_verified');
  });

  test('returns an app JWT and persists the user on a verified token', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({
      sub: '1234567890',
      email: 'user@example.com',
      emailVerified: true,
      name: 'Test User',
      givenName: 'Test',
      familyName: 'User',
      picture: 'https://lh3.googleusercontent.com/a/xyz',
    });

    const res = await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'valid-id-token', nonce: 'n' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.provider).toBe('google');
    expect(payload.providerId).toBe('1234567890');

    const users = JSON.parse(fs.readFileSync(TEST_FILE, 'utf-8'));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      provider: 'google',
      providerId: '1234567890',
      firstName: 'Test',
      lastName: 'User',
      email: 'user@example.com',
      avatarId: 'https://lh3.googleusercontent.com/a/xyz',
    });
  });

  test('does not duplicate the user on a second login', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      sub: '1234567890',
      email: 'user@example.com',
      emailVerified: true,
      name: 'Test User',
      givenName: 'Test',
      familyName: 'User',
    });

    await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'first', nonce: 'n1' });
    await request(createApp())
      .post('/auth/google/exchange-jwt')
      .send({ idToken: 'second', nonce: 'n2' });

    const users = JSON.parse(fs.readFileSync(TEST_FILE, 'utf-8'));
    expect(users).toHaveLength(1);
  });
});
