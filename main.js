'use strict';
/*
 * Teh Tarik Meter - your Claude usage as a living glass of teh tarik.
 *
 * The main process owns all data. Windows only draw what they are sent.
 *   widget : the always-on-top desktop card (the glass, the weekly cups), or a compact strip
 *   app    : settings, history, about, and the first-launch welcome
 *   show   : the full-screen easter egg (poke the glass 10 times fast)
 *   login  : a plain claude.ai window to sign in; nothing is injected into it
 *
 * Where the numbers come from:
 *   1. claude.ai - the same numbers as Settings > Usage, read with your own sign-in (kept
 *      in Electron's encrypted cookie store, never in a file of ours). Checked every 15 s
 *      while usage is moving, easing to 2 min when quiet, paused while the PC is locked or
 *      asleep, and right away on hover, wake and Refresh.
 *   2. Claude Code - its status line hands us rate_limits after every reply; a tiny script
 *      saves them to claude-code-feed.json and we update instantly.
 * The newer reading of each window wins.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, Notification, nativeImage, nativeTheme, shell, powerMonitor, net, protocol, session, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const U = require('./lib/usage.js');
const M = require('./lib/merge.js');
const H = require('./lib/history.js');
const CC = require('./lib/claudecode.js');
const ST = require('./lib/state.js');
const QUIET = require('./lib/quiet.js');
const F = require('./renderer/format.js');
const D = require('./renderer/data.js');
const I18N = require('./renderer/i18n.js');

const AUMID = 'app.tehtarik.meter';
const CLAUDE = 'https://claude.ai';
const PARTITION = 'persist:claude';
const WIDGET_W = 420, WIDGET_H = 540;
const ZOOMS = { normal: 1, large: 1.15, larger: 1.3 };
const ICON = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'tray.ico' : 'tray.png');
const REPO = 'chowkuanlaw/teh-tarik-meter';
const UPDATE_EVERY = 24 * 3600e3;
const SHORTCUT = 'CommandOrControl+Alt+T';
const SCHEME = 'tehtarik', ORIGIN = `${SCHEME}://app`, RENDERER_DIR = path.join(__dirname, 'renderer');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const DEMO = !app.isPackaged && process.env.TTM_DEMO === '1'; // development only: fake numbers, no network
// Microsoft Store copy: the Store installs updates and starts the app at sign-in.
const STORE = process.windowsStore === true || (!app.isPackaged && process.env.TTM_TEST_STORE === '1');
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  run();
}

function run() {
  if (!STORE) app.setAppUserModelId(AUMID);
  Menu.setApplicationMenu(null);

  const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');
  const HISTORY_FILE = () => path.join(app.getPath('userData'), 'history.json');
  const FEED_FILE = () => path.join(app.getPath('userData'), CC.FEED_NAME);
  const SCRIPT_DIR = () => path.join(app.getPath('userData'), 'statusline');

  let S = ST.clean(null);
  let HIST = H.empty();
  const R = {
    web: null, feed: null, view: null, fc: { session: null, weekly: null },
    status: 'starting',          // starting | ok | signed-out | offline | error
    errors: 0, shapeErrors: 0, formatBroken: false,
    fetching: false, again: false, lastFetchAt: 0, lastChangeAt: 0, warm: false,
    paused: false, fullHidden: false, timer: null, rollTimer: null, ccTimer: null, feedTimer: null,
    orgs: [], update: null, checking: false, updateMsg: null, shortcutTaken: false, histDirty: false
  };
  let widgetWin = null, appWin = null, loginWin = null, showWin = null, tray = null, quitting = false, saveTimer = null, claudeSes = null, cleanUA = '';
  const L = () => S.lang;
  const t = (k, v) => I18N.t(L(), k, v);
  const zoom = () => ZOOMS[S.textSize] || 1;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ST.write(STATE_FILE(), S), 300);
  }
  function saveHistory() { if (R.histDirty) { R.histDirty = false; ST.writeJson(HISTORY_FILE(), HIST); } }

  /* ---------- claude.ai ---------- */
  function httpError(code, status) { const e = new Error(code); e.code = code; e.status = status; return e; }

  // A plain GET with your claude.ai cookies, through Chromium's network stack.
  function getJson(url) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = net.request({ url, method: 'GET', session: claudeSes, useSessionCookies: true, redirect: 'manual' });
      } catch (e) { reject(httpError('network')); return; }
      req.setHeader('Accept', 'application/json');
      req.setHeader('User-Agent', cleanUA);
      const timer = setTimeout(() => { try { req.abort(); } catch (e) { /* ignore */ } reject(httpError('timeout')); }, 15000);
      // An API call that redirects is being sent to the login page.
      req.on('redirect', () => { clearTimeout(timer); try { req.abort(); } catch (e) { /* ignore */ } reject(httpError('auth', 302)); });
      req.on('response', res => {
        const chunks = [];
        let size = 0;
        res.on('data', c => { size += c.length; if (size < 2e6) chunks.push(c); });
        res.on('end', () => {
          clearTimeout(timer);
          const code = res.statusCode;
          const type = String((res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || '');
          // Cloudflare's "checking your browser" page is an HTML 403, not a sign-out.
          if (code === 403 && /text\/html/i.test(type)) return reject(httpError('challenge', code));
          if (code === 401 || code === 403) return reject(httpError('auth', code));
          if (code === 404) return reject(httpError('notfound', code));
          if (code === 429) return reject(httpError('rate', code));
          if (code < 200 || code >= 300) return reject(httpError('http', code));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(httpError('shape')); }
        });
        res.on('error', () => { clearTimeout(timer); reject(httpError('network')); });
      });
      req.on('error', () => { clearTimeout(timer); reject(httpError('network')); });
      req.end();
    });
  }

  async function loadOrgs() {
    const orgs = await getJson(`${CLAUDE}/api/organizations`);
    R.orgs = U.listOrgs(orgs);
    return orgs;
  }
  async function ensureOrg() {
    const pinned = U.safeOrgId(S.orgId);
    if (pinned) { if (!R.orgs.length) loadOrgs().catch(() => {}); return pinned; }
    const orgs = await loadOrgs();
    const id = U.safeOrgId(U.pickOrg(orgs, null));
    if (!id) throw httpError('auth');
    S.orgId = id; save();
    return id;
  }

  function demoUsage() {
    // Development preview: a session that drains over ~10 minutes, then refills.
    // TTM_DEMO_SESSION / TTM_DEMO_WEEKLY pin the numbers; TTM_DEMO_SIGNEDOUT=1 acts signed out;
    // TTM_DEMO_BROKEN=1 returns a reply in an unknown shape.
    if (process.env.TTM_DEMO_SIGNEDOUT === '1') throw httpError('auth', 401);
    if (process.env.TTM_DEMO_BROKEN === '1') return { something_new: true };
    const tt = (Date.now() / 1000) % 600;
    const now = Date.now();
    const fixed = k => (process.env[k] !== undefined ? Number(process.env[k]) : null);
    const s = fixed('TTM_DEMO_SESSION'), w = fixed('TTM_DEMO_WEEKLY');
    return {
      five_hour: { utilization: s !== null ? s : Math.min(100, tt / 5.5), resets_at: new Date(now + (2 * 3600 + 15 * 60) * 1000).toISOString() },
      seven_day: { utilization: w !== null ? w : 18 + tt / 40, resets_at: new Date(now + 3 * 86400e3).toISOString() },
      seven_day_opus: { utilization: 40, resets_at: new Date(now + 3 * 86400e3).toISOString() },
      extra_usage: { is_enabled: true, used_credits: 1240, monthly_limit: 5000, currency: 'USD' }
    };
  }
  if (DEMO) R.orgs = [{ id: 'demo-org-0001', name: 'Personal', chat: true }, { id: 'demo-org-0002', name: 'Work Team', chat: true }];

  async function refresh(reason) {
    if (R.fetching) { R.again = true; return; }
    if (R.paused && reason !== 'manual') return;
    R.fetching = true;
    broadcast();
    let attempt = 0;
    for (;;) {
      try {
        let raw;
        if (DEMO) raw = demoUsage();
        else {
          const orgId = await ensureOrg();
          raw = await getJson(`${CLAUDE}/api/organizations/${orgId}/usage`);
        }
        const parsed = U.parseUsage(raw);
        if (!parsed.ok) throw httpError('shape');
        const snap = { at: Date.now(), session: parsed.session, weekly: parsed.weekly, models: parsed.models, extra: parsed.extra };
        if (M.changed(R.web, snap)) R.lastChangeAt = Date.now();
        R.web = snap;
        S.last = snap; save();
        R.status = 'ok'; R.errors = 0; R.shapeErrors = 0; R.formatBroken = false;
      } catch (e) {
        if (e.code === 'notfound' && attempt === 0 && S.orgId) { S.orgId = null; attempt++; continue; } // org changed: look it up again
        if (e.code === 'auth') { R.status = 'signed-out'; S.orgId = null; save(); }
        else {
          R.status = (e.code === 'network' || e.code === 'timeout') ? 'offline' : 'error';
          R.errors++;
          if (e.code === 'challenge') warmUp();
          if (e.code === 'shape') formatProblem();
        }
      }
      break;
    }
    R.lastFetchAt = Date.now();
    R.fetching = false;
    update();
    schedule();
    if (R.again) { R.again = false; setTimeout(() => refresh('again'), 500); }
  }

  // Three unreadable replies in a row: claude.ai changed its usage page. Say so once per version
  // and look for an update that knows the new shape.
  function formatProblem() {
    R.shapeErrors++;
    if (R.shapeErrors < 3 || R.formatBroken) return;
    R.formatBroken = true;
    const key = `format:${app.getVersion()}`;
    if (!S.sent[key]) {
      S.sent[key] = Date.now(); save();
      toast(t('n.format.title'), t('n.format.body'));
    }
    checkForUpdate(false);
  }

  // Opens claude.ai once in a hidden window so Cloudflare's check can pass, then closes it.
  // At most once every 10 minutes.
  let lastWarm = 0;
  function warmUp() {
    if (DEMO || Date.now() - lastWarm < 10 * 60e3) return;
    lastWarm = Date.now();
    const w = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    w.webContents.setUserAgent(cleanUA);
    w.webContents.setAudioMuted(true);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const close = () => { if (!w.isDestroyed()) w.destroy(); };
    const kill = setTimeout(close, 30000);
    w.webContents.once('did-finish-load', () => setTimeout(() => { clearTimeout(kill); close(); R.errors = 0; refresh('warm'); }, 4000));
    w.loadURL(`${CLAUDE}/settings/usage`).catch(() => { clearTimeout(kill); close(); });
  }

  function schedule() {
    clearTimeout(R.timer);
    const d = M.nextDelay({ paused: R.paused, signedOut: R.status === 'signed-out', errors: R.errors, now: Date.now(), lastChangeAt: R.lastChangeAt });
    if (d !== null) R.timer = setTimeout(() => refresh('timer'), d);
  }

  // Ask again shortly after the session or weekly window resets.
  function scheduleRollover() {
    clearTimeout(R.rollTimer);
    const v = R.view;
    if (!v) return;
    const next = [v.session && v.session.resetsAt, v.weekly && v.weekly.resetsAt].filter(Boolean).sort((a, b) => a - b)[0];
    if (!next) return;
    const d = next - Date.now() + 5000;
    if (d > 0 && d < 7 * 86400e3) R.rollTimer = setTimeout(() => { update(); refresh('rollover'); }, Math.min(d, 2 ** 31 - 1));
  }

  function soon(reason, minGap) {
    if (Date.now() - R.lastFetchAt > (minGap || 10000)) refresh(reason);
  }

  /* ---------- Claude Code feed ---------- */
  function readFeed() {
    let f = null;
    try { f = M.parseFeed(JSON.parse(fs.readFileSync(FEED_FILE(), 'utf8'))); } catch (e) { return; }
    if (!f || (R.feed && f.at <= R.feed.at)) return;
    const before = R.feed;
    R.feed = f;
    if (!before || M.changed(before, f)) R.lastChangeAt = Date.now();
    update();
    // Pick up per-model caps and credits from claude.ai a moment later.
    clearTimeout(R.ccTimer);
    R.ccTimer = setTimeout(() => soon('cc', 20000), 3000);
  }
  function watchFeed() {
    readFeed();
    try {
      fs.watch(app.getPath('userData'), (_ev, name) => {
        if (name && name !== CC.FEED_NAME) return;
        clearTimeout(R.feedTimer);
        R.feedTimer = setTimeout(readFeed, 150);
      });
    } catch (e) { /* fall back to the regular checks */ }
  }

  /* ---------- putting it together ---------- */
  function update() {
    const now = Date.now();
    const prev = R.view;
    const view = M.buildView(R.web || S.last, R.feed, now);
    R.view = view;
    if (view.hasData && R.status !== 'signed-out' && H.add(HIST, view, now)) R.histDirty = true;
    R.fc = H.forecasts(HIST, view, now);
    // Celebrate a refill only between live readings, not against an old saved one at start-up.
    if (prev && R.warm && M.detectReset(prev, view)) {
      send(widgetWin, 'tarik');
      if (S.freshAlert && prev.session && prev.session.pct >= 95) toast(t('n.fresh.title'), t('n.fresh.body'));
    }
    if (R.status === 'ok' || R.feed) R.warm = true;
    if (S.alerts && R.status !== 'signed-out' && view.hasData) {
      const res = M.alertsFor(view, S.sent, now);
      S.sent = res.sent;
      if (res.alerts.length) { save(); res.alerts.forEach(notify); }
    }
    paceAlert(now);
    scheduleRollover();
    updateTray();
    broadcast();
  }

  // Once per session window: "at this pace, your glass runs out at 3:40 PM" when that's before the refill.
  function paceAlert(now) {
    const f = R.fc.session, w = R.view && R.view.session;
    if (!S.paceAlert || !f || !f.beforeReset || !w || !w.resetsAt || w.pct >= 80) return;
    if (f.eta - now > 90 * 60e3) return; // only when it's getting close
    const key = `pace:${Math.round(w.resetsAt / 3600e3)}`;
    if (S.sent[key]) return;
    S.sent[key] = now; save();
    toast(t('n.pace.title', { when: F.at(f.eta, now, L()) }), t('n.pace.body', { reset: F.when(w.resetsAt, now, L()) }));
  }

  function snapshot() {
    return {
      view: R.view,
      fc: R.fc,
      status: R.status,
      formatBroken: R.formatBroken,
      fetching: R.fetching,
      lastFetchAt: R.lastFetchAt,
      paused: R.paused,
      cc: S.cc.connected,
      ccAt: R.feed ? R.feed.at : null,
      orgs: R.orgs,
      orgId: S.orgId,
      settings: {
        onTop: S.onTop, autostart: S.autostart, alerts: S.alerts, paceAlert: S.paceAlert, freshAlert: S.freshAlert,
        sound: S.sound, hideFull: S.hideFull, shortcut: S.shortcut, theme: S.theme, lang: S.lang, drink: S.drink,
        textSize: S.textSize, compact: S.compact, festive: S.festive
      },
      dark: nativeTheme.shouldUseDarkColors,
      festival: S.festive ? (!app.isPackaged && process.env.TTM_FESTIVAL ? { id: process.env.TTM_FESTIVAL, daysLeft: 0 } : D.festivalOn(new Date())) : null,
      news: S.welcomed ? D.newsSince(S.seenVersion).map(n => n.v) : [],
      version: app.getVersion(),
      store: STORE,
      installed: INSTALLED,
      update: R.update,
      updateMsg: R.updateMsg,
      checking: R.checking,
      shortcutTaken: R.shortcutTaken,
      demo: DEMO
    };
  }
  function send(win, ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
  function broadcast() { const s = snapshot(); send(widgetWin, 'state', s); send(appWin, 'state', s); }

  /* ---------- alerts ---------- */
  function toast(title, body) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: ICON, silent: false });
    n.on('click', showWidget);
    n.show();
  }
  function notify(a) {
    const now = Date.now();
    const p = Math.round(a.pct);
    const when = F.when(a.resetsAt, now, L());
    if (a.kind === 'session') toast(t(a.level >= 95 ? 'n.s95.title' : 'n.s80.title'), t('n.s.body', { p, when }));
    else if (a.kind === 'weekly') toast(t(a.level >= 95 ? 'n.w95.title' : 'n.w80.title'), t('n.w.body', { p, when }));
    else toast(t('n.m.title', { name: a.name, p }), t('n.m.body', { when }));
  }

  /* ---------- sign in ---------- */
  async function signedIn() {
    if (DEMO) return true;
    try { return !!U.pickOrg(await getJson(`${CLAUDE}/api/organizations`), null); } catch (e) { return false; }
  }

  function openLogin() {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.show(); loginWin.focus(); return; }
    const browserPrefs = { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
    loginWin = new BrowserWindow({ width: 980, height: 780, title: 'Sign in to Claude - Teh Tarik Meter', icon: ICON, autoHideMenuBar: true, webPreferences: browserPrefs });
    loginWin.webContents.setUserAgent(cleanUA);
    // Sign-in pop-ups (such as Google) open in the same private browser, never in the app.
    loginWin.webContents.setWindowOpenHandler(({ url }) => (/^https:\/\//i.test(url)
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, webPreferences: browserPrefs } }
      : { action: 'deny' }));
    loginWin.webContents.on('will-navigate', (e, url) => { if (!/^https:\/\//i.test(url)) e.preventDefault(); });
    loginWin.loadURL(`${CLAUDE}/login`);
    let checking = false;
    const probe = setInterval(async () => {
      if (checking || !loginWin || loginWin.isDestroyed()) return;
      checking = true;
      const ok = await signedIn();
      checking = false;
      if (ok && loginWin && !loginWin.isDestroyed()) {
        clearInterval(probe);
        loginWin.close();
      }
    }, 2500);
    loginWin.on('closed', () => {
      clearInterval(probe);
      loginWin = null;
      R.errors = 0;
      refresh('login');
    });
  }

  // For when the sign-in window won't work (for example Google blocking embedded sign-in):
  // paste the sessionKey cookie from your browser. It goes straight into the encrypted cookie store.
  async function useSessionKey(value) {
    const v = String(value || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,400}$/.test(v)) return { ok: false, msg: t('d.keyBad') };
    try {
      await claudeSes.cookies.set({ url: CLAUDE, name: 'sessionKey', value: v, domain: '.claude.ai', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400 });
    } catch (e) { return { ok: false, msg: t('d.keySaveFail') }; }
    S.orgId = null; R.errors = 0;
    await refresh('manual');
    return R.status === 'signed-out' ? { ok: false, msg: t('d.keyRejected') } : { ok: true };
  }

  async function signOut() {
    const r = await dialog.showMessageBox({ type: 'question', buttons: [t('d.signOutBtn'), t('d.cancel')], defaultId: 1, cancelId: 1, title: 'Teh Tarik Meter', message: t('d.signOut'), detail: t('d.signOutDetail') });
    if (r.response !== 0) return;
    try { await claudeSes.clearStorageData(); } catch (e) { /* ignore */ }
    S.orgId = null; S.last = null; R.web = null; R.orgs = []; R.status = 'signed-out'; save();
    clearTimeout(R.timer);
    update();
  }

  function setOrg(id) {
    const ok = U.safeOrgId(id);
    if (!ok || !R.orgs.some(o => o.id === ok) || ok === S.orgId) return;
    S.orgId = ok; S.last = null; R.web = null; save();
    refresh('manual');
  }

  /* ---------- Claude Code ---------- */
  function hasNode() {
    try { return spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { windowsHide: true, timeout: 5000 }).status === 0; } catch (e) { return false; }
  }

  async function connectClaudeCode() {
    const file = CC.settingsPath();
    let settings;
    try { settings = CC.readSettings(file); }
    catch (e) {
      dialog.showMessageBox({ type: 'warning', title: 'Teh Tarik Meter', message: t('d.ccBadJson'), detail: t('d.ccBadJsonDetail', { file }) });
      return;
    }
    const had = settings.statusLine && !CC.isOurs(settings.statusLine);
    const r = await dialog.showMessageBox({
      type: 'question', buttons: [t('d.connectBtn'), t('d.cancel')], defaultId: 0, cancelId: 1, title: 'Teh Tarik Meter',
      message: t('d.ccTitle'),
      detail: t('d.ccDetail', { file }) + (had ? '\n\n' + t('d.ccKeep') : '') + '\n\n' + t('d.ccBackup')
    });
    if (r.response !== 0) return;
    try {
      const runner = hasNode() ? 'node' : 'powershell';
      const { settings: next, original } = CC.connect(settings, CC.buildCommand(runner, SCRIPT_DIR()));
      CC.installScripts(path.join(__dirname, 'statusline'), SCRIPT_DIR(), original);
      CC.backupOnce(file);
      CC.writeJsonAtomic(file, next);
      S.cc = { connected: true, original: original || (S.cc.connected ? S.cc.original : null), runner };
      save();
      dialog.showMessageBox({ type: 'info', title: 'Teh Tarik Meter', message: t('d.ccDone'), detail: t('d.ccDoneDetail') });
    } catch (e) {
      dialog.showMessageBox({ type: 'error', title: 'Teh Tarik Meter', message: t('d.ccFail'), detail: String(e && e.message || e) });
    }
    broadcast(); updateTray();
  }

  async function disconnectClaudeCode() {
    const file = CC.settingsPath();
    try {
      const settings = CC.readSettings(file);
      const { settings: next, changed } = CC.disconnect(settings, S.cc.original);
      if (changed) CC.writeJsonAtomic(file, next);
    } catch (e) {
      dialog.showMessageBox({ type: 'warning', title: 'Teh Tarik Meter', message: t('d.ccUpdateFail'), detail: String(e && e.message || e) });
      return;
    }
    S.cc = { connected: false, original: null, runner: null };
    R.feed = null;
    save(); update();
  }

  /* ---------- windows ---------- */
  function webPrefs(extra) {
    return Object.assign({
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', spellcheck: false
    }, extra || {});
  }
  function viewURL(view, extra) { return `${ORIGIN}/index.html?` + new URLSearchParams(Object.assign({ view }, extra || {})); }

  // Serves only files inside the renderer folder, read-only.
  function serveApp(req) {
    let u; try { u = new URL(req.url); } catch (e) { return new Response('', { status: 400 }); }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.resolve(RENDERER_DIR, rel || 'index.html');
    const type = MIME[path.extname(file).toLowerCase()];
    if (u.host !== 'app' || req.method !== 'GET' || !type || !file.startsWith(RENDERER_DIR + path.sep)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString())
      .then(r => new Response(r.body, { status: r.status, headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' } }))
      .catch(() => new Response('', { status: 404 }));
  }
  // Messages are only accepted from the app's own pages.
  function trusted(evt) {
    const f = evt.senderFrame;
    return !!f && !f.parent && typeof f.url === 'string' && f.url.startsWith(ORIGIN + '/');
  }
  function lockDown(win) {
    // Development only: show the page's console errors in the terminal.
    if (!app.isPackaged && process.env.TTM_DEBUG === '1') win.webContents.on('console-message', (e) => console.log('[page]', e.message || e));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
  }
  function applyZoom(win) { if (win && !win.isDestroyed()) win.webContents.setZoomFactor(zoom()); }

  function onSomeDisplay(p) {
    return p && screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return p.x >= a.x - 60 && p.y >= a.y - 20 && p.x + 120 <= a.x + a.width + WIDGET_W && p.y + 60 <= a.y + a.height + WIDGET_H;
    });
  }

  function createWidget() {
    const wa = screen.getPrimaryDisplay().workArea;
    const z = zoom();
    const w = Math.round(WIDGET_W * z), h = Math.round(WIDGET_H * z);
    const pos = onSomeDisplay(S.widgetPos) ? S.widgetPos : { x: wa.x + wa.width - w - 8, y: wa.y + wa.height - h - 8 };
    widgetWin = new BrowserWindow({
      x: pos.x, y: pos.y, width: w, height: h, frame: false, transparent: true, resizable: false,
      maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: S.onTop, show: false, title: 'Teh Tarik Meter', icon: ICON, webPreferences: webPrefs()
    });
    if (S.onTop) widgetWin.setAlwaysOnTop(true, 'floating');
    lockDown(widgetWin);
    widgetWin.webContents.on('did-finish-load', () => applyZoom(widgetWin));
    widgetWin.loadURL(viewURL('widget'));
    widgetWin.once('ready-to-show', () => syncWidget());
    let moveT;
    widgetWin.on('move', () => {
      clearTimeout(moveT);
      moveT = setTimeout(() => {
        if (!widgetWin || widgetWin.isDestroyed()) return;
        const [x, y] = widgetWin.getPosition();
        S.widgetPos = { x, y }; save();
      }, 400);
    });
    widgetWin.on('show', () => soon('show', 10000));
    widgetWin.on('close', e => { if (!quitting) { e.preventDefault(); setWidget(false); } });
  }
  function syncWidget() {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const want = S.widget && !R.fullHidden;
    if (want && !widgetWin.isVisible()) widgetWin.showInactive();
    if (!want && widgetWin.isVisible()) widgetWin.hide();
  }
  function setWidget(on) {
    S.widget = !!on; save();
    if (on) R.fullHidden = false;
    syncWidget();
    updateTray();
  }
  function showWidget() { setWidget(true); if (widgetWin && !widgetWin.isDestroyed()) widgetWin.focus(); }
  function toggleWidget() { setWidget(!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible())); }
  // The widget reports its card size in CSS pixels; the window follows it (at the chosen text size).
  function sizeWidget(w, h) {
    if (!widgetWin || widgetWin.isDestroyed() || !(w >= 120 && w <= 600 && h >= 60 && h <= 800)) return;
    const z = zoom();
    const W = Math.round(w * z), Hh = Math.round(h * z);
    const b = widgetWin.getBounds();
    if (b.width === W && b.height === Hh) return;
    // Keep the right edge where it was, so switching to compact doesn't jump away from a corner.
    const x = b.x + b.width - W;
    widgetWin.setBounds({ x, y: b.y, width: W, height: Hh });
    const wa = screen.getDisplayMatching(widgetWin.getBounds()).workArea;
    const nx = Math.min(Math.max(x, wa.x), wa.x + wa.width - W), ny = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - Hh);
    if (nx !== x || ny !== b.y) widgetWin.setPosition(nx, ny);
  }

  // Settings, history, about, and the welcome.
  function openApp(opts) {
    const q = Object.assign({}, opts || {});
    if (appWin && !appWin.isDestroyed()) {
      if (q.welcome || q.tab) appWin.loadURL(viewURL('app', q));
      if (appWin.isMinimized()) appWin.restore();
      appWin.show(); appWin.focus();
      return;
    }
    const z = zoom();
    appWin = new BrowserWindow({
      width: Math.round(760 * z), height: Math.round(600 * z), minWidth: 560, minHeight: 480, show: false, title: 'Teh Tarik Meter',
      icon: ICON, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E1814' : '#FFF8F0', autoHideMenuBar: true, webPreferences: webPrefs()
    });
    lockDown(appWin);
    appWin.webContents.on('did-finish-load', () => applyZoom(appWin));
    appWin.loadURL(viewURL('app', q));
    appWin.once('ready-to-show', () => appWin.show());
    appWin.on('closed', () => { appWin = null; }); // unloaded when closed, to save memory
    if (!R.orgs.length && R.status === 'ok') loadOrgs().then(broadcast).catch(() => {});
  }

  // The easter egg: a full-screen teh tarik show on the screen the widget is on.
  function startShow() {
    if (showWin && !showWin.isDestroyed()) return;
    const d = widgetWin && !widgetWin.isDestroyed() ? screen.getDisplayMatching(widgetWin.getBounds()) : screen.getPrimaryDisplay();
    const b = d.bounds;
    showWin = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false,
      backgroundColor: '#1E1611', title: 'Teh Tarik Meter', icon: ICON, webPreferences: webPrefs({ backgroundThrottling: false })
    });
    showWin.setAlwaysOnTop(true, 'screen-saver');
    lockDown(showWin);
    showWin.loadURL(viewURL('show'));
    showWin.once('ready-to-show', () => { showWin.show(); showWin.focus(); });
    const safety = setTimeout(endShow, 30000);
    showWin.on('closed', () => { clearTimeout(safety); showWin = null; send(widgetWin, 'show-over'); });
  }
  function endShow() { if (showWin && !showWin.isDestroyed()) showWin.close(); }

  /* ---------- hide in full screen and presentations (from Lapis) ---------- */
  function checkFullScreen() {
    if (!S.hideFull || process.platform !== 'win32' || (showWin && !showWin.isDestroyed())) {
      if (R.fullHidden) { R.fullHidden = false; syncWidget(); }
      return;
    }
    const busy = QUIET.fullScreenBusy();
    if (busy !== R.fullHidden) { R.fullHidden = busy; syncWidget(); }
  }

  /* ---------- Ctrl+Alt+T ---------- */
  function applyShortcut() {
    try { globalShortcut.unregister(SHORTCUT); } catch (e) { /* ignore */ }
    R.shortcutTaken = false;
    if (!S.shortcut) return;
    let ok = false;
    try { ok = globalShortcut.register(SHORTCUT, toggleWidget); } catch (e) { ok = false; }
    R.shortcutTaken = !ok;
  }

  /* ---------- tray ---------- */
  function trayText() {
    const v = R.view;
    if (R.status === 'signed-out') return t('t.tipSigned');
    if (!v || !v.hasData) return 'Teh Tarik Meter';
    const parts = ['Teh Tarik Meter'];
    if (v.session) parts.push(t('t.tipSession', { p: Math.round(100 - v.session.pct) }));
    if (v.weekly) parts.push(t('t.tipWeek', { p: Math.round(100 - v.weekly.pct) }));
    return parts.join('\n');
  }
  function updateTray() { if (tray) tray.setToolTip(trayText()); }
  function buildMenu() {
    const shown = widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible();
    const items = [
      { label: shown ? t('t.hide') : t('t.show'), accelerator: S.shortcut && !R.shortcutTaken ? 'Ctrl+Alt+T' : undefined, click: toggleWidget },
      { label: t('t.refresh'), enabled: R.status !== 'signed-out' || DEMO, click: () => { R.errors = 0; refresh('manual'); } },
      { label: t('t.settings'), click: () => openApp() },
      { type: 'separator' },
      { label: t('t.compact'), type: 'checkbox', checked: S.compact, click: m => setSetting('compact', m.checked) },
      { label: t('t.top'), type: 'checkbox', checked: S.onTop, click: m => setSetting('onTop', m.checked) },
      { type: 'separator' },
      S.cc.connected ? { label: t('t.ccDisconnect'), click: disconnectClaudeCode } : { label: t('t.ccConnect'), click: connectClaudeCode },
      { label: t('t.usage'), click: () => shell.openExternal(`${CLAUDE}/settings/usage`) },
      R.status === 'signed-out' ? { label: t('t.signIn'), click: openLogin } : { label: t('t.signOut'), click: signOut },
      { type: 'separator' }
    ];
    if (R.update && R.update.state === 'ready') items.push({ label: t('t.restart', { v: R.update.version }), click: installUpdate });
    else if (INSTALLED) items.push({ label: R.checking ? t('t.checking') : t('t.check'), enabled: !R.checking, click: () => checkForUpdate(true) });
    items.push({ label: `Teh Tarik Meter ${app.getVersion()}`, enabled: false });
    items.push({ label: t('t.quit'), click: () => { quitting = true; app.quit(); } });
    return Menu.buildFromTemplate(items);
  }
  function createTray() {
    let img = nativeImage.createFromPath(TRAY_ICON);
    if (img.isEmpty()) img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    updateTray();
    tray.on('click', toggleWidget);
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  }
  // The widget draws the glass at tray sizes, with the current level, and sends PNGs here.
  function setTrayIcon(images) {
    if (!tray || !Array.isArray(images)) return;
    const img = nativeImage.createEmpty();
    for (const it of images.slice(0, 4)) {
      const url = it && typeof it.url === 'string' ? it.url : '';
      const scale = Number(it && it.scale);
      if (!url.startsWith('data:image/png;base64,') || url.length > 200000 || !(scale >= 1 && scale <= 4)) continue;
      img.addRepresentation({ scaleFactor: scale, dataURL: url });
    }
    if (!img.isEmpty()) tray.setImage(img);
  }

  /* ---------- settings ---------- */
  function setSetting(key, value) {
    const B = ['onTop', 'autostart', 'alerts', 'paceAlert', 'freshAlert', 'sound', 'hideFull', 'shortcut', 'compact', 'festive'];
    if (B.includes(key)) S[key] = !!value;
    else if (key === 'theme' && ['system', 'light', 'dark'].includes(value)) S.theme = value;
    else if (key === 'lang' && ['en', 'ms'].includes(value)) S.lang = value;
    else if (key === 'drink' && D.DRINK_BY[value]) S.drink = value;
    else if (key === 'textSize' && ZOOMS[value]) S.textSize = value;
    else return;
    save();
    if (key === 'onTop' && widgetWin && !widgetWin.isDestroyed()) widgetWin.setAlwaysOnTop(S.onTop, 'floating');
    if (key === 'autostart') applyAutostart();
    if (key === 'hideFull') checkFullScreen();
    if (key === 'shortcut') applyShortcut();
    if (key === 'theme') nativeTheme.themeSource = S.theme;
    if (key === 'textSize') { applyZoom(widgetWin); applyZoom(appWin); }
    updateTray();
    broadcast();
  }

  /* ---------- Windows integration ---------- */
  function applyAutostart() {
    if (STORE || !app.isPackaged) return; // the Store copy starts with Windows through its startup task
    try { app.setLoginItemSettings({ openAtLogin: S.autostart, path: process.execPath, args: ['--autostart'] }); } catch (e) { /* ignore */ }
  }

  /* ---------- updates (installed copies, from GitHub releases like Lapis) ---------- */
  const INSTALLED = app.isPackaged && !STORE && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  let autoUpdater = null;
  if (INSTALLED) {
    try {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdater.logger = null;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-not-available', () => { R.updateMsg = 'latest'; broadcast(); });
      autoUpdater.on('update-downloaded', info => {
        R.update = { version: info.version, state: 'ready' };
        toast(t('n.update.title'), t('n.update.body', { v: info.version }));
        broadcast();
      });
      autoUpdater.on('error', () => { R.checking = false; broadcast(); });
    } catch (e) { autoUpdater = null; }
  }
  async function checkForUpdate(manual) {
    if (!autoUpdater || R.checking) return;
    R.checking = true; S.lastUpdateCheck = Date.now(); save(); broadcast();
    try { await autoUpdater.checkForUpdates(); } catch (e) { if (manual) dialog.showMessageBox({ type: 'info', title: 'Teh Tarik Meter', message: t('d.updFail'), detail: t('d.updFailDetail') }); }
    R.checking = false; broadcast();
  }
  function installUpdate() {
    if (!autoUpdater || !R.update || R.update.state !== 'ready') return;
    quitting = true;
    ST.write(STATE_FILE(), S);
    saveHistory();
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  /* ---------- messages from the windows ---------- */
  ipcMain.handle('get-state', evt => (trusted(evt) ? snapshot() : null));
  ipcMain.handle('get-history', evt => (trusted(evt) ? H.series(HIST, Date.now()) : null));
  ipcMain.handle('session-key', (evt, value) => (trusted(evt) ? useSessionKey(value) : { ok: false }));
  ipcMain.on('action', (evt, a) => {
    if (!trusted(evt) || !a || typeof a.type !== 'string') return;
    switch (a.type) {
      case 'refresh': R.errors = 0; refresh('manual'); break;
      case 'hover': soon('hover', 10000); break;
      case 'sign-in': openLogin(); break;
      case 'sign-out': signOut(); break;
      case 'hide': setWidget(false); break;
      case 'menu': if (tray) tray.popUpContextMenu(buildMenu()); else buildMenu().popup(); break;
      case 'settings': openApp(typeof a.tab === 'string' && /^[a-z]{3,10}$/.test(a.tab) ? { tab: a.tab } : null); break;
      case 'set': if (typeof a.key === 'string') setSetting(a.key, a.value); break;
      case 'org': setOrg(a.id); break;
      case 'cc-connect': connectClaudeCode(); break;
      case 'cc-disconnect': disconnectClaudeCode(); break;
      case 'open-usage': shell.openExternal(`${CLAUDE}/settings/usage`); break;
      case 'open-link': if (['privacy', 'repo'].includes(a.which)) shell.openExternal(`https://github.com/${REPO}${a.which === 'privacy' ? '/blob/main/PRIVACY.md' : ''}`); break;
      case 'check-update': checkForUpdate(true); break;
      case 'install-update': installUpdate(); break;
      case 'news-seen': S.seenVersion = app.getVersion(); save(); broadcast(); break;
      case 'welcome-done': S.welcomed = true; S.seenVersion = app.getVersion(); save(); if (appWin && !appWin.isDestroyed()) appWin.close(); broadcast(); break;
      case 'welcome-again': openApp({ welcome: '1' }); break;
      case 'start-show': startShow(); break;
      case 'show-done': endShow(); break;
      case 'mute': S.sound = !a.value; save(); break;
      case 'tray-icon': setTrayIcon(a.images); break;
      case 'size': sizeWidget(Math.round(Number(a.w)), Math.round(Number(a.h))); break;
    }
  });

  /* ---------- start ---------- */
  app.on('second-instance', showWidget);
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('before-quit', () => { quitting = true; ST.write(STATE_FILE(), S); saveHistory(); });
  app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ } });

  // Development only: save pictures of the windows to a folder, then quit.
  async function devSnapshots(dir) {
    const shot = async (win, name) => {
      if (!win || win.isDestroyed()) return;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, name), img.toPNG());
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(3500);
    await shot(widgetWin, 'widget.png');
    if (process.env.TTM_SNAP_POKE === '1') {
      await widgetWin.webContents.executeJavaScript("for (let i = 0; i < 6; i++) document.getElementById('stage').click(); true");
      await wait(700);
      await shot(widgetWin, 'widget-poked.png');
    }
    if (process.env.TTM_SNAP_TARIK === '1') { send(widgetWin, 'tarik'); await wait(1200); await shot(widgetWin, 'widget-tarik.png'); }
    if (process.env.TTM_SNAP_APP) {
      for (const tab of process.env.TTM_SNAP_APP.split(',')) {
        openApp(tab === 'welcome' ? { welcome: '1' } : { tab });
        await wait(2500);
        await shot(appWin, `app-${tab}.png`);
      }
    }
    if (process.env.TTM_SNAP_SHOW === '1') {
      startShow();
      const marks = [[2000, 'show-2-dance'], [4200, 'show-3-brew'], [8400, 'show-5-pull'], [15600, 'show-7-bow']];
      let last = 0;
      for (const [at, name] of marks) { await wait(at - last); last = at; await shot(showWin, name + '.png'); }
    }
    quitting = true;
    app.exit(0);
  }

  // Development only: a plausible day of readings, for previewing the History tab and the forecast.
  function seedHistory() {
    const now = Date.now(), reset = now + (2 * 3600 + 15 * 60) * 1000;
    const cur = Number(process.env.TTM_DEMO_SESSION || 45), wk = Number(process.env.TTM_DEMO_WEEKLY || 18);
    HIST = H.empty();
    const mid = new Date(); mid.setHours(0, 0, 0, 0);
    for (let at = mid.getTime(); at < now - 3600e3; at += 10 * 60e3) {
      const cyc = ((at - mid.getTime()) / (5 * 3600e3)) % 1;
      HIST.s.push([at, Math.round(cyc * 70), mid.getTime() + Math.ceil((at - mid.getTime() + 1) / (5 * 3600e3)) * 5 * 3600e3]);
    }
    for (let m = 60; m >= 0; m -= 5) HIST.s.push([now - m * 60e3, Math.max(0, cur - m * 0.5), reset]);
    for (let d = 7 * 24; d >= 0; d -= 2) HIST.w.push([now - d * 3600e3, Math.round(Math.min(100, 2 + (7 * 24 - d) / (7 * 24) * (wk - 2)) * 10) / 10, now + 3 * 86400e3]);
  }

  app.whenReady().then(() => {
    const loaded = ST.readWithBackup(STATE_FILE());
    S = loaded.state;
    try { HIST = H.clean(JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'))); } catch (e) { HIST = H.empty(); }
    if (!app.isPackaged) {
      // Development only: override settings for previews.
      for (const k of ['lang', 'theme', 'drink', 'textSize']) if (process.env['TTM_' + k.toUpperCase()]) S[k] = process.env['TTM_' + k.toUpperCase()];
      if (process.env.TTM_COMPACT === '1') S.compact = true;
      if (process.env.TTM_WELCOMED) S.welcomed = process.env.TTM_WELCOMED === '1';
      if (process.env.TTM_SEEN) S.seenVersion = process.env.TTM_SEEN;
      if (process.env.TTM_DEMO_HISTORY === '1') seedHistory();
    }
    nativeTheme.themeSource = S.theme;
    protocol.handle(SCHEME, serveApp);

    // The app's own pages get no permissions and can't download anything.
    const own = session.defaultSession;
    own.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    own.setPermissionCheckHandler(() => false);
    own.on('will-download', e => e.preventDefault());

    // claude.ai lives in its own private, persistent browser profile.
    claudeSes = session.fromPartition(PARTITION);
    cleanUA = claudeSes.getUserAgent().replace(/\s+teh-tarik-meter\/\S+/i, '').replace(/\s+Teh Tarik Meter\/\S+/i, '').replace(/\s+Electron\/\S+/i, '');
    claudeSes.setUserAgent(cleanUA);
    claudeSes.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
    claudeSes.on('will-download', e => e.preventDefault());

    R.web = S.last;
    R.view = M.buildView(R.web, null, Date.now());
    R.fc = H.forecasts(HIST, R.view, Date.now());
    createWidget();
    createTray();
    applyAutostart();
    applyShortcut();
    watchFeed();
    if (!S.welcomed) openApp({ welcome: '1' });
    if (loaded.restored) setTimeout(() => toast(t('n.backup.title'), t('n.backup.body')), 3000);

    nativeTheme.on('updated', broadcast);
    powerMonitor.on('suspend', () => { R.paused = true; clearTimeout(R.timer); });
    powerMonitor.on('lock-screen', () => { R.paused = true; clearTimeout(R.timer); });
    powerMonitor.on('resume', () => { R.paused = false; refresh('wake'); });
    powerMonitor.on('unlock-screen', () => { R.paused = false; refresh('wake'); });
    screen.on('display-removed', () => {
      if (widgetWin && !onSomeDisplay(S.widgetPos)) {
        const wa = screen.getPrimaryDisplay().workArea;
        const [w, h] = widgetWin.getSize();
        widgetWin.setPosition(wa.x + wa.width - w - 8, wa.y + wa.height - h - 8);
      }
    });
    setInterval(checkFullScreen, 2500);
    setInterval(saveHistory, 5 * 60e3);
    // A light tick so the festival outfit and forecasts move on with the clock.
    setInterval(() => { R.fc = H.forecasts(HIST, R.view, Date.now()); broadcast(); }, 60e3);

    refresh('start');
    if (!app.isPackaged && process.env.TTM_SNAP) devSnapshots(process.env.TTM_SNAP);
    if (INSTALLED) {
      setTimeout(() => checkForUpdate(false), 10000);
      setInterval(() => { if (Date.now() - S.lastUpdateCheck > UPDATE_EVERY) checkForUpdate(false); }, 3600e3);
    }
  });
}
