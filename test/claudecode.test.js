'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const CC = require('../lib/claudecode.js');

const SRC = path.join(__dirname, '..', 'statusline');

test('connect keeps the original status line to chain and restore', () => {
  const before = { model: 'opus', statusLine: { type: 'command', command: '~/.claude/my-line.sh', padding: 1 }, hooks: { a: 1 } };
  const cmd = CC.buildCommand('node', 'C:\\Users\\me\\AppData\\Roaming\\Teh Tarik Meter\\statusline');
  assert.equal(cmd, 'node "C:/Users/me/AppData/Roaming/Teh Tarik Meter/statusline/teh-tarik-statusline.js"');
  const { settings, original } = CC.connect(before, cmd);
  assert.deepEqual(original, before.statusLine);
  assert.equal(settings.statusLine.command, cmd);
  assert.equal(settings.statusLine.padding, 1);
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.hooks, { a: 1 });
  assert.notEqual(before.statusLine.command, cmd, 'input not changed');

  const back = CC.disconnect(settings, original);
  assert.equal(back.changed, true);
  assert.deepEqual(back.settings, before);
});

test('connecting twice does not chain to ourselves', () => {
  const cmd = CC.buildCommand('powershell', '/x/statusline');
  assert.match(cmd, /^powershell -NoProfile -ExecutionPolicy Bypass -File "\/x\/statusline\/teh-tarik-statusline\.ps1"$/);
  const once = CC.connect({}, cmd);
  const twice = CC.connect(once.settings, cmd);
  assert.equal(twice.original, null);
  assert.equal(CC.disconnect(twice.settings, null).settings.statusLine, undefined);
});

test('disconnect leaves a status line it did not set alone', () => {
  const s = { statusLine: { type: 'command', command: 'echo hi' } };
  const r = CC.disconnect(s, null);
  assert.equal(r.changed, false);
  assert.deepEqual(r.settings, s);
});

test('refuses to touch a settings.json it cannot read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttm-'));
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, '{ not json');
  assert.throws(() => CC.readSettings(f));
  fs.writeFileSync(f, '[]');
  assert.throws(() => CC.readSettings(f));
  fs.writeFileSync(f, '\uFEFF{"a":1}');
  assert.deepEqual(CC.readSettings(f), { a: 1 });
  assert.deepEqual(CC.readSettings(path.join(dir, 'missing.json')), {});
});

test('settings path follows CLAUDE_CONFIG_DIR', () => {
  assert.equal(CC.settingsPath({ CLAUDE_CONFIG_DIR: '/tmp/cc' }), path.join('/tmp/cc', 'settings.json'));
  assert.equal(CC.settingsPath({}), path.join(os.homedir(), '.claude', 'settings.json'));
});

test('the bridge folder is in the user profile, outside AppData (works in the Store copy)', () => {
  const dir = CC.bridgeDir('C:\\Users\\me');
  assert.equal(path.basename(dir), '.teh-tarik-meter');
  assert.ok(!/appdata/i.test(dir));
  assert.equal(CC.bridgeDir(), path.join(os.homedir(), '.teh-tarik-meter'));
});

test('an older connection in AppData is moved to the bridge folder, same runner, other settings kept', () => {
  const oldDir = 'C:\\Users\\me\\AppData\\Roaming\\Teh Tarik Meter\\statusline';
  const newDir = 'C:\\Users\\me\\.teh-tarik-meter\\statusline';
  for (const runner of ['node', 'powershell']) {
    const before = { model: 'opus', statusLine: { type: 'command', command: CC.buildCommand(runner, oldDir), padding: 2 } };
    assert.equal(CC.needsMove(before.statusLine, newDir), true);
    assert.equal(CC.runnerOf(before.statusLine), runner);
    const { settings, changed } = CC.moveCommand(before, newDir);
    assert.equal(changed, true);
    assert.equal(settings.statusLine.command, CC.buildCommand(runner, newDir));
    assert.equal(settings.statusLine.padding, 2);
    assert.equal(settings.model, 'opus');
    assert.equal(CC.needsMove(settings.statusLine, newDir), false, 'moved once only');
  }
  // Someone else's status line is never touched.
  const theirs = { statusLine: { type: 'command', command: 'echo hi' } };
  assert.equal(CC.needsMove(theirs.statusLine, newDir), false);
  assert.deepEqual(CC.moveCommand(theirs, newDir), { settings: theirs, changed: false });
});

function setup(original) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'ttm-app-'));
  const dir = path.join(app, 'statusline');
  CC.installScripts(SRC, dir, original);
  return { app, script: path.join(dir, 'teh-tarik-statusline.js'), feed: path.join(app, CC.FEED_NAME) };
}
const SAMPLE = {
  session_id: 'secret-session', cwd: '/home/me/private-project', model: { display_name: 'Opus' },
  rate_limits: { five_hour: { used_percentage: 37, resets_at: Math.floor(Date.now() / 1000) + 7200 }, seven_day: { used_percentage: 12.5, resets_at: Math.floor(Date.now() / 1000) + 86400 } }
};

test('the status line script saves only the limits and prints a summary', () => {
  const { script, feed } = setup(null);
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(SAMPLE), encoding: 'utf8', env: Object.assign({}, process.env, { SHELL: '' }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Teh tarik \| session 63% left \(1h 59m\) \| week 88% left$/);
  const saved = JSON.parse(fs.readFileSync(feed, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['five_hour', 'received_at', 'seven_day']);
  assert.equal(saved.five_hour.used_percentage, 37);
  assert.ok(!JSON.stringify(saved).includes('private-project'));
  assert.ok(!JSON.stringify(saved).includes('secret-session'));
});

test('the status line script runs your original status line', () => {
  const { script, feed } = setup({ type: 'command', command: `"${process.execPath}" -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('MINE '+JSON.parse(d).model.display_name))"` });
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(SAMPLE), encoding: 'utf8', env: Object.assign({}, process.env, { SHELL: '' }) });
  assert.equal(r.stdout, 'MINE Opus');
  assert.ok(fs.existsSync(feed));
});

test('the status line script copes with no limits or bad input', () => {
  const { script, feed } = setup(null);
  let r = spawnSync(process.execPath, [script], { input: JSON.stringify({ model: {} }), encoding: 'utf8', env: Object.assign({}, process.env, { SHELL: '' }) });
  assert.equal(r.stdout, 'Teh tarik');
  assert.equal(fs.existsSync(feed), false);
  r = spawnSync(process.execPath, [script], { input: 'garbage', encoding: 'utf8', env: Object.assign({}, process.env, { SHELL: '' }) });
  assert.equal(r.status, 0);
});
