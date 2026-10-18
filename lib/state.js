'use strict';
/*
 * The app's own settings, saved in %APPDATA%\Teh Tarik Meter\state.json.
 * Nothing secret is kept here: your claude.ai sign-in lives in Electron's
 * encrypted cookie store, never in this file.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  v: 1,
  widget: true,          // show the desktop widget
  onTop: true,           // keep it above other windows
  autostart: true,       // start with Windows
  alerts: true,          // Windows notifications at 80% and 95%
  sound: true,           // chimes in the easter-egg show
  widgetPos: null,       // { x, y }
  orgId: null,           // which claude.ai organization to read
  cc: { connected: false, original: null, runner: null }, // Claude Code status line
  sent: {},              // alerts already sent: key -> time
  last: null,            // last claude.ai reading, so the widget isn't empty at start
  lastUpdateCheck: 0
};

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
function win(w) {
  if (!w || typeof w !== 'object') return null;
  const pct = Number(w.pct), r = Number(w.resetsAt);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { pct, resetsAt: Number.isFinite(r) && r > 0 ? r : null };
}

function clean(s) {
  const o = JSON.parse(JSON.stringify(DEFAULTS));
  if (!s || typeof s !== 'object') return o;
  for (const k of ['widget', 'onTop', 'autostart', 'alerts', 'sound']) o[k] = bool(s[k], DEFAULTS[k]);
  if (s.widgetPos && Number.isFinite(s.widgetPos.x) && Number.isFinite(s.widgetPos.y)) o.widgetPos = { x: Math.round(s.widgetPos.x), y: Math.round(s.widgetPos.y) };
  if (typeof s.orgId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(s.orgId)) o.orgId = s.orgId;
  if (s.cc && typeof s.cc === 'object') {
    o.cc.connected = !!s.cc.connected;
    o.cc.original = s.cc.original && typeof s.cc.original === 'object' && !Array.isArray(s.cc.original) ? s.cc.original : null;
    o.cc.runner = s.cc.runner === 'node' || s.cc.runner === 'powershell' ? s.cc.runner : null;
  }
  if (s.sent && typeof s.sent === 'object') for (const [k, t] of Object.entries(s.sent)) if (typeof k === 'string' && k.length < 120 && Number.isFinite(t)) o.sent[k] = t;
  if (s.last && typeof s.last === 'object' && Number.isFinite(s.last.at)) {
    o.last = {
      at: s.last.at,
      session: win(s.last.session),
      weekly: win(s.last.weekly),
      models: Array.isArray(s.last.models) ? s.last.models.slice(0, 6).map(m => m && typeof m.name === 'string' ? Object.assign({ name: m.name.slice(0, 40) }, win(m)) : null).filter(m => m && m.pct !== undefined) : []
    };
  }
  if (Number.isFinite(s.lastUpdateCheck)) o.lastUpdateCheck = s.lastUpdateCheck;
  return o;
}

function read(file) {
  try { return clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { return clean(null); }
}

function write(file, s) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { /* best effort */ }
}

module.exports = { DEFAULTS, clean, read, write };
