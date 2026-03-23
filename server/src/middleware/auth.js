const jwt = require('jsonwebtoken');

function createAuthMiddleware(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'invalid_token', message: 'Token is invalid or expired' });
    }

    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, secret);
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'invalid_token', message: 'Token is invalid or expired' });
    }
  };
}

module.exports = { createAuthMiddleware };
