const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');
const { defaultState } = require('./logic/engine');

let pool = null;
let initialized = false;
let storeMode = 'memory';
let fileStore = { users: [], userStates: {} };
const DB_FILE = path.join(__dirname, 'data', 'db.json');

function buildConnectionString() {
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || '5432';
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || 'postgres';
  const database = process.env.PGDATABASE || 'the_system';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || buildConnectionString();
    pool = new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 1000,
    });
  }
  return pool;
}

async function initializePostgres() {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_states (
        user_id TEXT PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
    storeMode = 'postgres';
    initialized = true;
    return true;
  } finally {
    client.release();
  }
}

async function initializeFileStore() {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    fileStore = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      userStates: parsed.userStates || parsed.states || {},
    };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    fileStore = { users: [], userStates: {} };
    await fs.writeFile(DB_FILE, JSON.stringify(fileStore, null, 2));
  }
  storeMode = 'file';
  initialized = true;
}

async function initializeDb() {
  if (initialized) return { mode: storeMode };

  const hasPostgresConfig = Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGPORT || process.env.PGUSER || process.env.PGDATABASE);
  if (hasPostgresConfig) {
    try {
      await initializePostgres();
      return { mode: storeMode };
    } catch (err) {
      console.warn('Postgres unavailable, falling back to local JSON store:', err.message);
    }
  }

  await initializeFileStore();
  return { mode: storeMode };
}

async function createUser({ id, email, passwordHash, createdAt }) {
  if (storeMode === 'postgres') {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'INSERT INTO users(id, email, password_hash, created_at) VALUES($1, $2, $3, $4) RETURNING id, email, created_at',
        [id, email, passwordHash, createdAt]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  fileStore.users.push({ id, email, passwordHash, createdAt });
  await persistFileStore();
  return { id, email, createdAt };
}

async function findUserByEmail(email) {
  if (storeMode === 'postgres') {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'SELECT id, email, password_hash, created_at FROM users WHERE lower(email) = lower($1) LIMIT 1',
        [email]
      );
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
    } finally {
      client.release();
    }
  }

  const user = fileStore.users.find(entry => entry.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return null;
  return { id: user.id, email: user.email, passwordHash: user.passwordHash, createdAt: user.createdAt };
}

async function getUserState(userId) {
  if (storeMode === 'postgres') {
    const client = await getPool().connect();
    try {
      const result = await client.query('SELECT state_json FROM user_states WHERE user_id = $1', [userId]);
      if (!result.rows[0]) return null;
      return result.rows[0].state_json;
    } finally {
      client.release();
    }
  }
  return fileStore.userStates[userId] || null;
}

async function ensureUserState(userId) {
  const state = await getUserState(userId);
  if (state) return state;
  const initialState = defaultState();
  await saveUserState(userId, initialState);
  return initialState;
}

async function saveUserState(userId, state) {
  const updatedAt = Date.now();
  if (storeMode === 'postgres') {
    const client = await getPool().connect();
    try {
      await client.query(
        `INSERT INTO user_states(user_id, state_json, updated_at)
         VALUES($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at`,
        [userId, JSON.stringify(state), updatedAt]
      );
    } finally {
      client.release();
    }
    return { updatedAt };
  }

  fileStore.userStates[userId] = state;
  await persistFileStore();
  return { updatedAt };
}

async function persistFileStore() {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(fileStore, null, 2));
}

module.exports = {
  initializeDb,
  getPool,
  createUser,
  findUserByEmail,
  getUserState,
  ensureUserState,
  saveUserState,
};
