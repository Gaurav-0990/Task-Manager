const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { authMiddleware } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const questRoutes = require('./routes/quests');
const dayRoutes = require('./routes/day');
const verificationRoutes = require('./routes/verification');
const { initializeDb } = require('./db');

const app = express();
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use(express.static(__dirname));

app.use(generalLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/state', authMiddleware, stateRoutes);
app.use('/api/quests', authMiddleware, questRoutes);
app.use('/api/day', authMiddleware, dayRoutes);
app.use('/api/verify', authMiddleware, verificationRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err?.message === 'CORS origin not allowed') {
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

if (!process.env.VERCEL) {
  initializeDb().catch(err => {
    console.error('Failed to initialize database', err);
  }).finally(() => {
    app.listen(PORT, () => console.log(`THE SYSTEM backend running on port ${PORT}`));
  });
}

module.exports = app;
