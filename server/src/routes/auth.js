const express = require('express');
const jwt = require('jsonwebtoken');
const { exchangeCode, fetchUserProfile } = require('../services/vk');
const { findById, createUser } = require('../services/users');
const { createAuthMiddleware } = require('../middleware/auth');

// vkAppSecret accepted for caller compatibility; not used — PKCE replaces client_secret in VK ID OAuth 2.1
function createAuthRoutes({ jwtSecret, vkAppId, vkAppSecret, usersFile }) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(jwtSecret);

  router.post('/vk/exchange', async (req, res) => {
    const { code, code_verifier: codeVerifier, device_id: deviceId } = req.body;

    if (!code || !codeVerifier || !deviceId) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'code, codeVerifier, and deviceId are required',
      });
    }

    try {
      const { accessToken } = await exchangeCode({
        code,
        codeVerifier,
        deviceId,
        redirectUri: `vk${vkAppId}://vk.ru/blank.html`,
        clientId: vkAppId,
      });

      const profile = await fetchUserProfile(accessToken, vkAppId, deviceId);
      const user = createUser(profile, usersFile);

      const token = jwt.sign(
        { userId: user.id, vkId: user.vkId },
        jwtSecret,
        { expiresIn: '7d' }
      );

      return res.json({ token });
    } catch (err) {
      return res.status(401).json({
        error: 'vk_exchange_failed',
        message: err.message || 'VK token exchange failed',
      });
    }
  });

  router.get('/me', authMiddleware, (req, res) => {
    const user = findById(req.user.userId, usersFile);
    if (!user) {
      return res.status(401).json({ error: 'invalid_token', message: 'User not found' });
    }
    return res.json({ user });
  });

  return router;
}

module.exports = { createAuthRoutes };
