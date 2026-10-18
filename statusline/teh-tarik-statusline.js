#!/usr/bin/env node
'use strict';
/*
 * Teh Tarik Meter - Claude Code status line script.
 *
 * Claude Code runs this after each reply and pipes in a JSON object on stdin.
 * We keep ONLY the usage limits (rate_limits: five_hour and seven_day, each
 * { used_percentage, resets_at }) and save them next to the app's settings in
 * claude-code-feed.json. Nothing else from the JSON is saved or sent anywhere.
 *
 * Then we print a status line: your original one if you had one (chain.json),
 * otherwise a short teh tarik summary.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const FEED = path.join(HERE, '..', 'claude-code-feed.json');
const CHAIN = path.join(HERE, 'chain.json');

let raw = '';
let finished = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { if (raw.length < 1e6) raw += c; });
process.stdin.on('end', done);
process.stdin.on('error', done);
setTimeout(done, 3000).unref();

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function keep(b) {
  return b && typeof b === 'object' ? { used_percentage: num(b.used_percentage), resets_at: num(b.resets_at) } : null;
}

function done() {
  if (finished) return;
  finished = true;
  let j = null;
  try { j = JSON.parse(raw); } catch (e) { /* not JSON: nothing to save */ }
  const rl = j && j.rate_limits;
  if (rl && typeof rl === 'object' && (rl.five_hour || rl.seven_day)) {
    const out = { received_at: Date.now(), five_hour: keep(rl.five_hour), seven_day: keep(rl.seven_day) };
    const tmp = `${FEED}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, FEED); }
    catch (e) { try { fs.writeFileSync(FEED, JSON.stringify(out)); } catch (e2) { /* ignore */ } try { fs.unlinkSync(tmp); } catch (e3) { /* ignore */ } }
  }

  let chained = null;
  try { chained = JSON.parse(fs.readFileSync(CHAIN, 'utf8')).command; } catch (e) { /* no chain */ }
  if (typeof chained === 'string' && chained.trim()) {
    const sh = process.env.SHELL;
    const r = sh
      ? spawnSync(sh, ['-c', chained], { input: raw, encoding: 'utf8', windowsHide: true, timeout: 5000 })
      : spawnSync(chained, { shell: true, input: raw, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    process.stdout.write((r && r.stdout) || '');
    return;
  }
  process.stdout.write(summary(rl));
}

function left(b) {
  const p = b ? num(b.used_percentage) : null;
  return p === null ? null : Math.max(0, Math.round(100 - p));
}
function until(b) {
  const r = b ? num(b.resets_at) : null;
  if (!r) return '';
  const ms = (r < 1e12 ? r * 1000 : r) - Date.now();
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h > 0 ? ` (${h}h ${m}m)` : ` (${m}m)`;
}
function summary(rl) {
  if (!rl) return 'Teh tarik';
  const parts = ['Teh tarik'];
  const s = left(rl.five_hour), w = left(rl.seven_day);
  if (s !== null) parts.push(`session ${s}% left${until(rl.five_hour)}`);
  if (w !== null) parts.push(`week ${w}% left`);
  return parts.join(' | ');
}
