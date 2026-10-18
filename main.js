'use strict';
/*
 * Teh Tarik Meter - your Claude usage as a living glass of teh tarik.
 *
 * The main process owns all data. Windows only draw what they are sent.
 *   widget : the always-on-top desktop card (the glass, the weekly cups)
 *   show   : the full-screen easter egg (poke the glass 10 times fast)
 *   login  : a plain claude.ai window to sign in; nothing is injected into it
 *
 * Where the numbers come from:
 *   1. claude.ai - the same numbers as Settings > Usage, read with your own
 *      sign-in (kept in Electron's encrypted cookie store, never in a file of ours).
 *      Checked every 15 s while usage is moving, easing to 2 min when quiet,
 *      paused while the PC is locked or asleep, and right away on hover/wake/Refresh.
 *   2. Claude Code - its status line hands us rate_limits after every reply;
 *      a tiny script saves them to claude-code-feed.json and we update instantly.
 * The newer reading of each window wins.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, Notification, nativeImage, shell, powerMonitor, net, protocol, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const U = require('./lib/usage.js');
const M = require('./lib/merge.js');
const CC = require('./lib/claudecode.js');
const ST = require('./lib/state.js');
const F = require('./renderer/format.js');

const AUMID = 'app.tehtarik.meter';
const CLAUDE = 'https://claude.ai';
const PARTITION = 'persist:claude';
const WIDGET_W = 420, WIDGET_H = 540;
const ICON = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'tray.ico' : 'tray.png');
const REPO = 'chowkuanlaw/teh-tarik-meter';
const UPDATE_EVERY = 24 * 3600e3;
const SCHEME = 'tehtarik', ORIGIN = `${SCHEME}://app`, RENDERER_DIR = path.join(__dirname, 'renderer');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const DEMO = !app.isPackaged && process.env.TTM_DEMO === '1'; // development only: fake numbers, no network
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  run();
}

function run() {
  app.setAppUserModelId(AUMID);
  Menu.setApplicationMenu(null);

  const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');
  const FEED_FILE = () => path.join(app.getPath('userData'), CC.FEED_NAME);
  const SCRIPT_DIR = () => path.join(app.getPath('userData'), 'statusline');

  let S = ST.clean(null);
  const R = {
    web: null, feed: null, view: null,
    status: 'starting',          // starting | ok | signed-out | offline | error
    errors: 0, fetching: false, again: false, lastFetchAt: 0, lastChangeAt: 0,
    paused: false, timer: null, rollTimer: null, ccTimer: null, feedTimer: null,
    update: null, checking: false
  };
  let widgetWin = null, loginWin = null, showWin = null, tray = null, quitting = false, saveTimer = null, claudeSes = null, cleanUA = '';

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ST.write(STATE_FILE(), S), 300);
  }

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
      const t = setTimeout(() => { try { req.abort(); } catch (e) { /* ignore */ } reject(httpError('timeout')); }, 15000);
      // An API call that redirects is being sent to the login page.
      req.on('redirect', () => { clearTimeout(t); try { req.abort(); } catch (e) { /* ignore */ } reject(httpError('auth', 302)); });
      req.on('response', res => {
        const chunks = [];
        let size = 0;
        res.on('data', c => { size += c.length; if (size < 2e6) chunks.push(c); });
        res.on('end', () => {
          clearTimeout(t);
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
        res.on('error', () => { clearTimeout(t); reject(httpError('network')); });
      });
      req.on('error', () => { clearTimeout(t); reject(httpError('network')); });
      req.end();
    });
  }

  async function ensureOrg() {
    const pinned = U.safeOrgId(S.orgId);
    if (pinned) return pinned;
    const orgs = await getJson(`${CLAUDE}/api/organizations`);
    const id = U.safeOrgId(U.pickOrg(orgs, null));
    if (!id) throw httpError('auth');
    S.orgId = id; save();
    return id;
  }

  function demoUsage() {
    // Development preview: a session that drains over ~10 minutes, then refills.
    // TTM_DEMO_SESSION / TTM_DEMO_WEEKLY pin the numbers; TTM_DEMO_SIGNEDOUT=1 acts signed out.
    if (process.env.TTM_DEMO_SIGNEDOUT === '1') throw httpError('auth', 401);
    const t = (Date.now() / 1000) % 600;
    const now = Date.now();
    const fixed = k => (process.env[k] !== undefined ? Number(process.env[k]) : null);
    const s = fixed('TTM_DEMO_SESSION'), w = fixed('TTM_DEMO_WEEKLY');
    return {
      five_hour: { utilization: s !== null ? s : Math.min(100, t / 5.5), resets_at: new Date(now + (2 * 3600 + 15 * 60) * 1000).toISOString() },
      seven_day: { utilization: w !== null ? w : 18 + t / 40, resets_at: new Date(now + 3 * 86400e3).toISOString() },
      seven_day_opus: { utilization: 40, resets_at: new Date(now + 3 * 86400e3).toISOString() }
    };
  }

  // Development only: save pictures of the widget (and the show) to a folder, then quit.
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
    if (process.env.TTM_SNAP_TARIK === '1') {
      send(widgetWin, 'tarik');
      await wait(1200);
      await shot(widgetWin, 'widget-tarik.png');
    }
    if (process.env.TTM_SNAP_SHOW === '1') {
      startShow();
      const marks = [[600, 'show-1-intro'], [2000, 'show-2-dance'], [4200, 'show-3-brew'], [6600, 'show-4-milk'], [8400, 'show-5-pull'], [13600, 'show-6-serve'], [15600, 'show-7-bow']];
      let last = 0;
      for (const [at, name] of marks) { await wait(at - last); last = at; await shot(showWin, name + '.png'); }
    }
    quitting = true;
    app.exit(0);
  }

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
        const snap = { at: Date.now(), session: parsed.session, weekly: parsed.weekly, models: parsed.models };
        if (M.changed(R.web, snap)) R.lastChangeAt = Date.now();
        R.web = snap;
        S.last = snap; save();
        R.status = 'ok'; R.errors = 0;
      } catch (e) {
        if (e.code === 'notfound' && attempt === 0 && S.orgId) { S.orgId = null; attempt++; continue; } // org changed: look it up again
        if (e.code === 'auth') { R.status = 'signed-out'; S.orgId = null; save(); }
        else {
          R.status = (e.code === 'network' || e.code === 'timeout') ? 'offline' : 'error';
          R.errors++;
          if (e.code === 'challenge') warmUp();
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
    // Pick up per-model caps from claude.ai a moment later.
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
    // Celebrate a refill only between live readings, not against an old saved one at start-up.
    if (prev && R.warm && M.detectReset(prev, view)) send(widgetWin, 'tarik');
    if (R.status === 'ok' || R.feed) R.warm = true;
    if (S.alerts && R.status !== 'signed-out' && view.hasData) {
      const res = M.alertsFor(view, S.sent, now);
      S.sent = res.sent;
      if (res.alerts.length) { save(); res.alerts.forEach(notify); }
    }
    scheduleRollover();
    updateTray();
    broadcast();
  }

  function snapshot() {
    return {
      view: R.view,
      status: R.status,
      fetching: R.fetching,
      lastFetchAt: R.lastFetchAt,
      paused: R.paused,
      cc: S.cc.connected,
      ccAt: R.feed ? R.feed.at : null,
      onTop: S.onTop,
      sound: S.sound,
      update: R.update,
      demo: DEMO
    };
  }
  function send(win, ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
  function broadcast() { send(widgetWin, 'state', snapshot()); }

  /* ---------- alerts ---------- */
  function notify(a) {
    if (!Notification.isSupported()) return;
    const now = Date.now();
    const p = Math.round(a.pct);
    let title, body;
    if (a.kind === 'session') {
      title = a.level >= 95 ? 'Alamak, last few sips!' : 'Eh, slow down a bit lah!';
      body = `Your session is ${p}% used. Fresh glass ${F.when(a.resetsAt, now)}.`;
    } else if (a.kind === 'weekly') {
      title = a.level >= 95 ? 'Almost no teh left this week' : "This week's pot is running low";
      body = `Weekly usage is at ${p}%. Fresh pot ${F.when(a.resetsAt, now)}.`;
    } else {
      title = `${a.name} weekly limit at ${p}%`;
      body = `Resets ${F.when(a.resetsAt, now)}.`;
    }
    const n = new Notification({ title, body, icon: ICON, silent: false });
    n.on('click', showWidget);
    n.show();
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
    if (!/^sk-ant-[A-Za-z0-9_-]{20,400}$/.test(v)) return { ok: false, msg: "That doesn't look like a session key. It starts with sk-ant-." };
    try {
      await claudeSes.cookies.set({ url: CLAUDE, name: 'sessionKey', value: v, domain: '.claude.ai', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400 });
    } catch (e) { return { ok: false, msg: "Couldn't save it. Try again." }; }
    S.orgId = null; R.errors = 0;
    await refresh('manual');
    return R.status === 'signed-out' ? { ok: false, msg: 'claude.ai did not accept that key.' } : { ok: true };
  }

  async function signOut() {
    const r = await dialog.showMessageBox({ type: 'question', buttons: ['Sign out', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Teh Tarik Meter', message: 'Sign out of claude.ai in Teh Tarik Meter?', detail: 'This only signs out the meter, not your browser or the Claude app.' });
    if (r.response !== 0) return;
    try { await claudeSes.clearStorageData(); } catch (e) { /* ignore */ }
    S.orgId = null; S.last = null; R.web = null; R.status = 'signed-out'; save();
    clearTimeout(R.timer);
    update();
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
      dialog.showMessageBox({ type: 'warning', title: 'Teh Tarik Meter', message: "Couldn't read Claude Code's settings.json", detail: `${file}\n\nIt doesn't look like valid JSON, so nothing was changed. Fix the file and try again.` });
      return;
    }
    const had = settings.statusLine && !CC.isOurs(settings.statusLine);
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Connect', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Teh Tarik Meter',
      message: 'Connect Claude Code for instant updates?',
      detail: `Teh Tarik Meter will set Claude Code's status line (in ${file}) to a small script that saves only your usage limits for the widget.` +
        (had ? '\n\nYour current status line is kept: the script runs it and shows its output as before.' : '') +
        '\n\nA backup of settings.json is saved next to it. You can disconnect any time from the tray menu.'
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
      dialog.showMessageBox({ type: 'info', title: 'Teh Tarik Meter', message: 'Claude Code is connected', detail: 'The glass now moves the moment a Claude Code reply lands. Start a new Claude Code session (or send a message) to see it.' });
    } catch (e) {
      dialog.showMessageBox({ type: 'error', title: 'Teh Tarik Meter', message: "Couldn't connect Claude Code", detail: String(e && e.message || e) });
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
      dialog.showMessageBox({ type: 'warning', title: 'Teh Tarik Meter', message: "Couldn't update Claude Code's settings.json", detail: String(e && e.message || e) });
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
  function viewURL(view) { return `${ORIGIN}/index.html?view=${encodeURIComponent(view)}`; }

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
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
  }

  function onSomeDisplay(p) {
    return p && screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return p.x >= a.x - 60 && p.y >= a.y - 20 && p.x + 120 <= a.x + a.width + WIDGET_W && p.y + 60 <= a.y + a.height + WIDGET_H;
    });
  }

  function createWidget() {
    const wa = screen.getPrimaryDisplay().workArea;
    const pos = onSomeDisplay(S.widgetPos) ? S.widgetPos : { x: wa.x + wa.width - WIDGET_W - 8, y: wa.y + wa.height - WIDGET_H - 8 };
    widgetWin = new BrowserWindow({
      x: pos.x, y: pos.y, width: WIDGET_W, height: WIDGET_H, frame: false, transparent: true, resizable: false,
      maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: S.onTop, show: false, title: 'Teh Tarik Meter', icon: ICON, webPreferences: webPrefs()
    });
    if (S.onTop) widgetWin.setAlwaysOnTop(true, 'floating');
    lockDown(widgetWin);
    widgetWin.loadURL(viewURL('widget'));
    widgetWin.once('ready-to-show', () => { if (S.widget) widgetWin.showInactive(); });
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
  function setWidget(on) {
    S.widget = !!on; save();
    if (!widgetWin || widgetWin.isDestroyed()) return;
    if (on) { widgetWin.showInactive(); } else widgetWin.hide();
    updateTray();
  }
  function showWidget() { setWidget(true); if (widgetWin && !widgetWin.isDestroyed()) widgetWin.focus(); }
  function setOnTop(on) {
    S.onTop = !!on; save();
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.setAlwaysOnTop(S.onTop, 'floating');
    broadcast(); updateTray();
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

  /* ---------- tray ---------- */
  function trayText() {
    const v = R.view;
    if (R.status === 'signed-out') return 'Teh Tarik Meter - sign in to see your usage';
    if (!v || !v.hasData) return 'Teh Tarik Meter';
    const parts = ['Teh Tarik Meter'];
    if (v.session) parts.push(`Session ${Math.round(100 - v.session.pct)}% left`);
    if (v.weekly) parts.push(`Week ${Math.round(100 - v.weekly.pct)}% left`);
    return parts.join('\n');
  }
  function updateTray() { if (tray) tray.setToolTip(trayText()); }
  function buildMenu() {
    const items = [
      { label: S.widget ? 'Hide the widget' : 'Show the widget', click: () => setWidget(!S.widget) },
      { label: 'Refresh now', enabled: R.status !== 'signed-out' || DEMO, click: () => refresh('manual') },
      { type: 'separator' },
      { label: 'Keep on top', type: 'checkbox', checked: S.onTop, click: m => setOnTop(m.checked) },
      { label: 'Alerts at 80% and 95%', type: 'checkbox', checked: S.alerts, click: m => { S.alerts = m.checked; save(); } },
      { label: 'Sound in the teh tarik show', type: 'checkbox', checked: S.sound, click: m => { S.sound = m.checked; save(); broadcast(); } },
      { label: 'Start with Windows', type: 'checkbox', checked: S.autostart, click: m => { S.autostart = m.checked; save(); applyAutostart(); } },
      { type: 'separator' },
      S.cc.connected
        ? { label: 'Disconnect Claude Code', click: disconnectClaudeCode }
        : { label: 'Connect Claude Code (instant updates)...', click: connectClaudeCode },
      { label: 'Open claude.ai usage page', click: () => shell.openExternal(`${CLAUDE}/settings/usage`) },
      R.status === 'signed-out'
        ? { label: 'Sign in to claude.ai...', click: openLogin }
        : { label: 'Sign out', click: signOut },
      { type: 'separator' }
    ];
    if (R.update && R.update.state === 'ready') items.push({ label: `Restart to update to ${R.update.version}`, click: installUpdate });
    else if (INSTALLED) items.push({ label: R.checking ? 'Checking for updates...' : 'Check for updates', enabled: !R.checking, click: () => checkForUpdate(true) });
    items.push({ label: `Teh Tarik Meter ${app.getVersion()}`, enabled: false });
    items.push({ label: 'Quit', click: () => { quitting = true; app.quit(); } });
    return Menu.buildFromTemplate(items);
  }
  function createTray() {
    let img = nativeImage.createFromPath(TRAY_ICON);
    if (img.isEmpty()) img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    updateTray();
    tray.on('click', () => setWidget(!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible())));
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  }
  // The widget draws the glass at tray sizes, with the current tea level, and sends PNGs here.
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

  /* ---------- Windows integration ---------- */
  function applyAutostart() {
    if (!app.isPackaged) return;
    try { app.setLoginItemSettings({ openAtLogin: S.autostart, path: process.execPath, args: ['--autostart'] }); } catch (e) { /* ignore */ }
  }

  /* ---------- updates (installed copies, from GitHub releases like Lapis) ---------- */
  const INSTALLED = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  let autoUpdater = null;
  if (INSTALLED) {
    try {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdater.logger = null;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-downloaded', info => {
        R.update = { version: info.version, state: 'ready' };
        if (Notification.isSupported()) {
          const n = new Notification({ title: 'Teh Tarik Meter update ready', body: `Version ${info.version} is downloaded. Restart from the tray menu, or it installs when you quit.`, icon: ICON, silent: true });
          n.show();
        }
        broadcast();
      });
      autoUpdater.on('error', () => { R.checking = false; });
    } catch (e) { autoUpdater = null; }
  }
  async function checkForUpdate(manual) {
    if (!autoUpdater || R.checking) return;
    R.checking = true; S.lastUpdateCheck = Date.now(); save();
    try { await autoUpdater.checkForUpdates(); } catch (e) { if (manual) dialog.showMessageBox({ type: 'info', title: 'Teh Tarik Meter', message: "Couldn't check for updates", detail: 'Check your internet connection and try again.' }); }
    R.checking = false;
  }
  function installUpdate() {
    if (!autoUpdater || !R.update || R.update.state !== 'ready') return;
    quitting = true;
    ST.write(STATE_FILE(), S);
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  /* ---------- messages from the widget ---------- */
  ipcMain.handle('get-state', evt => (trusted(evt) ? snapshot() : null));
  ipcMain.handle('session-key', (evt, value) => (trusted(evt) ? useSessionKey(value) : { ok: false }));
  ipcMain.on('action', (evt, a) => {
    if (!trusted(evt) || !a || typeof a.type !== 'string') return;
    switch (a.type) {
      case 'refresh': R.errors = 0; refresh('manual'); break;
      case 'hover': soon('hover', 10000); break;
      case 'sign-in': openLogin(); break;
      case 'hide': setWidget(false); break;
      case 'on-top': setOnTop(!S.onTop); break;
      case 'menu': if (tray) tray.popUpContextMenu(buildMenu()); else buildMenu().popup(); break;
      case 'open-usage': shell.openExternal(`${CLAUDE}/settings/usage`); break;
      case 'start-show': startShow(); break;
      case 'show-done': endShow(); break;
      case 'mute': S.sound = !a.value; save(); break;
      case 'tray-icon': setTrayIcon(a.images); break;
      case 'size': {
        const h = Math.round(Number(a.h));
        if (!widgetWin || widgetWin.isDestroyed() || !(h >= 150 && h <= 800)) break;
        const [, cur] = widgetWin.getSize();
        if (cur === h) break;
        const b = widgetWin.getBounds();
        widgetWin.setBounds({ x: b.x, y: b.y, width: WIDGET_W, height: h });
        const wa = screen.getDisplayMatching(widgetWin.getBounds()).workArea;
        if (b.y + h > wa.y + wa.height) widgetWin.setPosition(b.x, Math.max(wa.y, wa.y + wa.height - h));
        break;
      }
    }
  });

  /* ---------- start ---------- */
  app.on('second-instance', showWidget);
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('before-quit', () => { quitting = true; ST.write(STATE_FILE(), S); });

  app.whenReady().then(() => {
    S = ST.read(STATE_FILE());
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
    createWidget();
    createTray();
    applyAutostart();
    watchFeed();

    powerMonitor.on('suspend', () => { R.paused = true; clearTimeout(R.timer); });
    powerMonitor.on('lock-screen', () => { R.paused = true; clearTimeout(R.timer); });
    powerMonitor.on('resume', () => { R.paused = false; refresh('wake'); });
    powerMonitor.on('unlock-screen', () => { R.paused = false; refresh('wake'); });
    screen.on('display-removed', () => {
      if (widgetWin && !onSomeDisplay(S.widgetPos)) {
        const wa = screen.getPrimaryDisplay().workArea;
        widgetWin.setPosition(wa.x + wa.width - WIDGET_W - 8, wa.y + wa.height - WIDGET_H - 8);
      }
    });

    refresh('start');
    if (!app.isPackaged && process.env.TTM_SNAP) devSnapshots(process.env.TTM_SNAP);
    if (INSTALLED) {
      setTimeout(() => checkForUpdate(false), 10000);
      setInterval(() => { if (Date.now() - S.lastUpdateCheck > UPDATE_EVERY) checkForUpdate(false); }, 3600e3);
    }
  });
}
