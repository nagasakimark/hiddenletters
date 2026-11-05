/* Hidden Letters - find the letters hidden in each picture.
 *
 * Everything on screen is drawn on one canvas (menus included).
 *
 * How a turn works
 *   1. The student TAPS a place where they think a letter is hiding.
 *   2. If a letter's circle is under the tap it is "spotted" (Lenny's lens zooms in on it) and the student
 *      must PRESS THAT LETTER'S KEY.
 *   3. Right key = found. Wrong key / tapping empty space = a mistake.
 *
 * Anti-spam: mistakes are counted in a short window; too many too fast freezes the picture for a few
 * seconds (longer each time). A key does nothing unless a letter has just been spotted, and 3 wrong keys on
 * one spot drops it, so the alphabet can't be mashed either.
 *
 * Overlapping circles: a tap spots EVERY unfound letter whose circle is under it (plus a little forgiveness).
 * The key the student types decides which one they meant. In spelling levels only the next letter of the word
 * counts. If two spotted circles carry the same letter, the one whose centre is closest to the tap wins.
 */
(function () {
  'use strict';
  const { C, FONT, JA, TAU, clamp, lerp, ease, mix, rr, text, jaText, measure, wrap, bevel, star, icon, sunburst, cloud, hills, lenny, pointer } = G;

  const CFG = {
    mistakeWindowMs: 6000,       // look at mistakes made within this many ms ...
    mistakeLimit: 3,             // ... and freeze when there are this many
    lockMs: [3000, 5000, 8000, 12000],
    wrongKeysPerSpot: 3,         // wrong keys allowed on one spotted letter
    tapPadPx: 9,                 // forgiveness added around every circle (screen px)
    hints: 3,
    hintGlowMs: 3500,
    idleHintMs: 30000,
    lensZoom: 2.2
  };

  const DATA = window.HL_DATA;
  const levels = DATA.levels;
  const byId = Object.fromEntries(levels.map((l) => [l.id, l]));
  const groupOf = Object.fromEntries(DATA.groups.map((g) => [g.id, g]));
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const params = new URLSearchParams(location.search);
  const TEACHER = params.has('teacher');                // ?teacher=1: Shift+T shows every circle

  /* ---------- storage ---------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('hl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hl.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const prefs = { sound: LS.get('sound', true), music: LS.get('music', true), keypad: LS.get('keypad', null), order: LS.get('order', 'free') };
  if (prefs.keypad === null) prefs.keypad = coarse;
  let progress = LS.get('progress', {});
  SFX.set('sound', prefs.sound); SFX.set('music', prefs.music);

  /* ---------- canvas / globals ---------- */
  const cv = document.getElementById('cv'), c = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, u = 1, portrait = false;
  let now = 0, T = 0, last = 0, dt = 0;
  let scene = 'title', ts = 0, overlay = null, tr = null;
  let S = null;                                            // current play state
  let hits = [], hover = null, pressed = null;
  const anim = {};
  const ptr = { x: -999, y: -999, type: 'mouse', down: false };
  const thumbs = {};
  let selTab = LS.get('tab', 'months'), selPage = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    portrait = H > W * 1.05;
    u = portrait ? Math.min(W / 460, H / 800) : Math.min(W / 1000, H / 560);
    u = Math.max(u, .5);
  }
  window.addEventListener('resize', resize); resize();

  /* ---------- buttons / hit areas ---------- */
  function hitAt(x, y) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (h.round) { const r = Math.min(h.w, h.h) / 2; if (Math.hypot(x - h.x - h.w / 2, y - h.y - h.h / 2) <= r) return h; }
      else if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }
  function addHit(id, x, y, w, h, onClick, round) { hits.push({ id, x, y, w, h, onClick, round }); }
  function animOf(id) { return anim[id] || (anim[id] = { s: 1 }); }

  /* chunky button. o: col, colD, round, draw(c,cx,cy,w,h), onClick, disabled, pulse */
  function button(id, x, y, w, h, o) {
    const a = animOf(id), down = pressed === id, hot = hover === id && !down;
    const tgt = down ? .92 : hot ? 1.07 : 1;
    a.s += (tgt - a.s) * .35;
    const pulse = o.pulse ? 1 + Math.sin(T * 5) * .04 : 1;
    c.save(); c.translate(x + w / 2, y + h / 2); c.scale(a.s * pulse, a.s * pulse);
    if (o.disabled) c.globalAlpha = .45;
    bevel(c, -w / 2, -h / 2, w, h, o.col || C.grass, o.colD || C.grassD, { r: o.round ? Math.min(w, h) / 2 : undefined, press: down });
    if (o.draw) o.draw(c, 0, down ? 2 : 0, w, h);
    c.restore();
    if (!o.disabled) addHit(id, x, y, w, h, o.onClick, o.round);
  }
  function roundBtn(id, cx, cy, d, col, colD, drawIcon, onClick, extra) {
    button(id, cx - d / 2, cy - d / 2, d, d, Object.assign({ col, colD, round: true, onClick, draw: (cc, x, y) => drawIcon(cc, x, y, d) }, extra || {}));
  }

  /* ---------- transitions ---------- */
  function go(to, cx, cy, setup) {
    if (tr) return;
    SFX.whoosh();
    tr = { t0: now, dur: 820, cx: cx === undefined ? W / 2 : cx, cy: cy === undefined ? H / 2 : cy, swapped: false, setup: () => { overlay = null; if (to) { scene = to; ts = now; } if (setup) setup(); } };
  }
  function drawIris() {
    if (!tr) return;
    const p = (now - tr.t0) / tr.dur, R = Math.hypot(W, H);
    let r;
    if (p < .5) r = R * (1 - ease.inOut(p * 2));
    else { if (!tr.swapped) { tr.swapped = true; tr.setup(); } r = R * ease.inOut((p - .5) * 2); }
    if (p >= 1) { tr = null; return; }
    c.save(); c.beginPath(); c.rect(0, 0, W, H); c.arc(tr.cx, tr.cy, Math.max(r, 0), 0, TAU, true);
    c.fillStyle = C.out; c.fill('evenodd'); c.restore();
  }

  /* ---------- scenery ---------- */
  const floaters = Array.from({ length: 16 }, (_, i) => ({ ch: ALPHA[(i * 7) % 26], x: Math.random(), y: Math.random(), s: 28 + Math.random() * 44, v: 5 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - .5) * .4 }));
  function drawFloaters(alpha) {
    c.save(); c.globalAlpha = alpha;
    floaters.forEach((f) => {
      f.y -= f.v * dt / H * 1.2; f.r += f.vr * dt; if (f.y < -.1) { f.y = 1.1; f.x = Math.random(); }
      c.save(); c.translate(f.x * W, f.y * H); c.rotate(f.r * .3);
      text(c, f.ch, 0, 0, f.s * u, '#fff', { out: null });
      c.restore();
    });
    c.restore();
  }
  function bgSky(top, bot) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bot); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  function bgDots() {
    const s = 64 * u, off = (T * 10) % (s * 2);
    c.fillStyle = 'rgba(255,255,255,.14)';
    for (let r = -2; r * s < H + s * 2; r++) for (let q = -2; q * s * 1 < W + s * 2; q++) {
      c.beginPath(); c.arc(q * s + (r % 2 ? s / 2 : 0) + off, r * s + off * .5, s * .17, 0, TAU); c.fill();
    }
  }
  function drawClouds() {
    [[.1, .12, 70, 14], [.55, .08, 54, 10], [.8, .2, 80, 18], [.3, .27, 46, 8]].forEach(([bx, by, s, sp], i) => {
      const x = ((bx * W + T * sp * u) % (W + 300 * u)) - 150 * u;
      cloud(c, x, by * H, s * u, .92);
    });
  }

  /* ---------- tiny helpers used by several screens ---------- */
  function pill(x, y, w, h, fill) { rr(c, x, y, w, h, h / 2); c.fillStyle = fill || '#fff'; c.fill(); c.lineWidth = 3 * u; c.strokeStyle = C.out; c.stroke(); }
  function fmt(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function starRow(cx, cy, R, n, total) {
    for (let i = 0; i < 3; i++) star(c, cx + (i - 1) * R * 2.3, cy - (i === 1 ? R * .25 : 0), R, { empty: i >= n, rot: (i - 1) * .12 });
  }
  function toggles(rightX, y, d, withKeys) {
    const gap = 8 * u; let x = rightX - d / 2;
    if (withKeys) { roundBtn('t:keys', x, y, d, prefs.keypad ? C.sky : C.gray, prefs.keypad ? C.skyD : '#9d9382', (cc, px, py) => icon(cc, 'keys', px, py, d * .72), () => { prefs.keypad = !prefs.keypad; LS.set('keypad', prefs.keypad); SFX.click(); }); x -= d + gap; }
    roundBtn('t:music', x, y, d, prefs.music ? C.sky : C.gray, prefs.music ? C.skyD : '#9d9382', (cc, px, py) => icon(cc, 'music', px, py, d * .72, prefs.music), () => { prefs.music = !prefs.music; LS.set('music', prefs.music); SFX.set('music', prefs.music); SFX.click(); });
    x -= d + gap;
    roundBtn('t:sound', x, y, d, prefs.sound ? C.sky : C.gray, prefs.sound ? C.skyD : '#9d9382', (cc, px, py) => icon(cc, 'sound', px, py, d * .72, prefs.sound), () => { prefs.sound = !prefs.sound; LS.set('sound', prefs.sound); SFX.set('sound', prefs.sound); SFX.click(); });
  }

  /* ================================================================== TITLE */
  const LOGO = ['Hidden', 'Letters'];
  const LOGO_COL = [C.tom, C.ora, C.sun, C.grass, C.sky, C.tom, C.ora];
  let titleSq = 0;

  function drawTitle() {
    bgSky('#52c6fb', '#e6f8ff');
    sunburst(c, W * (portrait ? .5 : .5), H * .6, Math.hypot(W, H), 26, T * .07, 'rgba(255,255,255,.3)');
    drawClouds(); drawFloaters(.22); hills(c, W, H, T, u);
    // flowers on the front hill
    for (let i = 0; i < 9; i++) {
      const x = (i + .5) * W / 9 + Math.sin(i * 5) * 20 * u, y = H - 40 * u - (i % 3) * 14 * u, s = 9 * u, sw = Math.sin(T * 2 + i) * .08;
      c.save(); c.translate(x, y); c.rotate(sw); c.strokeStyle = C.grassD; c.lineWidth = 3 * u; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 18 * u); c.stroke();
      for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(Math.cos(k * TAU / 5) * s * .8, Math.sin(k * TAU / 5) * s * .8, s * .62, 0, TAU); c.fillStyle = [C.tom, '#fff', C.sun][i % 3]; c.fill(); c.lineWidth = 2 * u; c.strokeStyle = C.out; c.stroke(); }
      c.beginPath(); c.arc(0, 0, s * .5, 0, TAU); c.fillStyle = C.sun; c.fill(); c.stroke(); c.restore();
    }

    // logo
    const fs = portrait ? Math.min(W * .22, 100 * u) : Math.min(H * .2, W * .105);
    const cx = portrait ? W / 2 : W * .37, cy = portrait ? H * .2 : H * .27;
    let ci = 0;
    LOGO.forEach((line, li) => {
      const size = li ? fs * 1.12 : fs;
      const spacing = size * .02;
      const widths = Array.from(line).map((ch) => measure(c, ch, size) + spacing);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = cx - total / 2;
      const ly = cy + li * fs * .95 + (li ? fs * .05 : 0);
      Array.from(line).forEach((ch, i) => {
        const delay = (ci * .06), p = clamp(((now - ts) / 1000 - delay) / .75, 0, 1);
        const by = (1 - ease.outBounce(p)) * -(H * .7);
        const wob = p >= 1 ? Math.sin(T * 2.4 + ci * .8) * fs * .05 : 0, rot = p >= 1 ? Math.sin(T * 1.7 + ci) * .05 : (1 - p) * .6;
        const col = LOGO_COL[ci % LOGO_COL.length];
        c.save(); c.translate(x + widths[i] / 2, ly + by + wob); c.rotate(rot);
        const g = c.createLinearGradient(0, -size * .5, 0, size * .5); g.addColorStop(0, mix(col, '#ffffff', .45)); g.addColorStop(.55, col); g.addColorStop(1, mix(col, C.out, .25));
        text(c, ch, 0, 0, size, g, { sh: size * .07, ow: size * .24 });
        c.restore();
        x += widths[i]; ci++;
      });
    });
    // tagline ribbon
    const ty = cy + fs * 2.15, tw = Math.min(W * (portrait ? .86 : .5), 440 * u), th = 40 * u;
    c.save(); c.translate(cx, ty); c.rotate(-.025);
    rr(c, -tw / 2, -th / 2, tw, th, th * .4); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3.5 * u; c.strokeStyle = C.out; c.stroke();
    jaText(c, 'かくれた もじを さがそう！', 0, 2 * u, 21 * u, C.tomD);
    c.restore();

    // play button
    const bw = 230 * u, bh = 78 * u, bx = cx - bw / 2, by = ty + 38 * u;
    button('play', bx, by, bw, bh, {
      col: C.grass, colD: C.grassD, pulse: !anim.play || hover !== 'play', onClick: () => { SFX.click(); titleSq = 1; startFromTitle(); },
      draw: (cc, x, y) => { icon(cc, 'play', x - 68 * u, y, 46 * u); text(cc, 'PLAY', x + 18 * u, y + 2 * u, 44 * u, '#fff', { sh: 3 * u }); }
    });

    // Lenny
    const lr = portrait ? Math.min(W * .24, 90 * u) : Math.min(H * .21, 118 * u);
    const lx = portrait ? W * .5 : W * .8, ly2 = portrait ? H * .6 : H * .47;
    titleSq = Math.max(0, titleSq - dt * 3);
    drawLenny(lx, ly2, lr, hover === 'play' ? 'happy' : 'idle', titleSq);

    toggles(W - 12 * u, 32 * u, 46 * u, false);
    roundBtn('t:how', W - 12 * u - 3 * (46 + 8) * u + 23 * u, 32 * u, 46 * u, C.ora, C.oraD, (cc, x, y, d) => icon(cc, 'question', x, y, d * .7), () => { SFX.click(); overlay = 'how'; ts2 = now; howAfter = null; });
  }
  function startFromTitle() {
    const done = () => go('select', ptr.x, ptr.y);
    if (!LS.get('seenHow', false)) { overlay = 'how'; ts2 = now; howAfter = done; } else done();
  }

  function drawLenny(x, y, r, mood, sq, look) {
    const lk = look || { x: clamp((ptr.x - x) / (W * .4), -1, 1), y: clamp((ptr.y - y) / (H * .4), -1, 1) };
    lenny(c, x, y, r, { mood, t: T, look: lk, sq });
  }

  /* ================================================================== SELECT */
  const PER_PAGE = () => (portrait ? 6 : 8);
  function thumbFor(l) {
    let t = thumbs[l.id];
    if (!t) { t = thumbs[l.id] = new Image(); t.src = l.thumb; }
    return t.complete && t.naturalWidth ? t : null;
  }
  function drawSelect() {
    bgSky('#3dbcf4', '#a8e7ff'); bgDots(); drawFloaters(.18);
    const pad = 14 * u;
    roundBtn('home', pad + 24 * u, pad + 28 * u, 50 * u, C.tom, C.tomD, (cc, x, y, d) => icon(cc, 'home', x, y, d * .72), () => { SFX.click(); go('title', ptr.x, ptr.y); });
    toggles(W - pad, pad + 28 * u, 44 * u, false);

    // tabs
    const tabs = DATA.groups.filter((g) => g.id !== 'holidays' || levels.some((l) => l.group === 'holidays'));
    const tw = (portrait ? 150 : 200) * u, th = 56 * u, gap = 10 * u;
    const totalW = tabs.length * tw + (tabs.length - 1) * gap;
    let tx = W / 2 - totalW / 2 + (portrait ? 30 * u : 0);
    if (portrait) tx = Math.max(pad + 66 * u, tx);
    const tabY = pad + 4 * u;
    tabs.forEach((g) => {
      const on = selTab === g.id;
      button('tab:' + g.id, tx, tabY + (on ? 0 : 6 * u), tw, th - (on ? 0 : 6 * u), {
        col: on ? C.sun : C.creamD, colD: on ? C.sunD : '#b9a46a', onClick: () => { selTab = g.id; LS.set('tab', g.id); selPage = 0; SFX.click(); },
        draw: (cc, x, y) => { text(cc, g.id === 'months' ? 'Months' : g.id === 'general' ? 'A to Z' : g.title, x, y - 8 * u, 24 * u, on ? '#fff' : '#8a7348', { out: on ? C.out : null, sh: on ? 2 * u : 0 }); jaText(cc, g.id === 'months' ? 'つきの なまえ' : g.id === 'general' ? '26もじ ぜんぶ' : g.ja, x, y + 15 * u, 12 * u, on ? C.out : '#8a7348'); }
      });
      tx += tw + gap;
    });

    const g = groupOf[selTab] || DATA.groups[0];
    // order switch for the alphabet levels
    let top = tabY + th + 14 * u;
    if (g.mode === 'alphabet') {
      const sw = 150 * u, sh = 34 * u, sx = W / 2 - sw - 4 * u;
      [['free', 'Any order'], ['az', 'A to Z']].forEach(([k, label], i) => {
        const on = prefs.order === k;
        button('ord:' + k, sx + i * (sw + 8 * u), top, sw, sh, { col: on ? C.grass : C.creamD, colD: on ? C.grassD : '#b9a46a', onClick: () => { prefs.order = k; LS.set('order', k); SFX.click(); },
          draw: (cc, x, y) => text(cc, label, x, y, 18 * u, on ? '#fff' : '#8a7348', { out: on ? C.out : null }) });
      });
      top += sh + 14 * u;
    } else if (g.hint) {
      jaText(c, 'すきな えを えらんでね', W / 2, top + 8 * u, 15 * u, C.out, { alpha: 1 });
      top += 26 * u;
    }
    const list = levels.filter((l) => l.group === g.id), per = PER_PAGE(), pages = Math.max(1, Math.ceil(list.length / per));
    selPage = clamp(selPage, 0, pages - 1);
    const items = list.slice(selPage * per, selPage * per + per);
    const cols = portrait ? 2 : 4, rows = portrait ? 3 : 2;
    const ax = pad + (portrait ? 0 : 56 * u), aw = W - 2 * ax, ay = top, ah = H - top - 34 * u;
    const cw = aw / cols, ch = ah / rows;
    const m = 8 * u, capH = 42 * u;
    let pw = Math.min(cw * .86, ((ch * .9 - m - capH) / .75) + 2 * m), ph = m + (pw - 2 * m) * .75 + capH;
    items.forEach((l, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = ax + (col + .5) * cw, cy = ay + (row + .5) * ch;
      drawPolaroid(l, cx, cy, pw, ph, m, capH, i + selPage * per);
    });
    if (pages > 1) {
      for (let p = 0; p < pages; p++) { c.beginPath(); c.arc(W / 2 + (p - (pages - 1) / 2) * 22 * u, H - 18 * u, 6 * u, 0, TAU); c.fillStyle = p === selPage ? C.sun : 'rgba(255,255,255,.7)'; c.fill(); c.lineWidth = 2.5 * u; c.strokeStyle = C.out; c.stroke(); }
      const ay2 = ay + ah / 2;
      if (selPage > 0) roundBtn('pg:l', pad + 28 * u, ay2, 52 * u, C.sun, C.sunD, (cc, x, y, d) => icon(cc, 'left', x, y, d * .6), () => { selPage--; SFX.click(); });
      if (selPage < pages - 1) roundBtn('pg:r', W - pad - 28 * u, ay2, 52 * u, C.sun, C.sunD, (cc, x, y, d) => icon(cc, 'right', x, y, d * .6), () => { selPage++; SFX.click(); });
    }
  }
  function drawPolaroid(l, cx, cy, w, h, m, capH, idx) {
    const id = 'lv:' + l.id, a = animOf(id), hot = hover === id;
    a.s += ((hot ? 1.07 : 1) - a.s) * .3;
    const tilt = ((idx * 37) % 7 - 3) * .012 * (hot ? 0 : 1);
    c.save(); c.translate(cx, cy + (hot ? -4 * u : 0)); c.rotate(tilt); c.scale(a.s, a.s);
    c.fillStyle = 'rgba(74,42,20,.3)'; rr(c, -w / 2 + 3 * u, -h / 2 + 8 * u, w, h, 8 * u); c.fill();
    rr(c, -w / 2, -h / 2, w, h, 8 * u); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3.5 * u; c.strokeStyle = C.out; c.stroke();
    const iw = w - 2 * m, ih = iw * .75, ix = -w / 2 + m, iy = -h / 2 + m;
    c.save(); rr(c, ix, iy, iw, ih, 4 * u); c.clip();
    const t = thumbFor(l);
    if (t) { const sc = Math.max(iw / t.naturalWidth, ih / t.naturalHeight); c.drawImage(t, ix + (iw - t.naturalWidth * sc) / 2, iy + (ih - t.naturalHeight * sc) / 2, t.naturalWidth * sc, t.naturalHeight * sc); }
    else { c.fillStyle = C.skyL; c.fillRect(ix, iy, iw, ih); }
    c.restore(); rr(c, ix, iy, iw, ih, 4 * u); c.lineWidth = 2.5 * u; c.strokeStyle = C.out; c.stroke();
    // caption
    const capY = iy + ih + capH / 2 + 2 * u;
    text(c, l.title, ix + 2 * u, capY - (l.ja ? 8 * u : 0), Math.min(21 * u, iw / Math.max(6, l.title.length) * 1.9), C.out, { align: 'left', out: null });
    if (l.ja) jaText(c, l.ja, ix + 2 * u, capY + 10 * u, 12 * u, '#8a7348', { align: 'left' });
    const pr = progress[l.id];
    if (pr) for (let i = 0; i < 3; i++) star(c, w / 2 - m - 13 * u - (2 - i) * 24 * u + 24 * u * 0, capY + 1 * u, 9 * u, { empty: i >= pr.stars });
    // tape
    c.save(); c.translate(0, -h / 2 + 2 * u); c.rotate(((idx * 53) % 5 - 2) * .03);
    rr(c, -26 * u, -10 * u, 52 * u, 20 * u, 3 * u); c.fillStyle = 'rgba(255,214,90,.85)'; c.fill(); c.lineWidth = 2 * u; c.strokeStyle = 'rgba(74,42,20,.5)'; c.stroke();
    c.restore();
    c.restore();
    addHit(id, cx - w / 2, cy - h / 2, w, h, () => { SFX.click(); go('play', ptr.x, ptr.y, () => startLevel(l.id)); });
  }

  /* ================================================================== PLAY */
  let ts2 = 0, howAfter = null;

  function startLevel(id) {
    const lv = byId[id]; if (!lv) return;
    const g = groupOf[lv.group];
    let seq = null;
    if (g.mode === 'spell') seq = lv.word.toUpperCase().replace(/[^A-Z]/g, '').split('');
    else if (prefs.order === 'az') seq = ALPHA.slice();
    S = {
      lv, g, id, seq, step: 0, found: new Set(), sel: null, shown: new Set(), pops: {}, slotPos: {},
      mistakes: 0, hints: 0, hintsLeft: CFG.hints, elapsed: 0, streak: 0,
      recent: [], lockUntil: 0, lockCount: 0, wasLocked: false,
      fx: [], parts: [], flies: [], cheers: [], hint: null, reveal: 0, done: false, completing: false,
      lastProgress: now, lastTip: 0, teacher: TEACHER, img: null, loadErr: false, bubble: null, mood: 'idle', moodUntil: 0, sq: 0,
      shakeUntil: 0, win: null, L: null, startedAt: now
    };
    overlay = null; scene = 'play'; ts = now;
    const img = new Image();
    img.onload = () => { if (S && S.id === id) { S.img = img; say(seq ? 'Find ' + seq[0] + '!' : 'Find them all!', seq ? seq[0] + ' を さがそう！' : 'かくれた もじを さがして タップ！'); } };
    img.onerror = () => { if (S && S.id === id) S.loadErr = true; };
    img.src = lv.image;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }

  function say(en, ja, mood, ms) {
    if (!S) return;
    S.bubble = { en, ja, t0: now };
    if (mood) { S.mood = mood; S.moodUntil = now + (ms || 1600); }
    S.sq = 1;
  }
  function lockedNow() { return S && now < S.lockUntil; }

  function layoutPlay() {
    const L = {}, pad = 12 * u;
    if (!portrait) {
      const pw = Math.max(290 * u, Math.min(W * .27, 370 * u));
      L.panel = { x: W - pw - pad, y: pad, w: pw, h: H - 2 * pad };
      L.area = { x: pad, y: pad, w: W - pw - 3 * pad, h: H - 2 * pad };
    } else {
      const ph = Math.min(H * .5, 400 * u);
      L.panel = { x: pad, y: H - ph - pad, w: W - 2 * pad, h: ph };
      L.area = { x: pad, y: pad, w: W - 2 * pad, h: H - ph - 3 * pad };
    }
    const fr = 9 * u, a = L.area, sc = Math.min((a.w - 2 * fr) / S.lv.w, (a.h - 2 * fr) / S.lv.h);
    const pw2 = Math.floor(S.lv.w * sc), ph2 = Math.floor(S.lv.h * sc);
    L.fr = fr; L.pic = { x: Math.round(a.x + (a.w - pw2) / 2), y: Math.round(a.y + (a.h - ph2) / 2), w: pw2, h: ph2 };
    return L;
  }
  const sx = (nx) => S.L.pic.x + nx * S.L.pic.w, sy = (ny) => S.L.pic.y + ny * S.L.pic.h;

  /* ---- hit testing: every unfound circle under the tap, closest centre first ---- */
  function ellipseD(m, x, y, pad) {
    const p = S.L.pic, dx = (x - sx(m.cx)) / (m.rx * p.w + pad), dy = (y - sy(m.cy)) / (m.ry * p.h + pad);
    return dx * dx + dy * dy;
  }
  function candidatesAt(x, y, foundToo) {
    const out = [];
    S.lv.letters.forEach((m, i) => {
      if (!!S.found.has(i) !== !!foundToo) return;
      const d = ellipseD(m, x, y, CFG.tapPadPx * u);
      if (d <= 1) out.push({ i, d });
    });
    return out.sort((a, b) => a.d - b.d);
  }

  function tapPicture(x, y) {
    if (!S || !S.img || S.done || S.completing || lockedNow()) return;
    const p = S.L.pic;
    if (x < p.x || y < p.y || x > p.x + p.w || y > p.y + p.h) return;
    let cand = candidatesAt(x, y, false);
    if (!cand.length) {
      if (candidatesAt(x, y, true).length) { ripple(x, y, C.grass); say('Got it!', 'それは みつけたよ'); return; }
      S.sel = null; mistake(x, y);
      if (!lockedNow()) say('Oops!', 'ここには ないよ', 'sad', 1100);
      return;
    }
    const target = S.seq ? S.seq[S.step] : null;
    if (target) {
      cand = cand.filter((o) => S.lv.letters[o.i].l === target);
      if (!cand.length) { S.sel = null; mistake(x, y); if (!lockedNow()) say('Find ' + target + ' first!', 'つぎは ' + target + ' を さがそう', 'sad', 1300); return; }
    }
    S.sel = { cands: cand.map((o) => o.i), x, y, wrong: 0, t0: now };
    SFX.tap(); S.sq = 1;
    say(cand.length > 1 ? 'Which one?' : 'Press the key!', cand.length > 1 ? 'どの もじかな？ キーを おしてね' : 'おなじ もじの キーを おしてね', 'think', 60000);
  }

  function handleLetter(L) {
    if (!S || !S.img || S.done || S.completing || lockedNow()) return;
    if (!S.sel) {
      if (now - S.lastTip > 1500) { S.lastTip = now; say('Tap first!', 'さきに えを タップしてね'); }
      return;
    }
    const hitsL = S.sel.cands.filter((i) => S.lv.letters[i].l === L);
    if (hitsL.length) {
      hitsL.sort((a, b) => ellipseD(S.lv.letters[a], S.sel.x, S.sel.y, 0) - ellipseD(S.lv.letters[b], S.sel.x, S.sel.y, 0));
      found(hitsL[0]);
    } else {
      const sel = S.sel; sel.wrong++; S.shakeUntil = now + 320; sel.shakeAt = now;
      mistake(sel.x, sel.y, true);
      if (lockedNow()) return;
      if (sel.wrong >= CFG.wrongKeysPerSpot) { S.sel = null; say('Tap it again!', 'もういちど タップしてね', 'sad', 1500); }
      else say('Try again!', 'ちがうよ。よく みてね', 'sad', 1300);
    }
  }

  function mistake(x, y, silent) {
    S.mistakes++; S.streak = 0;
    S.recent = S.recent.filter((t) => now - t < CFG.mistakeWindowMs); S.recent.push(now);
    if (!silent) ripple(x, y, C.tom);
    SFX.bad();
    if (S.recent.length >= CFG.mistakeLimit) lock();
  }
  function lock() {
    const ms = CFG.lockMs[Math.min(S.lockCount, CFG.lockMs.length - 1)];
    S.lockCount++; S.recent = []; S.sel = null; S.lockUntil = now + ms; S.lockLen = ms; S.wasLocked = true;
    SFX.lock(); say('Brr!', 'ゆっくり よく みてね', 'cold', ms);
  }

  const CHEERS = ['Nice!', 'Great!', 'Yes!', 'Wow!', 'Super!', 'Cool!', 'Amazing!'];
  function found(i) {
    const m = S.lv.letters[i], p = S.L.pic;
    S.found.add(i); S.sel = null; S.lastProgress = now; S.streak++;
    const slot = S.seq ? S.step : ALPHA.indexOf(m.l);
    if (S.seq) S.step++;
    const x = sx(m.cx), y = sy(m.cy);
    S.flies.push({ ch: m.l, x0: x, y0: y, slot, t0: now, dur: 700 });
    S.cheers.push({ x, y: y - Math.max(m.ry * p.h, 10 * u) - 20 * u, txt: CHEERS[(S.streak - 1) % CHEERS.length], t0: now, rot: (Math.random() - .5) * .3, col: [C.tom, C.ora, C.grass, C.sky][S.streak % 4] });
    burst(x, y, 16);
    SFX.good(S.streak);
    const total = S.seq ? S.seq.length : S.lv.letters.length, have = S.seq ? S.step : S.found.size;
    if (have >= total) S.completing = true;
    else say('Yes! ' + m.l, 'やったね！', 'happy', 1400);
  }

  function finish() {
    S.done = true; S.completing = false; S.reveal = now;
    const n = S.seq ? S.seq.length : S.lv.letters.length, eff = S.mistakes + S.hints * 2;
    const stars = eff <= n * .3 ? 3 : eff <= n * .8 ? 2 : 1;
    const old = progress[S.id];
    if (!old || stars > old.stars || (stars === old.stars && S.elapsed < old.time)) { progress[S.id] = { stars, time: Math.round(S.elapsed) }; LS.set('progress', progress); }
    S.win = { t0: now + 1300, stars, starSfx: 0, played: false };
    say('Great job!', 'ぜんぶ みつけた！', 'happy', 99999);
    for (let k = 0; k < 6; k++) setTimeout(() => S && S.L && burst(S.L.pic.x + Math.random() * S.L.pic.w, S.L.pic.y + Math.random() * S.L.pic.h * .6, 22), k * 150);
  }

  function useHint() {
    if (!S || S.done || S.completing || lockedNow() || S.hintsLeft <= 0 || !S.img) return;
    const target = S.seq ? S.seq[S.step] : null;
    const pool = S.lv.letters.map((m, i) => i).filter((i) => !S.found.has(i) && (!target || S.lv.letters[i].l === target));
    if (!pool.length) return;
    const m = S.lv.letters[pool[Math.floor(Math.random() * pool.length)]], p = S.L.pic;
    const a = Math.random() * TAU, off = Math.random() * .06 * p.w;
    S.hint = { x: sx(m.cx) + Math.cos(a) * off, y: sy(m.cy) + Math.sin(a) * off, r: Math.max(.13 * p.w, m.rx * p.w + 30), t0: now };
    S.hints++; S.hintsLeft--; SFX.pop();
    say('Look here!', 'ひかっている ところ！', 'think', 2500);
  }

  /* ---- effects ---- */
  function ripple(x, y, color) { S.fx.push({ x, y, color, t0: now, dur: 520 }); }
  function burst(x, y, n) {
    const cols = [C.sun, C.tom, C.sky, C.grass, C.ora, '#fff'];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, v = 90 + Math.random() * 260;
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 110, life: .8 + Math.random() * .7, t: 0, c: cols[k % cols.length], s: 5 + Math.random() * 6, star: k % 3 === 0, rot: Math.random() * 6 });
    }
  }

  /* ---- the play screen ---- */
  function drawPlay() {
    bgSky('#3dbcf4', '#a8e7ff'); bgDots();
    if (!S) return;
    const L = S.L = layoutPlay();
    if (!S.done && S.img) {
      S.elapsed += dt;
      if (S.wasLocked && now >= S.lockUntil) { S.wasLocked = false; say('Ready?', 'もういちど さがそう', 'idle'); }
    }
    c.save();
    if (now < S.shakeUntil) c.translate(Math.sin(now * .09) * 5 * u, 0);
    drawPicture(L);
    drawPanel(L);
    c.restore();
    if (S.win && now >= S.win.t0) overlay = overlay || 'win';
  }

  function drawPicture(L) {
    const p = L.pic, fr = L.fr;
    // frame
    c.fillStyle = 'rgba(74,42,20,.3)'; rr(c, p.x - fr + 3 * u, p.y - fr + 8 * u, p.w + 2 * fr, p.h + 2 * fr, 16 * u); c.fill();
    const g = c.createLinearGradient(0, p.y - fr, 0, p.y + p.h + fr); g.addColorStop(0, '#fff7dd'); g.addColorStop(1, C.creamD);
    rr(c, p.x - fr, p.y - fr, p.w + 2 * fr, p.h + 2 * fr, 16 * u); c.fillStyle = g; c.fill(); c.lineWidth = 4 * u; c.strokeStyle = C.out; c.stroke();
    if (!S.img) {
      rr(c, p.x, p.y, p.w, p.h, 8 * u); c.fillStyle = C.skyL; c.fill();
      drawLenny(p.x + p.w / 2, p.y + p.h / 2 - 10 * u, 46 * u, S.loadErr ? 'sad' : 'think', 0);
      jaText(c, S.loadErr ? 'えが よみこめませんでした' : 'よみこみちゅう…', p.x + p.w / 2, p.y + p.h / 2 + 80 * u, 18 * u, C.out);
      return;
    }
    c.save(); rr(c, p.x, p.y, p.w, p.h, 7 * u); c.clip();
    c.imageSmoothingQuality = 'high'; c.drawImage(S.img, p.x, p.y, p.w, p.h);
    const lw = 4 * u;
    // found letters
    S.lv.letters.forEach((m, i) => {
      if (!S.found.has(i)) return;
      ell(m); c.fillStyle = 'rgba(91,200,75,.16)'; c.fill(); c.lineWidth = lw + 2 * u; c.strokeStyle = C.out; c.stroke(); c.lineWidth = lw; c.strokeStyle = C.grass; c.stroke();
      chip(m.l, sx(m.cx), sy(m.cy) - Math.max(m.ry * p.h, 7 * u) - 2 * u, C.grass);
    });
    // end-of-level reveal of the ones nobody needed
    if (S.reveal) {
      c.globalAlpha = clamp((now - S.reveal) / 600, 0, 1);
      S.lv.letters.forEach((m, i) => { if (S.found.has(i)) return; ell(m); c.lineWidth = 3 * u; c.strokeStyle = C.ora; c.stroke(); chip(m.l, sx(m.cx), sy(m.cy) - Math.max(m.ry * p.h, 7 * u) - 2 * u, C.ora); });
      c.globalAlpha = 1;
    }
    if (S.teacher && S.teacherOn && !S.reveal) S.lv.letters.forEach((m, i) => { if (S.found.has(i)) return; c.setLineDash([6, 4]); ell(m); c.lineWidth = 2; c.strokeStyle = '#d100d1'; c.stroke(); c.setLineDash([]); chip(m.l, sx(m.cx), sy(m.cy), '#d100d1'); });
    // hint glow
    if (S.hint) {
      const k = (now - S.hint.t0) / CFG.hintGlowMs;
      if (k >= 1) S.hint = null; else {
        const h = S.hint, gr = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
        gr.addColorStop(0, 'rgba(255,236,110,' + .65 * (1 - k) + ')'); gr.addColorStop(1, 'rgba(255,236,110,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(h.x, h.y, h.r, 0, TAU); c.fill();
        for (let i = 0; i < 5; i++) { const a = T * 2 + i * TAU / 5, rr2 = h.r * .55 * (.6 + .4 * Math.sin(T * 3 + i)); star(c, h.x + Math.cos(a) * rr2, h.y + Math.sin(a) * rr2, 6 * u, { rot: T }); }
      }
    }
    // ripples
    S.fx = S.fx.filter((f) => now - f.t0 < f.dur);
    S.fx.forEach((f) => { const k = (now - f.t0) / f.dur; c.globalAlpha = 1 - k; c.strokeStyle = f.color; c.lineWidth = 5 * u * (1 - k * .5); c.beginPath(); c.arc(f.x, f.y, 8 * u + k * 38 * u, 0, TAU); c.stroke(); c.globalAlpha = 1; });
    c.restore();

    // lens on the spotted letter(s)
    if (S.sel && !S.done) drawLens();

    // frozen overlay
    if (lockedNow()) drawFrozen(p);
    // particles, flying letters, cheers
    drawParts();
    drawCheers();
  }
  function ell(m) { c.beginPath(); c.ellipse(sx(m.cx), sy(m.cy), Math.max(m.rx * S.L.pic.w, 8 * u), Math.max(m.ry * S.L.pic.h, 8 * u), 0, 0, TAU); }
  function chip(ch, x, y, col) {
    const s = 22 * u; rr(c, x - s / 2, y - s, s, s, 7 * u); c.fillStyle = col; c.fill(); c.lineWidth = 3 * u; c.strokeStyle = C.out; c.stroke();
    text(c, ch, x, y - s / 2 + 1 * u, 17 * u, '#fff', { out: null });
  }

  function drawLens() {
    const p = S.L.pic, sel = S.sel, multi = sel.cands.length > 1;
    let cx, cy, lr;
    if (multi) { cx = sel.x; cy = sel.y; lr = 62 * u; }
    else { const m = S.lv.letters[sel.cands[0]]; cx = sx(m.cx); cy = sy(m.cy); lr = clamp(Math.max(m.rx * p.w, m.ry * p.h) * 1.05 + 10 * u, 40 * u, 118 * u); }
    const pop = ease.outBack(clamp((now - sel.t0) / 260, 0, 1));
    lr *= pop;
    const shake = sel.shakeAt && now - sel.shakeAt < 320 ? Math.sin((now - sel.shakeAt) * .06) * 6 * u * (1 - (now - sel.shakeAt) / 320) : 0;
    cx += shake;
    // handle
    c.save(); c.translate(cx, cy); c.lineJoin = 'round'; c.lineCap = 'round';
    c.rotate(-Math.PI / 4); rr(c, -lr * .14, lr * .95, lr * .28, lr * .95, lr * .1); c.fillStyle = C.ora; c.fill(); c.lineWidth = lr * .09; c.strokeStyle = C.out; c.stroke(); c.restore();
    // magnified picture
    c.save(); c.beginPath(); c.arc(cx, cy, lr, 0, TAU); c.clip();
    const img = S.img, k = img.naturalWidth / p.w, z = CFG.lensZoom, srcW = (2 * lr / z) * k;
    const ox = multi ? sel.x : sx(S.lv.letters[sel.cands[0]].cx), oy = multi ? sel.y : sy(S.lv.letters[sel.cands[0]].cy);
    c.fillStyle = '#fff'; c.fillRect(cx - lr, cy - lr, 2 * lr, 2 * lr);
    c.drawImage(img, (ox - p.x) * k - srcW / 2, (oy - p.y) * k - srcW / 2, srcW, srcW, cx - lr, cy - lr, 2 * lr, 2 * lr);
    c.restore();
    // glass shine + rim
    c.beginPath(); c.arc(cx, cy, lr * .86, Math.PI * 1.1, Math.PI * 1.42); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = lr * .07; c.lineCap = 'round'; c.stroke();
    const pulse = .5 + .5 * Math.sin(now / 150);
    c.beginPath(); c.arc(cx, cy, lr, 0, TAU); c.lineWidth = lr * .2 + pulse * 2 * u; c.strokeStyle = C.out; c.stroke();
    c.lineWidth = lr * .11 + pulse * 2 * u; c.strokeStyle = C.sun; c.stroke();
    // keycap prompt
    const kx = cx + lr * .85, ky = cy - lr * .95 + Math.sin(now / 200) * 3 * u, ks = 34 * u;
    c.save(); c.translate(clamp(kx, p.x + ks, p.x + p.w - ks), clamp(ky, p.y + ks, p.y + p.h));
    bevel(c, -ks / 2, -ks / 2, ks, ks, '#fff', C.creamD, { r: 8 * u, depth: 5 * u, lw: 3 * u });
    text(c, '?', 0, 0, 24 * u, C.tom, { ow: 4 * u });
    c.restore();
  }

  function drawFrozen(p) {
    const left = S.lockUntil - now, a = clamp(left / 300, 0, 1);
    c.save(); rr(c, p.x, p.y, p.w, p.h, 7 * u); c.clip();
    c.fillStyle = 'rgba(150,215,255,' + (.55 * a) + ')'; c.fillRect(p.x, p.y, p.w, p.h);
    // icicles along the top and bottom
    c.fillStyle = 'rgba(255,255,255,' + (.92 * a) + ')'; c.strokeStyle = 'rgba(40,120,170,' + a + ')'; c.lineWidth = 2.5 * u; c.lineJoin = 'round';
    const n = Math.ceil(p.w / (46 * u));
    for (let i = 0; i < n; i++) {
      const x0 = p.x + i * p.w / n, w = p.w / n, hgt = (22 + ((i * 37) % 5) * 9) * u;
      c.beginPath(); c.moveTo(x0, p.y); c.lineTo(x0 + w, p.y); c.lineTo(x0 + w / 2, p.y + hgt); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(x0, p.y + p.h); c.lineTo(x0 + w, p.y + p.h); c.lineTo(x0 + w / 2, p.y + p.h - hgt * .7); c.closePath(); c.fill(); c.stroke();
    }
    for (let i = 0; i < 14; i++) { const fx = p.x + ((i * 97 + T * 20 * (1 + i % 3)) % p.w), fy = p.y + ((i * 61 + T * 40) % p.h); icon(c, 'snow', fx, fy, 14 * u + (i % 3) * 6 * u); }
    c.restore();
    // countdown ring
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = 52 * u, frac = clamp(left / (S.lockLen || 3000), 0, 1);
    c.save(); c.globalAlpha = a;
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 5 * u; c.strokeStyle = C.out; c.stroke();
    c.beginPath(); c.arc(cx, cy, R - 9 * u, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.lineWidth = 9 * u; c.strokeStyle = C.sky; c.lineCap = 'round'; c.stroke();
    text(c, String(Math.ceil(left / 1000)), cx, cy + 2 * u, 46 * u, C.skyD, { ow: 5 * u });
    c.restore();
    c.save(); c.globalAlpha = a; jaText(c, 'ゆっくり よく みてね', cx, cy + R + 28 * u, 22 * u, '#fff', { out: C.out, ow: 5 * u }); c.restore();
  }

  function drawParts() {
    S.parts = S.parts.filter((q) => q.t < q.life);
    S.parts.forEach((q) => {
      q.t += dt; q.vy += 520 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += dt * 8;
      c.globalAlpha = clamp(1 - q.t / q.life, 0, 1); c.fillStyle = q.c;
      if (q.star) star(c, q.x, q.y, q.s * 1.2 * u, { rot: q.rot }); else { c.save(); c.translate(q.x, q.y); c.rotate(q.rot); c.fillRect(-q.s / 2 * u, -q.s / 2 * u, q.s * u, q.s * u * .6); c.restore(); }
    });
    c.globalAlpha = 1;
    // letters flying to their tile
    S.flies = S.flies.filter((f) => {
      const k = clamp((now - f.t0) / f.dur, 0, 1), tgt = S.slotPos[f.slot] || { x: S.L.panel.x + S.L.panel.w / 2, y: S.L.panel.y + 120 * u };
      const e = ease.inOut(k), mx = (f.x0 + tgt.x) / 2, my = Math.min(f.y0, tgt.y) - 70 * u;
      const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * tgt.x, y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * tgt.y;
      const s = (1 + Math.sin(k * Math.PI) * .6) * 34 * u;
      if (k < 1) {
        if (Math.random() < .5) S.parts.push({ x, y, vx: (Math.random() - .5) * 60, vy: (Math.random() - .5) * 60, life: .4, t: 0, c: C.sun, s: 5, star: true, rot: 0 });
        text(c, f.ch, x, y, s, '#fff', { ow: s * .22, sh: 2 * u });
        return true;
      }
      S.shown.add(f.slot); S.pops[f.slot] = now; SFX.pop(); burst(tgt.x, tgt.y, 8); S.sq = 1;
      if (S.completing && !S.flies.some((o) => o !== f)) setTimeout(() => S && !S.done && finish(), 150);
      return false;
    });
  }
  function drawCheers() {
    S.cheers = S.cheers.filter((q) => now - q.t0 < 1100);
    S.cheers.forEach((q) => {
      const k = (now - q.t0) / 1100, sc = ease.outBack(clamp(k * 4, 0, 1)), a = k > .7 ? 1 - (k - .7) / .3 : 1;
      c.save(); c.globalAlpha = a; c.translate(clamp(q.x, S.L.pic.x + 70 * u, S.L.pic.x + S.L.pic.w - 70 * u), Math.max(q.y - k * 34 * u, S.L.pic.y + 24 * u)); c.rotate(q.rot); c.scale(sc, sc);
      text(c, q.txt, 0, 0, 38 * u, q.col, { sh: 3 * u, ow: 8 * u });
      c.restore();
    });
  }

  /* ---- right-hand board ---- */
  function drawPanel(L) {
    const P = L.panel, pad = 10 * u, gw = P.w - 2 * pad;
    c.fillStyle = 'rgba(74,42,20,.3)'; rr(c, P.x + 3 * u, P.y + 8 * u, P.w, P.h, 18 * u); c.fill();
    const g = c.createLinearGradient(0, P.y, 0, P.y + P.h); g.addColorStop(0, '#fff8e1'); g.addColorStop(1, '#ffe9a8');
    rr(c, P.x, P.y, P.w, P.h, 18 * u); c.fillStyle = g; c.fill(); c.lineWidth = 4 * u; c.strokeStyle = C.out; c.stroke();
    let y = P.y + pad;

    // header buttons
    const d = Math.min(42 * u, (gw - 5 * 6 * u) / 5), cy = y + d / 2;
    roundBtn('home', P.x + pad + d / 2, cy, d, C.tom, C.tomD, (cc, x, yy) => icon(cc, 'home', x, yy, d * .72), () => { SFX.click(); go('select', ptr.x, ptr.y, () => { S = null; }); });
    const hintReady = S.hintsLeft > 0 && !S.done && now - S.lastProgress > CFG.idleHintMs;
    roundBtn('hint', P.x + pad + d * 1.5 + 6 * u, cy, d, C.sun, C.sunD, (cc, x, yy) => icon(cc, 'bulb', x, yy, d * .75), useHint, { disabled: S.hintsLeft <= 0 || S.done, pulse: hintReady });
    // hint count badge
    c.beginPath(); c.arc(P.x + pad + d * 1.5 + 6 * u + d * .38, cy - d * .38, 9 * u, 0, TAU); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2.5 * u; c.strokeStyle = C.out; c.stroke();
    text(c, String(S.hintsLeft), P.x + pad + d * 1.5 + 6 * u + d * .38, cy - d * .38 + 1 * u, 12 * u, C.out, { out: null });
    toggles(P.x + P.w - pad, cy, d, true);
    y += d + 8 * u;

    // title + clock
    const rowH = 34 * u;
    const tw = measure(c, S.lv.title, 22 * u);
    const tsz = tw > gw * .62 ? 22 * u * gw * .62 / tw : 22 * u;
    text(c, S.lv.title, P.x + pad + 2 * u, y + rowH / 2, tsz, C.out, { align: 'left', out: null });
    const cw = 86 * u; pill(P.x + P.w - pad - cw, y + 2 * u, cw, rowH - 4 * u);
    icon(c, 'clock', P.x + P.w - pad - cw + 17 * u, y + rowH / 2, 22 * u);
    text(c, fmt(S.elapsed), P.x + P.w - pad - 9 * u, y + rowH / 2 + 1 * u, 20 * u, C.out, { align: 'right', out: null });
    y += rowH + 6 * u;

    // layout budget for the rest
    const k = (gw - 8 * 3 * u) / 9, kpH = prefs.keypad ? 3 * k + 2 * 3 * u + 8 * u : 0;
    const bottom = P.y + P.h - pad;
    const rest = bottom - y - kpH;
    const goalH = Math.max(rest * (prefs.keypad ? .62 : .56), 120 * u);
    drawGoal(P.x + pad, y, gw, goalH);
    y += goalH + 8 * u;
    drawMascot(P.x + pad, y, gw, bottom - kpH - y);
    if (prefs.keypad) drawKeypad(P.x + pad, bottom - kpH + 8 * u, gw, k);
  }

  function drawGoal(x, y, w, h) {
    rr(c, x, y, w, h, 14 * u); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3 * u; c.strokeStyle = C.out; c.stroke();
    const pad = 9 * u, target = S.seq ? S.seq[S.step] : null;
    let yy = y + pad;
    if (S.g.mode === 'spell') {
      const letters = Array.from(S.lv.word).filter((ch) => /[A-Za-z]/.test(ch)), n = letters.length, gap = 4 * u;
      const per = Math.min(n, Math.max(1, Math.floor((w - 2 * pad + gap) / (40 * u + gap))));
      const bsz = Math.min(46 * u, (w - 2 * pad - (per - 1) * gap) / per), bh = bsz * 1.1, rows = Math.ceil(n / per);
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / per), q = i % per, inRow = Math.min(per, n - r * per), rowW = inRow * bsz + (inRow - 1) * gap;
        const bx = x + (w - rowW) / 2 + q * (bsz + gap), by = yy + r * (bh + gap + 2 * u);
        const done = S.shown.has(i), nowT = i === S.step && !S.done, pop = S.pops[i] ? clamp((now - S.pops[i]) / 500, 0, 1) : 1;
        S.slotPos[i] = { x: bx + bsz / 2, y: by + bh / 2 };
        c.save(); c.translate(bx + bsz / 2, by + bh / 2); const sc = done ? 1 + .38 * (1 - pop) * Math.cos(pop * 11) : (nowT ? 1 + Math.sin(T * 6) * .04 : 1); c.scale(sc, sc);
        bevel(c, -bsz / 2, -bh / 2, bsz, bh, done ? C.grass : nowT ? C.sun : C.cream, done ? C.grassD : nowT ? C.sunD : C.creamD, { r: 9 * u, depth: 4 * u, lw: 3 * u });
        text(c, letters[i], 0, 1 * u, bsz * .68, done ? '#fff' : nowT ? C.out : 'rgba(138,115,72,.45)', { out: done ? C.out : null, ow: bsz * .14 });
        c.restore();
      }
      yy += rows * (bh + gap + 2 * u) + 4 * u;
    } else {
      const cols = 9, gap = 3 * u, tsz = (w - 2 * pad - (cols - 1) * gap) / cols;
      ALPHA.forEach((L2, i) => {
        const r = Math.floor(i / cols), q = i % cols, inRow = r === 2 ? 8 : cols, off = (cols - inRow) * (tsz + gap) / 2;
        const tx = x + pad + off + q * (tsz + gap), ty = yy + r * (tsz + gap);
        const done = S.shown.has(i), nowT = target === L2 && !S.done, pop = S.pops[i] ? clamp((now - S.pops[i]) / 500, 0, 1) : 1;
        S.slotPos[i] = { x: tx + tsz / 2, y: ty + tsz / 2 };
        c.save(); c.translate(tx + tsz / 2, ty + tsz / 2); const sc = done ? 1 + .45 * (1 - pop) * Math.cos(pop * 11) : (nowT ? 1.06 + Math.sin(T * 6) * .05 : 1); c.scale(sc, sc);
        rr(c, -tsz / 2, -tsz / 2, tsz, tsz, 6 * u); c.fillStyle = done ? C.grass : nowT ? C.sun : C.cream; c.fill(); c.lineWidth = 2.5 * u; c.strokeStyle = done || nowT ? C.out : 'rgba(74,42,20,.35)'; c.stroke();
        text(c, L2, 0, 1 * u, tsz * .7, done ? '#fff' : nowT ? C.out : 'rgba(138,115,72,.5)', { out: null });
        c.restore();
      });
      yy += 3 * (tsz + gap) + 4 * u;
      star(c, x + pad + 10 * u, yy + 9 * u, 9 * u);
      text(c, S.found.size + ' / ' + S.lv.letters.length, x + pad + 26 * u, yy + 10 * u, 18 * u, C.grassD, { align: 'left', out: null });
      yy += 22 * u;
    }
    // what to look for
    if (target && !S.done) {
      const ch = Math.min(y + h - yy - pad, 120 * u);
      if (ch > 34 * u) {
        const cy = yy + ch / 2;
        rr(c, x + pad, yy, w - 2 * pad, ch, 12 * u); c.fillStyle = C.sunL; c.fill(); c.lineWidth = 3 * u; c.strokeStyle = C.out; c.stroke();
        jaText(c, 'さがす もじ', x + pad + 12 * u, cy, 14 * u, C.out, { align: 'left' });
        text(c, target + ' ' + target.toLowerCase(), x + w - pad - 14 * u, cy + 2 * u, Math.min(ch * .7, 64 * u), C.tom, { align: 'right', ow: 9 * u, sh: 2 * u });
      }
    }
  }

  function drawMascot(x, y, w, h) {
    if (h < 40 * u) return;
    const r = clamp(h * .3, 22 * u, 42 * u), lx = x + r * 1.15, ly = y + h / 2 - r * .1;
    if (S.mood !== 'idle' && now > S.moodUntil && !lockedNow() && !S.done) S.mood = 'idle';
    S.sq = Math.max(0, S.sq - dt * 3.2);
    const mood = lockedNow() ? 'cold' : S.mood;
    const look = S.sel ? { x: clamp((S.sel.x - lx) / (W * .4), -1, 1), y: clamp((S.sel.y - ly) / (H * .4), -1, 1) } : null;
    drawLenny(lx, ly, r, mood, S.sq, look);
    // speech bubble
    const b = S.bubble; if (!b) return;
    const bx = lx + r * 1.55, bw = x + w - bx, bh = Math.min(h - 4 * u, 112 * u), by = y + (h - bh) / 2;
    if (bw < 70 * u) return;
    const k = ease.outBack(clamp((now - b.t0) / 260, 0, 1));
    c.save(); c.translate(bx + bw / 2, by + bh / 2); c.scale(.9 + .1 * k, .9 + .1 * k); c.translate(-bw / 2, -bh / 2);
    c.fillStyle = 'rgba(74,42,20,.22)'; rr(c, 2 * u, 5 * u, bw, bh, 14 * u); c.fill();
    c.beginPath(); c.moveTo(-r * .3, bh / 2); c.lineTo(3 * u, bh / 2 - 12 * u); c.lineTo(3 * u, bh / 2 + 12 * u); c.closePath();
    rr(c, 0, 0, bw, bh, 14 * u); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3 * u; c.strokeStyle = C.out; c.stroke();
    c.beginPath(); c.moveTo(-r * .25, bh / 2); c.lineTo(2 * u, bh / 2 - 11 * u); c.lineTo(2 * u, bh / 2 + 11 * u); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3 * u; c.stroke();
    c.fillStyle = '#fff'; c.fillRect(1.5 * u, bh / 2 - 9 * u, 3 * u, 18 * u);
    // text
    let fs = 17 * u; const maxW = bw - 18 * u;
    let enLines = b.en ? wrap(c, b.en, maxW, fs * 1.15) : [], jaLines = b.ja ? wrap(c, b.ja, maxW, 13.5 * u, JA, 'bold') : [];
    let total = enLines.length * fs * 1.15 + jaLines.length * 16 * u;
    let scale = total > bh - 14 * u ? (bh - 14 * u) / total : 1; scale = Math.max(scale, .7);
    let ty = (bh - total * scale) / 2 + (fs * 1.15 * scale) / 2;
    enLines.forEach((ln) => { text(c, ln, bw / 2, ty, fs * 1.15 * scale, C.tom, { out: null }); ty += fs * 1.15 * scale; });
    ty += (jaLines.length && enLines.length ? -2 * u : 8 * u);
    jaLines.forEach((ln) => { jaText(c, ln, bw / 2, ty + 2 * u, 13.5 * u * scale, C.out); ty += 16 * u * scale; });
    c.restore();
  }

  function drawKeypad(x, y, w, k) {
    const gap = 3 * u, idle = !S.sel;
    ALPHA.forEach((L2, i) => {
      const r = Math.floor(i / 9), q = i % 9, inRow = r === 2 ? 8 : 9, off = (9 - inRow) * (k + gap) / 2;
      const kx = x + off + q * (k + gap), ky = y + r * (k + gap);
      button('k:' + L2, kx, ky, k, k, { col: idle ? '#7fcfF3' : C.sky, colD: idle ? '#4aa0cc' : C.skyD, onClick: () => { SFX.unlock(); handleLetter(L2); },
        draw: (cc, px, py) => text(cc, L2, px, py, k * .62, '#fff', { ow: k * .13 }) });
    });
  }

  /* ================================================================== OVERLAYS */
  function drawDim(a) { c.fillStyle = 'rgba(74,42,20,' + a + ')'; c.fillRect(0, 0, W, H); }

  function drawWin() {
    const w = S.win, t = (now - w.t0) / 1000;
    drawDim(.55 * clamp(t * 4, 0, 1));
    const cw = Math.min(W * .9, 640 * u), chh = Math.min(H * .92, 400 * u), cx = W / 2, cy = H / 2;
    const k = ease.outBack(clamp(t * 2.2, 0, 1));
    c.save(); c.translate(cx, cy); c.scale(k, k);
    c.fillStyle = 'rgba(74,42,20,.35)'; rr(c, -cw / 2 + 4 * u, -chh / 2 + 10 * u, cw, chh, 26 * u); c.fill();
    const g = c.createLinearGradient(0, -chh / 2, 0, chh / 2); g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#ffe9a8');
    rr(c, -cw / 2, -chh / 2, cw, chh, 26 * u); c.fillStyle = g; c.fill(); c.lineWidth = 5 * u; c.strokeStyle = C.out; c.stroke();
    // ribbon
    const rw = cw * .72, rh = 56 * u, ry = -chh / 2 - 6 * u;
    rr(c, -rw / 2, ry - rh / 2, rw, rh, 14 * u); c.fillStyle = C.tom; c.fill(); c.lineWidth = 4 * u; c.strokeStyle = C.out; c.stroke();
    text(c, S.g.mode === 'spell' ? 'You did it!' : 'All 26!', 0, ry + 2 * u, 38 * u, '#fff', { sh: 3 * u, ow: 7 * u });
    // word
    const wy = -chh / 2 + 112 * u;
    if (S.g.mode === 'spell') {
      const letters = Array.from(S.lv.word).filter((ch) => /[A-Za-z]/.test(ch)), n = letters.length, gap = 6 * u;
      const bs = Math.min(54 * u, (cw - 60 * u - (n - 1) * gap) / n);
      letters.forEach((ch, i) => {
        const p = clamp(t - .3 - i * .08, 0, 1) / 1, sc = ease.outBack(p), bx = (i - (n - 1) / 2) * (bs + gap);
        c.save(); c.translate(bx, wy + (1 - ease.outBounce(p)) * -40 * u); c.scale(sc, sc);
        bevel(c, -bs / 2, -bs * .55, bs, bs * 1.1, [C.tom, C.ora, C.sun, C.grass, C.sky][i % 5], [C.tomD, C.oraD, C.sunD, C.grassD, C.skyD][i % 5], { r: 10 * u, depth: 5 * u });
        text(c, ch, 0, 2 * u, bs * .72, '#fff', { ow: bs * .13 });
        c.restore();
      });
    } else text(c, S.lv.title, 0, wy, 46 * u, C.sky, { sh: 3 * u, ow: 9 * u });
    // stars
    const sy2 = wy + 92 * u;
    for (let i = 0; i < 3; i++) {
      const st = 1 + i * .45, p = clamp(t - st, 0, 1);
      if (t > st && w.starSfx <= i) { w.starSfx = i + 1; if (i < w.stars) SFX.star(i); }
      const R = 36 * u, sc = i < w.stars ? ease.outBack(p) * (1 + .25 * Math.sin(p * Math.PI)) : 1;
      if (i < w.stars && p === 0) { star(c, (i - 1) * R * 2.4, sy2 - (i === 1 ? R * .3 : 0), R, { empty: true }); continue; }
      c.save(); c.translate((i - 1) * R * 2.4, sy2 - (i === 1 ? R * .3 : 0)); c.scale(sc, sc); star(c, 0, 0, R, { empty: i >= w.stars, rot: (i - 1) * .12 }); c.restore();
    }
    jaText(c, 'タイム ' + fmt(S.elapsed) + '    まちがい ' + S.mistakes + '    ヒント ' + S.hints, 0, sy2 + 62 * u, 17 * u, C.out);
    // buttons
    const list = levels.filter((l) => l.group === S.lv.group), nxt = list[list.indexOf(S.lv) + 1];
    const bh = 54 * u, by = chh / 2 - bh - 22 * u, bw = Math.min(170 * u, (cw - 60 * u) / 3);
    const lid = S.id;
    const bx0 = -(bw * 3 + 14 * u * 2) / 2;
    c.restore();
    // hit areas need un-scaled coordinates, so draw buttons after restoring (scale = 1 once the card has popped in)
    if (k >= 1) {
      const X = (i) => cx + bx0 + i * (bw + 14 * u), Y = cy + by;
      button('w:menu', X(0), Y, bw, bh, { col: C.creamD, colD: '#b9a46a', onClick: () => { SFX.click(); go('select', ptr.x, ptr.y, () => { S = null; }); }, draw: (cc, x, y) => { icon(cc, 'home', x - bw * .24, y, 30 * u); text(cc, 'Menu', x + bw * .1, y + 1 * u, 22 * u, '#fff', { sh: 2 * u }); } });
      button('w:again', X(1), Y, bw, bh, { col: C.sky, colD: C.skyD, onClick: () => { SFX.click(); go('play', ptr.x, ptr.y, () => startLevel(lid)); }, draw: (cc, x, y) => { icon(cc, 'refresh', x - bw * .26, y, 30 * u); text(cc, 'Again', x + bw * .1, y + 1 * u, 22 * u, '#fff', { sh: 2 * u }); } });
      button('w:next', X(2), Y, bw, bh, { col: C.grass, colD: C.grassD, pulse: true, disabled: !nxt, onClick: () => { SFX.click(); go('play', ptr.x, ptr.y, () => startLevel(nxt.id)); }, draw: (cc, x, y) => { text(cc, 'Next', x - bw * .08, y + 1 * u, 22 * u, '#fff', { sh: 2 * u }); icon(cc, 'next', x + bw * .26, y, 28 * u); } });
    }
    if (!w.played) { w.played = true; SFX.win(); }
  }

  function drawHow() {
    drawDim(.55 * clamp((now - ts2) / 200, 0, 1));
    const t = (now - ts2) / 1000, cw = Math.min(W * .94, 780 * u), chh = Math.min(H * .94, portrait ? 600 * u : 440 * u), cx = W / 2, cy = H / 2;
    const k = ease.outBack(clamp(t * 2.5, 0, 1));
    c.save(); c.translate(cx, cy); c.scale(k, k);
    c.fillStyle = 'rgba(74,42,20,.35)'; rr(c, -cw / 2 + 4 * u, -chh / 2 + 10 * u, cw, chh, 26 * u); c.fill();
    rr(c, -cw / 2, -chh / 2, cw, chh, 26 * u); c.fillStyle = '#fff8e1'; c.fill(); c.lineWidth = 5 * u; c.strokeStyle = C.out; c.stroke();
    const rw = cw * .5, rh = 52 * u, ry = -chh / 2 - 4 * u;
    rr(c, -rw / 2, ry - rh / 2, rw, rh, 14 * u); c.fillStyle = C.ora; c.fill(); c.lineWidth = 4 * u; c.strokeStyle = C.out; c.stroke();
    text(c, 'How to play', 0, ry + 2 * u, 34 * u, '#fff', { sh: 3 * u, ow: 7 * u });
    const colW = portrait ? cw - 40 * u : (cw - 60 * u) / 2, ph = portrait ? 140 * u : 170 * u;
    const steps = [
      { n: 1, en: 'Tap it!', ja: 'もじを みつけたら タップ！' },
      { n: 2, en: 'Press the key!', ja: 'おなじ もじの キーを おしてね！' }
    ];
    steps.forEach((s, i) => {
      const px = portrait ? 0 : (i - .5) * (colW + 20 * u), py = portrait ? -chh / 2 + 70 * u + i * 215 * u + ph / 2 : -chh / 2 + 40 * u + ph / 2 + 18 * u;
      c.save(); c.translate(px, py);
      rr(c, -colW / 2, -ph / 2, colW, ph, 16 * u); c.fillStyle = i ? '#ffe9a8' : C.skyL; c.fill(); c.lineWidth = 4 * u; c.strokeStyle = C.out; c.stroke();
      c.save(); rr(c, -colW / 2, -ph / 2, colW, ph, 16 * u); c.clip();
      if (i === 0) {
        // little picture with a camouflaged letter and a lens on it
        const g = c.createLinearGradient(0, -ph / 2, 0, ph / 2); g.addColorStop(0, '#8fdcff'); g.addColorStop(.55, '#cfeeff'); g.addColorStop(.56, '#6fd05a'); g.addColorStop(1, '#4db43f'); c.fillStyle = g; c.fillRect(-colW / 2, -ph / 2, colW, ph);
        c.save(); c.translate(colW * .12, ph * .08); c.rotate(.22); text(c, 'A', 0, 0, ph * .46, '#4db43f', { out: '#3f9d34', ow: 3 * u }); c.restore();
        const lx = colW * .12, ly = ph * .08, lr = ph * .3 * (1 + .04 * Math.sin(t * 5));
        c.save(); c.beginPath(); c.arc(lx, ly, lr, 0, TAU); c.clip(); c.fillStyle = '#fff'; c.fill(); c.translate(lx, ly); c.rotate(.22); text(c, 'A', 0, 0, ph * .46 * 1.9, '#3f9d34', { out: C.out, ow: 5 * u }); c.restore();
        c.beginPath(); c.arc(lx, ly, lr, 0, TAU); c.lineWidth = 9 * u; c.strokeStyle = C.out; c.stroke(); c.lineWidth = 5 * u; c.strokeStyle = C.sun; c.stroke();
        const tp = (t * 1.4) % 1; c.globalAlpha = 1 - tp; c.beginPath(); c.arc(lx, ly, lr + tp * 40 * u, 0, TAU); c.lineWidth = 4 * u; c.strokeStyle = C.tom; c.stroke(); c.globalAlpha = 1;
      } else {
        const press = Math.pow(Math.max(0, Math.sin(t * 4)), 3);
        c.save(); c.translate(0, 8 * u + press * 8 * u); const ks = ph * .56;
        bevel(c, -ks / 2, -ks / 2, ks, ks, '#fff', C.creamD, { r: 14 * u, depth: 10 * u - press * 7 * u, lw: 5 * u, press: press > .5 });
        text(c, 'A', 0, 2 * u, ks * .66, C.tom, { ow: ks * .12 });
        c.restore();
        for (let q = 0; q < 3; q++) star(c, (q - 1) * colW * .3, -ph * .32 + Math.sin(t * 3 + q) * 4 * u, 7 * u, { rot: t + q });
      }
      c.restore();
      c.restore();
      c.save(); c.translate(px, py + ph / 2 + 24 * u);
      c.beginPath(); c.arc(-colW / 2 + 18 * u, 0, 15 * u, 0, TAU); c.fillStyle = C.tom; c.fill(); c.lineWidth = 3 * u; c.strokeStyle = C.out; c.stroke(); text(c, String(s.n), -colW / 2 + 18 * u, 1 * u, 20 * u, '#fff', { out: null });
      text(c, s.en, -colW / 2 + 42 * u, -2 * u, 24 * u, C.out, { align: 'left', out: null });
      jaText(c, s.ja, -colW / 2 + 42 * u, 20 * u, 14 * u, '#8a7348', { align: 'left' });
      c.restore();
    });
    // extra tips in the space between the steps and the OK button
    {
      const lastPy = portrait ? -chh / 2 + 70 * u + 215 * u + ph / 2 : -chh / 2 + 40 * u + ph / 2 + 18 * u;
      const top = lastPy + ph / 2 + 50 * u, bottom = chh / 2 - 72 * u, ty = (top + bottom) / 2;
      if (bottom - top > 40 * u) {
        jaText(c, 'まちがいが おおいと、えが こおっちゃうよ。ゆっくり さがそう！', 0, ty - 11 * u, 15 * u, C.out, {});
        jaText(c, 'こまったら でんきゅうの ヒントを つかおう。', 0, ty + 12 * u, 15 * u, '#8a7348', {});
      }
    }
    c.restore();
    if (k >= 1) {
      const bw = 150 * u, bh = 54 * u;
      button('how:ok', cx - bw / 2, cy + chh / 2 - bh - 14 * u, bw, bh, { col: C.grass, colD: C.grassD, pulse: true, onClick: () => { SFX.click(); LS.set('seenHow', true); const f = howAfter; howAfter = null; overlay = null; if (f) f(); },
        draw: (cc, x, y) => text(cc, 'OK!', x, y + 1 * u, 30 * u, '#fff', { sh: 2 * u }) });
    }
  }

  /* ================================================================== INPUT */
  function setPtr(e) { const r = cv.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.type = e.pointerType || 'mouse'; }
  cv.addEventListener('pointermove', (e) => { setPtr(e); const h = tr ? null : hitAt(ptr.x, ptr.y); hover = h ? h.id : null; });
  cv.addEventListener('pointerleave', () => { ptr.x = ptr.y = -999; hover = null; });
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); SFX.unlock(); setPtr(e); ptr.down = true;
    if (tr) return;
    const h = hitAt(ptr.x, ptr.y);
    if (h) { pressed = h.id; return; }
    if (scene === 'play' && !overlay) tapPicture(ptr.x, ptr.y);
  });
  const release = (e) => {
    setPtr(e); ptr.down = false;
    const h = tr ? null : hitAt(ptr.x, ptr.y);
    if (pressed && h && h.id === pressed && h.onClick) h.onClick();
    pressed = null;
    if (ptr.type !== 'mouse') hover = null;
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { pressed = null; ptr.down = false; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  function letterFrom(e) {
    if (e.key && /^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase();
    const m = /^Key([A-Z])$/.exec(e.code || '');           // Japanese IME reports key = "Process"
    return m ? m[1] : null;
  }
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || tr) return;
    SFX.unlock();
    if (overlay === 'how' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const h = hits.find((q) => q.id === 'how:ok'); if (h) h.onClick(); return; }
    if (overlay === 'win' && e.key === 'Enter') { const h = hits.find((q) => q.id === 'w:next' && q.onClick) || hits.find((q) => q.id === 'w:menu'); if (h) h.onClick(); return; }
    if (scene === 'title' && !overlay && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); SFX.click(); titleSq = 1; startFromTitle(); return; }
    if (scene !== 'play' || overlay || !S) return;
    if (e.key === 'Escape') { S.sel = null; return; }
    const L = letterFrom(e); if (!L) return;
    e.preventDefault();
    if (e.repeat) return;                                   // holding a key down doesn't count
    if (TEACHER && e.shiftKey && L === 'T') { S.teacherOn = !S.teacherOn; return; }
    handleLetter(L);
  });

  /* ================================================================== LOOP */
  function frame(t) {
    requestAnimationFrame(frame);
    now = t; T = t / 1000; dt = Math.min((t - last) / 1000, .05); last = t;
    hits = [];
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (scene === 'title') drawTitle(); else if (scene === 'select') drawSelect(); else drawPlay();
    if (overlay) {
      hits = [];
      if (overlay === 'how') drawHow(); else if (overlay === 'win' && S && S.win) drawWin();
    }
    drawIris();
    if (ptr.type === 'mouse' && ptr.x > -100) pointer(c, ptr.x, ptr.y, 15 * u, ptr.down);
  }

  /* ---------- boot ---------- */
  const boot = () => {
    last = performance.now(); ts = last;
    const want = params.get('level') || location.hash.slice(1);
    requestAnimationFrame(frame);
    if (want && byId[want]) { requestAnimationFrame(() => startLevel(want)); }
    if (TEACHER) {
      window.HL = {
        get S() { return S; }, get scene() { return scene; }, get overlay() { return overlay; }, levels, CFG, startLevel, handleLetter, tapPicture,
        pos(i) { const m = S.lv.letters[i]; return { x: sx(m.cx), y: sy(m.cy) }; },
        hits() { return hits.map((h) => ({ id: h.id, x: h.x + h.w / 2, y: h.y + h.h / 2 })); },
        get tr() { return !!tr; }, prefs, size() { return { W, H, u }; }
      };
    }
  };
  const fontReady = (document.fonts && document.fonts.load) ? Promise.race([document.fonts.load('40px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  fontReady.then(boot, boot);
})();
