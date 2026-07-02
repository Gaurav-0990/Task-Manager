const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (secret) return secret;

  const secretFile = path.join(__dirname, '..', 'data', 'jwt-secret.txt');
  try {
    if (fs.existsSync(secretFile)) {
      const persisted = fs.readFileSync(secretFile, 'utf8').trim();
      if (persisted) return persisted;
    }
  } catch (err) {
    // fall back to generating a new secret below
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  const newSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, newSecret);
  } catch (err) {
    // ignore write failures and continue with the generated secret
  }
  return newSecret;
}

const JWT_SECRET = getJwtSecret();

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authMiddleware, signToken, JWT_SECRET };
