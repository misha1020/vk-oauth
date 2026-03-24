const express = require('express');
const jwt = require('jsonwebtoken');
const { exchangeCode, fetchUserProfile } = require('../services/vk');
const { findById, createUser } = require('../services/users');
const { createAuthMiddleware } = require('../middleware/auth');

function createAuthRoutes({ jwtSecret, vkAppId, vkAppSecret, usersFile }) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(jwtSecret);

  router.get('/vk/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      const msg = encodeURIComponent(error_description || error);
      return res.redirect(`vkoauth://auth/error?message=${msg}`);
    }

    if (!code) {
      return res.redirect('vkoauth://auth/error?message=missing_code');
    }

    if (!state) {
      return res.redirect('vkoauth://auth/error?message=missing_state');
    }

    let codeVerifier, deviceId;
    try {
      const base64 = state.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
      codeVerifier = decoded.code_verifier;
      deviceId = decoded.device_id;
    } catch {
      return res.redirect('vkoauth://auth/error?message=invalid_state');
    }

    if (!codeVerifier || !deviceId) {
      return res.redirect('vkoauth://auth/error?message=invalid_state');
    }

    const callbackUrl = `${process.env.SERVER_URL}/auth/vk/callback`;

    try {
      const { accessToken } = await exchangeCode({
        code,
        redirectUri: callbackUrl,
        clientId: vkAppId,
        clientSecret: vkAppSecret,
        codeVerifier,
        deviceId,
      });

      const profile = await fetchUserProfile(accessToken);
      const user = createUser(profile, usersFile);

      const token = jwt.sign(
        { userId: user.id, vkId: user.vkId },
        jwtSecret,
        { expiresIn: '7d' }
      );

      return res.redirect(`vkoauth://auth/success?token=${encodeURIComponent(token)}`);
    } catch (err) {
      const msg = encodeURIComponent(err.message || 'auth_failed');
      return res.redirect(`vkoauth://auth/error?message=${msg}`);
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
