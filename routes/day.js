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
    const status = e.code === 'ALREADY_CLOSED' ? 409 : 400;
    res.status(status).json({ error: e.message, code: e.code });
  }
}

router.post('/close', (req, res) => withState(req, res, (state) => engine.closeDay(state)));
router.post('/reset', (req, res) => withState(req, res, (state) => { engine.resetDay(state); return { reset: true }; }));

router.post('/emergency/manual', (req, res) => withState(req, res, (state) => engine.manualEmergency(state)));
router.post('/emergency/:id/toggle', (req, res) => withState(req, res, (state) => engine.toggleEmergency(state, req.params.id)));
router.post('/emergency/check', (req, res) => withState(req, res, (state) => ({ issued: engine.checkEmergencyTriggers(state) })));

router.get('/traits', async (req, res) => {
  const state = await ensureUserState(req.userId);
  res.json(engine.computeTraits(state));
});

module.exports = router;
