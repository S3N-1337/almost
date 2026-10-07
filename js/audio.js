/*
 * audio.js — все звуки и музыка генерируются кодом через Web Audio API.
 * Никаких внешних файлов.
 */
var Sound = (function () {
  'use strict';

  var ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  var muted = false;
  var held = false;      // игра на паузе — звук «заморожен»
  var music = null;
  var VOL = 0.9;

  // Аккордовые последовательности (сдвиг корня в полутонах, первый аккорд — минор)
  var PROGS = [[0, -4, 3, -2], [0, -2, -4, -2], [0, 3, -2, -4], [0, -4, -2, 0]];

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) {
      try { ctx = new AC(); } catch (e2) { return null; }
    }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4;
    comp.attack.value = 0.002; comp.release.value = 0.12;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = muted ? 0 : VOL; master.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = 0.4; musBus.connect(master);

    var len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // «разблокировка» звука на iOS — короткий беззвучный буфер
    try {
      var s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination); s.start(0);
    } catch (e) { }
    return ctx;
  }

  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended' && !held) { try { c.resume(); } catch (e) { } }
  }

  function ready() { return ctx && ctx.state === 'running' && !muted; }

  /* ---------- Кирпичики ---------- */
  function env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(type, f, t, dur, vol, out, f2, lp) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, 0.004, dur, vol);
    if (lp) {
      var bq = ctx.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = lp;
      o.connect(bq); bq.connect(g);
    } else o.connect(g);
    g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(t, dur, vol, type, freq, q, out, f2) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var bq = ctx.createBiquadFilter(); bq.type = type; bq.Q.value = q || 1;
    bq.frequency.setValueAtTime(freq, t);
    if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t + dur);
    var g = ctx.createGain(); env(g, t, 0.002, dur, vol);
    src.connect(bq); bq.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /* ---------- Эффекты ---------- */
  function jump() {
    if (!ready()) return;
    var t = ctx.currentTime;
    tone('square', 320, t, 0.09, 0.10, sfxBus, 760, 2800);
    tone('sine', 640, t, 0.07, 0.10, sfxBus, 1250);
  }

  function orb() {
    if (!ready()) return;
    var t = ctx.currentTime;
    tone('triangle', 880, t, 0.16, 0.20, sfxBus, 1760);
    tone('sine', 1320, t + 0.03, 0.14, 0.10, sfxBus, 2640);
  }

  function pad() {
    if (!ready()) return;
    var t = ctx.currentTime;
    tone('sine', 170, t, 0.32, 0.30, sfxBus, 950);
    noise(t, 0.2, 0.10, 'highpass', 3000, 0.7, sfxBus);
  }

  function death() {
    if (!ready()) return;
    var t = ctx.currentTime;
    noise(t, 0.45, 0.6, 'lowpass', 5000, 0.8, sfxBus, 160);
    tone('sawtooth', 260, t, 0.42, 0.22, sfxBus, 38, 1800);
    tone('square', 95, t, 0.2, 0.26, sfxBus, 45, 600);
  }

  function record() {
    if (!ready()) return;
    var t = ctx.currentTime + 0.22;
    tone('triangle', midi(84), t, 0.18, 0.16, sfxBus);
    tone('triangle', midi(91), t + 0.09, 0.3, 0.16, sfxBus);
  }

  function win() {
    if (!ready()) return;
    var t = ctx.currentTime;
    var notes = [72, 76, 79, 84, 88, 91, 96];
    for (var i = 0; i < notes.length; i++) {
      tone('triangle', midi(notes[i]), t + i * 0.065, 0.32, 0.16, sfxBus);
      tone('square', midi(notes[i]), t + i * 0.065, 0.12, 0.04, sfxBus, 0, 3000);
    }
    var tc = t + notes.length * 0.065;
    [72, 76, 79, 84].forEach(function (n) { tone('sawtooth', midi(n), tc, 1.1, 0.06, sfxBus, 0, 2400); });
    noise(tc, 0.9, 0.08, 'highpass', 6000, 0.5, sfxBus);
    tone('sine', 55, t, 0.5, 0.4, sfxBus, 40);
  }

  function click() {
    if (!ready()) return;
    var t = ctx.currentTime;
    tone('sine', 900, t, 0.05, 0.08, sfxBus, 1400);
  }

  /* ---------- Музыка: простой секвенсор ---------- */
  function kick(t, out, v) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95 * (v || 1), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.33);
  }

  function bass(t, f, dur, out) {
    var o = ctx.createOscillator(), bq = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    bq.type = 'lowpass'; bq.Q.value = 6;
    bq.frequency.setValueAtTime(1100, t); bq.frequency.exponentialRampToValueAtTime(180, t + dur);
    env(g, t, 0.005, dur, 0.22);
    o.connect(bq); bq.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function playStep(m, i, t, spb) {
    var s = i % 16, bar = Math.floor(i / 16), st = m.style, out = m.gain;
    var cr = m.prog[bar % 4];
    var tones = cr === 0 ? [0, 3, 7, 12] : [0, 4, 7, 12];

    if (s % 4 === 0) kick(t, out, 1);
    if (st >= 3 && s === 14) kick(t, out, 0.55);
    if (st >= 1 && (s === 4 || s === 12)) {
      noise(t, 0.14, 0.26, 'bandpass', 1600, 0.8, out);
      noise(t + 0.012, 0.1, 0.16, 'bandpass', 1200, 0.8, out);
    }
    if (s % 4 === 2) noise(t, 0.05, 0.10, 'highpass', 7500, 0.7, out);
    else if (st >= 2 && s % 2 === 1) noise(t, 0.03, 0.04, 'highpass', 9000, 0.7, out);

    var bassOn = st >= 2 ? (s % 4 !== 0) : (s % 4 === 2);
    if (bassOn) {
      var bn = m.root - 24 + cr + (st >= 3 && s % 8 === 6 ? 12 : 0);
      bass(t, midi(bn), spb * 1.6, out);
    }

    if (st >= 1) {
      var every = st >= 2 ? 1 : 2;
      if (s % every === 0) {
        var k = Math.floor(i / every);
        var ln = m.root + 12 + cr + tones[k % 4] + (st >= 3 && (k % 8) >= 4 ? 12 : 0);
        tone(st >= 3 ? 'sawtooth' : 'square', midi(ln), t, spb * 0.9, 0.045, out, 0, st >= 3 ? 3200 : 2400);
      }
    }
    if (st <= 1 && s === 0) {
      [0, tones[1], 7].forEach(function (n) { tone('triangle', midi(m.root + cr + n), t, spb * 15, 0.035, out); });
    }
  }

  function musicTick() {
    var m = music;
    if (!m || !ctx || ctx.state !== 'running') return;
    var spb = 60 / m.bpm / 4;
    if (m.next < ctx.currentTime - 0.1) m.next = ctx.currentTime + 0.02;
    while (m.next < ctx.currentTime + 0.12) {
      playStep(m, m.step, m.next, spb);
      m.step++;
      m.next += spb;
    }
  }

  function startMusic(def) {
    if (!ensure()) return;
    stopMusic(0.02);
    def = def || {};
    var g = ctx.createGain(); g.gain.value = 1; g.connect(musBus);
    music = {
      bpm: def.bpm || 128, root: def.root || 57, style: def.style || 0,
      prog: PROGS[(def.prog || 0) % PROGS.length],
      gain: g, next: ctx.currentTime + 0.03, step: 0, timer: 0
    };
    musicTick();
    music.timer = setInterval(musicTick, 25);
  }

  function stopMusic(fade) {
    if (!music) return;
    var m = music; music = null;
    clearInterval(m.timer);
    if (!ctx) return;
    var t = ctx.currentTime;
    try {
      m.gain.gain.cancelScheduledValues(t);
      m.gain.gain.setValueAtTime(m.gain.gain.value, t);
      m.gain.gain.linearRampToValueAtTime(0.0001, t + (fade || 0.08));
    } catch (e) { }
    setTimeout(function () { try { m.gain.disconnect(); } catch (e) { } }, 600);
  }

  /* ---------- Управление ---------- */
  function setMuted(b) {
    muted = !!b;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : VOL, ctx.currentTime, 0.02);
  }

  function suspend() {
    held = true;
    if (ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) { } }
  }

  function resume() {
    held = false;
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { } }
  }

  return {
    unlock: unlock, setMuted: setMuted, isMuted: function () { return muted; },
    suspend: suspend, resume: resume,
    jump: jump, orb: orb, pad: pad, death: death, record: record, win: win, click: click,
    startMusic: startMusic, stopMusic: stopMusic
  };
})();
