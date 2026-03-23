const jwt = require('jsonwebtoken');
const { createAuthMiddleware } = require('../../src/middleware/auth');

const SECRET = 'test-secret';
const middleware = createAuthMiddleware(SECRET);

function mockReqResNext(authHeader) {
  const req = { headers: { authorization: authHeader } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('auth middleware', () => {
  test('passes with valid token and sets req.user', () => {
    const token = jwt.sign({ userId: 'abc', vkId: 123 }, SECRET);
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ userId: 'abc', vkId: 123 });
  });

  test('rejects missing Authorization header', () => {
    const { req, res, next } = mockReqResNext(undefined);

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects expired token', () => {
    const token = jwt.sign({ userId: 'abc', vkId: 123, iat: Math.floor(Date.now() / 1000) - 100 }, SECRET, { expiresIn: '1s' });
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects token with wrong secret', () => {
    const token = jwt.sign({ userId: 'abc', vkId: 123 }, 'wrong-secret');
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
