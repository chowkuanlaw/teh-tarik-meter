'use strict';
/*
 * Connects Claude Code's status line to Teh Tarik Meter.
 *
 * Claude Code passes its status line command a JSON object after each reply.
 * For Pro and Max plans it carries rate_limits.five_hour and rate_limits.seven_day
 * ({ used_percentage, resets_at }). Our small script saves just those numbers to
 * claude-code-feed.json in the app's folder, which the app watches, so the
 * widget moves the moment a reply lands.
 *
 * If you already had a status line, its command is kept in chain.json and our
 * script runs it and prints its output, so your status line looks the same.
 * Disconnecting puts your original status line back.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MARK = 'teh-tarik-statusline';
const FEED_NAME = 'claude-code-feed.json';

function settingsPath(env) {
  env = env || process.env;
  const dir = env.CLAUDE_CONFIG_DIR && String(env.CLAUDE_CONFIG_DIR).trim() ? String(env.CLAUDE_CONFIG_DIR).trim() : path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

function isOurs(statusLine) {
  return !!(statusLine && typeof statusLine === 'object' && typeof statusLine.command === 'string' && statusLine.command.includes(MARK));
}

const fwd = p => p.replace(/\\/g, '/');

function buildCommand(runner, scriptDir) {
  if (runner === 'node') return `node "${fwd(path.join(scriptDir, MARK + '.js'))}"`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${fwd(path.join(scriptDir, MARK + '.ps1'))}"`;
}

const clone = o => (o && typeof o === 'object' && !Array.isArray(o) ? JSON.parse(JSON.stringify(o)) : {});

// Returns the new settings and the status line that was there before (to chain and restore).
function connect(settings, command) {
  const s = clone(settings);
  const prev = s.statusLine;
  const original = prev && typeof prev === 'object' && !isOurs(prev) ? prev : null;
  s.statusLine = { type: 'command', command };
  if (prev && typeof prev === 'object' && typeof prev.padding === 'number') s.statusLine.padding = prev.padding;
  return { settings: s, original };
}

function disconnect(settings, original) {
  const s = clone(settings);
  if (!isOurs(s.statusLine)) return { settings: s, changed: false };
  if (original && typeof original === 'object') s.statusLine = original;
  else delete s.statusLine;
  return { settings: s, changed: true };
}

// Throws if the file exists but isn't valid JSON, so we never overwrite something we can't read.
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!txt.trim()) return {};
  const j = JSON.parse(txt);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('settings.json is not a JSON object');
  return j;
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// Keeps one copy of settings.json from before the first change.
function backupOnce(file) {
  const bak = file + '.before-teh-tarik';
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}

// Copies the scripts somewhere Claude Code can run them (outside the app's packed files),
// and records the original status line command to chain to.
function installScripts(srcDir, destDir, original) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ext of ['.js', '.ps1']) fs.copyFileSync(path.join(srcDir, MARK + ext), path.join(destDir, MARK + ext));
  const command = original && original.type === 'command' && typeof original.command === 'string' ? original.command : null;
  writeJsonAtomic(path.join(destDir, 'chain.json'), { command });
}

module.exports = { MARK, FEED_NAME, settingsPath, isOurs, buildCommand, connect, disconnect, readSettings, writeJsonAtomic, backupOnce, installScripts };
