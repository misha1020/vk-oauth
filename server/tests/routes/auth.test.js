const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { createAuthRoutes } = require('../../src/routes/auth');

const TEST_FILE = path.join(__dirname, '../../data/users.route-test.json');
const JWT_SECRET = 'test-secret';

// Mock VK service
jest.mock('../../src/services/vk', () => ({
  exchangeCode: jest.fn(),
  fetchUserProfile: jest.fn(),
}));

const { exchangeCode, fetchUserProfile } = require('../../src/services/vk');

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

beforeEach(() => {
  fs.writeFileSync(TEST_FILE, '[]');
  exchangeCode.mockReset();
  fetchUserProfile.mockReset();
});

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe('POST /auth/vk', () => {
  test('returns 400 when fields are missing', async () => {
    const app = createApp();
    const res = await request(app).post('/auth/vk').send({ code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  test('returns token and user on success', async () => {
    exchangeCode.mockResolvedValue({
      accessToken: 'vk-token',
      userId: 12345,
      idToken: null,
    });
    fetchUserProfile.mockResolvedValue({
      vkId: 12345,
      firstName: 'Ivan',
      lastName: 'Petrov',
    });

    const app = createApp();
    const res = await request(app).post('/auth/vk').send({
      code: 'auth-code',
      codeVerifier: 'verifier',
      deviceId: 'device-123',
      redirectUri: 'vkoauth://auth/vk',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({ vkId: 12345, firstName: 'Ivan' });

    // Verify JWT is valid
    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.vkId).toBe(12345);
  });

  test('returns 401 when VK exchange fails', async () => {
    exchangeCode.mockRejectedValue(new Error('Code expired'));

    const app = createApp();
    const res = await request(app).post('/auth/vk').send({
      code: 'bad-code',
      codeVerifier: 'verifier',
      deviceId: 'device-123',
      redirectUri: 'vkoauth://auth/vk',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('vk_exchange_failed');
  });
});

describe('GET /auth/me', () => {
  test('returns user for valid token', async () => {
    // Seed a user
    exchangeCode.mockResolvedValue({ accessToken: 'vk-token', userId: 12345, idToken: null });
    fetchUserProfile.mockResolvedValue({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });

    const app = createApp();
    const loginRes = await request(app).post('/auth/vk').send({
      code: 'code',
      codeVerifier: 'verifier',
      deviceId: 'device',
      redirectUri: 'vkoauth://auth/vk',
    });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ vkId: 12345, firstName: 'Ivan' });
  });

  test('returns 401 for missing token', async () => {
    const app = createApp();
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});
