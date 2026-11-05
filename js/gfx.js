/* Drawing helpers: cartoon outlines, bevelled buttons, stars, icons and the mascot. Everything is canvas paths. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const C = {
    out: '#4a2a14',                       // warm brown used for every outline instead of black
    sun: '#ffc933', sunD: '#d99200', sunL: '#ffe48a',
    tom: '#ff5a4d', tomD: '#c23a30',
    sky: '#35b6f0', skyD: '#1a7fb5', skyL: '#c4ecff',
    grass: '#5bc84b', grassD: '#2f8f2a',
    ora: '#ff9a2e', oraD: '#c96a00',
    cream: '#fff4d6', creamD: '#eed79b', white: '#ffffff', gray: '#c9bfae'
  };
  const FONT = '"Lilita One","Hiragino Maru Gothic ProN","Yu Gothic UI",Meiryo,"Noto Sans JP",sans-serif';
  const JA = '"Hiragino Maru Gothic ProN","Yu Gothic UI",Meiryo,"Noto Sans JP",sans-serif';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3),
    inOut: (t) => { t = clamp(t, 0, 1); return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    outBack: (t) => { t = clamp(t, 0, 1) - 1; return t * t * (2.70158 * t + 1.70158) + 1; },
    outBounce: (t) => {
      t = clamp(t, 0, 1);
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + .75; }
      if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + .9375; }
      t -= 2.625 / 2.75; return 7.5625 * t * t + .984375;
    }
  };

  function hex(h) { if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; if (h[0] === 'r') return h.match(/[\d.]+/g).slice(0, 3).map(Number); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mix(a, b, t) {
    const A = hex(a), B = hex(b);
    return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',') + ')';
  }

  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  /* Outlined display text (the "flash game" look). o: out, ow, sh, shc, font, align, base, weight */
  function text(c, str, x, y, size, fill, o) {
    o = o || {};
    c.save();
    c.font = (o.weight ? o.weight + ' ' : '') + size + 'px ' + (o.font || FONT);
    c.textAlign = o.align || 'center'; c.textBaseline = o.base || 'middle';
    c.lineJoin = 'round'; c.miterLimit = 2;
    const out = o.out === undefined ? C.out : o.out, ow = o.ow || size * 0.2;
    if (o.sh) {
      c.fillStyle = c.strokeStyle = o.shc || 'rgba(74,42,20,.35)'; c.lineWidth = ow;
      if (out) c.strokeText(str, x, y + o.sh);
      c.fillText(str, x, y + o.sh);
    }
    if (out) { c.strokeStyle = out; c.lineWidth = ow; c.strokeText(str, x, y); }
    c.fillStyle = fill; c.fillText(str, x, y);
    c.restore();
  }
  function jaText(c, str, x, y, size, fill, o) {          // plain Japanese text (no outline unless asked)
    o = Object.assign({ font: JA, weight: 'bold', out: null }, o || {});
    text(c, str, x, y, size, fill, o);
  }
  function measure(c, str, size, font, weight) {
    c.save(); c.font = (weight ? weight + ' ' : '') + size + 'px ' + (font || FONT);
    const w = c.measureText(str).width; c.restore(); return w;
  }
  function wrap(c, str, maxW, size, font, weight) {
    c.save(); c.font = (weight ? weight + ' ' : '') + size + 'px ' + (font || FONT);
    const lines = []; let line = '';
    const tokens = /\s/.test(str) ? str.split(/(\s+)/) : Array.from(str);
    for (const t of tokens) {
      if (c.measureText(line + t).width > maxW && line) { lines.push(line.trim()); line = t.trim() ? t : ''; }
      else line += t;
    }
    if (line.trim()) lines.push(line.trim());
    c.restore(); return lines;
  }

  /* chunky bevelled button body */
  function bevel(c, x, y, w, h, col, colD, o) {
    o = o || {};
    const r = o.r !== undefined ? o.r : h * 0.3, d = o.press ? 2 : (o.depth || Math.max(4, h * 0.1)), lw = o.lw || Math.max(3, h * 0.07);
    const top = o.press ? y + d * 0.8 : y;
    c.save(); c.lineJoin = 'round';
    c.fillStyle = 'rgba(74,42,20,.28)'; rr(c, x + 2, y + d + 5, w, h, r); c.fill();
    rr(c, x, y + d, w, h, r); c.fillStyle = colD; c.fill(); c.lineWidth = lw; c.strokeStyle = C.out; c.stroke();
    rr(c, x, top, w, h, r);
    const g = c.createLinearGradient(0, top, 0, top + h); g.addColorStop(0, mix(col, '#ffffff', .35)); g.addColorStop(.45, col); g.addColorStop(1, mix(col, colD, .25));
    c.fillStyle = g; c.fill(); c.stroke();
    c.beginPath(); rr(c, x + h * .1, top + h * .08, w - h * .2, h * .36, r * .7); c.fillStyle = 'rgba(255,255,255,.3)'; c.fill();
    c.restore();
  }

  function star(c, cx, cy, R, o) {
    o = o || {};
    c.save(); c.translate(cx, cy); c.rotate(o.rot || 0); c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * .52 : R;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    if (o.empty) { c.fillStyle = '#d9cdb8'; }
    else { const g = c.createLinearGradient(0, -R, 0, R); g.addColorStop(0, '#fff2a0'); g.addColorStop(.5, C.sun); g.addColorStop(1, C.ora); c.fillStyle = g; }
    c.fill(); c.lineWidth = Math.max(2, R * .18); c.strokeStyle = C.out; c.stroke();
    if (!o.empty) { c.beginPath(); c.arc(-R * .28, -R * .22, R * .13, 0, TAU); c.fillStyle = 'rgba(255,255,255,.85)'; c.fill(); }
    c.restore();
  }

  /* ---- icons: drawn centred on (0,0) in a box of size s ---- */
  const I = {
    home(c, s) { c.beginPath(); c.moveTo(0, -s * .42); c.lineTo(s * .46, 0); c.lineTo(s * .32, 0); c.lineTo(s * .32, s * .4); c.lineTo(-s * .32, s * .4); c.lineTo(-s * .32, 0); c.lineTo(-s * .46, 0); c.closePath(); fillStroke(c, '#fff', s); c.beginPath(); c.rect(-s * .1, s * .12, s * .2, s * .28); fillStroke(c, C.sun, s); },
    play(c, s) { c.beginPath(); c.moveTo(-s * .26, -s * .38); c.lineTo(s * .4, 0); c.lineTo(-s * .26, s * .38); c.closePath(); fillStroke(c, '#fff', s); },
    next(c, s) { c.beginPath(); c.moveTo(-s * .34, -s * .36); c.lineTo(s * .3, 0); c.lineTo(-s * .34, s * .36); c.closePath(); fillStroke(c, '#fff', s); },
    left(c, s) { c.beginPath(); c.moveTo(s * .3, -s * .4); c.lineTo(-s * .3, 0); c.lineTo(s * .3, s * .4); c.closePath(); fillStroke(c, '#fff', s); },
    right(c, s) { c.beginPath(); c.moveTo(-s * .3, -s * .4); c.lineTo(s * .3, 0); c.lineTo(-s * .3, s * .4); c.closePath(); fillStroke(c, '#fff', s); },
    sound(c, s, on) {
      c.beginPath(); c.moveTo(-s * .4, -s * .14); c.lineTo(-s * .18, -s * .14); c.lineTo(s * .06, -s * .36); c.lineTo(s * .06, s * .36); c.lineTo(-s * .18, s * .14); c.lineTo(-s * .4, s * .14); c.closePath(); fillStroke(c, '#fff', s);
      c.lineCap = 'round';
      if (on) { [0.2, 0.38].forEach((r, i) => { c.beginPath(); c.arc(s * .06, 0, s * (.2 + i * .17), -.9, .9); c.lineWidth = s * .1; c.strokeStyle = C.out; c.stroke(); c.lineWidth = s * .05; c.strokeStyle = '#fff'; c.stroke(); }); }
      else slash(c, s);
    },
    music(c, s, on) {
      c.beginPath(); c.ellipse(-s * .14, s * .26, s * .17, s * .13, -.3, 0, TAU); fillStroke(c, '#fff', s);
      c.beginPath(); c.rect(s * .0, -s * .38, s * .09, s * .64); fillStroke(c, '#fff', s);
      c.beginPath(); c.moveTo(s * .09, -s * .38); c.quadraticCurveTo(s * .42, -s * .3, s * .3, -s * .02); c.lineTo(s * .09, -s * .12); c.closePath(); fillStroke(c, '#fff', s);
      if (!on) slash(c, s);
    },
    keys(c, s) {
      rr(c, -s * .46, -s * .28, s * .92, s * .56, s * .1); fillStroke(c, '#fff', s);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) { c.beginPath(); c.rect(-s * .36 + k * s * .19, -s * .17 + r * s * .15, s * .12, s * .09); c.fillStyle = C.skyD; c.fill(); }
      c.beginPath(); c.rect(-s * .24, s * .08, s * .48, s * .09); c.fillStyle = C.skyD; c.fill();
    },
    bulb(c, s) {
      c.beginPath(); c.arc(0, -s * .1, s * .3, 0, TAU); fillStroke(c, C.sunL, s);
      rr(c, -s * .15, s * .16, s * .3, s * .2, s * .05); fillStroke(c, '#fff', s);
      c.lineCap = 'round'; c.strokeStyle = C.out; c.lineWidth = s * .07;
      [[-.5, -.1], [.5, -.1], [-.36, -.42], [.36, -.42], [0, -.58]].forEach(([x, y]) => { c.beginPath(); c.moveTo(x * s * .82, y * s * .82); c.lineTo(x * s, y * s); c.stroke(); });
    },
    refresh(c, s) {
      c.lineCap = 'round'; c.lineWidth = s * .2; c.strokeStyle = C.out; c.beginPath(); c.arc(0, 0, s * .28, -2.5, 1.9); c.stroke();
      c.lineWidth = s * .1; c.strokeStyle = '#fff'; c.stroke();
      c.beginPath(); c.moveTo(s * .08, s * .0); c.lineTo(s * .44, s * .0); c.lineTo(s * .26, s * .3); c.closePath(); fillStroke(c, '#fff', s * .8);
    },
    clock(c, s) {
      c.beginPath(); c.arc(0, 0, s * .4, 0, TAU); fillStroke(c, '#fff', s);
      c.lineCap = 'round'; c.strokeStyle = C.out; c.lineWidth = s * .09; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -s * .24); c.moveTo(0, 0); c.lineTo(s * .17, s * .08); c.stroke();
    },
    snow(c, s) {
      c.lineCap = 'round'; c.strokeStyle = '#fff'; c.lineWidth = s * .09;
      for (let i = 0; i < 3; i++) { c.save(); c.rotate(i * Math.PI / 3); c.beginPath(); c.moveTo(0, -s * .45); c.lineTo(0, s * .45); c.moveTo(-s * .12, -s * .32); c.lineTo(0, -s * .22); c.lineTo(s * .12, -s * .32); c.moveTo(-s * .12, s * .32); c.lineTo(0, s * .22); c.lineTo(s * .12, s * .32); c.stroke(); c.restore(); }
    },
    question(c, s) { text(c, '?', 0, s * .03, s * .95, '#fff', { ow: s * .2 }); }
  };
  function fillStroke(c, fill, s) { c.fillStyle = fill; c.fill(); c.lineJoin = 'round'; c.lineWidth = Math.max(2, s * .09); c.strokeStyle = C.out; c.stroke(); }
  function slash(c, s) { c.lineCap = 'round'; c.beginPath(); c.moveTo(-s * .42, -s * .42); c.lineTo(s * .42, s * .42); c.lineWidth = s * .2; c.strokeStyle = C.out; c.stroke(); c.lineWidth = s * .1; c.strokeStyle = C.tom; c.stroke(); }
  function icon(c, name, x, y, s, arg) { c.save(); c.translate(x, y); I[name](c, s, arg); c.restore(); }

  /* ---- scenery ---- */
  function sunburst(c, cx, cy, R, n, rot, fill) {
    c.fillStyle = fill;
    for (let i = 0; i < n; i += 2) {
      const a0 = rot + i * TAU / n, a1 = rot + (i + 1) * TAU / n;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); c.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); c.closePath(); c.fill();
    }
  }
  function cloud(c, x, y, s, a) {
    c.save(); c.globalAlpha = a === undefined ? .95 : a; c.fillStyle = '#fff';
    c.beginPath(); c.arc(x, y, s * .5, 0, TAU); c.arc(x + s * .5, y - s * .18, s * .62, 0, TAU); c.arc(x + s * 1.1, y, s * .5, 0, TAU); c.rect(x, y, s * 1.1, s * .5); c.fill();
    c.restore();
  }
  function hills(c, W, H, t, u) {
    const layers = [{ y: H - 150 * u, a: 22 * u, f: .006, col: '#8fdc6e', sp: .25 }, { y: H - 84 * u, a: 18 * u, f: .009, col: C.grass, sp: .5 }];
    layers.forEach((L, k) => {
      c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W + 10; x += 10) c.lineTo(x, L.y + Math.sin(x * L.f + k * 2 + t * .0) * L.a);
      c.lineTo(W, H); c.closePath(); c.fillStyle = L.col; c.fill();
      c.lineWidth = 4 * u; c.strokeStyle = C.out; c.lineJoin = 'round'; c.beginPath();
      for (let x = 0; x <= W + 10; x += 10) { const y = L.y + Math.sin(x * L.f + k * 2) * L.a; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    });
  }

  /* ---- Lenny, the magnifying-glass mascot ----
     o: mood ('idle'|'happy'|'sad'|'cold'|'think'), t seconds, look {x,y} (-1..1), sq squash 0..1, tilt radians */
  function lenny(c, x, y, r, o) {
    o = o || {};
    const t = o.t || 0, mood = o.mood || 'idle', look = o.look || { x: 0, y: 0 }, sq = o.sq || 0;
    c.save(); c.translate(x, y + Math.sin(t * 2.4) * r * .04 + (mood === 'cold' ? Math.sin(t * 40) * r * .02 : 0));
    c.rotate((o.tilt || 0) + (mood === 'cold' ? Math.sin(t * 38) * .03 : 0));
    c.scale(1 + sq * .14, 1 - sq * .14);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.fillStyle = 'rgba(74,42,20,.22)'; c.beginPath(); c.ellipse(r * .3, r * 1.25, r * 1.1, r * .22, 0, 0, TAU); c.fill();
    // handle
    c.save(); c.rotate(-Math.PI / 4);
    const hw = r * .4, h0 = r * .8, h1 = r * 2;
    rr(c, -hw / 2, h0, hw, h1 - h0, hw * .5); c.fillStyle = C.ora; c.fill(); c.lineWidth = r * .13; c.strokeStyle = C.out; c.stroke();
    rr(c, -hw * .22, h0 + r * .12, hw * .2, h1 - h0 - r * .3, hw * .1); c.fillStyle = 'rgba(255,255,255,.45)'; c.fill();
    rr(c, -hw / 2, h0 + r * .02, hw, r * .22, r * .06); c.fillStyle = C.oraD; c.fill(); c.stroke();
    c.restore();
    // rim
    const g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, C.sunL); g.addColorStop(.5, C.sun); g.addColorStop(1, C.sunD);
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = g; c.fill(); c.lineWidth = r * .14; c.strokeStyle = C.out; c.stroke();
    // glass
    const gg = c.createRadialGradient(-r * .25, -r * .3, r * .1, 0, 0, r * .8);
    gg.addColorStop(0, '#ffffff'); gg.addColorStop(1, mood === 'cold' ? '#a9dcff' : C.skyL);
    c.beginPath(); c.arc(0, 0, r * .76, 0, TAU); c.fillStyle = gg; c.fill(); c.lineWidth = r * .07; c.stroke();
    // eyes
    const ex = r * .27, ey = -r * .1, ink = C.out;
    c.lineWidth = r * .07;
    [-1, 1].forEach((s) => {
      const X = s * ex;
      if (mood === 'happy') { c.beginPath(); c.arc(X, ey + r * .08, r * .15, Math.PI * 1.08, Math.PI * 1.92); c.strokeStyle = ink; c.lineWidth = r * .08; c.stroke(); }
      else if (mood === 'cold') { c.strokeStyle = ink; c.lineWidth = r * .07; c.beginPath(); c.moveTo(X - s * r * .13, ey - r * .1); c.lineTo(X + s * r * .1, ey); c.lineTo(X - s * r * .13, ey + r * .1); c.stroke(); }
      else {
        c.beginPath(); c.ellipse(X, ey, r * .17, r * .23, 0, 0, TAU); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = ink; c.lineWidth = r * .06; c.stroke();
        const px = X + look.x * r * .07, py = ey + (mood === 'sad' ? r * .05 : 0) + look.y * r * .09;
        c.beginPath(); c.arc(px, py, r * .095, 0, TAU); c.fillStyle = ink; c.fill();
        c.beginPath(); c.arc(px - r * .03, py - r * .035, r * .03, 0, TAU); c.fillStyle = '#fff'; c.fill();
      }
      if (mood === 'sad') { c.beginPath(); c.moveTo(X - s * r * .17, ey - r * .3 + s * r * .06); c.lineTo(X + s * r * .17, ey - r * .3 - s * r * .06); c.strokeStyle = ink; c.lineWidth = r * .06; c.stroke(); }
    });
    // cheeks
    c.fillStyle = 'rgba(255,90,77,.4)';
    [-1, 1].forEach((s) => { c.beginPath(); c.ellipse(s * r * .45, r * .17, r * .1, r * .065, 0, 0, TAU); c.fill(); });
    // mouth
    c.strokeStyle = ink; c.lineWidth = r * .07;
    const my = r * .27;
    if (mood === 'happy') {
      c.beginPath(); c.moveTo(-r * .2, my - r * .03); c.quadraticCurveTo(0, my + r * .3, r * .2, my - r * .03); c.closePath(); c.fillStyle = C.tomD; c.fill(); c.stroke();
      c.beginPath(); c.ellipse(0, my + r * .1, r * .08, r * .05, 0, 0, TAU); c.fillStyle = '#ff8a80'; c.fill();
    } else if (mood === 'sad') { c.beginPath(); c.arc(0, my + r * .2, r * .15, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
    else if (mood === 'cold') { c.beginPath(); for (let i = 0; i <= 6; i++) c.lineTo(-r * .21 + i * r * .07, my + (i % 2 ? r * .04 : -r * .02)); c.stroke(); }
    else if (mood === 'think') { c.beginPath(); c.ellipse(r * .05, my + r * .03, r * .06, r * .08, 0, 0, TAU); c.stroke(); }
    else { c.beginPath(); c.arc(0, my - r * .06, r * .19, .2, Math.PI - .2); c.stroke(); }
    // shine
    c.beginPath(); c.arc(0, 0, r * .6, Math.PI * 1.08, Math.PI * 1.45); c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = r * .08; c.stroke();
    if (mood === 'cold') { c.beginPath(); c.arc(0, 0, r * .76, 0, TAU); c.fillStyle = 'rgba(120,200,255,.28)'; c.fill(); }
    c.restore();
  }

  /* small magnifier used as the mouse pointer: hot spot is the centre of the lens */
  function pointer(c, x, y, s, down) {
    c.save(); c.translate(x, y); c.scale(down ? .88 : 1, down ? .88 : 1); c.lineJoin = 'round'; c.lineCap = 'round';
    c.save(); c.rotate(-Math.PI / 4); rr(c, -s * .13, s * .62, s * .26, s * .6, s * .1); c.fillStyle = C.ora; c.fill(); c.lineWidth = s * .1; c.strokeStyle = C.out; c.stroke(); c.restore();
    c.beginPath(); c.arc(0, 0, s * .62, 0, TAU); c.fillStyle = 'rgba(196,236,255,.35)'; c.fill();
    c.lineWidth = s * .2; c.strokeStyle = C.out; c.stroke();
    c.lineWidth = s * .1; c.strokeStyle = C.sun; c.stroke();
    c.beginPath(); c.arc(0, 0, s * .4, Math.PI * 1.1, Math.PI * 1.45); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = s * .07; c.stroke();
    c.restore();
  }

  window.G = { C, FONT, JA, TAU, clamp, lerp, ease, mix, rr, text, jaText, measure, wrap, bevel, star, icon, sunburst, cloud, hills, lenny, pointer };
})();
