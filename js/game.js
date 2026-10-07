/*
 * game.js — логика игры: попытки, смерть и мгновенный рестарт, победа,
 * меню, карточка прохождения, управление и сохранения.
 *
 * Полезные адреса для теста:
 *   index.html?unlock=all      — открыть все уровни (только на этот запуск)
 *   index.html?level=5         — сразу запустить уровень 5
 *   index.html?level=5&autoplay=1 — бот сам проходит уровень (видно, что он проходим)
 *   index.html?fps=1           — показать FPS
 *   index.html?reset=1         — стереть прогресс
 */
(function () {
  'use strict';
  var P = Physics, C = P.C;
  var $ = function (id) { return document.getElementById(id); };

  var params = new URLSearchParams(location.search);
  var AUTOPLAY = params.has('autoplay');
  var UNLOCK_ALL = params.get('unlock') === 'all' || AUTOPLAY;
  var SHOW_FPS = params.has('fps');
  var RESET = params.has('reset');

  var BUFFER = 0.11;          // тап чуть раньше приземления всё равно засчитается
  var RESTART_DELAY = 0.55;   // сколько длится смерть до автоматического рестарта
  var SKIP_AFTER = 0.22;      // после этого тап перезапускает сразу
  var CARD_DELAY = 1.0;       // пауза между финишем и карточкой
  var ROT_SPEED = Math.PI / (2 * C.JUMP_V / C.GRAVITY); // пол-оборота за прыжок
  var IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  var levels = LEVELS.map(function (d, i) { return P.parseLevel(d, i); });
  var save = defaults();
  var autoCache = {};

  var G = {
    mode: 'menu',            // menu | play | dead | win | pause
    li: 0, lv: levels[0],
    s: null, prevX: 0, prevY: 0,
    rot: 0, sqx: 1, sqy: 1,
    acc: 0, buffer: 0, holdBlocked: false,
    deadT: 0, winT: 0, cardShown: false, winInfo: null,
    attempt: 0, attemptT: 0, jumps: 0, tick: 0,
    usedOrbs: new Set(),
    auto: null, hint: false, menuT: 0
  };
  var pointers = new Set(), keyHeld = false;
  var view = {};
  var fps = 60, fpsAcc = 0, fpsN = 0;

  /* ---------- Сохранения ---------- */
  function defaults() { return { v: 1, unlocked: 1, total: 0, muted: false, levels: {} }; }

  function lvSave(i) {
    var k = 'l' + (i + 1);
    return save.levels[k] || (save.levels[k] = { a: 0, best: 0, done: 0, wa: 0, t: 0 });
  }

  function merge(a, b) {
    if (!b || typeof b !== 'object') return a;
    var r = defaults();
    r.unlocked = Math.max(a.unlocked || 1, b.unlocked || 1);
    r.total = Math.max(a.total || 0, b.total || 0);
    r.muted = !!(a.muted || b.muted);
    var keys = {};
    Object.keys(a.levels || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(b.levels || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var x = (a.levels || {})[k] || {}, y = (b.levels || {})[k] || {};
      var wa = [x.wa || 0, y.wa || 0].filter(function (n) { return n > 0; });
      r.levels[k] = {
        a: Math.max(x.a || 0, y.a || 0),
        best: Math.max(x.best || 0, y.best || 0),
        done: (x.done || y.done) ? 1 : 0,
        wa: wa.length ? Math.min.apply(null, wa) : 0,
        t: Math.max(x.t || 0, y.t || 0)
      };
    });
    return r;
  }

  function persist(now) {
    if (AUTOPLAY) return;
    Platform.save(save);
    if (now) Platform.flush();
  }

  /* ---------- Вспомогательное ---------- */
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m100 >= 11 && m100 <= 14) return many;
    if (m10 === 1) return one;
    if (m10 >= 2 && m10 <= 4) return few;
    return many;
  }

  function fmtTime(sec) {
    sec = Math.round(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m >= 60) return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
    if (m > 0) return m + ' мин ' + s + ' с';
    return s + ' с';
  }

  function isUnlocked(i) { return UNLOCK_ALL || i < save.unlocked; }

  function nextLevelIndex() {
    for (var i = 0; i < levels.length; i++) {
      if (isUnlocked(i) && !lvSave(i).done) return i;
    }
    return Math.min(levels.length - 1, Math.max(0, save.unlocked - 1));
  }

  function applyTheme(lv) {
    var app = $('app');
    var c = lv.def.color || '#00e5ff';
    app.style.setProperty('--c', c);
    app.style.setProperty('--c-rgb', Render.hexRgb(c).join(','));
    drawLogo(false);
  }

  // Неоновый логотип в меню (canvas, а не CSS-тень — так он одинаково выглядит на всех телефонах)
  function drawLogo(dim) {
    var cv = $('logo');
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var d = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);
    var col = G.lv.def.color || '#00e5ff';
    var fs = Math.round(Math.min(h * 0.5, w * 0.15));
    g.font = '900 ' + fs + 'px ' + FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    try { g.letterSpacing = Math.round(fs * 0.05) + 'px'; } catch (e) { }
    var x = w / 2, y = h / 2 + fs * 0.05, k = dim ? 0.4 : 1;
    g.globalAlpha = 0.55 * k;
    g.fillStyle = '#ff2e88'; g.fillText('ALMOST', x - fs * 0.035, y + fs * 0.01);
    g.fillStyle = '#00e5ff'; g.fillText('ALMOST', x + fs * 0.035, y - fs * 0.01);
    g.globalAlpha = k;
    g.shadowColor = col; g.fillStyle = col;
    g.shadowBlur = fs * 0.4; g.fillText('ALMOST', x, y);
    g.shadowBlur = fs * 0.18; g.fillText('ALMOST', x, y);
    g.globalAlpha = dim ? 0.75 : 1;
    g.shadowColor = '#ffffff'; g.shadowBlur = fs * 0.08; g.fillStyle = '#ffffff';
    g.fillText('ALMOST', x, y);
  }

  // лёгкое «мерцание неона» раз в несколько секунд
  setInterval(function () {
    if (G.mode !== 'menu') return;
    [70, 140, 210].forEach(function (t, i) { setTimeout(function () { drawLogo(i % 2 === 0 ? false : true); }, t); });
    drawLogo(true);
  }, 4200);

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  function getAuto(i) {
    if (!autoCache[i]) autoCache[i] = Solver.solve(levels[i]);
    return autoCache[i].ok ? autoCache[i] : null;
  }

  /* ---------- Игровой процесс ---------- */
  function startLevel(i) {
    if (!isUnlocked(i)) return;
    G.li = i; G.lv = levels[i];
    applyTheme(G.lv);
    Render.setLevel(G.lv);
    hide('menu'); hide('pause'); hide('card');
    show('btn-pause');
    Platform.showBack(true);
    G.auto = AUTOPLAY ? getAuto(i) : null;
    G.attempt = 0;
    G.hint = i === 0 && lvSave(0).a < 3 && !G.auto;
    newAttempt();
  }

  function newAttempt() {
    var L = lvSave(G.li);
    if (!AUTOPLAY) { L.a++; save.total++; persist(); G.attempt = L.a; }
    else G.attempt++;
    G.s = P.newState(G.lv);
    G.prevX = G.s.x; G.prevY = G.s.y;
    G.rot = 0; G.sqx = 1; G.sqy = 1;
    G.acc = 0; G.tick = 0; G.buffer = 0; G.jumps = 0; G.attemptT = 0;
    G.usedOrbs.clear();
    G.holdBlocked = pointers.size > 0 || keyHeld; // палец, оставшийся с прошлой попытки, не прыгает сам
    G.mode = 'play'; G.deadT = 0;
    Render.onAttempt(G.attempt, G.lv, !!G.auto);
    Sound.startMusic(G.lv.def.music);
  }

  function die() {
    G.mode = 'dead'; G.deadT = 0;
    var L = lvSave(G.li);
    var pct = Math.min(99, Math.floor(P.progress(G.lv, G.s.x) * 100));
    var prev = L.best;
    var rec = pct > prev;
    if (rec && !AUTOPLAY) L.best = pct;
    persist();
    Render.explode(G.s.x, G.s.y + C.SIZE / 2);
    Render.showPopup(pct, rec && G.attempt > 1, Math.max(prev, pct));
    Sound.stopMusic(0.05);
    Sound.death();
    if (rec && G.attempt > 1) Sound.record();
    Platform.haptic('death');
  }

  function win() {
    G.mode = 'win'; G.winT = 0; G.cardShown = false;
    var L = lvSave(G.li);
    var info = { first: !L.done, attempts: G.attempt, jumps: G.jumps, unlockedNew: false };
    if (!AUTOPLAY) {
      L.best = 100;
      if (!L.done) { L.done = 1; L.wa = L.a; }
      if (G.li + 1 < levels.length && save.unlocked < G.li + 2) { save.unlocked = G.li + 2; info.unlockedNew = true; }
      persist(true);
    }
    info.time = L.t;
    G.winInfo = info;
    Sound.stopMusic(0.3);
    Sound.win();
    Platform.haptic('win');
    Render.winBurst(G.s.x, G.s.y + C.SIZE / 2);
    G.hint = false;
  }

  function stepTick() {
    var s = G.s;
    G.prevX = s.x; G.prevY = s.y;
    var jump = false, orb = false;
    if (G.mode === 'play') {
      if (G.auto) { jump = orb = G.auto.actions[G.tick] === 1; }
      else {
        jump = G.buffer > 0 || ((pointers.size > 0 || keyHeld) && !G.holdBlocked);
        orb = G.buffer > 0;
      }
    }
    var ev = {};
    P.step(s, G.lv, jump, orb, ev);
    G.tick++;
    if (ev.jump || ev.orb) G.buffer = 0;
    else if (G.buffer > 0) G.buffer -= C.DT;

    if (s.grounded) {
      var q = Math.PI / 2, target = Math.round(G.rot / q) * q;
      G.rot += (target - G.rot) * 0.35;
    } else G.rot += ROT_SPEED * C.DT;

    if (G.mode !== 'play') return;
    if (ev.jump) {
      G.jumps++; G.sqx = 0.78; G.sqy = 1.28;
      Sound.jump(); Platform.haptic('jump'); Render.onJump(s.x, s.y);
      G.hint = false;
    }
    if (ev.orb) {
      G.jumps++; G.usedOrbs.add(ev.orbId);
      Sound.orb(); Platform.haptic('jump'); Render.onOrb(ev.orbId);
    }
    if (ev.pad) { Sound.pad(); Platform.haptic('jump'); Render.onPad(s.x, s.y); }
    if (ev.land) { G.sqx = 1.25; G.sqy = 0.8; Render.onLand(s.x, s.y); }
    if (s.dead) die();
    else if (s.won) win();
  }

  function update(dt) {
    if (G.mode === 'play' || G.mode === 'win') {
      G.acc += dt;
      var n = 0;
      while (G.acc >= C.DT && n < 12) {
        stepTick();
        G.acc -= C.DT; n++;
        if (G.mode !== 'play' && G.mode !== 'win') { G.acc = 0; break; }
      }
      if (G.acc > C.DT) G.acc = 0;
      if (G.mode === 'play') {
        G.attemptT += dt;
        if (!AUTOPLAY) lvSave(G.li).t += dt;
      }
    }
    if (G.mode === 'dead') {
      G.deadT += dt;
      if (G.deadT >= RESTART_DELAY) newAttempt();
    }
    if (G.mode === 'win') {
      G.winT += dt;
      if (G.winT > CARD_DELAY && !G.cardShown) showCard();
    }
    if (G.mode === 'menu') G.menuT += dt;
    var k = Math.min(1, dt * 12);
    G.sqx += (1 - G.sqx) * k; G.sqy += (1 - G.sqy) * k;
  }

  function beat() {
    var m = G.lv.def.music || {};
    var bpm = m.bpm || 128;
    var t;
    if (G.mode === 'play' || G.mode === 'pause') t = G.attemptT;
    else if (G.mode === 'menu') t = G.menuT;
    else return 0;
    var ph = (t * bpm / 60) % 1;
    return Math.exp(-ph * 6);
  }

  function render(dt) {
    var a = Math.min(1, G.acc / C.DT);
    var s = G.s;
    var v = view;
    v.mode = G.mode;
    v.menu = G.mode === 'menu' || !s;
    if (s) {
      if (G.mode === 'play' || G.mode === 'win') {
        v.px = G.prevX + (s.x - G.prevX) * a;
        v.py = G.prevY + (s.y - G.prevY) * a;
      } else { v.px = s.x; v.py = s.y; }
      v.grounded = s.grounded;
      v.prog = P.progress(G.lv, s.x);
    }
    v.rot = G.rot; v.sqx = G.sqx; v.sqy = G.sqy;
    v.showPlayer = G.mode === 'play' || G.mode === 'win' || G.mode === 'pause';
    v.best = lvSave(G.li).best / 100;
    v.attempt = G.attempt;
    v.level = G.li + 1;
    v.beat = beat();
    v.usedOrbs = G.usedOrbs;
    v.hint = G.hint && G.mode === 'play';
    v.hintText = IS_TOUCH ? 'ТАП — ПРЫЖОК' : 'ПРОБЕЛ ИЛИ КЛИК — ПРЫЖОК';
    v.auto = !!G.auto;
    v.fps = SHOW_FPS ? fps : 0;
    Render.frame(G.mode === 'pause' ? 0 : dt, v);
  }

  var last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    if (SHOW_FPS) {
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    }
    update(dt);
    render(dt);
  }

  /* ---------- Пауза, меню, карточка ---------- */
  function pause() {
    if (G.mode !== 'play') return;
    G.mode = 'pause';
    Sound.suspend();
    show('pause');
  }

  function resume() {
    if (G.mode !== 'pause') return;
    hide('pause');
    G.mode = 'play';
    G.holdBlocked = true;
    G.acc = 0;
    Sound.resume();
  }

  function toMenu() {
    Sound.stopMusic(0.1);
    Sound.resume();
    G.mode = 'menu';
    G.s = null;
    hide('pause'); hide('card'); hide('btn-pause');
    show('menu');
    Platform.showBack(false);
    var ni = nextLevelIndex();
    G.li = ni; G.lv = levels[ni];
    applyTheme(G.lv);
    Render.setLevel(G.lv);
    refreshMenu();
  }

  function onBack() {
    if (G.mode === 'play') pause();
    else if (G.mode !== 'menu') toMenu();
  }

  function countUp(el, n) {
    var t0 = performance.now(), dur = Math.min(900, 300 + n * 25);
    el.textContent = '0';
    function stepNum(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(n * e));
      if (k < 1) requestAnimationFrame(stepNum);
    }
    requestAnimationFrame(stepNum);
  }

  function diffDots(n) {
    var h = '';
    for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return h;
  }

  function showCard() {
    G.cardShown = true;
    var lv = G.lv, info = G.winInfo, last = G.li === levels.length - 1;
    var n = info.attempts;
    $('card-num').textContent = G.li + 1;
    $('card-name').textContent = lv.name;
    $('card-diff').innerHTML = diffDots(lv.def.difficulty || 1);
    countUp($('card-attempts'), n);
    $('card-attempts-lbl').textContent = plural(n, 'попытка', 'попытки', 'попыток');
    $('card-time').textContent = fmtTime(info.time || 0);
    $('card-jumps').textContent = info.jumps;
    $('card-total').textContent = AUTOPLAY ? '—' : save.total;
    var badge = '';
    if (AUTOPLAY) badge = 'ПРОШЁЛ АВТОПИЛОТ';
    else if (n === 1) badge = 'С ПЕРВОЙ ПОПЫТКИ!';
    else if (last && info.first) badge = 'ВСЯ ИГРА ПРОЙДЕНА!';
    else if (info.unlockedNew) badge = 'ОТКРЫТ УРОВЕНЬ ' + (G.li + 2);
    $('card-badge').textContent = badge;
    $('card-badge').classList.toggle('hidden', !badge);
    var nb = $('btn-next');
    nb.textContent = last ? 'В МЕНЮ' : 'ДАЛЬШЕ';
    nb.dataset.act = last ? 'menu' : 'next';
    hide('btn-pause');
    show('card');
    var box = $('card-box');
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
  }

  function onCardAction(act) {
    if (act === 'next') startLevel(Math.min(levels.length - 1, G.li + 1));
    else if (act === 'retry') startLevel(G.li);
    else toMenu();
  }

  /* ---------- Меню уровней ---------- */
  function buildMenu() {
    var grid = $('level-grid');
    grid.innerHTML = '';
    levels.forEach(function (lv, i) {
      var b = document.createElement('button');
      b.className = 'lvl-btn';
      b.type = 'button';
      b.innerHTML = '<span class="lvl-num">' + (i + 1) + '</span>' +
        '<span class="lvl-txt"><span class="lvl-name"></span><span class="lvl-info"></span></span>' +
        '<span class="lvl-bar"><i></i></span>';
      b.addEventListener('click', function () {
        b.blur();
        if (!isUnlocked(i)) {
          Platform.haptic('error');
          b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
          return;
        }
        Sound.click();
        startLevel(i);
      });
      grid.appendChild(b);
    });
  }

  function refreshMenu() {
    var btns = $('level-grid').children;
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i], L = lvSave(i), b = btns[i], open = isUnlocked(i);
      var c = lv.def.color || '#00e5ff';
      b.style.setProperty('--lc', c);
      b.style.setProperty('--lc-rgb', Render.hexRgb(c).join(','));
      b.classList.toggle('locked', !open);
      b.classList.toggle('done', !!L.done);
      b.querySelector('.lvl-name').textContent = lv.name;
      var info;
      if (!open) info = 'закрыт';
      else if (L.done) info = '✓ ' + L.wa + ' ' + plural(L.wa, 'попытка', 'попытки', 'попыток');
      else if (L.a) info = 'рекорд ' + L.best + '%';
      else info = 'новый';
      b.querySelector('.lvl-info').textContent = info;
      b.querySelector('.lvl-bar i').style.width = (L.done ? 100 : L.best) + '%';
    }
    var ni = nextLevelIndex();
    $('play-sub').textContent = 'уровень ' + (ni + 1) + ' · ' + levels[ni].name;
    $('menu-total').textContent = save.total ? 'всего попыток: ' + save.total : '';
  }

  /* ---------- Звук ---------- */
  function updateSoundBtn() {
    $('btn-sound').classList.toggle('muted', Sound.isMuted());
  }

  function toggleMute() {
    Sound.unlock();
    Sound.setMuted(!Sound.isMuted());
    save.muted = Sound.isMuted();
    persist();
    updateSoundBtn();
  }

  /* ---------- Управление ---------- */
  function press() {
    if (G.mode === 'play') {
      if (!G.auto) { G.buffer = BUFFER; G.holdBlocked = false; }
    } else if (G.mode === 'dead' && G.deadT > SKIP_AFTER) {
      newAttempt();
      G.holdBlocked = true;
    }
  }

  function releasePointer(e) {
    pointers.delete(e.pointerId);
    if (!pointers.size && !keyHeld) G.holdBlocked = false;
  }

  function bindInput() {
    var cv = $('game');
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      Sound.unlock();
      pointers.add(e.pointerId);
      press();
    });
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // первый жест пользователя включает звук
    ['pointerdown', 'touchend', 'keydown'].forEach(function (t) {
      document.addEventListener(t, function () { Sound.unlock(); }, true);
    });

    // не даём странице прокручиваться и «пружинить» (кроме списка уровней)
    document.addEventListener('touchmove', function (e) {
      if (!e.target.closest || !e.target.closest('.scroll-y')) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', function (e) {
      var k = e.code;
      if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW' || k === 'Enter') {
        e.preventDefault();
        if (e.repeat) return;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        if (G.mode === 'menu') { startLevel(nextLevelIndex()); return; }
        if (G.mode === 'pause') { resume(); return; }
        if (G.mode === 'win') { if (G.cardShown) onCardAction($('btn-next').dataset.act); return; }
        keyHeld = true;
        press();
      } else if (k === 'Escape' || k === 'KeyP') {
        if (G.mode === 'play') pause();
        else if (G.mode === 'pause') resume();
      } else if (k === 'KeyR') {
        if (G.mode === 'play' || G.mode === 'dead') newAttempt();
      } else if (k === 'KeyM') {
        toggleMute();
      }
    });
    window.addEventListener('keyup', function (e) {
      var k = e.code;
      if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW' || k === 'Enter') {
        keyHeld = false;
        if (!pointers.size) G.holdBlocked = false;
      }
    });

    $('btn-play').addEventListener('click', function () { this.blur(); Sound.click(); startLevel(nextLevelIndex()); });
    $('btn-pause').addEventListener('click', function () { this.blur(); pause(); });
    $('btn-sound').addEventListener('click', function () { this.blur(); toggleMute(); });
    $('pause').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      b.blur();
      var act = b.dataset.act;
      if (act === 'resume') resume();
      else if (act === 'restart') { hide('pause'); Sound.resume(); newAttempt(); G.holdBlocked = true; }
      else toMenu();
    });
    $('card').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      b.blur();
      Sound.click();
      onCardAction(b.dataset.act);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (G.mode === 'play') pause();
        Sound.suspend();
        Platform.flush();
      } else if (G.mode !== 'pause') {
        Sound.resume();
      }
    });
    window.addEventListener('pagehide', function () { Platform.flush(); });
    window.addEventListener('resize', layout);
  }

  /* ---------- Размеры экрана ---------- */
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (vw < 50 || vh < 50) return; // окно свёрнуто или ещё не получило размер
    var w = Math.min(vw, Math.round(vh * 0.62)); // на компьютере — вертикальная «колонка» как у телефона
    var app = $('app');
    app.style.width = w + 'px';
    app.style.height = vh + 'px';
    Render.resize(w, vh);
    if (G.mode === 'menu') drawLogo(false);
    Platform.lockPortrait();
  }

  /* ---------- Старт ---------- */
  function boot() {
    Render.init($('game'));
    Platform.init({ onResize: layout, onBack: onBack, onPause: pause });
    buildMenu();
    Platform.load(function (data) {
      if (RESET) return;
      if (data) save = merge(save, data);
      Sound.setMuted(save.muted);
      updateSoundBtn();
      if (G.mode === 'menu') refreshMenu();
    });
    if (RESET) { save = defaults(); persist(true); }
    layout();
    bindInput();
    toMenu();
    var lvParam = parseInt(params.get('level'), 10);
    if (lvParam >= 1 && lvParam <= levels.length && isUnlocked(lvParam - 1)) startLevel(lvParam - 1);
    requestAnimationFrame(loop);
    // отладка из консоли браузера: __game.advance(2) — промотать 2 секунды игры
    window.__game = {
      G: G, levels: levels, save: function () { return save; }, startLevel: startLevel, toMenu: toMenu,
      press: function () { pointers.add(-1); press(); }, release: function () { releasePointer({ pointerId: -1 }); },
      advance: function (sec) { for (var i = 0; i < Math.round(sec * 60); i++) update(1 / 60); render(1 / 60); },
      bench: function (n) { var t = performance.now(); for (var i = 0; i < n; i++) { update(1 / 60); render(1 / 60); } return (performance.now() - t) / n; }
    };
  }

  boot();
})();
