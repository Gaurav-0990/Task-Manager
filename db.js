const fs = require('fs/promises');
const path = require('path');
const { defaultState } = require('./logic/engine');

let mongoClient = null;
let mongoDb = null;
let initialized = false;
let storeMode = 'memory';
let fileStore = { users: [], userStates: {} };
const DB_FILE = path.join(__dirname, 'data', 'db.json');

function getMongoConfig() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) return null;
  return {
    uri,
    dbName: process.env.MONGODB_DB || process.env.MONGO_DB || 'the_system',
  };
}

async function connectMongo() {
  const config = getMongoConfig();
  if (!config) throw new Error('MongoDB connection string not configured');

  if (!mongoClient) {
    const { MongoClient } = require('mongodb');
    mongoClient = new MongoClient(config.uri, {
      serverSelectionTimeoutMS: 3000,
      maxPoolSize: 10,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(config.dbName);
  }

  return mongoDb;
}

async function initializeMongo() {
  const db = await connectMongo();
  await db.collection('users').createIndex({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
  await db.collection('user_states').createIndex({ userId: 1 }, { unique: true });
  storeMode = 'mongo';
  initialized = true;
  return true;
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

  if (getMongoConfig()) {
    try {
      await initializeMongo();
      return { mode: storeMode };
    } catch (err) {
      console.warn('MongoDB unavailable, falling back to local JSON store:', err.message);
    }
  }

  await initializeFileStore();
  return { mode: storeMode };
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

async function createUser({ id, email, passwordHash, createdAt, verified = true, otpHash = null, otpExpiresAt = null }) {
  const normalizedEmail = normalizeEmail(email);
  if (storeMode === 'mongo') {
    const db = await connectMongo();
    const payload = {
      _id: id,
      id,
      email: normalizedEmail,
      passwordHash,
      createdAt,
      verified,
      otpHash,
      otpExpiresAt,
    };
    await db.collection('users').insertOne(payload);
    return { id, email: normalizedEmail, createdAt, verified, otpHash, otpExpiresAt };
  }

  const existingIndex = fileStore.users.findIndex(entry => entry.email.toLowerCase() === normalizedEmail);
  const record = { id, email: normalizedEmail, passwordHash, createdAt, verified, otpHash, otpExpiresAt };
  if (existingIndex >= 0) {
    fileStore.users[existingIndex] = record;
  } else {
    fileStore.users.push(record);
  }
  await persistFileStore();
  return { id, email: normalizedEmail, createdAt, verified, otpHash, otpExpiresAt };
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (storeMode === 'mongo') {
    const db = await connectMongo();
    const user = await db.collection('users').findOne({ email: normalizedEmail });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
      verified: user.verified !== false,
      otpHash: user.otpHash || null,
      otpExpiresAt: user.otpExpiresAt || null,
    };
  }

  const user = fileStore.users.find(entry => entry.email.toLowerCase() === normalizedEmail);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    verified: user.verified !== false,
    otpHash: user.otpHash || null,
    otpExpiresAt: user.otpExpiresAt || null,
  };
}

async function updateUserOtp(email, otpHash, otpExpiresAt) {
  const normalizedEmail = normalizeEmail(email);
  if (storeMode === 'mongo') {
    const db = await connectMongo();
    await db.collection('users').updateOne(
      { email: normalizedEmail },
      { $set: { otpHash, otpExpiresAt, verified: false } },
      { upsert: false }
    );
    return true;
  }

  const existingIndex = fileStore.users.findIndex(entry => entry.email.toLowerCase() === normalizedEmail);
  if (existingIndex >= 0) {
    fileStore.users[existingIndex] = {
      ...fileStore.users[existingIndex],
      otpHash,
      otpExpiresAt,
      verified: false,
    };
    await persistFileStore();
  }
  return true;
}

async function markUserVerified(email) {
  const normalizedEmail = normalizeEmail(email);
  if (storeMode === 'mongo') {
    const db = await connectMongo();
    await db.collection('users').updateOne(
      { email: normalizedEmail },
      { $set: { verified: true, otpHash: null, otpExpiresAt: null } },
      { upsert: false }
    );
    return true;
  }

  const existingIndex = fileStore.users.findIndex(entry => entry.email.toLowerCase() === normalizedEmail);
  if (existingIndex >= 0) {
    fileStore.users[existingIndex] = {
      ...fileStore.users[existingIndex],
      verified: true,
      otpHash: null,
      otpExpiresAt: null,
    };
    await persistFileStore();
  }
  return true;
}

async function getUserState(userId) {
  if (storeMode === 'mongo') {
    const db = await connectMongo();
    const doc = await db.collection('user_states').findOne({ userId });
    return doc?.state || null;
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
  if (storeMode === 'mongo') {
    const db = await connectMongo();
    await db.collection('user_states').updateOne(
      { userId },
      { $set: { userId, state, updatedAt } },
      { upsert: true }
    );
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
  createUser,
  findUserByEmail,
  updateUserOtp,
  markUserVerified,
  getUserState,
  ensureUserState,
  saveUserState,
};
