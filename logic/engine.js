// logic/engine.js
// Server-side port of THE SYSTEM's core mechanics (adaptive XP, decay,
// emergency quests, trait inference). This is the authoritative copy —
// the client should never compute XP/penalties itself once talking to
// this backend; it just renders what the server returns.

const CATS = ['CDS', 'GYM', 'DSA', 'DEV'];
const CAT_STAT = { CDS: 'INT', GYM: 'STR', DSA: 'PER', DEV: 'AGI' };
const CAT_LABEL = { CDS: 'CDS/AFCAT Prep', GYM: 'Physical Training', DSA: 'DSA Practice', DEV: 'Dev Work' };

const DEFAULT_QUESTS = [
  { id: 'q1', cat: 'CDS', title: 'Study CDS/AFCAT — 2 hrs', xp: 30, penalty: 15, done: false },
  { id: 'q2', cat: 'GYM', title: 'Complete gym session', xp: 20, penalty: 10, done: false },
  { id: 'q3', cat: 'DSA', title: 'Solve 5 DSA problems', xp: 25, penalty: 12, done: false },
  { id: 'q4', cat: 'DEV', title: '1 hr web dev practice/project', xp: 20, penalty: 10, done: false },
];

function defaultState() {
  return {
    level: 1, xp: 0,
    stats: { STR: 0, INT: 0, PER: 0, AGI: 0 },
    quests: JSON.parse(JSON.stringify(DEFAULT_QUESTS)),
    emergencyQuests: [],
    streak: 0,
    lastCloseDate: null,
    history: [],
    dayLog: [],
    difficulty: {},
    decayCounter: { CDS: 0, GYM: 0, DEV: 0, DSA: 0 },
    log: [],
    updatedAt: Date.now(),
  };
}

function xpNeeded(lvl) { return 100 + (lvl - 1) * 40; }

function rankForLevel(lvl) {
  if (lvl < 5) return 'E-RANK';
  if (lvl < 10) return 'D-RANK';
  if (lvl < 18) return 'C-RANK';
  if (lvl < 28) return 'B-RANK';
  if (lvl < 40) return 'A-RANK';
  return 'S-RANK';
}

/* ---------- ADAPTIVE DIFFICULTY / XP ENGINE ---------- */
function difficultyCoef(state, qid) {
  const d = state.difficulty[qid];
  if (!d || d.n === 0) return 1;
  return Math.min(1.6, 1 + d.skipRate * 0.6);
}
function consistencyMultiplier(state) {
  return 0.85 + 0.15 * Math.min(state.streak, 10) / 10;
}
function effectiveXP(state, q) {
  return Math.round(q.xp * difficultyCoef(state, q.id) * consistencyMultiplier(state));
}
function updateDifficulty(state, q) {
  const d = state.difficulty[q.id] || { skipRate: 0, n: 0 };
  d.n += 1;
  const lr = Math.max(0.1, 1 / d.n);
  d.skipRate = d.skipRate + lr * ((q.done ? 0 : 1) - d.skipRate);
  state.difficulty[q.id] = d;
}

function addXP(state, amount, cat, log = []) {
  state.xp += amount;
  const statKey = CAT_STAT[cat];
  if (statKey) state.stats[statKey] += Math.round(amount / 5);
  while (state.xp >= xpNeeded(state.level)) {
    state.xp -= xpNeeded(state.level);
    state.level += 1;
    log.push({ text: `LEVEL UP — YOU ARE NOW LEVEL ${state.level}`, type: 'p' });
  }
}

function addLog(state, text, type) {
  state.log.unshift({ text, type, date: new Date().toLocaleString() });
  state.log = state.log.slice(0, 50);
}

/* ---------- QUESTS ---------- */
function toggleQuest(state, id) {
  const q = state.quests.find(x => x.id === id);
  if (!q) throw new Error('Quest not found');
  q.done = !q.done;
  let result = { xp: 0 };
  if (q.done) {
    const xp = effectiveXP(state, q);
    addXP(state, xp, q.cat);
    const coef = difficultyCoef(state, q.id);
    const tag = xp !== q.xp ? ` (base ${q.xp} × ${coef.toFixed(2)} difficulty)` : '';
    addLog(state, `+${xp} XP — "${q.title}" cleared${tag}`, 'p');
    result = { xp, message: `QUEST CLEAR +${xp} XP` };
  } else {
    const xp = effectiveXP(state, q);
    state.xp -= xp;
    if (state.xp < 0) { state.level = Math.max(1, state.level - 1); state.xp += xpNeeded(state.level); }
    addLog(state, `Quest "${q.title}" unmarked`, 'n');
    result = { xp: -xp, message: `Quest unmarked` };
  }
  return result;
}

function addQuest(state, { title, cat, xp, penalty }) {
  if (!title || !title.trim()) throw new Error('Quest title required');
  const q = { id: 'q' + Date.now(), cat, title: title.trim(), xp: xp || 10, penalty: penalty || 5, done: false };
  state.quests.push(q);
  return q;
}

function deleteQuest(state, id) {
  state.quests = state.quests.filter(x => x.id !== id);
}

/* ---------- EMERGENCY QUESTS ---------- */
function weeklyCompletionByCat(state) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = {};
  CATS.forEach(cat => {
    const entries = state.history.filter(h => h.cat === cat && new Date(h.date).getTime() >= cutoff);
    let done = 0, total = 0;
    entries.forEach(e => { done += e.done; total += e.total; });
    result[cat] = total > 0 ? done / total : null;
  });
  return result;
}

function issueEmergencyQuest(state, cat, rate) {
  const deadline = Date.now() + 3 * 24 * 60 * 60 * 1000;
  const eq = {
    id: 'em' + Date.now() + cat,
    cat,
    title: `Redeem your ${CAT_LABEL[cat]} performance — complete an intensive session`,
    xp: 60, penalty: 50, deadline, done: false, resolved: false,
  };
  state.emergencyQuests.push(eq);
  addLog(state, `⚠ EMERGENCY QUEST ISSUED — ${CAT_LABEL[cat]} completion fell to ${Math.round(rate * 100)}% this week`, 'w');
  return eq;
}

function checkEmergencyTriggers(state) {
  const rates = weeklyCompletionByCat(state);
  const issued = [];
  CATS.forEach(cat => {
    const rate = rates[cat];
    if (rate === null) return;
    if (rate < 0.5) {
      const alreadyActive = state.emergencyQuests.some(e => e.cat === cat && !e.resolved);
      if (!alreadyActive) issued.push(issueEmergencyQuest(state, cat, rate));
    }
  });
  return issued;
}

function manualEmergency(state) {
  const rates = weeklyCompletionByCat(state);
  let weakest = CATS[0], lowest = 2;
  CATS.forEach(cat => {
    const r = rates[cat];
    if (r !== null && r < lowest) { lowest = r; weakest = cat; }
  });
  return issueEmergencyQuest(state, weakest, lowest < 2 ? lowest : 0);
}

function toggleEmergency(state, id) {
  const eq = state.emergencyQuests.find(e => e.id === id);
  if (!eq || eq.resolved) throw new Error('Emergency quest not found or already resolved');
  eq.done = !eq.done;
  if (eq.done) {
    eq.resolved = true;
    addXP(state, eq.xp, eq.cat);
    addLog(state, `+${eq.xp} XP — EMERGENCY QUEST CLEARED: ${CAT_LABEL[eq.cat]}`, 'p');
  }
  return eq;
}

function resolveExpiredEmergencies(state) {
  const now = Date.now();
  state.emergencyQuests.forEach(eq => {
    if (!eq.resolved && now > eq.deadline) {
      eq.resolved = true;
      state.xp -= eq.penalty;
      while (state.xp < 0 && state.level > 1) { state.level -= 1; state.xp += xpNeeded(state.level); }
      if (state.xp < 0) state.xp = 0;
      addLog(state, `-${eq.penalty} XP — EMERGENCY QUEST FAILED: ${CAT_LABEL[eq.cat]}`, 'n');
    }
  });
  state.emergencyQuests = state.emergencyQuests.filter(
    e => !(e.resolved && e.done === false && now - e.deadline > 7 * 24 * 60 * 60 * 1000)
  );
}

/* ---------- DAY CLOSE (decay + history + streak) ---------- */
function closeDay(state) {
  const today = new Date().toDateString();
  if (state.lastCloseDate === today) {
    const err = new Error('Day already closed');
    err.code = 'ALREADY_CLOSED';
    throw err;
  }

  const incomplete = state.quests.filter(q => !q.done);
  let totalPenalty = 0;
  incomplete.forEach(q => {
    totalPenalty += q.penalty;
    addLog(state, `-${q.penalty} XP — PENALTY: "${q.title}" not completed`, 'n');
  });

  state.quests.forEach(q => updateDifficulty(state, q));

  CATS.forEach(cat => {
    const catQuests = state.quests.filter(q => q.cat === cat);
    if (catQuests.length === 0) return;
    const doneCount = catQuests.filter(q => q.done).length;
    state.history.push({ date: today, cat, done: doneCount, total: catQuests.length });

    if (doneCount === 0) {
      state.decayCounter[cat] = (state.decayCounter[cat] || 0) + 1;
      if (state.decayCounter[cat] >= 3) {
        const statKey = CAT_STAT[cat];
        if (state.stats[statKey] > 0) {
          state.stats[statKey] = Math.max(0, state.stats[statKey] - 2);
          addLog(state, `-2 ${statKey} — DECAY: ${CAT_LABEL[cat]} neglected ${state.decayCounter[cat]} days`, 'w');
        }
      }
    } else {
      state.decayCounter[cat] = 0;
    }
  });
  state.history = state.history.slice(-200);

  let outcome;
  if (totalPenalty > 0) {
    state.xp -= totalPenalty;
    while (state.xp < 0 && state.level > 1) { state.level -= 1; state.xp += xpNeeded(state.level); }
    if (state.xp < 0) state.xp = 0;
    state.streak = 0;
    state.dayLog.push({ date: today, perfect: false });
    outcome = { perfect: false, penalty: totalPenalty, message: `PENALTY ZONE: -${totalPenalty} XP` };
  } else {
    state.streak += 1;
    addLog(state, `Day complete — all quests cleared. Streak: ${state.streak}`, 'p');
    state.dayLog.push({ date: today, perfect: true });
    outcome = { perfect: true, streak: state.streak, message: 'PERFECT DAY — STREAK +1' };
  }
  state.dayLog = state.dayLog.slice(-60);

  resolveExpiredEmergencies(state);

  state.lastCloseDate = today;
  state.quests.forEach(q => (q.done = false));
  const issued = checkEmergencyTriggers(state);

  return { ...outcome, emergencyQuestsIssued: issued };
}

function resetDay(state) {
  state.quests.forEach(q => (q.done = false));
}

/* ---------- HIDDEN TRAIT INFERENCE ---------- */
function computeTraits(state) {
  const recent = state.dayLog.slice(-14);
  const discipline = recent.length ? Math.round(recent.filter(d => d.perfect).length / recent.length * 100) : null;

  let recoverOps = 0, recovered = 0;
  for (let i = 1; i < recent.length; i++) {
    if (!recent[i - 1].perfect) {
      recoverOps++;
      if (recent[i].perfect) recovered++;
    }
  }
  const resilience = recoverOps > 0 ? Math.round(recovered / recoverOps * 100) : null;

  const rates = weeklyCompletionByCat(state);
  const vals = CATS.map(c => rates[c]).filter(v => v !== null);
  const focus = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) : null;

  return { discipline, resilience, focus };
}

/* ---------- BURNOUT / COMPULSION DETECTION ---------- */
// Flags rapid-fire quest completions (XP-chasing) within a short window.
function checkBurnoutSignal(state, recentToggleTimestamps) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000; // 5 minutes
  const recent = recentToggleTimestamps.filter(t => now - t < windowMs);
  if (recent.length >= 6) {
    return { flagged: true, message: 'Unusual completion burst detected — consider a short break.' };
  }
  return { flagged: false };
}

module.exports = {
  CATS, CAT_STAT, CAT_LABEL,
  defaultState, xpNeeded, rankForLevel,
  effectiveXP, difficultyCoef, updateDifficulty,
  toggleQuest, addQuest, deleteQuest,
  weeklyCompletionByCat, checkEmergencyTriggers, manualEmergency, toggleEmergency, resolveExpiredEmergencies,
  closeDay, resetDay,
  computeTraits, checkBurnoutSignal,
};
