declare const React: typeof import('react');
declare const ReactDOM: typeof import('react-dom');

const { useState, useEffect } = React;

type Category = 'ALL' | 'CDS' | 'GYM' | 'DEV' | 'DSA' | 'OTHER';
type Quest = {
  id: string;
  cat: 'CDS' | 'GYM' | 'DEV' | 'DSA' | 'OTHER';
  title: string;
  xp: number;
  penalty: number;
  done: boolean;
};
type DifficultyState = {
  n: number;
  skipRate: number;
};
type QuestForm = {
  title: string;
  cat: Quest['cat'];
  xp: number;
  penalty: number;
};
type HistoryEntry = {
  cat: string;
  done: number;
  total: number;
  date: string;
};
type LogEntry = {
  type: 'p' | 'w' | 'l';
  text: string;
  date: string;
};
type AppState = {
  level: number;
  xp: number;
  stats: Record<string, number>;
  quests: Quest[];
  emergencyQuests: Quest[];
  streak: number;
  lastCloseDate: string | null;
  history: HistoryEntry[];
  dayLog: unknown[];
  difficulty: Record<string, DifficultyState>;
  decayCounter: Record<string, number>;
  log: LogEntry[];
  updatedAt: number;
};
type ToastState = {
  text: string;
  penalty: boolean;
};
type ApiFetchOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
};

const API_BASE = '/api';
const CATS: Array<Quest['cat']> = ['CDS', 'GYM', 'DEV', 'DSA'];
const CAT_LABEL: Record<string, string> = {
  CDS: 'CDS / AFCAT',
  GYM: 'GYM',
  DEV: 'WEB DEV',
  DSA: 'DSA',
};
const CAT_STAT: Record<string, string> = {
  CDS: 'INT',
  GYM: 'STR',
  DSA: 'PER',
  DEV: 'AGI',
};
const DEFAULT_QUESTS: Quest[] = [
  { id: 'q1', cat: 'CDS', title: 'Study CDS/AFCAT — 2 hrs', xp: 30, penalty: 15, done: false },
  { id: 'q2', cat: 'GYM', title: 'Complete gym session', xp: 20, penalty: 10, done: false },
  { id: 'q3', cat: 'DSA', title: 'Solve 5 DSA problems', xp: 25, penalty: 12, done: false },
  { id: 'q4', cat: 'DEV', title: '1 hr web dev practice/project', xp: 20, penalty: 10, done: false },
];

const storage = {
  get token() { return localStorage.getItem('system-auth-token') || ''; },
  set token(value: string) { localStorage.setItem('system-auth-token', value || ''); },
  get userId() { return localStorage.getItem('system-user-id') || ''; },
  set userId(value: string) { localStorage.setItem('system-user-id', value || ''); },
};

async function apiFetch<T = any>(path: string, { method = 'GET', body, auth = true }: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && storage.token) headers['Authorization'] = `Bearer ${storage.token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as any).error || 'Request failed');
  return data as T;
}

function validateEmail(email: string): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function defaultState(): AppState {
  return {
    level: 1,
    xp: 0,
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

function xpNeeded(lvl: number): number {
  return 100 + (lvl - 1) * 40;
}

function rankForLevel(lvl: number): string {
  if (lvl < 5) return 'E-RANK';
  if (lvl < 10) return 'D-RANK';
  if (lvl < 18) return 'C-RANK';
  if (lvl < 28) return 'B-RANK';
  if (lvl < 40) return 'A-RANK';
  return 'S-RANK';
}

function difficultyCoef(state: AppState, qid: string): number {
  const current = state.difficulty[qid];
  if (!current || current.n === 0) return 1;
  return Math.min(1.6, 1 + current.skipRate * 0.6);
}

function consistencyMultiplier(state: AppState): number {
  return 0.85 + 0.15 * Math.min(state.streak, 10) / 10;
}

function effectiveXP(state: AppState, quest: Quest): number {
  return Math.round(quest.xp * difficultyCoef(state, quest.id) * consistencyMultiplier(state));
}

function useToast(): [ToastState, React.Dispatch<React.SetStateAction<ToastState>>] {
  const [toast, setToast] = useState<ToastState>({ text: '', penalty: false });

  useEffect(() => {
    if (!toast.text) return;
    const timer = window.setTimeout(() => setToast({ text: '', penalty: false }), 2800);
    return () => window.clearTimeout(timer);
  }, [toast.text]);

  return [toast, setToast];
}

function AuthView({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (mode: 'login' | 'register') => {
    if (!validateEmail(email) || typeof password !== 'string' || password.length < 6) {
      setMessage('Email and password (min 6 chars) required');
      return;
    }

    try {
      const data = await apiFetch<{ token: string; userId: string }>(`/auth/${mode}`, {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      storage.token = data.token;
      storage.userId = data.userId;
      setMessage(mode === 'login' ? 'Signed in.' : 'Registered and signed in.');
      onSuccess();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  return (
    <div className="panel auth-panel mx-auto max-w-xl rounded-[18px]">
      <div className="panel-corner-tl" />
      <div className="panel-title">AUTHENTICATION <span className="corner" /></div>
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <button className="btn" type="button" onClick={() => submit('login')}>LOGIN</button>
        <button className="btn ghost" type="button" onClick={() => submit('register')}>REGISTER</button>
      </div>
      <div className="empty" style={{ display: 'block', marginTop: '12px' }}>{message}</div>
    </div>
  );
}

function MainShell() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeCat, setActiveCat] = useState<Category>('ALL');
  const [toast, setToast] = useToast();
  const [questForm, setQuestForm] = useState<QuestForm>({ title: '', cat: 'CDS', xp: 20, penalty: 10 });

  const notify = (text: string, penalty = false) => setToast({ text, penalty });

  const load = async () => {
    try {
      const data = await apiFetch<AppState>('/state');
      setState(data);
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async (path: string, options: ApiFetchOptions) => {
    try {
      const data = await apiFetch<{ state?: AppState }>(path, options);
      setState((data.state || data) as AppState);
      return data;
    } catch (err) {
      notify((err as Error).message, true);
      return null;
    }
  };

  if (!state) {
    return <div className="wrap mx-auto relative z-10 px-4 sm:px-6"><div className="panel">Loading...</div></div>;
  }

  const filteredQuests = state.quests.filter(q => activeCat === 'ALL' ? true : q.cat === activeCat);
  const completionRatio = state.quests.length ? state.quests.filter(q => q.done).length / state.quests.length : 0;

  const handleToggle = async (id: string) => {
    const result = await refresh(`/quests/${id}/toggle`, { method: 'POST' });
    if (result) notify((result as any).result?.message || 'Quest updated');
  };

  const handleDelete = async (id: string) => {
    const result = await refresh(`/quests/${id}`, { method: 'DELETE' });
    if (result) notify('Quest removed');
  };

  const handleAddQuest = async () => {
    if (!questForm.title.trim()) {
      notify('ENTER A QUEST NAME', true);
      return;
    }
    const result = await refresh('/quests', { method: 'POST', body: questForm });
    if (result) {
      setQuestForm({ title: '', cat: 'CDS', xp: 20, penalty: 10 });
      notify('QUEST REGISTERED');
    }
  };

  const handleDay = async (path: string, successMessage: string, penalty = false) => {
    const result = await refresh(path, { method: 'POST' });
    if (result) notify((result as any).result?.message || successMessage, penalty);
  };

  const weeklyRates = () => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return CATS.reduce<Record<string, number | null>>((acc, cat) => {
      const entries = state.history.filter(h => h.cat === cat && new Date(h.date).getTime() >= cutoff);
      const done = entries.reduce((sum, e) => sum + e.done, 0);
      const total = entries.reduce((sum, e) => sum + e.total, 0);
      acc[cat] = total ? done / total : null;
      return acc;
    }, {});
  };

  return (
    <div className="wrap mx-auto relative z-10 px-4 sm:px-6">
      <div className="bg-fx" />
      <div className="bg-glow" />
      <div className="header text-center sm:text-left">
        <div className="eyebrow title-font">[ NOTIFICATION ]</div>
        <h1 className="title-font">THE SYSTEM</h1>
        <div className="sub title-font">YOU HAVE BEEN GRANTED THE POWER TO LEVEL UP</div>
      </div>

      <div className="panel">
        <div className="panel-corner-tl" />
        <div className="panel-title">STATUS WINDOW <span className="corner" /></div>
        <div className="status-grid">
          <div>
            <div className="name-row">
              <div className="player-name">HUNTER</div>
              <div className="rank-badge">{rankForLevel(state.level)}</div>
            </div>
            <div className="lvl-row">LEVEL <b>{state.level}</b></div>
            <div className="xp-bar-wrap">
              <div className="xp-label"><span>XP</span><span>{state.xp} / {xpNeeded(state.level)}</span></div>
              <div className="xp-bar"><div className="xp-fill" style={{ width: `${Math.min(100, (state.xp / xpNeeded(state.level)) * 100)}%` }} /></div>
            </div>
            <div className="stats-list">
              {Object.entries(state.stats).map(([key, value]) => (
                <div className="stat-line" key={key}>
                  <span>{key} — {Object.entries(CAT_STAT).find(([, v]) => v === key)?.[0] ?? ''}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="score-circle-wrap">
            <div className="score-circle">
              <svg width="150" height="150" viewBox="0 0 150 150">
                <defs>
                  <linearGradient id="gradStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#7c4dff" />
                    <stop offset="100%" stopColor="#8ad7ff" />
                  </linearGradient>
                </defs>
                <circle className="bg" cx="75" cy="75" r="64" />
                <circle className="fg" cx="75" cy="75" r="64" strokeDasharray="402" strokeDashoffset={`${402 - completionRatio * 402}`} />
              </svg>
              <div className="score-num"><div className="big">{Math.round(completionRatio * 100)}%</div><div className="small">TODAY</div></div>
            </div>
            <div className="streak">🔥 {state.streak} DAY STREAK</div>
          </div>
        </div>
      </div>

      <div className="panel emergency">
        <div className="panel-corner-tl" />
        <div className="panel-title">EMERGENCY QUEST <span className="corner" /></div>
        <div className="em-intro">No active emergencies. The System watches your <b>weekly completion rate</b> per stat — fall below <b>50%</b> over 7 days and an Emergency Quest will be issued with a harsh penalty and a deadline.</div>
        <div className="weekly-bars">
          {Object.entries(weeklyRates()).map(([cat, rate]) => (
            <div className="wb-row" key={cat}>
              <div className="wb-label">{CAT_LABEL[cat]}</div>
              <div className="wb-track"><div className={`wb-fill ${rate !== null && rate < 0.5 ? 'low' : ''}`} style={{ width: rate === null ? 0 : `${Math.round(rate * 100)}%` }} /></div>
              <div className="wb-pct">{rate === null ? '—' : `${Math.round(rate * 100)}%`}</div>
            </div>
          ))}
        </div>
        <div className="close-day-row">
          <button className="btn ghost" type="button" onClick={() => handleDay('/day/emergency/manual', 'EMERGENCY QUEST ISSUED', true)}>⚠ FORCE-ISSUE EMERGENCY QUEST</button>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px' }}>Auto-triggers when a stat falls below 50% completion this week</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-corner-tl" />
        <div className="panel-title">DAILY QUESTS <span className="corner" /></div>
        <div className="quest-categories">
          {['ALL', 'CDS', 'GYM', 'DEV', 'DSA', 'OTHER'].map(cat => (
            <button key={cat} type="button" className={`cat-pill ${activeCat === cat ? 'active' : ''}`} onClick={() => setActiveCat(cat as Category)}>{cat}</button>
          ))}
        </div>
        <div id="questList">
          {filteredQuests.map(q => (
            <div className={`quest ${q.done ? 'done' : ''}`} key={q.id}>
              <div className={`qcheck ${q.done ? 'checked' : ''}`} onClick={() => handleToggle(q.id)} />
              <div className="qbody">
                <div className="qtop"><div className="qtitle">{q.title}</div><span className={`quest-tag tag-${q.cat}`}>{q.cat}</span></div>
                <div className="qmeta"><span className="qreward">Reward +{effectiveXP(state, q)} XP</span><span className="qpenalty">Penalty -{q.penalty} XP</span></div>
              </div>
              <button className="qdel" type="button" onClick={() => handleDelete(q.id)}>✕</button>
            </div>
          ))}
        </div>
        <div className="empty" style={{ display: filteredQuests.length ? 'none' : 'block' }}>No quests in this category. Register one below, Hunter.</div>
        <div className="add-form">
          <input type="text" placeholder="New quest (e.g. Solve 20 DSA problems)" value={questForm.title} onChange={e => setQuestForm({ ...questForm, title: e.target.value })} />
          <select value={questForm.cat} onChange={e => setQuestForm({ ...questForm, cat: e.target.value as Quest['cat'] })}>
            <option value="CDS">CDS/AFCAT</option>
            <option value="GYM">GYM</option>
            <option value="DEV">WEB DEV</option>
            <option value="DSA">DSA</option>
            <option value="OTHER">OTHER</option>
          </select>
          <input type="number" placeholder="XP reward" value={questForm.xp} onChange={e => setQuestForm({ ...questForm, xp: Number(e.target.value) })} />
          <input type="number" placeholder="Penalty XP" value={questForm.penalty} onChange={e => setQuestForm({ ...questForm, penalty: Number(e.target.value) })} />
          <button className="btn" type="button" onClick={handleAddQuest}>+ REGISTER QUEST</button>
        </div>
        <div className="close-day-row">
          <button className="btn ghost" type="button" onClick={() => handleDay('/day/reset', 'NEW DAY — QUESTS RESET', false)}>↻ NEW DAY (clear completion)</button>
          <button className="btn danger" type="button" onClick={() => handleDay('/day/close', 'DAY CLOSED', true)}>⚔ CLOSE OUT DAY</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-corner-tl" />
        <div className="panel-title">SYSTEM LOG <span className="corner" /></div>
        {state.log.length ? state.log.slice(0, 18).map((entry, idx) => (
          <div className="log-entry" key={idx}><span className={entry.type === 'p' ? 'lp' : entry.type === 'w' ? 'lw' : 'ln'}>{entry.text}</span><span>{entry.date}</span></div>
        )) : <div className="empty">No entries yet.</div>}
      </div>

      <div className="foot-note">DO NOT IGNORE THE SYSTEM'S WARNINGS.</div>
      {toast.text && <div className={`toast show${toast.penalty ? ' penalty' : ''}`}>{toast.text}</div>}
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(!!storage.token);

  return authenticated ? <MainShell /> : <div className="wrap mx-auto relative z-10 px-4 sm:px-6"><AuthView onSuccess={() => setAuthenticated(true)} /></div>;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.render(<App />, rootElement);
}
