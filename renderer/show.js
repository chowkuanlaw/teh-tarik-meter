'use strict';
/*
 * The easter egg (poke the glass 10 times in 4 seconds): a full-screen show.
 * 1 s intro, 2 s joget, then a whole teh tarik made start to finish:
 * bancuh teh, susu pekat, three pulls, into the glass, and a bow. About 16 seconds,
 * with a music-box chime made on the spot (no sound files).
 */
(function () {
  if (!window.ttm || window.ttm.view !== 'show') return;
  const G = window.TTGlass, I = window.TTI18n;
  let lang = 'en';
  const t = k => I.t(lang, k);
  const $ = id => document.getElementById(id);
  const show = $('show');
  show.hidden = false;
  document.body.style.background = '#1E1611';

  const PHASES = ['intro', 'dance', 'brew', 'milk', 'pull', 'serve', 'bow'];
  const ENDS = [1000, 3000, 5500, 7500, 12000, 14500, 16500];
  const cap = phase => t('show.' + phase).split('|');
  const TEA = ['#C8874E', '#DDA26B'];

  // Scenery.
  for (let j = 0; j < 16; j++) {
    const i = document.createElement('i');
    i.style.background = j % 2 === 0 ? '#2F8F83' : '#F3DEC0';
    i.style.animationDelay = `${((j % 4) * 0.15).toFixed(2)}s`;
    $('tiles').appendChild(i);
  }
  const colors = ['#E5436B', '#F3DEC0', '#2F8F83', '#C8874E', '#7EC8E3', '#F28CA3'];
  for (let j = 0; j < 24; j++) {
    const i = document.createElement('i');
    i.style.left = `${(j * 53) % 100}%`;
    i.style.width = `${8 + (j % 3) * 3}px`;
    i.style.height = `${10 + (j % 4) * 3}px`;
    i.style.background = colors[j % 6];
    i.style.animationDuration = `${(2.6 + (j % 5) * 0.4).toFixed(1)}s`;
    i.style.animationDelay = `${(-((j * 0.37) % 3)).toFixed(2)}s`;
    $('confetti').appendChild(i);
  }
  const mugA = $('mugA'), mugB = $('mugB');
  const foamA = G.drawMug(mugA.querySelector('svg')), foamB = G.drawMug(mugB.querySelector('svg'));
  const steps = ['Bancuh', 'Susu', 'Tarik', 'Siap'].map(label => {
    const s = document.createElement('span');
    s.textContent = label;
    $('steps').appendChild(s);
    return { s, label };
  });

  // Fit the 560 x 660 stage to the screen.
  function fit() {
    const k = Math.min(window.innerWidth / 560, window.innerHeight / 680, 2);
    $('scaler').style.transform = `scale(${k.toFixed(3)})`;
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- music ---------- */
  let ctx = null, master = null, muted = false;
  function startMusic() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.2;
      master.connect(ctx.destination);
      const t0 = ctx.currentTime + 0.05;
      const bell = (time, f, len, vol) => {
        for (const [mul, g] of [[1, 1], [2.76, 0.25], [5.4, 0.08]]) {
          const o = ctx.createOscillator(), gn = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f * mul;
          gn.gain.setValueAtTime(0.0001, time);
          gn.gain.exponentialRampToValueAtTime(vol * g, time + 0.01);
          gn.gain.exponentialRampToValueAtTime(0.0001, time + len);
          o.connect(gn); gn.connect(master); o.start(time); o.stop(time + len + 0.05);
        }
      };
      const bass = (time, f) => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        gn.gain.setValueAtTime(0.0001, time);
        gn.gain.exponentialRampToValueAtTime(0.35, time + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);
        o.connect(gn); gn.connect(master); o.start(time); o.stop(time + 0.5);
      };
      const len = 0.5;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const whoosh = time => {
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(500, time); bp.frequency.exponentialRampToValueAtTime(2400, time + len);
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0.0001, time);
        gn.gain.exponentialRampToValueAtTime(0.35, time + 0.12);
        gn.gain.exponentialRampToValueAtTime(0.0001, time + len);
        src.connect(bp); bp.connect(gn); gn.connect(master); src.start(time); src.stop(time + len);
      };
      const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568 };
      const melody = ['E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'A5', 'G5', 'E5', null];
      const basses = [130.81, 98, 110, 98];
      for (let i = 0; i * 0.2 < 14.4; i++) {
        const time = t0 + i * 0.2, n = melody[i % 16];
        if (n) bell(time, N[n], 1.1, 0.5);
        if (i % 4 === 0) bass(time, basses[(i / 4) % 4]);
      }
      [3.0, 5.5, 7.5, 12.0].forEach(s => { bell(t0 + s, N.C6, 1.4, 0.6); bell(t0 + s + 0.08, N.E6, 1.4, 0.4); });
      [7.85, 9.35, 10.85].forEach(s => whoosh(t0 + s));
      ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, j) => bell(t0 + 14.5 + j * 0.09, N[n], 2.2, 0.55));
    } catch (e) { ctx = null; }
  }
  function setMuted(m) {
    muted = m;
    $('soundLabel').textContent = t(m ? 'show.soundOff' : 'show.soundOn');
    $('soundWaves').setAttribute('d', m ? 'M17 9l5 6M22 9l-5 6' : 'M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13');
    $('btnSound').setAttribute('aria-pressed', String(m));
    if (ctx && master) {
      try { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(m ? 0 : 0.2, t, 0.05); } catch (e) { /* ignore */ }
    }
  }
  function stopMusic() {
    if (!ctx) return;
    try { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + 0.3); } catch (e) { /* ignore */ }
    const c = ctx; ctx = null;
    setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 400);
  }

  /* ---------- the show ---------- */
  let t0 = 0, iv = 0, lastPhase = -1, lastCount = -1, lastPull = -1, done = false;

  function place(m, foamEl, o) {
    m.style.left = o.l + 'px';
    m.style.top = o.t + 'px';
    m.style.transform = `rotate(${o.r || 0}deg)`;
    m.className = 'mug' + (o.cls ? ' ' + o.cls : '');
    foamEl.setAttribute('ry', (o.foam || 0).toFixed(1));
    foamEl.setAttribute('opacity', o.foam > 0 ? '1' : '0');
  }
  function prop(id, on) {
    const n = $(id);
    if (on && !n.classList.contains('on')) n.classList.add('on');
    if (!on) n.classList.remove('on');
  }
  function popText(n, text) { n.textContent = text; n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }

  function frame() {
    const t = Date.now() - t0;
    if (t >= ENDS[ENDS.length - 1]) { finish(); return; }
    let i = 0;
    while (i < PHASES.length - 1 && t >= ENDS[i]) i++;
    const phase = PHASES[i];
    const lt = t - (i === 0 ? 0 : ENDS[i - 1]);

    if (i !== lastPhase) {
      lastPhase = i;
      const [c1, c2] = cap(phase);
      $('capTitle').textContent = c1;
      $('capSub').textContent = c2 || '';
      const capEl = $('caption').firstElementChild;
      capEl.classList.remove('pop'); void capEl.offsetWidth; capEl.classList.add('pop');
      show.classList.toggle('lights', phase === 'intro' || phase === 'dance' || phase === 'bow');
      show.classList.toggle('dancing', phase === 'dance');
      show.classList.toggle('party', phase === 'dance' || phase === 'bow');
      prop('big', phase === 'intro' || phase === 'dance' || phase === 'bow');
      $('big').classList.toggle('dance', phase === 'dance');
      $('big').classList.toggle('bowing', phase === 'bow');
      prop('sock', phase === 'brew');
      prop('can', phase === 'milk');
      prop('small', phase === 'serve');
      const order = ['brew', 'milk', 'pull', 'serve'], cur = order.indexOf(phase);
      steps.forEach((st, j) => {
        const state = phase === 'bow' || (cur >= 0 && j < cur) ? 'done' : (j === cur ? 'now' : '');
        st.s.className = state;
        st.s.textContent = (state === 'done' ? '✓ ' : '') + st.label;
      });
    }

    // Countdown during the joget.
    const count = phase === 'dance' ? Math.max(1, Math.ceil((ENDS[1] - t) / 1000)) : 0;
    if (count !== lastCount) { lastCount = count; if (count) popText($('count'), String(count)); else $('count').textContent = ''; }

    // Mugs and streams.
    let a = { l: 12, t: 300, foam: 0 }, b = { l: 284, t: 300, foam: 0 }, stream = null;
    if (phase === 'dance' || phase === 'bow') { a.cls = 'dance'; b.cls = 'dance2'; if (phase === 'bow') { a.foam = 10; b.foam = 10; } }
    if (phase === 'brew' || phase === 'milk') {
      a = { l: 70, t: 330, foam: phase === 'milk' ? 3 : 0 };
      b = { l: 250, t: 330, foam: 0 };
      if (phase === 'brew' && lt > 500 && lt < 2300) stream = { l: 99, t: 205, w: 6, h: 128, c: ['#6B3A1E', '#8A4E2A'] };
      if (phase === 'milk' && lt > 500 && lt < 1800) stream = { l: 102, t: 222, w: 8, h: 112, c: ['#FFF4DC', '#F3E6CB'] };
    }
    let pull = -1;
    if (phase === 'pull') {
      pull = Math.min(2, Math.floor(lt / 1500));
      const loc = lt - pull * 1500;
      const high = { l: 150, t: 40, r: -40 }, low = { l: 118, t: 330, r: 0 };
      const fh = 4 + pull * 3, fl = Math.min(12, fh + (loc > 350 ? Math.min(1, (loc - 350) / 1000) * 3 : 0));
      if (pull % 2 === 0) { a = Object.assign({}, high, { foam: fh }); b = Object.assign({}, low, { foam: fl }); }
      else { b = Object.assign({}, high, { foam: fh }); a = Object.assign({}, low, { foam: fl }); }
      if (loc > 350 && loc < 1350) stream = { l: 148, t: 78, w: 7, h: 266, c: TEA };
    }
    if (pull !== lastPull) { lastPull = pull; if (pull >= 0) popText($('tarikpop'), `Tarik! ×${pull + 1}`); else $('tarikpop').textContent = ''; }
    if (phase === 'serve') {
      a = { l: 20, t: 330, foam: 6 };
      b = { l: 176, t: 24, r: -40, foam: 12 };
      if (lt > 400 && lt < 2100) stream = { l: 174, t: 62, w: 7, h: 228, c: TEA };
      const fill = Math.max(0, Math.min(1, (lt - 400) / 1700)) * 92;
      const p = G.teaPolys(fill);
      $('smallTea').setAttribute('points', p.tea);
      $('smallFoam').setAttribute('points', p.foam);
    }
    place(mugA, foamA, a);
    place(mugB, foamB, b);
    const ss = $('sstream');
    if (stream) {
      const was = ss.classList.contains('on');
      Object.assign(ss.style, { left: stream.l + 'px', top: stream.t + 'px', width: stream.w + 'px', height: stream.h + 'px', background: `repeating-linear-gradient(180deg, ${stream.c[0]} 0 10px, ${stream.c[1]} 10px 20px)` });
      if (!was) ss.classList.add('on');
    } else ss.classList.remove('on');
  }

  function finish() {
    if (done) return;
    done = true;
    clearInterval(iv);
    stopMusic();
    setTimeout(() => window.ttm.act('show-done'), 350);
  }

  $('btnSkip').addEventListener('click', finish);
  $('btnSound').addEventListener('click', () => { setMuted(!muted); window.ttm.act('mute', { value: muted }); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') finish(); });

  window.ttm.getState().then(s => {
    lang = (s && s.settings && s.settings.lang) || 'en';
    document.documentElement.lang = lang;
    $('btnSkip').textContent = t('show.skip');
    setMuted(!!(s && s.settings && s.settings.sound === false));
    t0 = Date.now();
    startMusic();
    frame();
    iv = setInterval(frame, 50);
  });
})();
