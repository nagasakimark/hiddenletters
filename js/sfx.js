/* Sound effects and a small looping background tune, all synthesised (no audio files). */
(function () {
  'use strict';
  let ac = null, master, sfxG, musG, noise, timer = null, nextT = 0, step = 0;
  const st = { sound: true, music: true };
  const hz = (semi) => 261.63 * Math.pow(2, semi / 12);               // semitones above middle C

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = .9; master.connect(ac.destination);
      sfxG = ac.createGain(); sfxG.connect(master);
      musG = ac.createGain(); musG.gain.value = 0; musG.connect(master);
      noise = ac.createBuffer(1, ac.sampleRate * .3, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startMusic();
    } catch (e) { ac = null; }
    return ac;
  }

  function tone(f, d, type, v, delay, dest, to) {
    if (!ac) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v || .1, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(dest || sfxG); o.start(t); o.stop(t + d + .03);
  }
  function hiss(d, f0, f1, v, delay, dest) {
    if (!ac) return;
    const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; fl.type = 'bandpass'; fl.Q.value = 1.2; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + d * .3); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(dest || sfxG); s.start(t); s.stop(t + d + .02);
  }
  const on = (fn) => function () { if (st.sound && init()) fn.apply(null, arguments); };

  const SFX = {
    unlock: function () { init(); },
    click: on(() => { tone(560, .06, 'triangle', .09); tone(840, .07, 'triangle', .06, .03); }),
    tap: on(() => { tone(700, .09, 'sine', .1, 0, null, 1100); }),
    good: on((streak) => {
      const b = 523.25 * Math.pow(2, Math.min(streak || 0, 8) * 2 / 12);
      [1, 1.25, 1.5, 2].forEach((m, i) => tone(b * m, .16, 'sine', .11, i * .06));
      tone(b * 4, .25, 'triangle', .04, .2);
    }),
    pop: on(() => { tone(500, .08, 'sine', .12, 0, null, 1000); }),
    bad: on(() => { tone(220, .2, 'square', .045, 0, null, 120); }),
    lock: on(() => { tone(330, .35, 'sawtooth', .04, 0, null, 140); hiss(.5, 6000, 900, .06); }),
    whoosh: on(() => { hiss(.45, 400, 3000, .09); }),
    star: on((i) => { const b = 659.25 * Math.pow(2, i * 3 / 12); tone(b, .3, 'triangle', .12); tone(b * 2, .3, 'sine', .05, .02); }),
    win: on(() => { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(hz(s + 12), .22, 'triangle', .1, i * .09)); }),
    set(k, v) { st[k] = v; if (k === 'music') applyMusic(); },
    get(k) { return st[k]; }
  };

  /* ---- music: C - Am - F - G, bass + arpeggio + hats ---- */
  const BARS = [{ r: 0, q: [0, 4, 7] }, { r: -3, q: [0, 3, 7] }, { r: -7, q: [0, 4, 7] }, { r: -5, q: [0, 4, 7] }];
  const ARP = [0, 1, 2, 1, 0, 1, 2, 1];
  const DUR = 60 / 112 / 2;
  function sched(s, t) {
    const bar = BARS[(s >> 3) & 3], k = s & 7;
    const at = (t - ac.currentTime);
    if ([0, 3, 4, 7].includes(k)) tone(hz(bar.r - 12), DUR * 1.6, 'triangle', .1, at, musG);
    const iv = bar.q[ARP[k]] + (k === 6 && (s >> 3) % 2 ? 12 : 0);
    tone(hz(bar.r + iv + 12), DUR * 1.1, 'sine', .055, at, musG);
    if (k % 2) hiss(.05, 7000, 9000, .035, at, musG);
    if (k === 0 && s >= 8 && (s >> 3) % 2 === 0) tone(hz(bar.r + bar.q[2] + 24), DUR * 2.5, 'triangle', .035, at, musG);
  }
  function startMusic() {
    if (timer) return;
    nextT = ac.currentTime + .1; step = 0;
    timer = setInterval(() => {
      if (!ac || ac.state !== 'running') { nextT = Math.max(nextT, (ac ? ac.currentTime : 0) + .05); return; }
      while (nextT < ac.currentTime + .25) { if (st.music) sched(step, nextT); nextT += DUR; step = (step + 1) % 32; }
    }, 60);
    applyMusic();
  }
  function applyMusic() { if (ac) musG.gain.setTargetAtTime(st.music ? .9 : 0, ac.currentTime, .1); }
  document.addEventListener('visibilitychange', () => { if (!ac) return; document.hidden ? ac.suspend() : ac.resume(); });

  window.SFX = SFX;
})();
