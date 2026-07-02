const { useState, useEffect } = React;
const API_BASE = (typeof window !== 'undefined' && window.__SYSTEM_API_BASE__) || '/api';
const CATS = ['CDS', 'GYM', 'DEV', 'DSA'];
const CAT_LABEL = {
    CDS: 'CDS / AFCAT',
    GYM: 'GYM',
    DEV: 'WEB DEV',
    DSA: 'DSA',
};
const CAT_STAT = {
    CDS: 'INT',
    GYM: 'STR',
    DSA: 'PER',
    DEV: 'AGI',
};
const DEFAULT_QUESTS = [
    { id: 'q1', cat: 'CDS', title: 'Study CDS/AFCAT — 2 hrs', xp: 30, penalty: 15, done: false },
    { id: 'q2', cat: 'GYM', title: 'Complete gym session', xp: 20, penalty: 10, done: false },
    { id: 'q3', cat: 'DSA', title: 'Solve 5 DSA problems', xp: 25, penalty: 12, done: false },
    { id: 'q4', cat: 'DEV', title: '1 hr web dev practice/project', xp: 20, penalty: 10, done: false },
];
const storage = {
    get token() { return localStorage.getItem('system-auth-token') || ''; },
    set token(value) { localStorage.setItem('system-auth-token', value || ''); },
    get userId() { return localStorage.getItem('system-user-id') || ''; },
    set userId(value) { localStorage.setItem('system-user-id', value || ''); },
};
async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    if (auth && storage.token)
        headers['Authorization'] = `Bearer ${storage.token}`;
    const baseUrl = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || 'Request failed');
    return data;
}
function validateEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function defaultState() {
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
function xpNeeded(lvl) {
    return 100 + (lvl - 1) * 40;
}
function rankForLevel(lvl) {
    if (lvl < 5)
        return 'E-RANK';
    if (lvl < 10)
        return 'D-RANK';
    if (lvl < 18)
        return 'C-RANK';
    if (lvl < 28)
        return 'B-RANK';
    if (lvl < 40)
        return 'A-RANK';
    return 'S-RANK';
}
function difficultyCoef(state, qid) {
    const current = state.difficulty[qid];
    if (!current || current.n === 0)
        return 1;
    return Math.min(1.6, 1 + current.skipRate * 0.6);
}
function consistencyMultiplier(state) {
    return 0.85 + 0.15 * Math.min(state.streak, 10) / 10;
}
function effectiveXP(state, quest) {
    return Math.round(quest.xp * difficultyCoef(state, quest.id) * consistencyMultiplier(state));
}
function useToast() {
    const [toast, setToast] = useState({ text: '', penalty: false });
    useEffect(() => {
        if (!toast.text)
            return;
        const timer = window.setTimeout(() => setToast({ text: '', penalty: false }), 2800);
        return () => window.clearTimeout(timer);
    }, [toast.text]);
    return [toast, setToast];
}
function AuthView({ onSuccess }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [otp, setOtp] = useState('');
    const [message, setMessage] = useState('');
    const [otpPendingEmail, setOtpPendingEmail] = useState('');
    const [otpVisible, setOtpVisible] = useState(false);
    const submit = async (mode) => {
        if (!validateEmail(email) || typeof password !== 'string' || password.length < 6) {
            setMessage('Email and password (min 6 chars) required');
            return;
        }
        try {
            const data = await apiFetch(`/auth/${mode}`, {
                method: 'POST',
                body: { email, password },
                auth: false,
            });
            if (data.requiresVerification) {
                setOtpPendingEmail(data.email || email);
                setOtpVisible(true);
                setMessage(data.message || 'Verification code sent. Enter it to continue.');
                return;
            }
            storage.token = data.token;
            storage.userId = data.userId;
            setMessage(mode === 'login' ? 'Signed in.' : 'Registered and signed in.');
            onSuccess();
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    const verifyOtp = async () => {
        if (!otpPendingEmail || !/^\d{6}$/.test(otp)) {
            setMessage('Enter the 6-digit verification code.');
            return;
        }
        try {
            const data = await apiFetch('/auth/verify-otp', {
                method: 'POST',
                body: { email: otpPendingEmail, otp },
                auth: false,
            });
            storage.token = data.token;
            storage.userId = data.userId;
            setOtpVisible(false);
            setMessage('Email verified and signed in.');
            onSuccess();
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    const resendOtp = async () => {
        if (!validateEmail(email)) {
            setMessage('Enter your email first.');
            return;
        }
        try {
            const data = await apiFetch('/auth/resend-otp', {
                method: 'POST',
                body: { email },
                auth: false,
            });
            setOtpPendingEmail(data.email || email);
            setOtpVisible(true);
            setMessage(data.message || 'A new verification code has been sent.');
        }
        catch (err) {
            setMessage(err.message);
        }
    };
    return (React.createElement("div", { className: "panel auth-panel mx-auto max-w-xl rounded-[18px]" },
        React.createElement("div", { className: "panel-corner-tl" }),
        React.createElement("div", { className: "panel-title" },
            "AUTHENTICATION ",
            React.createElement("span", { className: "corner" })),
        React.createElement("input", { type: "email", placeholder: "Email", value: email, onChange: e => setEmail(e.target.value) }),
        React.createElement("input", { type: "password", placeholder: "Password", value: password, onChange: e => setPassword(e.target.value) }),
        otpVisible ? React.createElement("input", { type: "text", placeholder: "Enter 6-digit OTP", value: otp, onChange: e => setOtp(e.target.value) }) : null,
        React.createElement("div", { className: "flex flex-wrap gap-3" },
            React.createElement("button", { className: "btn", type: "button", onClick: () => submit('login') }, "LOGIN"),
            React.createElement("button", { className: "btn ghost", type: "button", onClick: () => submit('register') }, "REGISTER"),
            otpVisible ? React.createElement("button", { className: "btn", type: "button", onClick: verifyOtp }, "VERIFY OTP") : null,
            otpVisible ? React.createElement("button", { className: "btn ghost", type: "button", onClick: resendOtp }, "RESEND OTP") : null),
        React.createElement("div", { className: "empty", style: { display: 'block', marginTop: '12px' } }, message)));
}
function MainShell() {
    const [state, setState] = useState(null);
    const [activeCat, setActiveCat] = useState('ALL');
    const [toast, setToast] = useToast();
    const [questForm, setQuestForm] = useState({ title: '', cat: 'CDS', xp: 20, penalty: 10 });
    const notify = (text, penalty = false) => setToast({ text, penalty });
    const load = async () => {
        try {
            const data = await apiFetch('/state');
            setState(data);
        }
        catch (err) {
            notify(err.message, true);
        }
    };
    useEffect(() => {
        load();
    }, []);
    const refresh = async (path, options) => {
        try {
            const data = await apiFetch(path, options);
            setState((data.state || data));
            return data;
        }
        catch (err) {
            notify(err.message, true);
            return null;
        }
    };
    if (!state) {
        return React.createElement("div", { className: "wrap mx-auto relative z-10 px-4 sm:px-6" },
            React.createElement("div", { className: "panel" }, "Loading..."));
    }
    const filteredQuests = state.quests.filter(q => activeCat === 'ALL' ? true : q.cat === activeCat);
    const completionRatio = state.quests.length ? state.quests.filter(q => q.done).length / state.quests.length : 0;
    const handleToggle = async (id) => {
        const result = await refresh(`/quests/${id}/toggle`, { method: 'POST' });
        if (result)
            notify(result.result?.message || 'Quest updated');
    };
    const handleDelete = async (id) => {
        const result = await refresh(`/quests/${id}`, { method: 'DELETE' });
        if (result)
            notify('Quest removed');
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
    const handleDay = async (path, successMessage, penalty = false) => {
        const result = await refresh(path, { method: 'POST' });
        if (result)
            notify(result.result?.message || successMessage, penalty);
    };
    const weeklyRates = () => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return CATS.reduce((acc, cat) => {
            const entries = state.history.filter(h => h.cat === cat && new Date(h.date).getTime() >= cutoff);
            const done = entries.reduce((sum, e) => sum + e.done, 0);
            const total = entries.reduce((sum, e) => sum + e.total, 0);
            acc[cat] = total ? done / total : null;
            return acc;
        }, {});
    };
    return (React.createElement("div", { className: "wrap mx-auto relative z-10 px-4 sm:px-6" },
        React.createElement("div", { className: "bg-fx" }),
        React.createElement("div", { className: "bg-glow" }),
        React.createElement("div", { className: "header text-center sm:text-left" },
            React.createElement("div", { className: "eyebrow title-font" }, "[ NOTIFICATION ]"),
            React.createElement("h1", { className: "title-font" }, "THE SYSTEM"),
            React.createElement("div", { className: "sub title-font" }, "YOU HAVE BEEN GRANTED THE POWER TO LEVEL UP")),
        React.createElement("div", { className: "panel" },
            React.createElement("div", { className: "panel-corner-tl" }),
            React.createElement("div", { className: "panel-title" },
                "STATUS WINDOW ",
                React.createElement("span", { className: "corner" })),
            React.createElement("div", { className: "status-grid" },
                React.createElement("div", null,
                    React.createElement("div", { className: "name-row" },
                        React.createElement("div", { className: "player-name" }, "HUNTER"),
                        React.createElement("div", { className: "rank-badge" }, rankForLevel(state.level))),
                    React.createElement("div", { className: "lvl-row" },
                        "LEVEL ",
                        React.createElement("b", null, state.level)),
                    React.createElement("div", { className: "xp-bar-wrap" },
                        React.createElement("div", { className: "xp-label" },
                            React.createElement("span", null, "XP"),
                            React.createElement("span", null,
                                state.xp,
                                " / ",
                                xpNeeded(state.level))),
                        React.createElement("div", { className: "xp-bar" },
                            React.createElement("div", { className: "xp-fill", style: { width: `${Math.min(100, (state.xp / xpNeeded(state.level)) * 100)}%` } }))),
                    React.createElement("div", { className: "stats-list" }, Object.entries(state.stats).map(([key, value]) => (React.createElement("div", { className: "stat-line", key: key },
                        React.createElement("span", null,
                            key,
                            " \u2014 ",
                            Object.entries(CAT_STAT).find(([, v]) => v === key)?.[0] ?? ''),
                        React.createElement("span", null, value)))))),
                React.createElement("div", { className: "score-circle-wrap" },
                    React.createElement("div", { className: "score-circle" },
                        React.createElement("svg", { width: "150", height: "150", viewBox: "0 0 150 150" },
                            React.createElement("defs", null,
                                React.createElement("linearGradient", { id: "gradStroke", x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
                                    React.createElement("stop", { offset: "0%", stopColor: "#7c4dff" }),
                                    React.createElement("stop", { offset: "100%", stopColor: "#8ad7ff" }))),
                            React.createElement("circle", { className: "bg", cx: "75", cy: "75", r: "64" }),
                            React.createElement("circle", { className: "fg", cx: "75", cy: "75", r: "64", strokeDasharray: "402", strokeDashoffset: `${402 - completionRatio * 402}` })),
                        React.createElement("div", { className: "score-num" },
                            React.createElement("div", { className: "big" },
                                Math.round(completionRatio * 100),
                                "%"),
                            React.createElement("div", { className: "small" }, "TODAY"))),
                    React.createElement("div", { className: "streak" },
                        "\uD83D\uDD25 ",
                        state.streak,
                        " DAY STREAK")))),
        React.createElement("div", { className: "panel emergency" },
            React.createElement("div", { className: "panel-corner-tl" }),
            React.createElement("div", { className: "panel-title" },
                "EMERGENCY QUEST ",
                React.createElement("span", { className: "corner" })),
            React.createElement("div", { className: "em-intro" },
                "No active emergencies. The System watches your ",
                React.createElement("b", null, "weekly completion rate"),
                " per stat \u2014 fall below ",
                React.createElement("b", null, "50%"),
                " over 7 days and an Emergency Quest will be issued with a harsh penalty and a deadline."),
            React.createElement("div", { className: "weekly-bars" }, Object.entries(weeklyRates()).map(([cat, rate]) => (React.createElement("div", { className: "wb-row", key: cat },
                React.createElement("div", { className: "wb-label" }, CAT_LABEL[cat]),
                React.createElement("div", { className: "wb-track" },
                    React.createElement("div", { className: `wb-fill ${rate !== null && rate < 0.5 ? 'low' : ''}`, style: { width: rate === null ? 0 : `${Math.round(rate * 100)}%` } })),
                React.createElement("div", { className: "wb-pct" }, rate === null ? '—' : `${Math.round(rate * 100)}%`))))),
            React.createElement("div", { className: "close-day-row" },
                React.createElement("button", { className: "btn ghost", type: "button", onClick: () => handleDay('/day/emergency/manual', 'EMERGENCY QUEST ISSUED', true) }, "\u26A0 FORCE-ISSUE EMERGENCY QUEST"),
                React.createElement("span", { style: { fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px' } }, "Auto-triggers when a stat falls below 50% completion this week"))),
        React.createElement("div", { className: "panel" },
            React.createElement("div", { className: "panel-corner-tl" }),
            React.createElement("div", { className: "panel-title" },
                "DAILY QUESTS ",
                React.createElement("span", { className: "corner" })),
            React.createElement("div", { className: "quest-categories" }, ['ALL', 'CDS', 'GYM', 'DEV', 'DSA', 'OTHER'].map(cat => (React.createElement("button", { key: cat, type: "button", className: `cat-pill ${activeCat === cat ? 'active' : ''}`, onClick: () => setActiveCat(cat) }, cat)))),
            React.createElement("div", { id: "questList" }, filteredQuests.map(q => (React.createElement("div", { className: `quest ${q.done ? 'done' : ''}`, key: q.id },
                React.createElement("div", { className: `qcheck ${q.done ? 'checked' : ''}`, onClick: () => handleToggle(q.id) }),
                React.createElement("div", { className: "qbody" },
                    React.createElement("div", { className: "qtop" },
                        React.createElement("div", { className: "qtitle" }, q.title),
                        React.createElement("span", { className: `quest-tag tag-${q.cat}` }, q.cat)),
                    React.createElement("div", { className: "qmeta" },
                        React.createElement("span", { className: "qreward" },
                            "Reward +",
                            effectiveXP(state, q),
                            " XP"),
                        React.createElement("span", { className: "qpenalty" },
                            "Penalty -",
                            q.penalty,
                            " XP"))),
                React.createElement("button", { className: "qdel", type: "button", onClick: () => handleDelete(q.id) }, "\u2715"))))),
            React.createElement("div", { className: "empty", style: { display: filteredQuests.length ? 'none' : 'block' } }, "No quests in this category. Register one below, Hunter."),
            React.createElement("div", { className: "add-form" },
                React.createElement("input", { type: "text", placeholder: "New quest (e.g. Solve 20 DSA problems)", value: questForm.title, onChange: e => setQuestForm({ ...questForm, title: e.target.value }) }),
                React.createElement("select", { value: questForm.cat, onChange: e => setQuestForm({ ...questForm, cat: e.target.value }) },
                    React.createElement("option", { value: "CDS" }, "CDS/AFCAT"),
                    React.createElement("option", { value: "GYM" }, "GYM"),
                    React.createElement("option", { value: "DEV" }, "WEB DEV"),
                    React.createElement("option", { value: "DSA" }, "DSA"),
                    React.createElement("option", { value: "OTHER" }, "OTHER")),
                React.createElement("input", { type: "number", placeholder: "XP reward", value: questForm.xp, onChange: e => setQuestForm({ ...questForm, xp: Number(e.target.value) }) }),
                React.createElement("input", { type: "number", placeholder: "Penalty XP", value: questForm.penalty, onChange: e => setQuestForm({ ...questForm, penalty: Number(e.target.value) }) }),
                React.createElement("button", { className: "btn", type: "button", onClick: handleAddQuest }, "+ REGISTER QUEST")),
            React.createElement("div", { className: "close-day-row" },
                React.createElement("button", { className: "btn ghost", type: "button", onClick: () => handleDay('/day/reset', 'NEW DAY — QUESTS RESET', false) }, "\u21BB NEW DAY (clear completion)"),
                React.createElement("button", { className: "btn danger", type: "button", onClick: () => handleDay('/day/close', 'DAY CLOSED', true) }, "\u2694 CLOSE OUT DAY"))),
        React.createElement("div", { className: "panel" },
            React.createElement("div", { className: "panel-corner-tl" }),
            React.createElement("div", { className: "panel-title" },
                "SYSTEM LOG ",
                React.createElement("span", { className: "corner" })),
            state.log.length ? state.log.slice(0, 18).map((entry, idx) => (React.createElement("div", { className: "log-entry", key: idx },
                React.createElement("span", { className: entry.type === 'p' ? 'lp' : entry.type === 'w' ? 'lw' : 'ln' }, entry.text),
                React.createElement("span", null, entry.date)))) : React.createElement("div", { className: "empty" }, "No entries yet.")),
        React.createElement("div", { className: "foot-note" }, "DO NOT IGNORE THE SYSTEM'S WARNINGS."),
        toast.text && React.createElement("div", { className: `toast show${toast.penalty ? ' penalty' : ''}` }, toast.text)));
}
function App() {
    const [authenticated, setAuthenticated] = useState(!!storage.token);
    return authenticated ? React.createElement(MainShell, null) : React.createElement("div", { className: "wrap mx-auto relative z-10 px-4 sm:px-6" },
        React.createElement(AuthView, { onSuccess: () => setAuthenticated(true) }));
}
const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(React.createElement(App, null));
}
