/*
 * physics.js — физика игры и разбор уровней.
 *
 * Этот же файл использует страница проверки уровней (tools/check.html),
 * поэтому если «робот» прошёл уровень там — он гарантированно проходим в игре.
 *
 * Единица измерения — одна клетка уровня. Ось Y направлена вверх, y = 0 — поверхность земли.
 */
(function (root) {
  'use strict';

  var C = {
    DT: 1 / 120,      // шаг симуляции (120 раз в секунду, независимо от FPS экрана)
    GRAVITY: 80,      // гравитация, клеток/с²
    JUMP_V: 19,       // скорость прыжка → высота ≈ 2.25 клетки, полёт ≈ 0.48 с
    PAD_V: 27,        // батут → высота ≈ 4.5 клетки
    ORB_V: 19,        // кольцо (прыжок в воздухе)
    MAX_FALL: 28,     // максимальная скорость падения
    SIZE: 0.9,        // размер кубика
    HAZ_INSET: 0.1,   // для шипов хитбокс кубика меньше на столько с каждой стороны (прощает «чуть задел»)
    LAND_TOL: 0.14,   // насколько можно «зацепить» верх блока и всё равно встать на него
    COYOTE: 0.06,     // можно прыгнуть чуть позже, чем сошёл с края, сек
    ORB_R: 0.85,      // радиус, в котором срабатывает кольцо
    DEATH_Y: -3,      // ниже — упал в яму
    START_X: 3.5,     // откуда стартует игрок
    START_PAD: 10,    // ровная дорожка перед уровнем, клеток
    END_PAD: 40       // ровная дорожка после финиша
  };

  // Типы клеток
  var T = { EMPTY: 0, BLOCK: 1, SPIKE: 2, CEIL: 3, SMALL: 4, PAD: 5, ORB: 6 };
  var CHAR = { '.': 0, '#': 1, '=': 1, '^': 2, 'v': 3, ',': 4, '*': 5, 'o': 6 };
  var EPS = 1e-6;

  /* ---------- Разбор уровня из «ASCII-картинки» ---------- */
  function parseLevel(def, index) {
    var warnings = [];
    var chunks = [];
    var maxRows = 0;
    var map = def.map || [];
    var i, ci;

    for (ci = 0; ci < map.length; ci++) {
      var lines = String(map[ci]).split('\n')
        .map(function (l) { return l.trim(); })
        .filter(function (l) { return l.length > 0; });
      if (!lines.length) continue;
      var w = 0;
      for (i = 0; i < lines.length; i++) w = Math.max(w, lines[i].length);
      for (i = 0; i < lines.length; i++) {
        if (lines[i].length !== w) {
          warnings.push('кусок ' + (ci + 1) + ', строка ' + (i + 1) + ': ' + lines[i].length + ' символов вместо ' + w);
        }
      }
      chunks.push({ lines: lines, w: w, n: ci + 1 });
      if (lines.length - 1 > maxRows) maxRows = lines.length - 1;
    }

    var mapW = 0;
    for (i = 0; i < chunks.length; i++) mapW += chunks[i].w;
    var width = C.START_PAD + mapW + C.END_PAD;
    var rows = Math.max(1, maxRows);
    var grid = new Uint8Array(width * rows);
    var ground = new Uint8Array(width);
    for (i = 0; i < width; i++) ground[i] = 1;

    var x0 = C.START_PAD;
    chunks.forEach(function (ch) {
      var n = ch.lines.length;
      for (var li = 0; li < n; li++) {
        var line = ch.lines[li];
        var row = n - 2 - li; // последняя строка куска — земля (ряд -1)
        for (var k = 0; k < ch.w; k++) {
          var col = x0 + k;
          var chr = k < line.length ? line.charAt(k) : (row < 0 ? '=' : '.');
          if (row < 0) {
            if (chr === '=' || chr === '#') ground[col] = 1;
            else if (chr === '_' || chr === '.') ground[col] = 0;
            else { warnings.push('кусок ' + ch.n + ': в строке земли неизвестный символ «' + chr + '»'); ground[col] = 1; }
          } else {
            var t = CHAR[chr];
            if (t === undefined) { warnings.push('кусок ' + ch.n + ': неизвестный символ «' + chr + '»'); t = 0; }
            grid[row * width + col] = t;
          }
        }
      }
      x0 += ch.w;
    });

    return {
      index: index,
      def: def,
      name: def.name || ('Уровень ' + (index + 1)),
      speed: def.speed || 8,
      width: width,
      rows: rows,
      grid: grid,
      ground: ground,
      mapW: mapW,
      startX: C.START_X,
      finishX: C.START_PAD + mapW,
      warnings: warnings
    };
  }

  /* ---------- Доступ к клеткам ---------- */
  function cellAt(lv, c, r) {
    if (c < 0 || c >= lv.width || r < 0 || r >= lv.rows) return 0;
    return lv.grid[r * lv.width + c];
  }

  function solidAt(lv, c, r) {
    if (r < 0) return (c < 0 || c >= lv.width) ? true : lv.ground[c] === 1; // земля — сплошная вниз
    if (r >= lv.rows || c < 0 || c >= lv.width) return false;
    return lv.grid[r * lv.width + c] === 1;
  }

  // Ищет кольцо рядом с кубиком (кроме того, что уже сработало последним). Возвращает id клетки или -1.
  function findOrb(lv, s) {
    var cx = s.x, cy = s.y + C.SIZE / 2, R2 = C.ORB_R * C.ORB_R;
    var c1 = Math.floor(cx + 0.4), r1 = Math.floor(cy + 0.4);
    for (var c = Math.floor(cx - 1.4); c <= c1; c++) {
      for (var r = Math.max(0, Math.floor(cy - 1.4)); r <= r1; r++) {
        if (cellAt(lv, c, r) !== T.ORB) continue;
        var dx = c + 0.5 - cx, dy = r + 0.5 - cy;
        if (dx * dx + dy * dy < R2) {
          var id = r * lv.width + c;
          if (id !== s.lastOrb) return id;
        }
      }
    }
    return -1;
  }

  /* ---------- Состояние игрока ---------- */
  function newState(lv) {
    return { x: lv.startX, y: 0, vy: 0, grounded: true, coyote: C.COYOTE, lastOrb: -1, dead: 0, won: false };
  }

  function cloneState(s) {
    return { x: s.x, y: s.y, vy: s.vy, grounded: s.grounded, coyote: s.coyote, lastOrb: s.lastOrb, dead: s.dead, won: s.won };
  }

  function kill(s, ev, why) {
    s.dead = 1;
    if (ev) ev.dead = why;
    return s;
  }

  /*
   * Один шаг симуляции.
   *   jump — игрок хочет прыгнуть (держит палец или только что тапнул)
   *   orb  — свежий тап (для колец в воздухе)
   *   ev   — сюда записываются события для эффектов: jump, orb, pad, land, dead, win
   */
  function step(s, lv, jump, orb, ev) {
    var dt = C.DT, c, r;

    // 1. Ввод
    if (jump && (s.grounded || s.coyote > 0)) {
      s.vy = C.JUMP_V; s.grounded = false; s.coyote = 0;
      if (ev) ev.jump = true;
    } else if (orb && !s.grounded) {
      var id = findOrb(lv, s);
      if (id >= 0) {
        s.vy = C.ORB_V; s.lastOrb = id; s.coyote = 0;
        if (ev) { ev.orb = true; ev.orbId = id; }
      }
    }
    var wasGrounded = s.grounded;

    // 2. Движение
    s.vy -= C.GRAVITY * dt;
    if (s.vy < -C.MAX_FALL) s.vy = -C.MAX_FALL;
    s.x += lv.speed * dt;
    s.y += s.vy * dt;
    s.grounded = false;

    // 3. Блоки и земля: встать сверху можно, врезаться сбоку или снизу — смерть
    var x0 = s.x - C.SIZE / 2, x1 = s.x + C.SIZE / 2;
    var c0 = Math.floor(x0), c1 = Math.floor(x1 - EPS);
    var r0 = Math.floor(s.y), r1 = Math.floor(s.y + C.SIZE - EPS);
    var tol = C.LAND_TOL + (s.vy < 0 ? -s.vy * dt : 0);
    var land = -1e9;
    for (c = c0; c <= c1; c++) {
      for (r = r0; r <= r1; r++) {
        if (!solidAt(lv, c, r)) continue;
        var pen = r + 1 - s.y;
        if (pen <= EPS) continue;
        if (pen <= tol) { if (r + 1 > land) land = r + 1; }
        else return kill(s, ev, 'crash');
      }
    }
    if (land > -1e9) {
      s.y = land;
      if (s.vy <= 0) {
        s.vy = 0; s.grounded = true;
        if (ev && !wasGrounded) ev.land = true;
      }
      r0 = Math.floor(s.y + EPS); r1 = Math.floor(s.y + C.SIZE - EPS);
      for (c = c0; c <= c1; c++) for (r = r0; r <= r1; r++) if (solidAt(lv, c, r)) return kill(s, ev, 'crash');
    }

    if (s.grounded) s.coyote = C.COYOTE;
    else if (s.coyote > 0) s.coyote = Math.max(0, s.coyote - dt);

    // 4. Шипы и батуты
    var hx0 = x0 + C.HAZ_INSET, hx1 = x1 - C.HAZ_INSET;
    var hy0 = s.y + C.HAZ_INSET, hy1 = s.y + C.SIZE - C.HAZ_INSET;
    var pad = false;
    var rr0 = Math.max(0, Math.floor(s.y)), rr1 = Math.floor(s.y + C.SIZE - EPS);
    for (c = c0; c <= c1; c++) {
      for (r = rr0; r <= rr1; r++) {
        var t = cellAt(lv, c, r);
        if (t < 2) continue;
        if (t === T.SPIKE) {
          if (hx1 > c + 0.3 && hx0 < c + 0.7 && hy0 < r + 0.55 && hy1 > r) return kill(s, ev, 'spike');
        } else if (t === T.CEIL) {
          if (hx1 > c + 0.3 && hx0 < c + 0.7 && hy1 > r + 0.45 && hy0 < r + 1) return kill(s, ev, 'spike');
        } else if (t === T.SMALL) {
          if (hx1 > c + 0.3 && hx0 < c + 0.7 && hy0 < r + 0.3 && hy1 > r) return kill(s, ev, 'spike');
        } else if (t === T.PAD) {
          if (x1 > c + 0.1 && x0 < c + 0.9 && s.y < r + 0.25) pad = true;
        }
      }
    }
    if (pad && s.vy < C.PAD_V * 0.5) {
      s.vy = C.PAD_V; s.grounded = false; s.coyote = 0;
      if (ev) ev.pad = true;
    }

    // 5. Яма и финиш
    if (s.y < C.DEATH_Y) return kill(s, ev, 'fall');
    if (s.x >= lv.finishX) { s.won = true; if (ev) ev.win = true; }
    return s;
  }

  function progress(lv, x) {
    var p = (x - lv.startX) / (lv.finishX - lv.startX);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  var Physics = {
    C: C, T: T,
    parseLevel: parseLevel,
    cellAt: cellAt, solidAt: solidAt, findOrb: findOrb,
    newState: newState, cloneState: cloneState,
    step: step, progress: progress
  };

  root.Physics = Physics;
  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
})(typeof window !== 'undefined' ? window : this);
