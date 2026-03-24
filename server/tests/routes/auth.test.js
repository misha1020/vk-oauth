const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { createAuthRoutes } = require('../../src/routes/auth');

const TEST_FILE = path.join(__dirname, '../../data/users.route-test.json');
const JWT_SECRET = 'test-secret';

jest.mock('../../src/services/vk', () => ({
  exchangeCode: jest.fn(),
  fetchUserProfile: jest.fn(),
}));

const { exchangeCode, fetchUserProfile } = require('../../src/services/vk');

beforeAll(() => {
  process.env.SERVER_URL = 'https://mz.ludentes.ru';
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRoutes({
    jwtSecret: JWT_SECRET,
    vkAppId: 'test-app-id',
    vkAppSecret: 'test-app-secret',
    usersFile: TEST_FILE,
  }));
  return app;
}

function makeState(codeVerifier = 'test-verifier', deviceId = 'test-device') {
  return Buffer.from(JSON.stringify({ code_verifier: codeVerifier, device_id: deviceId }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

beforeEach(() => {
  fs.writeFileSync(TEST_FILE, '[]');
  exchangeCode.mockReset();
  fetchUserProfile.mockReset();
});

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe('GET /auth/vk/callback', () => {
  test('redirects to success deep link with JWT on valid code', async () => {
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345, idToken: null });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const res = await request(app).get(`/auth/vk/callback?code=valid-code&state=${makeState()}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^vkoauth:\/\/auth\/success\?token=/);

    const tokenMatch = res.headers.location.match(/token=([^&]+)/);
    const token = decodeURIComponent(tokenMatch[1]);
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.vkId).toBe(12345);
  });

  test('redirects to error deep link when VK returns error param', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/auth/vk/callback?error=access_denied&error_description=User+denied+access');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^vkoauth:\/\/auth\/error/);
    expect(decodeURIComponent(res.headers.location)).toContain('User denied access');
  });

  test('redirects to error deep link when code is missing', async () => {
    const app = createApp();
    const res = await request(app).get('/auth/vk/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('vkoauth://auth/error?message=missing_code');
  });

  test('redirects to error deep link when state is missing', async () => {
    const app = createApp();
    const res = await request(app).get('/auth/vk/callback?code=valid-code');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('vkoauth://auth/error?message=missing_state');
  });

  test('redirects to error deep link when exchange fails', async () => {
    exchangeCode.mockRejectedValue(new Error('Code expired'));

    const app = createApp();
    const res = await request(app).get(`/auth/vk/callback?code=bad-code&state=${makeState()}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^vkoauth:\/\/auth\/error/);
    expect(decodeURIComponent(res.headers.location)).toContain('Code expired');
  });
});

describe('GET /auth/me', () => {
  test('returns user for valid token', async () => {
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345, idToken: null });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const callbackRes = await request(app).get(`/auth/vk/callback?code=valid-code&state=${makeState()}`);
    const tokenMatch = callbackRes.headers.location.match(/token=([^&]+)/);
    const token = decodeURIComponent(tokenMatch[1]);

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ vkId: 12345, firstName: 'Ivan' });
  });

  test('returns 401 for missing token', async () => {
    const app = createApp();
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});
