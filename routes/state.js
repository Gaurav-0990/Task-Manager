const express = require('express');
const { ensureUserState, saveUserState } = require('../db');
const { computeTraits, rankForLevel, xpNeeded } = require('../logic/engine');

const router = express.Router();

async function loadState(req) {
  return { state: await ensureUserState(req.userId) };
}

// GET full state, enriched with derived fields the client doesn't need to compute
router.get('/', async (req, res) => {
  const { state } = await loadState(req);
  res.json({
    ...state,
    rank: rankForLevel(state.level),
    xpToNextLevel: xpNeeded(state.level),
    traits: computeTraits(state),
  });
});

router.post('/sync', async (req, res) => {
  const { state: serverState } = await loadState(req);
  const clientState = req.body;
  if (!clientState || typeof clientState.updatedAt !== 'number') {
    return res.status(400).json({ error: 'Client state with updatedAt required' });
  }

  let merged;
  if (clientState.updatedAt > (serverState.updatedAt || 0)) {
    merged = { ...clientState };
  } else {
    merged = { ...serverState };
  }

  merged.history = mergeByKey(serverState.history, clientState.history, h => `${h.date}|${h.cat}`);
  merged.dayLog = mergeByKey(serverState.dayLog, clientState.dayLog, d => d.date);
  merged.log = mergeByKey(serverState.log, clientState.log, l => `${l.date}|${l.text}`).slice(0, 50);
  merged.emergencyQuests = mergeByKey(serverState.emergencyQuests, clientState.emergencyQuests, e => e.id);
  merged.quests = mergeByKey(serverState.quests, clientState.quests, q => q.id);
  merged.updatedAt = Date.now();

  await saveUserState(req.userId, merged);
  res.json({ ...merged, rank: rankForLevel(merged.level), xpToNextLevel: xpNeeded(merged.level), traits: computeTraits(merged) });
});

function mergeByKey(a = [], b = [], keyFn) {
  const map = new Map();
  [...a, ...b].forEach(item => map.set(keyFn(item), item));
  return Array.from(map.values());
}

module.exports = router;
