const express = require('express');
const { ensureUserState, saveUserState } = require('../db');
const engine = require('../logic/engine');

const router = express.Router();

async function withState(req, res, fn) {
  const state = await ensureUserState(req.userId);
  try {
    const result = fn(state);
    state.updatedAt = Date.now();
    await saveUserState(req.userId, state);
    res.json({ result, state });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

function validateQuestPayload(body) {
  if (!body || typeof body !== 'object') throw new Error('Quest payload required');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const cat = typeof body.cat === 'string' ? body.cat.toUpperCase() : 'OTHER';
  const validCats = ['CDS', 'GYM', 'DEV', 'DSA', 'OTHER'];
  if (!title) throw new Error('Quest title required');
  if (!validCats.includes(cat)) throw new Error('Invalid quest category');
  const xp = Number(body.xp);
  const penalty = Number(body.penalty);
  if (!Number.isInteger(xp) || xp < 0 || !Number.isInteger(penalty) || penalty < 0) {
    throw new Error('Quest XP and penalty must be non-negative integers');
  }
  return { title, cat, xp, penalty };
}

router.post('/', (req, res) => withState(req, res, (state) => engine.addQuest(state, validateQuestPayload(req.body))));

router.post('/:id/toggle', (req, res) => withState(req, res, (state) => engine.toggleQuest(state, req.params.id)));

router.delete('/:id', (req, res) => withState(req, res, (state) => { engine.deleteQuest(state, req.params.id); return { deleted: req.params.id }; }));

module.exports = router;
