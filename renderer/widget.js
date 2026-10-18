'use strict';
/* The desktop widget: draws what the main process sends, plus the glass's own life (pokes, moods, refills). */
(function () {
  if (!window.ttm || window.ttm.view !== 'widget') return;
  const F = window.TTFormat, G = window.TTGlass;
  const $ = id => document.getElementById(id);
  $('widget').hidden = false;

  const card = $('card'), stage = $('stage');
  let st = null;
  let pokes = [], pokeIdx = -1, combo = 0, comboTimer = 0, jiggleTimer = 0;
  let msg = null, msgUntil = 0;
  let pouring = false, holdTea = null, pourTimer = 0;
  let shownLine = '', trayKey = '', lastTea = null;

  // Weekly cups.
  const cups = [];
  for (let i = 0; i < 7; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 36 44'); svg.setAttribute('width', '40'); svg.setAttribute('height', '49');
    svg.style.animationDelay = `${(i * 0.3).toFixed(1)}s`;
    $('cups').appendChild(svg);
    cups.push({ svg, parts: G.drawCup(svg) });
  }

  function say(text, ms) { msg = text; msgUntil = Date.now() + (ms || 6000); render(); }

  function setLine(text) {
    if (text === shownLine) return;
    shownLine = text;
    $('line').textContent = text;
    const b = $('bubble');
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }

  function setFace(mood) {
    const f = G.FACES[mood] || G.FACES.happy;
    const eyes = $('eyes');
    eyes.setAttribute('d', f.eyes);
    eyes.setAttribute('fill', f.eyesFilled ? '#3A2A22' : 'none');
    eyes.style.stroke = f.eyesFilled ? 'none' : '';
    $('brows').setAttribute('d', f.brows);
    $('mouth').setAttribute('d', f.mouth);
    $('mouth').classList.toggle('filled', f.mouthFilled);
    const arm = $('armR');
    arm.setAttribute('d', f.wave ? 'M133 30 q12 -5 15 -18' : 'M133 30 q11 7 12 19');
    arm.classList.toggle('wave', f.wave);
    stage.dataset.mood = mood;
  }

  function syncText(now) {
    const s = st;
    if (!s) return ['Starting...', ''];
    if (s.demo) return ['Demo numbers (development)', 'warn'];
    if (s.status === 'signed-out') return ['Not signed in', 'off'];
    if (s.paused) return ['Paused while your PC is locked', 'off'];
    if (s.fetching && !(s.view && s.view.syncedAt)) return ['Syncing...', ''];
    const have = !!(s.view && s.view.hasData);
    if (s.status === 'offline') return [have ? 'Offline · showing last reading' : 'Offline · will retry', 'warn'];
    if (s.status === 'error') return [have ? "Couldn't reach claude.ai · showing last reading" : "Couldn't reach claude.ai · retrying", 'warn'];
    if (s.fetching) return ['Syncing...', ''];
    const at = s.view && s.view.syncedAt;
    if (!at) return ['Starting...', ''];
    const via = s.view.source === 'cc' ? ' via Claude Code' : '';
    return [`Live · synced ${F.ago(now - at)}${via}`, ''];
  }

  function render() {
    const now = Date.now();
    const s = st;
    const v = s && s.view;
    const signedOut = !!(s && s.status === 'signed-out');
    const hasData = !!(v && v.hasData);
    card.classList.toggle('signed-out', signedOut);
    $('numbers').hidden = signedOut;
    $('signin').hidden = !signedOut;
    $('btnTop').setAttribute('aria-pressed', s && s.onTop ? 'true' : 'false');

    const sw = v && v.session, ww = v && v.weekly;
    const sPct = sw ? sw.pct : (hasData ? 0 : null);
    const wPct = ww ? ww.pct : null;
    const sLeft = sPct === null ? null : Math.max(0, Math.round(100 - sPct));

    // Tea level.
    let tea = signedOut ? 0 : (sLeft === null ? 0 : sLeft * 0.88);
    if (holdTea !== null) tea = holdTea;
    if (tea !== lastTea) { $('tea').style.height = tea.toFixed(1) + '%'; $('bubbles').style.height = tea.toFixed(1) + '%'; lastTea = tea; }
    stage.classList.toggle('has-tea', tea > 0.5);
    stage.classList.toggle('pouring', pouring);

    // Mood and words.
    const worst = Math.max(sPct || 0, wPct || 0);
    let mood = signedOut ? 'asleep' : (pouring ? 'excited' : (hasData ? F.mood(worst) : 'happy'));
    setFace(mood);
    let line;
    if (pouring) line = G.LINES.excited;
    else if (msg && now < msgUntil) line = msg;
    else if (G.comboLine(combo)) line = G.comboLine(combo);
    else if (pokeIdx >= 0 && combo > 0) line = G.POKES[pokeIdx];
    else if (signedOut) line = G.LINES.signedOut;
    else if (!hasData) line = G.LINES.starting;
    else if (sw && sw.fresh && (wPct || 0) < 80) line = G.LINES.fresh;
    else if ((wPct || 0) >= 80 && (sPct || 0) < 80) line = G.LINES.weeklyLow;
    else line = G.LINES[mood];
    setLine(line);

    // Numbers.
    $('sLeft').textContent = sLeft === null ? '--' : `${sLeft}%`;
    let sub = '';
    if (pouring) sub = 'Refilling...';
    else if (!hasData) sub = '';
    else if (!sw || sw.fresh || !sw.resetsAt) sub = 'Fresh glass · starts when you chat';
    else sub = `${sw.pct >= 100 ? 'Habis! ' : ''}Next teh tarik in ${F.countdown(sw.resetsAt - now, true)}`;
    $('sSub').textContent = sub;

    const wLeft = wPct === null ? null : Math.max(0, Math.round(100 - wPct));
    $('wLeft').textContent = wLeft === null ? '--' : `${wLeft}% left`;
    for (let i = 0; i < 7; i++) {
      const fr = wLeft === null ? 0 : Math.max(0, Math.min(1, wLeft * 7 / 100 - i));
      const awake = G.setCup(cups[i].parts, fr);
      cups[i].svg.classList.toggle('awake', awake);
    }
    let wsub = '';
    if (ww) {
      if (ww.fresh || !ww.resetsAt) wsub = 'Full pot · starts when you chat';
      else wsub = `${ww.pct >= 100 ? 'All cups empty · ' : ''}Fresh pot ${F.when(ww.resetsAt, now)}`;
    }
    $('wSub').textContent = wsub;
    const models = (v && v.models || []).filter(m => m && m.pct !== null && m.pct !== undefined);
    $('models').hidden = !models.length;
    $('models').textContent = models.length ? 'Also: ' + models.map(m => `${m.name} ${Math.max(0, Math.round(100 - m.pct))}% left`).join(' · ') : '';

    // Sync line and live dot.
    const [text, kind] = syncText(now);
    const sy = $('sync');
    sy.textContent = text;
    sy.className = 'sync' + (kind ? ' ' + kind : '');
    const dot = $('liveDot');
    dot.classList.toggle('off', kind === 'off');
    dot.classList.toggle('warn', kind === 'warn');
    $('btnRefresh').disabled = signedOut && !(s && s.demo);

    // Combo badge.
    const cb = $('combo');
    if (combo >= 3) { cb.textContent = `×${combo}`; } else cb.classList.remove('on');

    // Tray icon follows the tea level.
    const key = `${signedOut || !hasData ? 'x' : Math.round(sLeft / 5)}`;
    if (key !== trayKey) {
      trayKey = key;
      try { window.ttm.act('tray-icon', { images: G.trayIcons(sLeft === null ? 0 : sLeft, signedOut || !hasData) }); } catch (e) { /* ignore */ }
    }
  }

  function poke() {
    if (pouring) return;
    stage.classList.remove('jiggle'); void stage.offsetWidth; stage.classList.add('jiggle');
    clearTimeout(jiggleTimer);
    jiggleTimer = setTimeout(() => stage.classList.remove('jiggle'), 600);
    if (st && st.status === 'signed-out') return;
    const now = Date.now();
    pokes = pokes.filter(t => now - t < 4000);
    pokes.push(now);
    if (pokes.length >= 10) {
      pokes = []; combo = 0; pokeIdx = -1;
      say('Okay lah... SHOWTIME!', 4000);
      window.ttm.act('start-show');
      return;
    }
    combo = pokes.length;
    pokeIdx = (pokeIdx + 1) % G.POKES.length;
    msg = null;
    const cb = $('combo');
    if (combo >= 3) { cb.classList.remove('on'); void cb.offsetWidth; cb.classList.add('on'); }
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => { combo = 0; pokeIdx = -1; render(); }, 4000);
    render();
  }

  // The session refilled: a pulling mug pours fresh teh tarik into the glass.
  function playTarik() {
    if (pouring) return;
    holdTea = lastTea;
    pouring = true;
    render();
    setTimeout(() => { holdTea = null; render(); }, 400);
    clearTimeout(pourTimer);
    pourTimer = setTimeout(() => { pouring = false; render(); }, 2700);
  }

  stage.addEventListener('click', poke);
  card.addEventListener('mouseenter', () => window.ttm.act('hover'));
  $('btnRefresh').addEventListener('click', () => window.ttm.act('refresh'));
  $('btnHide').addEventListener('click', () => window.ttm.act('hide'));
  $('btnTop').addEventListener('click', () => window.ttm.act('on-top'));
  $('btnMenu').addEventListener('click', () => window.ttm.act('menu'));
  $('btnSignIn').addEventListener('click', () => window.ttm.act('sign-in'));
  $('btnKey').addEventListener('click', () => {
    const f = $('keyForm');
    f.hidden = !f.hidden;
    $('btnKey').setAttribute('aria-expanded', String(!f.hidden));
    if (!f.hidden) $('keyInput').focus();
  });
  $('keyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('keyInput');
    $('keyMsg').textContent = 'Checking...';
    const r = await window.ttm.sessionKey(input.value);
    input.value = '';
    $('keyMsg').textContent = r && r.ok ? 'Signed in!' : ((r && r.msg) || "That didn't work.");
  });

  // Keep the window just as tall as the card, so its empty corners don't block clicks underneath.
  let lastH = 0;
  new ResizeObserver(() => {
    const h = Math.ceil(card.getBoundingClientRect().height) + 26;
    if (Math.abs(h - lastH) > 1) { lastH = h; window.ttm.act('size', { h }); }
  }).observe(card);

  window.ttm.onState(s => { st = s; render(); });
  window.ttm.onTarik(playTarik);
  window.ttm.onShowOver(() => say('Show over! Back to work lah.', 8000));
  window.ttm.getState().then(s => { if (s) { st = s; render(); } });
  setInterval(render, 1000);
  render();
})();
