let state = null;
let activeCat = 'ALL';
let authToken = localStorage.getItem('system-auth-token') || '';
let userId = localStorage.getItem('system-user-id') || '';
let otpPendingEmail = '';
const API_BASE = window.__SYSTEM_API_BASE__ || '/api';
const CATS = ['CDS','GYM','DEV','DSA'];
const CAT_LABEL = {CDS:'CDS / AFCAT', GYM:'GYM', DEV:'WEB DEV', DSA:'DSA'};
const CAT_STAT = {CDS:'INT', GYM:'STR', DSA:'PER', DEV:'AGI'};

const DEFAULT_QUESTS = [
  {id:'q1', cat:'CDS', title:'Study CDS/AFCAT — 2 hrs', xp:30, penalty:15, done:false},
  {id:'q2', cat:'GYM', title:'Complete gym session', xp:20, penalty:10, done:false},
  {id:'q3', cat:'DSA', title:'Solve 5 DSA problems', xp:25, penalty:12, done:false},
  {id:'q4', cat:'DEV', title:'1 hr web dev practice/project', xp:20, penalty:10, done:false},
];

function defaultState(){
  return {
    level:1, xp:0,
    stats:{STR:0,INT:0,PER:0,AGI:0},
    quests: JSON.parse(JSON.stringify(DEFAULT_QUESTS)),
    emergencyQuests: [],
    streak:0,
    lastCloseDate:null,
    history: [],
    dayLog: [],
    difficulty: {},
    decayCounter: {CDS:0, GYM:0, DEV:0, DSA:0},
    log:[]
  };
}

const STORAGE_KEY = 'system-state-v3';

async function requestJson(path, { method='GET', body, auth=true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && authToken) headers['Authorization'] = `Bearer ${authToken}`;
  let baseUrl = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
  if (!baseUrl.startsWith('http')) {
    baseUrl = 'http://localhost:3001/api';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function ensureAuthenticated(){
  if (!authToken) {
    document.getElementById('authScreen').style.display = 'block';
    document.getElementById('appShell').style.display = 'none';
    return false;
  }
  return true;
}

function setOtpFlowVisible(visible){
  const otpInput = document.getElementById('authOtp');
  const verifyBtn = document.getElementById('verifyOtpBtn');
  const resendBtn = document.getElementById('resendOtpBtn');
  otpInput.style.display = visible ? 'block' : 'none';
  verifyBtn.style.display = visible ? 'inline-block' : 'none';
  resendBtn.style.display = visible ? 'inline-block' : 'none';
}

async function handleAuth(mode){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const message = document.getElementById('authMessage');
  try {
    const payload = await requestJson(`/auth/${mode}`, { method:'POST', body:{ email, password }, auth:false });
    if (payload.requiresVerification) {
      otpPendingEmail = payload.email || email;
      setOtpFlowVisible(true);
      message.textContent = payload.message || 'Verification code sent. Enter it to continue.';
      message.style.color = 'var(--gold)';
      return;
    }
    authToken = payload.token;
    userId = payload.userId;
    localStorage.setItem('system-auth-token', authToken);
    localStorage.setItem('system-user-id', userId);
    message.textContent = mode === 'login' ? 'Signed in.' : 'Registered and signed in.';
    message.style.color = 'var(--success)';
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'block';
    await loadState();
  } catch (err) {
    message.textContent = err.message;
    message.style.color = 'var(--danger-bright)';
  }
}

async function verifyOtp(){
  const message = document.getElementById('authMessage');
  const otp = document.getElementById('authOtp').value.trim();
  if (!otpPendingEmail || !/^[0-9]{6}$/.test(otp)) {
    message.textContent = 'Enter the 6-digit verification code.';
    message.style.color = 'var(--danger-bright)';
    return;
  }
  try {
    const payload = await requestJson('/auth/verify-otp', { method:'POST', body:{ email: otpPendingEmail, otp }, auth:false });
    authToken = payload.token;
    userId = payload.userId;
    localStorage.setItem('system-auth-token', authToken);
    localStorage.setItem('system-user-id', userId);
    setOtpFlowVisible(false);
    message.textContent = 'Email verified and signed in.';
    message.style.color = 'var(--success)';
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'block';
    await loadState();
  } catch (err) {
    message.textContent = err.message;
    message.style.color = 'var(--danger-bright)';
  }
}

async function resendOtp(){
  const email = document.getElementById('authEmail').value.trim();
  const message = document.getElementById('authMessage');
  if (!email) {
    message.textContent = 'Enter your email first.';
    message.style.color = 'var(--danger-bright)';
    return;
  }
  try {
    const payload = await requestJson('/auth/resend-otp', { method:'POST', body:{ email }, auth:false });
    otpPendingEmail = payload.email || email;
    setOtpFlowVisible(true);
    message.textContent = payload.message || 'A new code has been sent.';
    message.style.color = 'var(--gold)';
  } catch (err) {
    message.textContent = err.message;
    message.style.color = 'var(--danger-bright)';
  }
}

async function loadState(){
  if (!ensureAuthenticated()) return;
  try {
    const payload = await requestJson('/state');
    state = payload;
    if (!state.emergencyQuests) state.emergencyQuests = [];
    if (!state.history) state.history = [];
    if (!state.dayLog) state.dayLog = [];
    if (!state.difficulty) state.difficulty = {};
    if (!state.decayCounter) state.decayCounter = {CDS:0, GYM:0, DEV:0, DSA:0};
    if (!state.log) state.log = [];
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function saveState(){
  if (!state || !authToken) return;
  try {
    const payload = await requestJson('/state/sync', { method:'POST', body: state });
    state = payload;
    if (!state.emergencyQuests) state.emergencyQuests = [];
    if (!state.history) state.history = [];
    if (!state.dayLog) state.dayLog = [];
    if (!state.difficulty) state.difficulty = {};
    if (!state.decayCounter) state.decayCounter = {CDS:0, GYM:0, DEV:0, DSA:0};
    if (!state.log) state.log = [];
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ---------- ADAPTIVE DIFFICULTY / XP ENGINE ---------- */
function difficultyCoef(qid){
  const d = state.difficulty[qid];
  if(!d || d.n===0) return 1;
  return Math.min(1.6, 1 + d.skipRate*0.6);
}
function consistencyMultiplier(){
  return 0.85 + 0.15*Math.min(state.streak,10)/10;
}
function effectiveXP(q){
  return Math.round(q.xp * difficultyCoef(q.id) * consistencyMultiplier());
}
function updateDifficulty(q){
  const d = state.difficulty[q.id] || {skipRate:0, n:0};
  d.n += 1;
  const lr = Math.max(0.1, 1/d.n);
  d.skipRate = d.skipRate + lr*((q.done?0:1) - d.skipRate);
  state.difficulty[q.id] = d;
}

function xpNeeded(lvl){ return 100 + (lvl-1)*40; }
function rankForLevel(lvl){
  if(lvl<5) return 'E-RANK';
  if(lvl<10) return 'D-RANK';
  if(lvl<18) return 'C-RANK';
  if(lvl<28) return 'B-RANK';
  if(lvl<40) return 'A-RANK';
  return 'S-RANK';
}

function showToast(msg, isPenalty){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isPenalty?' penalty':'');
  setTimeout(()=>{ t.className = 'toast' + (isPenalty?' penalty':''); }, 2800);
}

function addXP(amount, cat){
  state.xp += amount;
  const statKey = CAT_STAT[cat];
  if(statKey) state.stats[statKey] += Math.round(amount/5);
  while(state.xp >= xpNeeded(state.level)){
    state.xp -= xpNeeded(state.level);
    state.level += 1;
    showToast('LEVEL UP — YOU ARE NOW LEVEL ' + state.level, false);
  }
}

function addLog(text, type){
  state.log.unshift({text, type, date: new Date().toLocaleString()});
  state.log = state.log.slice(0,50);
}

/* ---------- DAILY QUESTS ---------- */
async function toggleQuest(id){
  if(!ensureAuthenticated()) return;
  try {
    const payload = await requestJson(`/quests/${id}/toggle`, { method:'POST' });
    state = payload.state;
    if (!state.emergencyQuests) state.emergencyQuests = [];
    if (!state.history) state.history = [];
    if (!state.dayLog) state.dayLog = [];
    if (!state.difficulty) state.difficulty = {};
    if (!state.decayCounter) state.decayCounter = {CDS:0, GYM:0, DEV:0, DSA:0};
    if (!state.log) state.log = [];
    render();
    showToast(payload.result.message || 'Quest updated', false);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteQuest(id){
  if(!ensureAuthenticated()) return;
  try {
    const payload = await requestJson(`/quests/${id}`, { method:'DELETE' });
    state = payload.state;
    render();
    showToast(payload.result.deleted ? 'Quest removed' : 'Quest removed', false);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addQuest(){
  if(!ensureAuthenticated()) return;
  const title = document.getElementById('newQTitle').value.trim();
  const cat = document.getElementById('newQCat').value;
  const xp = parseInt(document.getElementById('newQXP').value, 10) || 10;
  const penalty = parseInt(document.getElementById('newQPenalty').value, 10) || 5;
  if(!title){ showToast('ENTER A QUEST NAME', true); return; }
  try {
    const payload = await requestJson('/quests', { method:'POST', body:{ title, cat, xp, penalty } });
    state = payload.state;
    document.getElementById('newQTitle').value='';
    render();
    showToast('QUEST REGISTERED', false);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function resetDay(){
  if(!ensureAuthenticated()) return;
  try {
    const payload = await requestJson('/day/reset', { method:'POST' });
    state = payload.state;
    render();
    showToast('NEW DAY — QUESTS RESET', false);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function closeDay(){
  if(!ensureAuthenticated()) return;
  try {
    const payload = await requestJson('/day/close', { method:'POST' });
    state = payload.state;
    render();
    const result = payload.result || {};
    const message = result.message || 'DAY CLOSED';
    showToast(message, result.perfect === false);
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ---------- EMERGENCY QUESTS ---------- */
function weeklyCompletionByCat(){
  const cutoff = Date.now() - 7*24*60*60*1000;
  const result = {};
  CATS.forEach(cat=>{
    const entries = state.history.filter(h=>h.cat===cat && new Date(h.date).getTime()>=cutoff);
    let done=0, total=0;
    entries.forEach(e=>{ done+=e.done; total+=e.total; });
    result[cat] = total>0 ? done/total : null;
  });
  return result;
}

function checkEmergencyTriggers(){
  const rates = weeklyCompletionByCat();
  CATS.forEach(cat=>{
    const rate = rates[cat];
    if(rate===null) return;
    if(rate < 0.5){
      const alreadyActive = state.emergencyQuests.some(e=>e.cat===cat && !e.resolved);
      if(!alreadyActive){
        issueEmergencyQuest(cat, rate);
      }
    }
  });
}

function issueEmergencyQuest(cat, rate){
  const deadline = Date.now() + 3*24*60*60*1000;
  const eq = {
    id:'em'+Date.now()+cat,
    cat,
    title:`Redeem your ${CAT_LABEL[cat]} performance — complete an intensive session`,
    xp: 60,
    penalty: 50,
    deadline,
    done:false,
    resolved:false
  };
  state.emergencyQuests.push(eq);
  addLog(`⚠ EMERGENCY QUEST ISSUED — ${CAT_LABEL[cat]} completion fell to ${Math.round(rate*100)}% this week`, 'w');
  showToast(`⚠ EMERGENCY QUEST: ${CAT_LABEL[cat]}`, true);
}

async function manualEmergency(){
  if(!ensureAuthenticated()) return;
  try {
    const payload = await requestJson('/day/emergency/manual', { method:'POST' });
    state = payload.state;
    render();
    showToast('EMERGENCY QUEST ISSUED', true);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function toggleEmergency(id){
  if(!ensureAuthenticated()) return;
  try {
    const payload = await requestJson(`/day/emergency/${id}/toggle`, { method:'POST' });
    state = payload.state;
    render();
    showToast(payload.result && payload.result.done ? 'EMERGENCY QUEST CLEARED' : 'EMERGENCY QUEST UPDATED', false);
  } catch (err) {
    showToast(err.message, true);
  }
}

function resolveExpiredEmergencies(){
  const now = Date.now();
  state.emergencyQuests.forEach(eq=>{
    if(!eq.resolved && now > eq.deadline){
      eq.resolved = true;
      state.xp -= eq.penalty;
      while(state.xp < 0 && state.level>1){ state.level -= 1; state.xp += xpNeeded(state.level); }
      if(state.xp<0) state.xp=0;
      addLog(`-${eq.penalty} XP — EMERGENCY QUEST FAILED: ${CAT_LABEL[eq.cat]}`, 'n');
      showToast(`EMERGENCY QUEST FAILED -${eq.penalty} XP`, true);
    }
  });
  state.emergencyQuests = state.emergencyQuests.filter(e=>!(e.resolved && e.done===false && now-e.deadline>7*24*60*60*1000) );
}

/* ---------- HIDDEN TRAIT INFERENCE ---------- */
function computeTraits(){
  const recent = state.dayLog.slice(-14);
  const discipline = recent.length ? Math.round(recent.filter(d=>d.perfect).length/recent.length*100) : null;

  let recoverOps=0, recovered=0;
  for(let i=1;i<recent.length;i++){
    if(!recent[i-1].perfect){
      recoverOps++;
      if(recent[i].perfect) recovered++;
    }
  }
  const resilience = recoverOps>0 ? Math.round(recovered/recoverOps*100) : null;

  const rates = weeklyCompletionByCat();
  const vals = CATS.map(c=>rates[c]).filter(v=>v!==null);
  const focus = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*100) : null;

  return {discipline, resilience, focus};
}

function setActiveCat(cat){
  activeCat = cat;
  document.querySelectorAll('#catFilters .cat-pill').forEach(p=>{
    p.classList.toggle('active', p.dataset.cat===cat);
  });
  render();
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDeadline(ts){
  const diff = ts - Date.now();
  if(diff<=0) return 'EXPIRED';
  const hrs = Math.floor(diff/3600000);
  const days = Math.floor(hrs/24);
  if(days>0) return `${days}d ${hrs%24}h left`;
  return `${hrs}h left`;
}

function render(){
  document.getElementById('lvlNum').textContent = state.level;
  document.getElementById('rankBadge').textContent = rankForLevel(state.level);
  const need = xpNeeded(state.level);
  document.getElementById('xpLabel').textContent = `${state.xp} / ${need}`;
  document.getElementById('xpFill').style.width = Math.min(100,(state.xp/need)*100) + '%';

  document.getElementById('statSTR').textContent = state.stats.STR;
  document.getElementById('statINT').textContent = state.stats.INT;
  document.getElementById('statPER').textContent = state.stats.PER;
  document.getElementById('statAGI').textContent = state.stats.AGI;

  const total = state.quests.length;
  const done = state.quests.filter(q=>q.done).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById('scorePct').textContent = pct + '%';
  const circumference = 402;
  document.getElementById('scoreRing').style.strokeDashoffset = circumference - (pct/100)*circumference;
  document.getElementById('streakText').textContent = `🔥 ${state.streak} DAY STREAK`;

  const list = document.getElementById('questList');
  const filtered = activeCat==='ALL' ? state.quests : state.quests.filter(q=>q.cat===activeCat);
  list.innerHTML = '';
  document.getElementById('emptyMsg').style.display = filtered.length ? 'none' : 'block';
  filtered.forEach(q=>{
    const div = document.createElement('div');
    div.className = 'quest' + (q.done ? ' done':'');
    const coef = difficultyCoef(q.id);
    const xpShown = effectiveXP(q);
    const diffTag = coef>1.05 ? `<span class="diff-tag">×${coef.toFixed(2)} difficulty</span>` : '';
    div.innerHTML = `
      <div class="qcheck ${q.done?'checked':''}" onclick="toggleQuest('${q.id}')"></div>
      <div class="qbody">
        <div class="qtop">
          <div class="qtitle">${escapeHtml(q.title)}</div>
          <span class="quest-tag tag-${q.cat}">${q.cat}</span>
        </div>
        <div class="qmeta">
          <span class="qreward">Reward +${xpShown} XP${diffTag}</span>
          <span class="qpenalty">Penalty -${q.penalty} XP</span>
        </div>
      </div>
      <button class="qdel" onclick="deleteQuest('${q.id}')">✕</button>
    `;
    list.appendChild(div);
  });

  const rates = weeklyCompletionByCat();
  const bars = document.getElementById('weeklyBars');
  bars.innerHTML = '';
  CATS.forEach(cat=>{
    const r = rates[cat];
    const pctVal = r===null ? null : Math.round(r*100);
    const row = document.createElement('div');
    row.className = 'wb-row';
    row.innerHTML = `
      <div class="wb-label">${CAT_LABEL[cat]}</div>
      <div class="wb-track"><div class="wb-fill ${pctVal!==null && pctVal<50 ? 'low':''}" style="width:${pctVal===null?0:pctVal}%"></div></div>
      <div class="wb-pct">${pctVal===null ? '—' : pctVal+'%'}</div>
    `;
    bars.appendChild(row);
  });

  const activeEm = state.emergencyQuests.filter(e=>!e.resolved);
  const emList = document.getElementById('emQuestList');
  emList.innerHTML = '';
  const emIntro = document.getElementById('emIntro');
  if(activeEm.length===0){
    emIntro.innerHTML = `No active emergencies. The System watches your <b>weekly completion rate</b> per stat — fall below <b>50%</b> over 7 days and an Emergency Quest will be issued with a harsh penalty and a deadline.`;
  } else {
    emIntro.innerHTML = `<b>${activeEm.length} active emergency quest(s).</b> Clear them before the deadline or take the penalty.`;
  }
  activeEm.forEach(eq=>{
    const div = document.createElement('div');
    div.className = 'quest urgent' + (eq.done?' done':'');
    div.innerHTML = `
      <div class="qcheck ${eq.done?'checked':''}" onclick="toggleEmergency('${eq.id}')"></div>
      <div class="qbody">
        <div class="qtop">
          <div class="qtitle">${escapeHtml(eq.title)}</div>
          <span class="quest-tag tag-EMERGENCY">EMERGENCY</span>
        </div>
        <div class="qmeta">
          <span class="qreward">Reward +${eq.xp} XP</span>
          <span class="qpenalty">Penalty -${eq.penalty} XP</span>
          <span class="qdeadline">${formatDeadline(eq.deadline)}</span>
        </div>
      </div>
    `;
    emList.appendChild(div);
  });

  const logList = document.getElementById('logList');
  logList.innerHTML = '';
  document.getElementById('logEmpty').style.display = state.log.length ? 'none':'block';
  state.log.slice(0,18).forEach(e=>{
    const cls = e.type==='p' ? 'lp' : (e.type==='w' ? 'lw' : 'ln');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="${cls}">${escapeHtml(e.text)}</span><span>${e.date}</span>`;
    logList.appendChild(div);
  });

  const traits = computeTraits();
  ['discipline','resilience','focus'].forEach(key=>{
    const v = traits[key];
    const fill = document.getElementById('trait'+key.charAt(0).toUpperCase()+key.slice(1));
    const val = document.getElementById('trait'+key.charAt(0).toUpperCase()+key.slice(1)+'Val');
    fill.style.width = (v===null?0:v) + '%';
    val.textContent = v===null ? '—' : v+'%';
  });
}

document.getElementById('catFilters').addEventListener('click', (e)=>{
  if(e.target.classList.contains('cat-pill')) setActiveCat(e.target.dataset.cat);
});

if (authToken) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  loadState();
} else {
  document.getElementById('authScreen').style.display = 'block';
  document.getElementById('appShell').style.display = 'none';
}
setInterval(()=>{ if (state && authToken) { loadState().catch(()=>{}); } }, 60000);

