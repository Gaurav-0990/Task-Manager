const express = require('express');
const bcrypt = require('bcryptjs');
const { createUser, findUserByEmail, ensureUserState } = require('../db');
const { signToken } = require('../middleware/auth');

const router = express.Router();

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Email and password (min 6 chars) required' });
    }

    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const id = 'u' + Date.now() + Math.random().toString(36).slice(2, 8);
    await createUser({ id, email: email.trim().toLowerCase(), passwordHash, createdAt: Date.now() });
    await ensureUserState(id);

    const token = signToken(id);
    return res.status(201).json({ token, userId: id });
  } catch (err) {
    console.error('register failed', err);
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string' || password.length < 1) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    return res.json({ token, userId: user.id });
  } catch (err) {
    console.error('login failed', err);
    next(err);
  }
});

module.exports = router;
