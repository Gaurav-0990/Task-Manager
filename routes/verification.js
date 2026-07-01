const express = require('express');
const { ensureUserState, saveUserState } = require('../db');

const router = express.Router();

// Haversine distance in meters
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Set/get a "home base" lat/lng per category (e.g. user's gym)
router.post('/homebase', async (req, res) => {
  const { cat, lat, lng, radiusMeters } = req.body || {};
  if (!cat || lat == null || lng == null) return res.status(400).json({ error: 'cat, lat, lng required' });
  const state = await ensureUserState(req.userId);
  state.homeBases = state.homeBases || {};
  state.homeBases[cat] = { lat, lng, radiusMeters: radiusMeters || 200 };
  await saveUserState(req.userId, state);
  res.json({ saved: true });
});

// Verify a GPS proof against the stored home base for that category
router.post('/gps-check', async (req, res) => {
  const { cat, lat, lng } = req.body || {};
  if (!cat || lat == null || lng == null) return res.status(400).json({ error: 'cat, lat, lng required' });
  const state = await ensureUserState(req.userId);
  const homeBases = state.homeBases || {};
  const base = homeBases[cat];
  if (!base) return res.status(404).json({ error: 'No home base set for this category' });
  const dist = distanceMeters(lat, lng, base.lat, base.lng);
  res.json({ verified: dist <= base.radiusMeters, distanceMeters: Math.round(dist), allowedRadius: base.radiusMeters });
});

// Photo proof-of-work anti-farming: client computes a perceptual hash
// (e.g. via a small JS pHash lib) and submits it here. Server tracks hashes
// per quest per user and flags reuse within a lookback window — this is the
// server-side half of the fraud check the frontend can't do alone.
router.post('/photo-check', async (req, res) => {
  const { questId, phash } = req.body || {};
  if (!questId || !phash) return res.status(400).json({ error: 'questId and phash required' });
  const state = await ensureUserState(req.userId);
  state.photoHashes = state.photoHashes || {}; // questId -> [{hash, ts}]
  const list = state.photoHashes[questId] || [];

  // Hamming-distance-based near-duplicate check (phash is a hex string)
  const isDuplicate = list.some(entry => hammingDistance(entry.hash, phash) <= 5);

  list.push({ hash: phash, ts: Date.now() });
  state.photoHashes[questId] = list.slice(-30);
  await saveUserState(req.userId, state);

  res.json({ accepted: !isDuplicate, flaggedAsDuplicate: isDuplicate });
});

function hammingDistance(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return 999;
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    dist += xor.toString(2).split('1').length - 1;
  }
  return dist;
}

module.exports = router;
