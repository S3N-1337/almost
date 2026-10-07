/*
 * render.js — вся графика на Canvas.
 * Неоновое свечение рисуется один раз в маленькие картинки-спрайты,
 * а в каждом кадре они просто копируются — так держится 60 FPS даже на средних телефонах.
 */
var Render = (function () {
  'use strict';
  var P = Physics, C = P.C, T = P.T;

  var VIEW_W = 12;        // сколько клеток помещается по ширине экрана
  var PLAYER_SX = 3.2;    // где стоит игрок (клеток от левого края)
  var GROUND_K = 0.64;    // высота земли (доля высоты экрана)
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var BG = '#07050f';
  var YELLOW = '#ffe23d';

  var cv, ctx, W = 1, H = 1, dpr = 1, U = 32, gy0 = 0, safeTop = 0;
  var lv = null, color = '#00e5ff', rgb = [0, 229, 255], danger = '#ff2d55', drgb = [255, 45, 85];
  var spr = null, built = '';
  var bg = null, sun = null, skyline = null, groundTex = null, gridTex = null, beam = null;
  var parts = [], rings = [];
  var MAX_PARTS = 420;
  var shake = 0, flash = 0, flashRGB = '255,255,255';
  var camX = 0, camY = 0, ox = 0, oy = 0;
  var stars = [], deco = [];
  var popup = null, tag = null, tagX = 0;
  var trail = [];
  var clock = 0, sparkT = 0;

  /* ---------- Утилиты ---------- */
  function hexRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function sx(wx) { return (wx - camX) * U + ox; }
  function sy(wy) { return gy0 - (wy - camY) * U + oy; }

  /* ---------- Инициализация ---------- */
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d', { alpha: false });
    var r = seeded(7);
    for (var i = 0; i < 70; i++) stars.push({ x: r(), y: r() * 0.62, s: 0.6 + r() * 1.2, ph: r() * 6.3 });
    for (i = 0; i < 8; i++) deco.push({ x: r(), y: 0.08 + r() * 0.42, size: 0.35 + r() * 1.1, rot: r() * 6.3, vr: (r() - 0.5) * 0.6 });
  }

  function readSafeTop() {
    var d = document.getElementById('safe-probe');
    return d ? d.offsetHeight : 0;
  }

  function resize(cssW, cssH) {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(cssW * dpr));
    H = Math.max(1, Math.round(cssH * dpr));
    cv.width = W; cv.height = H;
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    U = W / VIEW_W;
    gy0 = Math.round(H * GROUND_K);
    safeTop = readSafeTop() * dpr;
    built = '';
    rebuild();
  }

  function setLevel(level) {
    lv = level;
    color = level.def.color || '#00e5ff';
    rgb = hexRgb(color);
    danger = level.def.danger || '#ff2d55';
    drgb = hexRgb(danger);
    parts.length = 0; rings.length = 0; trail.length = 0;
    popup = null; flash = 0; shake = 0; camY = 0;
    built = '';
    rebuild();
  }

  /* ---------- Спрайты и фоны (строятся один раз) ---------- */
  function sprite(size, padK, draw) {
    var pad = Math.ceil(size * padK);
    var c = mk(size + pad * 2, size + pad * 2);
    draw(c.getContext('2d'), pad, size);
    c.pad = pad; c.size = size;
    return c;
  }

  function tri(g, o, s, w, h, down) {
    var x0 = o + (s - w) / 2, x1 = x0 + w;
    var base = down ? o : o + s, tip = down ? o + h : o + s - h;
    g.beginPath(); g.moveTo(x0, base); g.lineTo(o + s / 2, tip); g.lineTo(x1, base); g.closePath();
  }

  function rebuild() {
    if (!lv || !ctx) return;
    var key = color + '|' + danger + '|' + W + 'x' + H;
    if (key === built) return;
    built = key;

    var s = Math.max(8, Math.round(U));
    var lw = Math.max(1.5, s * 0.075);
    spr = {};

    spr.block = sprite(s, 0.5, function (g, o, s) {
      g.shadowColor = color; g.shadowBlur = s * 0.45;
      g.fillStyle = rgba(rgb, 0.14); g.fillRect(o, o, s, s);
      g.lineWidth = lw; g.strokeStyle = color;
      g.strokeRect(o + lw / 2, o + lw / 2, s - lw, s - lw);
      g.shadowBlur = s * 0.2;
      g.strokeRect(o + lw / 2, o + lw / 2, s - lw, s - lw);
      g.shadowBlur = 0; g.globalAlpha = 0.7; g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, lw * 0.35);
      g.strokeRect(o + lw / 2, o + lw / 2, s - lw, s - lw);
      g.globalAlpha = 0.35; g.strokeStyle = color; g.lineWidth = Math.max(1, s * 0.03);
      var i = s * 0.3; g.strokeRect(o + i, o + i, s - i * 2, s - i * 2);
      g.globalAlpha = 1;
    });

    function spikeDraw(w, h, down) {
      return function (g, o, s) {
        tri(g, o, s, s * w, s * h, down);
        g.shadowColor = danger; g.shadowBlur = s * 0.5;
        g.fillStyle = rgba(drgb, 0.22); g.fill();
        g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = danger; g.stroke();
        g.shadowBlur = s * 0.15; g.lineWidth = Math.max(1, lw * 0.45); g.strokeStyle = '#ffffff'; g.stroke();
      };
    }
    spr.spike = sprite(s, 0.5, spikeDraw(0.84, 0.86, false));
    spr.ceil = sprite(s, 0.5, spikeDraw(0.84, 0.86, true));
    spr.small = sprite(s, 0.5, spikeDraw(0.62, 0.46, false));

    spr.pad = sprite(s, 0.6, function (g, o, s) {
      g.shadowColor = YELLOW; g.shadowBlur = s * 0.5;
      g.fillStyle = 'rgba(255,226,61,0.92)';
      g.beginPath(); g.ellipse(o + s / 2, o + s, s * 0.42, s * 0.2, 0, Math.PI, 0); g.closePath(); g.fill();
      g.shadowBlur = 0; g.fillStyle = '#fff8c4';
      g.beginPath(); g.ellipse(o + s / 2, o + s, s * 0.24, s * 0.08, 0, Math.PI, 0); g.closePath(); g.fill();
    });

    spr.orb = sprite(s, 0.6, function (g, o, s) {
      var cx = o + s / 2, cy = o + s / 2;
      g.shadowColor = YELLOW; g.shadowBlur = s * 0.5;
      g.strokeStyle = YELLOW; g.lineWidth = s * 0.1;
      g.beginPath(); g.arc(cx, cy, s * 0.32, 0, Math.PI * 2); g.stroke();
      g.shadowBlur = s * 0.2; g.fillStyle = '#fffbe0';
      g.beginPath(); g.arc(cx, cy, s * 0.12, 0, Math.PI * 2); g.fill();
    });

    var ps = Math.max(6, Math.round(s * C.SIZE));
    spr.player = sprite(ps, 0.6, function (g, o, s) {
      g.shadowColor = color; g.shadowBlur = s * 0.6;
      g.fillStyle = rgba(rgb, 0.6); g.fillRect(o, o, s, s);
      g.shadowBlur = s * 0.3; g.fillRect(o, o, s, s);
      g.shadowBlur = 0;
      var l = Math.max(2, s * 0.1);
      g.lineWidth = l; g.strokeStyle = '#ffffff'; g.strokeRect(o + l / 2, o + l / 2, s - l, s - l);
      var i1 = s * 0.22; g.fillStyle = BG; g.fillRect(o + i1, o + i1, s - 2 * i1, s - 2 * i1);
      var i2 = s * 0.34; g.shadowColor = '#ffffff'; g.shadowBlur = s * 0.2; g.fillStyle = '#ffffff';
      g.fillRect(o + i2, o + i2, s - 2 * i2, s - 2 * i2);
    });

    function dot(col) {
      return sprite(Math.max(3, Math.round(s * 0.26)), 0.9, function (g, o, s2) {
        g.shadowColor = col; g.shadowBlur = s2 * 1.2;
        g.fillStyle = col; g.fillRect(o, o, s2, s2);
        g.shadowBlur = 0; g.globalAlpha = 0.6; g.fillStyle = '#ffffff';
        g.fillRect(o + s2 * 0.3, o + s2 * 0.3, s2 * 0.4, s2 * 0.4);
      });
    }
    spr.dots = [dot(color), dot('#ffffff'), dot(YELLOW), dot(danger)];

    buildBg();
    buildSun();
    buildSkyline();

    groundTex = mk(1, 256);
    var g = groundTex.getContext('2d');
    g.fillStyle = BG; g.fillRect(0, 0, 1, 256);
    var lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, rgba(rgb, 0.22)); lg.addColorStop(0.35, rgba(rgb, 0.06)); lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(0, 0, 1, 256);

    gridTex = mk(1, 256);
    g = gridTex.getContext('2d');
    lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, rgba(rgb, 0.5)); lg.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = lg; g.fillRect(0, 0, 1, 256);

    beam = mk(64, 256);
    g = beam.getContext('2d');
    lg = g.createLinearGradient(0, 0, 64, 0);
    lg.addColorStop(0, rgba(rgb, 0)); lg.addColorStop(0.5, rgba(rgb, 0.9)); lg.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = lg; g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'destination-in';
    lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = lg; g.fillRect(0, 0, 64, 256);
  }

  function buildBg() {
    bg = mk(W, H);
    var g = bg.getContext('2d');
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(GROUND_K * 0.55, rgba(rgb, 0.04));
    lg.addColorStop(GROUND_K, rgba(rgb, 0.17));
    lg.addColorStop(Math.min(1, GROUND_K + 0.002), 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    var rg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.2, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }

  function buildSun() {
    var R = Math.round(W * 0.26);
    sun = mk(R * 2 + 4, R * 2 + 4);
    var g = sun.getContext('2d');
    var lg = g.createLinearGradient(0, 2, 0, R * 2 + 2);
    lg.addColorStop(0, rgba(rgb, 0.6)); lg.addColorStop(1, 'rgba(255,45,149,0.35)');
    g.fillStyle = lg;
    g.beginPath(); g.arc(R + 2, R + 2, R, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (var i = 0; i < 7; i++) {
      var y = R + 2 + R * (0.08 + i * 0.13), h = R * (0.015 + i * 0.013);
      g.fillRect(0, y, R * 2 + 4, h);
    }
    sun.R = R;
  }

  function buildSkyline() {
    var w = Math.round(W * 1.5), h = Math.max(4, Math.round(H * 0.15));
    skyline = mk(w, h);
    var g = skyline.getContext('2d');
    var r = seeded(11 + (lv ? lv.index * 13 : 0));
    var x = 0, line = Math.max(1, Math.round(dpr));
    while (x < w) {
      var bw = Math.max(4, Math.round(w * (0.035 + r() * 0.07))), bh = Math.round(h * (0.25 + r() * 0.75));
      if (x + bw > w) bw = w - x;
      g.fillStyle = '#0b0918'; g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = rgba(rgb, 0.5); g.fillRect(x, h - bh, bw, line);
      g.fillStyle = rgba(rgb, 0.16);
      var ws = Math.max(2, Math.round(W * 0.008));
      for (var wy = h - bh + ws * 2; wy < h - ws; wy += ws * 3) {
        for (var wx = x + ws; wx < x + bw - ws; wx += ws * 3) if (r() < 0.35) g.fillRect(wx, wy, ws, ws);
      }
      x += Math.max(1, bw + Math.round(r() * w * 0.012));
    }
  }

  /* ---------- Эффекты ---------- */
  function spawn(x, y, vx, vy, life, size, kind, grav, drag) {
    if (parts.length >= MAX_PARTS) return;
    parts.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: size, kind: kind, g: grav, drag: drag, rot: rand(0, 6.3), vr: rand(-10, 10) });
  }

  function ring(x, y, r1, life, col, width) {
    rings.push({ x: x, y: y, r1: r1, life: life, max: life, col: col, w: width || 0.12 });
  }

  function explode(x, y) {
    for (var i = 0; i < 44; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(3, 14);
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp + 3, rand(0.45, 0.95), rand(0.14, 0.34), i % 5 < 3 ? 0 : (i % 5 === 3 ? 1 : 3), 20, 0.9);
    }
    ring(x, y, 2.6, 0.35, color, 0.16);
    ring(x, y, 1.4, 0.25, '#ffffff', 0.1);
    shake = Math.max(shake, 0.55);
    flash = 0.4; flashRGB = drgb.join(',');
    trail.length = 0;
  }

  function winBurst(x, y) {
    for (var i = 0; i < 90; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(4, 17);
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp + 5, rand(0.7, 1.5), rand(0.12, 0.32), i % 3, 14, 0.94);
    }
    ring(x, y, 4, 0.5, '#ffffff', 0.2);
    ring(x, y, 2.5, 0.4, color, 0.14);
    ring(x, y, 6, 0.7, color, 0.08);
    shake = Math.max(shake, 0.3);
    flash = 0.95; flashRGB = '255,255,255';
  }

  function onJump(x, y) {
    for (var i = 0; i < 6; i++) spawn(x - 0.2, y + 0.05, rand(-4, -1), rand(0.5, 3), rand(0.2, 0.35), rand(0.08, 0.16), 1, 10, 0.9);
  }

  function onLand(x, y) {
    for (var i = 0; i < 6; i++) spawn(x + rand(-0.4, 0.4), y + 0.02, rand(-3, 3), rand(0.5, 2.5), rand(0.15, 0.3), rand(0.07, 0.14), 0, 12, 0.9);
  }

  function onOrb(id) {
    if (!lv) return;
    var x = (id % lv.width) + 0.5, y = Math.floor(id / lv.width) + 0.5;
    ring(x, y, 1.6, 0.3, YELLOW, 0.14);
    for (var i = 0; i < 12; i++) {
      var a = rand(0, Math.PI * 2);
      spawn(x, y, Math.cos(a) * 6, Math.sin(a) * 6, rand(0.25, 0.45), rand(0.08, 0.16), 2, 0, 0.9);
    }
  }

  function onPad(x, y) {
    ring(x, y + 0.1, 1.4, 0.3, YELLOW, 0.14);
    for (var i = 0; i < 10; i++) spawn(x + rand(-0.4, 0.4), y, rand(-1, 1), rand(4, 10), rand(0.25, 0.5), rand(0.08, 0.16), 2, 10, 0.92);
  }

  function makeText(lines, glow) {
    // lines: [{t, size (в долях ширины), color, weight}]
    var hs = 0, i;
    for (i = 0; i < lines.length; i++) hs += Math.round(W * lines[i].size) * 1.25;
    var c = mk(W, hs + W * 0.1), g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    var y = W * 0.05;
    for (i = 0; i < lines.length; i++) {
      var L = lines[i], fs = Math.round(W * L.size);
      y += fs;
      g.font = (L.weight || 900) + ' ' + fs + 'px ' + FONT;
      g.shadowColor = L.glow || glow || color; g.shadowBlur = fs * (L.blur || 0.18);
      g.fillStyle = L.color || '#ffffff';
      g.fillText(L.t, W / 2, y);
      if (L.blur !== 0) { g.shadowBlur = fs * 0.05; g.fillText(L.t, W / 2, y); }
      y += fs * 0.25;
    }
    return c;
  }

  function showPopup(pct, isRecord, best) {
    var lines = [{ t: pct + '%', size: 0.27 }];
    if (isRecord) lines.push({ t: 'НОВЫЙ РЕКОРД!', size: 0.058, color: YELLOW, glow: YELLOW, weight: 800, blur: 0.5 });
    else lines.push({ t: 'рекорд ' + best + '%', size: 0.05, color: 'rgba(255,255,255,0.6)', weight: 700, blur: 0 });
    popup = { c: makeText(lines), t: 0 };
  }

  function onAttempt(n, level, auto) {
    var lines = [
      { t: 'УРОВЕНЬ ' + (level.index + 1) + ' · ' + level.name.toUpperCase(), size: 0.04, color: 'rgba(255,255,255,0.65)', weight: 700, blur: 0 },
      { t: auto ? 'АВТОПИЛОТ' : 'ПОПЫТКА ' + n, size: 0.085, weight: 900 }
    ];
    tag = makeText(lines);
    tagX = level.startX + 4.2;
    trail.length = 0;
  }

  /* ---------- Рисование кадра ---------- */
  function drawBackdrop(v) {
    var i, x, y;
    // звёзды
    ctx.fillStyle = '#ffffff';
    for (i = 0; i < stars.length; i++) {
      var st = stars[i];
      x = ((st.x * W - camX * U * 0.03) % W + W) % W;
      y = st.y * gy0 + camY * U * 0.05;
      ctx.globalAlpha = 0.18 + 0.22 * Math.sin(clock * 2 + st.ph) * Math.sin(clock * 2 + st.ph);
      var ss = st.s * dpr;
      ctx.fillRect(x, y, ss, ss);
    }
    // неоновое «солнце»
    var gy = sy(0);
    ctx.globalAlpha = 0.32 + 0.18 * v.beat;
    ctx.drawImage(sun, Math.round(W / 2 - sun.R - 2), Math.round(gy - sun.R * 1.5 + camY * U * 0.15));
    // город
    ctx.globalAlpha = 0.85;
    var off = ((camX * U * 0.12) % skyline.width + skyline.width) % skyline.width;
    var ky = gy - skyline.height + camY * U * 0.3;
    ctx.drawImage(skyline, -off, ky);
    if (skyline.width - off < W) ctx.drawImage(skyline, skyline.width - off, ky);
    // парящие квадраты
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, dpr * 1.2);
    for (i = 0; i < deco.length; i++) {
      var d = deco[i], span = W * 1.4;
      x = ((d.x * span - camX * U * 0.3) % span + span) % span - W * 0.2;
      y = d.y * gy0 + camY * U * 0.2;
      var sz = d.size * U;
      ctx.globalAlpha = 0.08 + 0.1 * v.beat;
      ctx.save(); ctx.translate(x, y); ctx.rotate(d.rot + clock * d.vr);
      ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function groundAt(c) {
    if (c < 0 || c >= lv.width) return 1;
    return lv.ground[c];
  }

  function drawGround(v) {
    var gy = Math.round(sy(0));
    if (gy >= H) return;
    var c0 = Math.floor(camX - ox / U) - 1, c1 = Math.ceil(camX + VIEW_W) + 1;
    var start = null;
    for (var c = c0; c <= c1 + 1; c++) {
      var g = c > c1 ? 0 : groundAt(c);
      if (g && start === null) start = c;
      if (!g && start !== null) { drawGroundSeg(start, c, gy, v, start > c0, c <= c1); start = null; }
    }
  }

  function drawGroundSeg(a, b, gy, v, leftEdge, rightEdge) {
    var x0 = Math.max(-4, Math.round(sx(a))), x1 = Math.min(W + 4, Math.round(sx(b)));
    if (x1 <= x0) return;
    var w = x1 - x0, h = H - gy;
    ctx.drawImage(groundTex, x0, gy, w, h);
    // сетка
    var lw = Math.max(1, Math.round(dpr));
    ctx.globalAlpha = 0.5;
    for (var k = Math.ceil(Math.max(a, camX - 1)); k < b; k++) {
      var x = Math.round(sx(k));
      if (x < x0 || x > x1) continue;
      ctx.drawImage(gridTex, x, gy, lw, h);
    }
    ctx.fillStyle = color;
    for (var n = 1; n <= 6; n++) {
      var yy = gy + U * (0.55 * n + 0.1 * n * n);
      if (yy > H) break;
      ctx.globalAlpha = 0.22 / n;
      ctx.fillRect(x0, yy, w, lw);
    }
    // светящаяся кромка
    ctx.globalAlpha = 0.18 + 0.12 * v.beat; ctx.fillRect(x0, gy - 4 * dpr, w, 8 * dpr);
    ctx.globalAlpha = 0.5; ctx.fillRect(x0, gy - 1.5 * dpr, w, 3 * dpr);
    ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffffff'; ctx.fillRect(x0, gy - 0.5 * dpr, w, Math.max(1, dpr));
    // края ям подсвечиваем цветом опасности
    ctx.fillStyle = danger; ctx.globalAlpha = 0.7;
    if (leftEdge) ctx.fillRect(x0 - lw, gy, lw * 2, U * 1.1);
    if (rightEdge) ctx.fillRect(x1 - lw, gy, lw * 2, U * 1.1);
    ctx.globalAlpha = 1;
  }

  function drawFinish(v) {
    var x = sx(lv.finishX);
    if (x < -U * 2 || x > W + U * 2) return;
    var gy = sy(0);
    var bw = U * 1.8;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.3 * v.beat;
    ctx.drawImage(beam, x - bw / 2, 0, bw, gy);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - dpr, 0, 2 * dpr, gy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawObjects(v) {
    var c0 = Math.floor(camX - ox / U) - 1, c1 = Math.ceil(camX + VIEW_W) + 1;
    if (c0 < 0) c0 = 0;
    if (c1 > lv.width - 1) c1 = lv.width - 1;
    var orbPulse = 1 + 0.07 * Math.sin(clock * 7) + 0.12 * v.beat;
    for (var r = 0; r < lv.rows; r++) {
      var y = sy(r + 1);
      if (y > H + U || y < -U * 2) continue;
      var rowBase = r * lv.width;
      for (var c = c0; c <= c1; c++) {
        var t = lv.grid[rowBase + c];
        if (!t) continue;
        var x = sx(c), sp;
        if (t === T.BLOCK) sp = spr.block;
        else if (t === T.SPIKE) sp = spr.spike;
        else if (t === T.CEIL) sp = spr.ceil;
        else if (t === T.SMALL) sp = spr.small;
        else if (t === T.PAD) {
          ctx.globalAlpha = 0.85 + 0.15 * v.beat;
          ctx.drawImage(spr.pad, Math.round(x - spr.pad.pad), Math.round(y - spr.pad.pad));
          ctx.globalAlpha = 1;
          continue;
        } else if (t === T.ORB) {
          var used = v.usedOrbs && v.usedOrbs.has(rowBase + c);
          var sz = spr.orb.width * (used ? 0.8 : orbPulse);
          ctx.globalAlpha = used ? 0.25 : 1;
          ctx.drawImage(spr.orb, x + U / 2 - sz / 2, y + U / 2 - sz / 2, sz, sz);
          ctx.globalAlpha = 1;
          continue;
        } else continue;
        ctx.drawImage(sp, Math.round(x - sp.pad), Math.round(y - sp.pad));
      }
    }
  }

  function drawTag() {
    if (!tag) return;
    var x = sx(tagX), y = sy(3.4);
    if (x < -W || x > W * 2) return;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(tag, Math.round(x - tag.width / 2), Math.round(y - tag.height / 2));
    ctx.globalAlpha = 1;
  }

  function drawPlayer(v, dt) {
    var half = C.SIZE / 2;
    var p = spr.player;
    if (v.mode === 'play' || v.mode === 'win') {
      trail.push(v.px, v.py, v.rot);
      if (trail.length > 3 * 7) trail.splice(0, 3);
    }
    ctx.globalCompositeOperation = 'lighter';
    var n = trail.length / 3;
    for (var i = 0; i < n - 1; i++) {
      var k = (i + 1) / n;
      var tx = sx(trail[i * 3]), ty = sy(trail[i * 3 + 1] + half);
      var sc = 0.45 + 0.4 * k;
      ctx.globalAlpha = 0.22 * k;
      var w = p.width * sc;
      ctx.drawImage(p, tx - w / 2, ty - w / 2, w, w);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    var x = sx(v.px), y = sy(v.py + half);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(v.sqx, v.sqy);
    ctx.rotate(v.rot);
    ctx.drawImage(p, -p.width / 2, -p.height / 2);
    ctx.restore();

    if (v.grounded && v.mode === 'play' && dt > 0) {
      sparkT += dt;
      while (sparkT > 0.035) {
        sparkT -= 0.035;
        spawn(v.px - half + 0.05, v.py + 0.04, rand(-3, -1), rand(0.6, 2.4), rand(0.15, 0.3), rand(0.06, 0.12), Math.random() < 0.5 ? 0 : 1, 12, 0.9);
      }
    }
  }

  function updateDrawParticles(dt) {
    var i, p;
    ctx.globalCompositeOperation = 'lighter';
    for (i = parts.length - 1; i >= 0; i--) {
      p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      var dr = Math.pow(p.drag, dt * 60);
      p.vx *= dr; p.vy *= dr;
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      var sp = spr.dots[p.kind];
      var k = p.life / p.max;
      var sz = sp.width * (p.size / 0.26) * (0.5 + 0.5 * k);
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.drawImage(sp, sx(p.x) - sz / 2, sy(p.y) - sz / 2, sz, sz);
    }
    for (i = rings.length - 1; i >= 0; i--) {
      var r = rings[i];
      r.life -= dt;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      var q = 1 - r.life / r.max;
      var rad = r.r1 * U * (1 - Math.pow(1 - q, 3));
      ctx.globalAlpha = (1 - q) * 0.9;
      ctx.strokeStyle = r.col;
      ctx.lineWidth = Math.max(1, r.w * U * (1 - q));
      ctx.beginPath(); ctx.arc(sx(r.x), sy(r.y), rad, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawHUD(v) {
    var top = safeTop + 30 * dpr;
    var x0 = 64 * dpr, x1 = W - 64 * dpr, bw = x1 - x0, bh = Math.round(6 * dpr);
    var by = Math.round(top - bh / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x0, by, bw, bh);
    var fw = Math.round(bw * v.prog);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25; ctx.fillRect(x0, by - bh, fw, bh * 3);
    ctx.globalAlpha = 1; ctx.fillRect(x0, by, fw, bh);
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.9;
    ctx.fillRect(x0 + fw - Math.max(1, dpr), by, Math.max(2, 2 * dpr), bh);
    if (v.best > 0 && v.best < 1) {
      var bx = Math.round(x0 + bw * v.best);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(bx - dpr, by - bh * 0.9, 2 * dpr, bh * 2.8);
    }
    ctx.globalAlpha = 1;
    ctx.font = '800 ' + Math.round(13 * dpr) + 'px ' + FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(v.auto ? 'АВТОПИЛОТ' : 'ПОПЫТКА ' + v.attempt, x0, by + bh + 8 * dpr);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(Math.floor(v.prog * 100) + '%', x1, by + bh + 8 * dpr);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '700 ' + Math.round(11 * dpr) + 'px ' + FONT;
    ctx.fillText('УР. ' + v.level, W / 2, by + bh + 9 * dpr);
  }

  function drawPopup(dt) {
    popup.t += dt;
    var t = popup.t;
    var a = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.45);
    if (a <= 0) { popup = null; return; }
    var sc = 1 + 0.55 * Math.exp(-t * 13);
    var rot = 0.07 * Math.exp(-t * 9) * Math.sin(t * 38);
    var c = popup.c;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H * 0.3);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.drawImage(c, -c.width / 2, -c.height / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHint(v) {
    var y = gy0 + (H - gy0) * 0.42;
    var p = 0.5 + 0.5 * Math.sin(clock * 5);
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.25 + 0.35 * (1 - p);
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(W / 2, y - 26 * dpr, (10 + 12 * p) * dpr, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(W / 2, y - 26 * dpr, 7 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.font = '900 ' + Math.round(17 * dpr) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.75 + 0.25 * p;
    ctx.fillText(v.hintText || 'ТАП — ПРЫЖОК', W / 2, y);
    ctx.globalAlpha = 1;
  }

  function frame(dt, v) {
    if (!ctx) return;
    clock += dt;
    if (!lv) { ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); return; }

    if (v.menu) {
      camX = (clock * 3) % Math.max(10, lv.finishX);
      camY += (0 - camY) * Math.min(1, dt * 4);
    } else if (v.px !== undefined) {
      camX = v.px - PLAYER_SX;
      var head = gy0 / U - 5;
      var ty = Math.max(0, v.py - head);
      camY += (ty - camY) * Math.min(1, dt * 6);
    }

    ox = 0; oy = 0;
    if (shake > 0.002) {
      ox = (Math.random() * 2 - 1) * shake * U * 0.35;
      oy = (Math.random() * 2 - 1) * shake * U * 0.35;
      shake *= Math.exp(-dt * 9);
    } else shake = 0;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0);
    drawBackdrop(v);
    drawGround(v);
    drawFinish(v);
    drawObjects(v);
    if (!v.menu) drawTag();
    if (v.showPlayer) drawPlayer(v, dt);
    updateDrawParticles(dt);

    if (flash > 0.001) {
      ctx.fillStyle = 'rgba(' + flashRGB + ',' + Math.min(1, flash) + ')';
      ctx.fillRect(0, 0, W, H);
      flash -= dt * 2.4;
    }

    if (!v.menu) drawHUD(v);
    if (popup) drawPopup(dt);
    if (v.hint) drawHint(v);
    if (v.fps) {
      ctx.font = '700 ' + Math.round(11 * dpr) + 'px ' + FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#7dff3a';
      ctx.fillText(v.fps + ' FPS', 8 * dpr, H - 8 * dpr);
    }
  }

  return {
    init: init, resize: resize, setLevel: setLevel, frame: frame,
    explode: explode, winBurst: winBurst, onJump: onJump, onLand: onLand, onOrb: onOrb, onPad: onPad,
    showPopup: showPopup, onAttempt: onAttempt, hexRgb: hexRgb
  };
})();
