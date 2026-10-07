/*
 * solver.js — «робот», который перебирает все возможные моменты нажатий
 * и проверяет, что уровень проходим. Заодно меряет, насколько точным
 * должен быть каждый прыжок (окно в миллисекундах) — это и есть сложность.
 *
 * Используется в tools/check.html и в игре в режиме ?autoplay (бот проходит уровень сам).
 */
(function (root) {
  'use strict';
  var P = root.Physics;
  var C = P.C;

  function key(s) {
    return Math.round(s.y * 1e6) + ',' + Math.round(s.vy * 1e6) + ',' + (s.grounded ? 1 : 0) + ',' +
      Math.round(s.coyote * 1e6) + ',' + s.lastOrb;
  }

  function canAct(lv, s) {
    return s.grounded || s.coyote > 0 || P.findOrb(lv, s) >= 0;
  }

  function node(s) {
    return { s: s, k0: -1, k1: -1, w0: false, w1: false, win: false };
  }

  // Прыгнули в момент i цепочки «ждём» и дальше не нажимаем: вернёмся ли в ту же цепочку до момента F?
  function mergesBack(layers, L0, chain, i, F) {
    var m = chain[i];
    if (m.k1 < 0) return false;
    var LL = L0 + i + 1, x = layers[LL][m.k1];
    for (;;) {
      var ci = LL - L0;
      if (ci > F + 1) return false;
      if (ci < chain.length && chain[ci] === x) return true;
      if (ci === F + 1 && chain[F].k0 >= 0 && layers[LL][chain[F].k0] === x) return true;
      if (x.k0 < 0) return false;
      x = layers[LL + 1][x.k0]; LL++;
    }
  }

  function solve(lv, opts) {
    opts = opts || {};
    var maxNodes = opts.maxNodes || 4e6;
    var t0 = Date.now();

    // 1. Перебор вперёд: все различные состояния на каждом шаге
    var layers = [[node(P.newState(lv))]];
    var total = 1, t = 0, i, a, n;
    for (;;) {
      var cur = layers[t], next = [], idx = new Map();
      for (i = 0; i < cur.length; i++) {
        n = cur[i];
        var acts = canAct(lv, n.s) ? 2 : 1;
        for (a = 0; a < acts; a++) {
          var s = P.cloneState(n.s);
          P.step(s, lv, a === 1, a === 1, null);
          if (s.dead) continue;
          if (s.won) { if (a) n.w1 = true; else n.w0 = true; continue; }
          var k = key(s), j = idx.get(k);
          if (j === undefined) { j = next.length; idx.set(k, j); next.push(node(s)); }
          if (a) n.k1 = j; else n.k0 = j;
        }
      }
      total += next.length;
      if (!next.length || total > maxNodes) break;
      layers.push(next);
      t++;
    }

    // 2. Обратный проход: из каких состояний можно победить
    for (var L = layers.length - 1; L >= 0; L--) {
      var layer = layers[L], nx = layers[L + 1];
      for (i = 0; i < layer.length; i++) {
        n = layer[i];
        if (!n.w0 && n.k0 >= 0 && nx[n.k0].win) n.w0 = true;
        if (!n.w1 && n.k1 >= 0 && nx[n.k1].win) n.w1 = true;
        n.win = n.w0 || n.w1;
      }
    }

    var lastLayer = layers[layers.length - 1];
    var result = {
      ok: layers[0][0].win,
      farthestX: lastLayer.length ? lastLayer[0].s.x : lv.startX,
      ticks: layers.length,
      nodes: total,
      overflow: total > maxNodes,
      actions: null,
      windows: [],
      exact: [],
      ms: 0
    };

    if (result.ok) {
      // 3. Строим «человечный» путь: каждый прыжок — в середине своего окна
      // Если можно и прыгнуть, и подождать — смотрим вперёд по цепочке «ждём»:
      // находим все промежутки, где прыжок ещё спасает, и прыгаем в середине самого широкого.
      var actions = [];
      n = layers[0][0];
      var Lc = 0, plan = -1, prevGrounded = true;
      for (;;) {
        if (plan >= 0) {
          a = (plan === Lc) ? 1 : 0;
          if (a) plan = -1;
        } else if (n.w0 && n.w1) {
          // идём по цепочке «ждём» до последнего момента, когда ещё можно прыгнуть (F)
          var chain = [n], m = n, LL = Lc, forced = false;
          for (;;) {
            if (!m.w0) { forced = true; break; }
            if (m.k0 < 0 || LL - Lc > 400) break;
            m = layers[LL + 1][m.k0]; LL++;
            chain.push(m);
          }
          a = 0;
          if (forced) {
            // окно — подряд идущие моменты до F, когда прыжок спасает и не является «пустым»
            // (пустой прыжок — по ровному месту, после него оказываемся там же, где были бы без него)
            // берём самый широкий такой промежуток (их может быть несколько: например,
            // «запрыгнуть на ступеньку» или «перепрыгнуть её целиком»)
            var F = chain.length - 1, bestStart = F, bestLen = 1, runStart = -1;
            for (var ci = 0; ci <= F; ci++) {
              var good = chain[ci].w1 && (ci === F || !mergesBack(layers, Lc, chain, ci, F));
              if (good && runStart < 0) runStart = ci;
              if ((!good || ci === F) && runStart >= 0) {
                var end = good ? ci : ci - 1;
                if (end - runStart + 1 > bestLen) { bestLen = end - runStart + 1; bestStart = runStart; }
                runStart = -1;
              }
            }
            plan = Lc + bestStart + Math.floor((bestLen - 1) / 2);
            result.windows.push({ x: chain[bestStart].s.x, ticks: bestLen, ms: Math.round(bestLen * C.DT * 1000) });
            if (plan === Lc) { a = 1; plan = -1; }
          }
        } else {
          a = n.w1 ? 1 : 0;
          if (a === 1 && !n.w0) {
            // прыжок ровно в этот шаг; если только что приземлились — это просто «держи палец»
            result.exact.push({ x: n.s.x, hold: n.s.grounded && !prevGrounded });
          }
        }
        actions.push(a);
        prevGrounded = n.s.grounded;
        var kid = a ? n.k1 : n.k0;
        if (kid < 0) break; // победа на этом шаге
        n = layers[Lc + 1][kid];
        Lc++;
      }
      result.actions = actions;
    }

    var mins = result.windows.map(function (w) { return w.ticks; });
    result.minTicks = mins.length ? Math.min.apply(null, mins) : 0;
    result.jumps = result.actions ? result.actions.reduce(function (s, v) { return s + v; }, 0) : 0;
    result.ms = Date.now() - t0;
    return result;
  }

  root.Solver = { solve: solve };
})(typeof window !== 'undefined' ? window : this);
