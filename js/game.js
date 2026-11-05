/* Hidden Letters - find the letters hidden in each picture.
 *
 * How a turn works
 *   1. The student TAPS a place where they think a letter is hiding.
 *   2. If a letter's circle is under the tap, it is "spotted" and the student must PRESS THAT LETTER'S KEY.
 *   3. Right key = found. Wrong key / tapping empty space = a mistake.
 *
 * Anti-spam: mistakes are counted in a short window; too many too fast freezes the picture for a few
 * seconds (a bit longer each time). A key press does nothing unless a letter has just been spotted,
 * and 3 wrong keys on one spot drops the spot, so the alphabet can't be mashed either.
 *
 * Overlapping circles: a tap "spots" EVERY unfound letter whose circle is under it (a few pixels of
 * forgiveness added). The key the student types decides which one they meant. In spelling levels only
 * the letter that is next in the word counts. If two spotted circles have the same letter, the one whose
 * centre is closest to the tap wins.
 */
(function () {
  'use strict';

  const CFG = {
    mistakeWindowMs: 6000,       // look at mistakes made within this many ms ...
    mistakeLimit: 3,             // ... and freeze when there are this many
    lockMs: [3000, 5000, 8000, 12000],
    wrongKeysPerSpot: 3,         // wrong keys allowed on one spotted letter
    tapPadPx: 9,                 // forgiveness added around every circle (screen px)
    hints: 3,
    hintGlowMs: 3500,
    idleHintMs: 30000
  };

  const DATA = window.HL_DATA;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const TEACHER = params.has('teacher');           // ?teacher=1 shows every circle (press T to toggle)

  /* ---------- storage / prefs ---------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('hl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hl.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const prefs = {
    sound: LS.get('sound', true),
    voice: LS.get('voice', false),
    keypad: LS.get('keypad', null),
    order: LS.get('order', 'free')                 // alphabet levels: 'free' or 'az'
  };
  if (prefs.keypad === null) prefs.keypad = coarse;
  let progress = LS.get('progress', {});

  /* ---------- sound ---------- */
  let actx = null;
  function ac() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
  }
  function tone(f, d, type, v, delay) {
    if (!prefs.sound) return;
    const a = ac(); if (!a) return;
    const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v || 0.1, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + 0.03);
  }
  const SFX = {
    tap() { tone(660, 0.07, 'triangle', 0.07); },
    good() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'sine', 0.11, i * 0.07)); },
    bad() { tone(180, 0.18, 'square', 0.06); },
    lock() { tone(220, 0.2, 'sawtooth', 0.05); tone(165, 0.3, 'sawtooth', 0.05, 0.18); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.11, i * 0.11)); }
  };
  function say(text) {
    if (!prefs.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.85;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  /* ---------- data ---------- */
  const levels = DATA.levels;
  const byId = Object.fromEntries(levels.map((l) => [l.id, l]));
  const groupOf = Object.fromEntries(DATA.groups.map((g) => [g.id, g]));
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  /* ---------- screens ---------- */
  function show(which) {
    $('#menu').classList.toggle('hidden', which !== 'menu');
    $('#play').classList.toggle('hidden', which !== 'play');
  }

  /* ---------- menu ---------- */
  function starsHTML(n) {
    return '★'.repeat(n) + '<span class="o">' + '★'.repeat(3 - n) + '</span>';
  }
  function fmt(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function buildMenu() {
    const host = $('#menu-groups'); host.innerHTML = '';
    DATA.groups.forEach((g) => {
      const sec = document.createElement('div'); sec.className = 'group';
      sec.innerHTML = '<h2>' + g.title + '<small>' + (g.ja || '') + '</small></h2><p class="sub">' + (g.hint || '') + '</p>';
      if (g.mode === 'alphabet') {
        const p = document.createElement('div'); p.className = 'pills';
        [['free', 'Any order  すきな じゅんばん'], ['az', 'A → Z in order  A から じゅんばん']].forEach(([k, label]) => {
          const b = document.createElement('button'); b.className = 'pill' + (prefs.order === k ? ' on' : ''); b.textContent = label;
          b.onclick = () => { prefs.order = k; LS.set('order', k); p.querySelectorAll('.pill').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
          p.appendChild(b);
        });
        sec.appendChild(p);
      }
      const grid = document.createElement('div'); grid.className = 'grid';
      levels.filter((l) => l.group === g.id).forEach((l) => {
        const pr = progress[l.id];
        const b = document.createElement('button'); b.className = 'card';
        b.innerHTML = '<img loading="lazy" alt="" src="' + l.thumb + '">' +
          (pr ? '<span class="st">' + starsHTML(pr.stars) + '</span>' : '') +
          '<div class="cap"><span>' + l.title + '</span><small>' + (l.ja || '') + '</small></div>';
        b.onclick = () => startLevel(l.id);
        grid.appendChild(b);
      });
      sec.appendChild(grid); host.appendChild(sec);
    });
  }

  /* ---------- play state ---------- */
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const stage = $('#stage');
  let S = null;                                   // current game
  let dpr = 1, W = 0, H = 0, base = null;

  function startLevel(id) {
    const lv = byId[id]; if (!lv) return;
    const g = groupOf[lv.group];
    let seq = null;
    if (g.mode === 'spell') seq = lv.word.toUpperCase().replace(/[^A-Z]/g, '').split('');
    else if (prefs.order === 'az') seq = ALPHA.slice();
    S = {
      lv, g, id, seq, step: 0, found: new Set(), sel: null,
      mistakes: 0, hints: 0, hintsLeft: CFG.hints, elapsed: 0,
      recent: [], lockUntil: 0, lockCount: 0,
      fx: [], parts: [], hint: null, reveal: 0, done: false,
      lastProgress: performance.now(), lastTip: 0, teacher: TEACHER, img: null
    };
    $('#lvtitle').innerHTML = lv.title + (lv.ja ? '<small>' + lv.ja + '</small>' : '');
    $('#win').classList.add('hidden'); $('#lock').classList.add('hidden');
    $('#loading').classList.remove('hidden'); $('#loading').textContent = 'Loading…';
    cv.style.visibility = 'hidden';
    show('play'); syncToggles(); buildKeypad(); renderGoal(); updateHint();
    msg('Look for the hidden letters! Tap one when you see it.', 'info', 'かくれた もじを さがして タップ！');
    const img = new Image();
    img.onload = () => { if (!S || S.id !== id) return; S.img = img; $('#loading').classList.add('hidden'); cv.style.visibility = 'visible'; layout(); };
    img.onerror = () => { $('#loading').textContent = 'Could not load the picture. Check your connection.'; };
    img.src = lv.image;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }

  function layout() {
    if (!S || !S.img) return;
    const aw = stage.clientWidth - 14, ah = stage.clientHeight - 14;
    if (aw < 50 || ah < 50) return;
    const sc = Math.min(aw / S.lv.w, ah / S.lv.h);
    W = Math.floor(S.lv.w * sc); H = Math.floor(S.lv.h * sc);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const lk = $('#lock'); lk.style.width = (W + 8) + 'px'; lk.style.height = (H + 8) + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height;
    const b = base.getContext('2d'); b.imageSmoothingQuality = 'high';
    b.drawImage(S.img, 0, 0, base.width, base.height);
  }
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  window.addEventListener('resize', layout);

  /* ---------- goal panel ---------- */
  function renderGoal() {
    const goal = $('#goal'); if (!S) return;
    const target = S.seq ? S.seq[S.step] : null;
    if (S.g.mode === 'spell') {
      let k = 0, html = '';
      for (const ch of S.lv.word) {
        if (/[A-Za-z]/.test(ch)) {
          const cls = k < S.step ? 'done' : k === S.step ? 'now' : '';
          html += '<span class="ch ' + cls + '">' + ch + '</span>'; k++;
        } else html += '<span style="width:12px"></span>';
      }
      goal.innerHTML = '<div class="goal-t">Spell the word! <small>じゅんばんに みつけよう</small></div><div class="word">' + html + '</div>' +
        (target ? '<div class="next">Find this letter: <b>' + target + ' ' + target.toLowerCase() + '</b></div>'
                : '<div class="count">Done!</div>');
    } else {
      let t = '';
      for (const L of ALPHA) {
        const done = S.lv.letters.some((m, i) => m.l === L && S.found.has(i));
        t += '<span class="' + (done ? 'done' : (target === L ? 'now' : '')) + '">' + L + '</span>';
      }
      goal.innerHTML = '<div class="goal-t">Find all 26 letters! <small>' + (S.seq ? 'A から じゅんばんに' : 'どの じゅんばんでも OK') + '</small></div>' +
        '<div class="tracker">' + t + '</div>' +
        '<div class="count">' + S.found.size + ' / ' + S.lv.letters.length + '</div>' +
        (target ? '<div class="next">Next letter: <b>' + target + ' ' + target.toLowerCase() + '</b></div>' : '');
    }
  }

  function msg(text, kind, ja) {
    const el = $('#msg');
    el.className = kind || '';
    el.innerHTML = text + (ja ? '<small>' + ja + '</small>' : '');
    if (kind === 'bad') { void el.offsetWidth; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  }

  /* ---------- keypad / toggles ---------- */
  function buildKeypad() {
    const kp = $('#keypad');
    if (!kp.childElementCount) {
      ALPHA.forEach((L) => {
        const b = document.createElement('button'); b.textContent = L;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); ac(); handleLetter(L); });
        kp.appendChild(b);
      });
    }
    kp.classList.toggle('hidden', !prefs.keypad);
    kp.classList.toggle('idle', !(S && S.sel));
  }
  function syncToggles() {
    document.querySelectorAll('.tog').forEach((b) => b.classList.toggle('off', !prefs[b.dataset.k]));
  }
  document.querySelectorAll('.tog').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k; prefs[k] = !prefs[k]; LS.set(k, prefs[k]); syncToggles(); buildKeypad(); layout();
    if (k === 'voice' && prefs.voice) say('Hello!');
    if (k === 'sound' && prefs.sound) SFX.good();
  }));

  /* ---------- input ---------- */
  function lockedNow() { return performance.now() < (S ? S.lockUntil : 0); }

  cv.addEventListener('pointerdown', (e) => {
    if (!S || !S.img || S.done) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); ac();
    const r = cv.getBoundingClientRect();
    onTap(e.clientX - r.left - cv.clientLeft, e.clientY - r.top - cv.clientTop);
  });

  function letterFrom(e) {
    if (e.key && /^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase();
    const m = /^Key([A-Z])$/.exec(e.code || '');           // Japanese IME reports key = "Process"
    return m ? m[1] : null;
  }
  window.addEventListener('keydown', (e) => {
    if (!S || $('#play').classList.contains('hidden')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { S.sel = null; buildKeypad(); return; }
    const L = letterFrom(e);
    if (!L) return;
    e.preventDefault();
    if (e.repeat) return;                                   // holding a key down doesn't count
    if (S.teacher && L === 'T' && TEACHER && e.shiftKey) { S.teacherOn = !S.teacherOn; return; }
    ac(); handleLetter(L);
  });

  /* hit testing: every unfound circle under the tap, closest centre first */
  function ellipseD(m, x, y, pad) {
    const dx = (x - m.cx * W) / (m.rx * W + pad), dy = (y - m.cy * H) / (m.ry * H + pad);
    return dx * dx + dy * dy;
  }
  function candidatesAt(x, y, foundToo) {
    const out = [];
    S.lv.letters.forEach((m, i) => {
      if (!!S.found.has(i) !== !!foundToo) return;
      const d = ellipseD(m, x, y, CFG.tapPadPx);
      if (d <= 1) out.push({ i, d });
    });
    return out.sort((a, b) => a.d - b.d);
  }

  function onTap(x, y) {
    if (lockedNow()) return;
    let c = candidatesAt(x, y, false);
    if (!c.length) {
      if (candidatesAt(x, y, true).length) { ripple(x, y, '#2bb673'); msg('You already found that one!', 'info', 'それは みつけたよ'); return; }
      S.sel = null; buildKeypad();
      mistake(x, y);
      if (!lockedNow()) msg('Nothing here. Keep looking!', 'bad', 'ここには ないよ');
      return;
    }
    const target = S.seq ? S.seq[S.step] : null;
    if (target) {
      c = c.filter((o) => S.lv.letters[o.i].l === target);
      if (!c.length) {
        S.sel = null; buildKeypad();
        mistake(x, y);
        if (!lockedNow()) msg('Not the next one! Look for <b>' + target + '</b> first.', 'bad', 'つぎは ' + target + ' を さがそう');
        return;
      }
    }
    S.sel = { cands: c.map((o) => o.i), x, y, wrong: 0, t0: performance.now() };
    SFX.tap(); buildKeypad();
    msg(c.length > 1
      ? 'You spotted something! There may be more than one letter here. Press the key for the letter you see!'
      : 'You spotted a letter! Now press that letter on your keyboard.',
      'info', 'キーボードで おなじ もじを おそう！');
  }

  function handleLetter(L) {
    if (!S || S.done || lockedNow()) return;
    if (!S.sel) {                                           // keys only count after a letter was spotted
      const now = performance.now();
      if (now - S.lastTip > 1500) { S.lastTip = now; msg('Tap a hidden letter in the picture first!', 'info', 'さきに えを タップしてね'); }
      return;
    }
    const hits = S.sel.cands.filter((i) => S.lv.letters[i].l === L);
    if (hits.length) {
      hits.sort((a, b) => ellipseD(S.lv.letters[a], S.sel.x, S.sel.y, 0) - ellipseD(S.lv.letters[b], S.sel.x, S.sel.y, 0));
      found(hits[0]);
    } else {
      const sel = S.sel; sel.wrong++;
      mistake(sel.x, sel.y, true);                          // may freeze the screen, which also clears S.sel
      if (lockedNow()) return;
      if (sel.wrong >= CFG.wrongKeysPerSpot) {
        S.sel = null; buildKeypad();
        if (!lockedNow()) msg('Look at the shape again, then tap it to try once more.', 'bad', 'もういちど よく みて タップしてね');
      } else if (!lockedNow()) msg('Not quite! Look at the shape again.', 'bad', 'ちがうよ。かたちを よく みてね');
    }
  }

  function mistake(x, y, silent) {
    S.mistakes++;
    const now = performance.now();
    S.recent = S.recent.filter((t) => now - t < CFG.mistakeWindowMs); S.recent.push(now);
    if (!silent) ripple(x, y, '#ff6b6b');
    SFX.bad();
    if (S.recent.length >= CFG.mistakeLimit) lock();
  }
  function lock() {
    const ms = CFG.lockMs[Math.min(S.lockCount, CFG.lockMs.length - 1)];
    S.lockCount++; S.recent = []; S.sel = null; buildKeypad();
    S.lockUntil = performance.now() + ms;
    $('#lock').classList.remove('hidden');
    SFX.lock();
    msg('Too fast! Take a breath and look carefully.', 'bad', 'ゆっくり よく みてね');
  }

  function found(i) {
    const m = S.lv.letters[i];
    S.found.add(i); S.sel = null; S.lastProgress = performance.now();
    if (S.seq) S.step++;
    burst(m.cx * W, m.cy * H, 18);
    SFX.good(); say(m.l);
    renderGoal(); buildKeypad(); updateHint();
    const total = S.seq ? S.seq.length : S.lv.letters.length;
    const have = S.seq ? S.step : S.found.size;
    if (have >= total) return finish();
    msg('Yes! That is <b>' + m.l + '</b>! ' + (S.seq ? 'Next: <b>' + S.seq[S.step] + '</b>' : (total - have) + ' to go!'), 'good', 'すごい！');
  }

  function finish() {
    S.done = true; S.reveal = performance.now();
    const n = S.seq ? S.seq.length : S.lv.letters.length;
    const eff = S.mistakes + S.hints * 2;
    const stars = eff <= n * 0.3 ? 3 : eff <= n * 0.8 ? 2 : 1;
    const old = progress[S.id];
    if (!old || stars > old.stars || (stars === old.stars && S.elapsed < old.time)) {
      progress[S.id] = { stars, time: Math.round(S.elapsed) }; LS.set('progress', progress);
    }
    for (let k = 0; k < 6; k++) setTimeout(() => S && burst(Math.random() * W, Math.random() * H * 0.6, 22), k * 160);
    SFX.win(); say(S.g.mode === 'spell' ? S.lv.word : 'Great job!');
    msg('You found them all!', 'good', 'ぜんぶ みつけた！');
    const id = S.id;
    setTimeout(() => { if (!S || S.id !== id) return; showWin(stars); }, 1700);
  }

  function showWin(stars) {
    $('#win-title').textContent = S.g.mode === 'spell' ? 'You spelled it!' : 'All 26 letters found!';
    $('#win-word').textContent = S.g.mode === 'spell' ? S.lv.word : S.lv.title;
    $('#win-stars').innerHTML = starsHTML(stars);
    $('#win-stats').textContent = 'Time ' + fmt(S.elapsed) + '  ·  Mistakes ' + S.mistakes + '  ·  Hints ' + S.hints;
    const list = levels.filter((l) => l.group === S.lv.group), at = list.indexOf(S.lv);
    const nxt = list[at + 1];
    const nb = $('#win-next'); nb.classList.toggle('hidden', !nxt); nb.onclick = () => startLevel(nxt.id);
    $('#win-again').onclick = () => startLevel(S.id);
    $('#win-menu').onclick = goMenu;
    $('#win').classList.remove('hidden');
  }
  function goMenu() { S = null; history.replaceState(null, '', location.pathname + location.search); buildMenu(); show('menu'); }
  $('#back').onclick = goMenu;

  /* ---------- hints ---------- */
  function updateHint() {
    const b = $('#hint'); if (!S) return;
    b.textContent = '💡 Hint (' + S.hintsLeft + ')'; b.disabled = S.hintsLeft <= 0 || S.done;
  }
  $('#hint').onclick = () => {
    if (!S || S.done || lockedNow() || S.hintsLeft <= 0 || !S.img) return;
    const target = S.seq ? S.seq[S.step] : null;
    const pool = S.lv.letters.map((m, i) => i).filter((i) => !S.found.has(i) && (!target || S.lv.letters[i].l === target));
    if (!pool.length) return;
    const m = S.lv.letters[pool[Math.floor(Math.random() * pool.length)]];
    const a = Math.random() * Math.PI * 2, off = Math.random() * 0.06 * W;      // glow is near, not exactly on, the letter
    S.hint = { x: m.cx * W + Math.cos(a) * off, y: m.cy * H + Math.sin(a) * off, r: Math.max(0.13 * W, m.rx * W + 30), t0: performance.now() };
    S.hints++; S.hintsLeft--; updateHint();
    msg('A letter is hiding in the glow!', 'info', 'ひかっている ところに あるよ');
  };

  /* ---------- effects ---------- */
  function ripple(x, y, color) { S.fx.push({ x, y, color, t0: performance.now(), dur: 500 }); }
  function burst(x, y, n) {
    const cols = ['#ffd23f', '#ff6b6b', '#2fa8e6', '#2bb673', '#ff9f43'];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 200;
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.9 + Math.random() * 0.6, t: 0, c: cols[k % cols.length], s: 4 + Math.random() * 5 });
    }
  }

  /* ---------- drawing ---------- */
  function ell(m) { ctx.beginPath(); ctx.ellipse(m.cx * W, m.cy * H, Math.max(m.rx * W, 7), Math.max(m.ry * H, 7), 0, 0, Math.PI * 2); }
  function badge(text, x, y, bg, fg) {
    ctx.font = '900 18px ' + getComputedStyle(document.body).fontFamily;
    const w = ctx.measureText(text).width + 14, h = 24;
    ctx.fillStyle = bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 8); else ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill();
    ctx.fillStyle = fg || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25); last = now;
    if (!S || !S.img || !base || $('#play').classList.contains('hidden')) return;
    if (!S.done) {
      S.elapsed += dt; $('#time').textContent = fmt(S.elapsed);
      $('#hint').classList.toggle('pulse', S.hintsLeft > 0 && now - S.lastProgress > CFG.idleHintMs);
    }
    // lock overlay
    const left = S.lockUntil - now;
    if (left > 0) $('#lock-num').textContent = Math.ceil(left / 1000);
    else if (!$('#lock').classList.contains('hidden')) { $('#lock').classList.add('hidden'); msg('Ready! Look carefully and tap a letter.', 'info', 'もういちど さがそう'); }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // found letters
    S.lv.letters.forEach((m, i) => {
      if (!S.found.has(i)) return;
      ctx.lineWidth = 4; ctx.strokeStyle = '#2bb673'; ctx.fillStyle = 'rgba(43,182,115,.14)';
      ell(m); ctx.fill(); ctx.stroke();
      badge(m.l, m.cx * W, m.cy * H - Math.max(m.ry * H, 7) - 4, '#2bb673');
    });
    // end-of-level reveal: show the ones that were never needed too
    if (S.reveal) {
      const a = Math.min(1, (now - S.reveal) / 600);
      ctx.globalAlpha = a;
      S.lv.letters.forEach((m, i) => {
        if (S.found.has(i)) return;
        ctx.lineWidth = 3; ctx.strokeStyle = '#ff9f43'; ell(m); ctx.stroke();
        badge(m.l, m.cx * W, m.cy * H - Math.max(m.ry * H, 7) - 4, '#ff9f43');
      });
      ctx.globalAlpha = 1;
    }
    // teacher view
    if (S.teacher && S.teacherOn && !S.reveal) {
      S.lv.letters.forEach((m, i) => {
        if (S.found.has(i)) return;
        ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#d100d1'; ell(m); ctx.stroke(); ctx.setLineDash([]);
        badge(m.l, m.cx * W, m.cy * H, '#d100d1');
      });
    }
    // spotted letter(s)
    if (S.sel) {
      const p = 0.5 + 0.5 * Math.sin(now / 160);
      S.sel.cands.forEach((i) => {
        const m = S.lv.letters[i];
        ctx.setLineDash([10, 6]); ctx.lineDashOffset = -now / 30; ctx.lineWidth = 4 + p * 2; ctx.strokeStyle = '#ffb300';
        ell(m); ctx.fillStyle = 'rgba(255,210,63,.18)'; ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        badge('?', m.cx * W, m.cy * H - Math.max(m.ry * H, 7) - 4, '#ffb300', '#5a4300');
      });
    }
    // hint glow
    if (S.hint) {
      const k = (now - S.hint.t0) / CFG.hintGlowMs;
      if (k >= 1) S.hint = null; else {
        const h = S.hint, g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
        g.addColorStop(0, 'rgba(255,230,90,' + 0.55 * (1 - k) + ')'); g.addColorStop(1, 'rgba(255,230,90,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // ripples
    S.fx = S.fx.filter((f) => now - f.t0 < f.dur);
    S.fx.forEach((f) => {
      const k = (now - f.t0) / f.dur;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(f.x, f.y, 8 + k * 34, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    });
    // confetti
    S.parts = S.parts.filter((p) => p.t < p.life);
    S.parts.forEach((p) => {
      p.t += dt; p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s);
    });
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);

  /* ---------- boot ---------- */
  syncToggles(); buildMenu();
  const want = params.get('level') || location.hash.slice(1);
  if (want && byId[want]) startLevel(want); else show('menu');
  if (TEACHER) { window.HL = { get S() { return S; }, levels, CFG, startLevel, handleLetter, onTap, get size() { return { W, H }; } }; }
})();
