/*
 * platform.js — всё, что связано с Telegram Mini App:
 *   - ready(), expand(), отключение вертикальных свайпов
 *   - полноэкранный режим без шапки и фиксация вертикальной ориентации (Telegram 8.0+)
 *   - вибрация (HapticFeedback)
 *   - кнопка «Назад» в шапке Telegram
 *   - сохранение прогресса: Telegram CloudStorage, а в обычном браузере — localStorage
 *
 * Вне Telegram всё работает так же, просто без облака и родной вибрации.
 */
var Platform = (function () {
  'use strict';

  var BG = '#07050f';
  var KEY = 'almost_save_v1';
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  // SDK загружается и в обычном браузере, но initData там пустая
  var inTG = !!(tg && typeof tg.initData === 'string' && tg.initData.length > 0);

  function ver(v) {
    try { return !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v)); } catch (e) { return false; }
  }

  var cloud = inTG && ver('6.9') && tg.CloudStorage ? tg.CloudStorage : null;
  var backHandler = null;

  function init(opts) {
    opts = opts || {};
    backHandler = opts.onBack || null;
    if (!tg) { tryFullscreen('при запуске'); return; } // только запишет причину для диагностики
    try { tg.ready(); } catch (e) { }
    if (!inTG) { tryFullscreen('при запуске'); return; }
    try { tg.expand(); } catch (e) { }
    try { if (ver('7.7') && tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { }
    try { if (ver('6.1')) tg.setBackgroundColor(BG); } catch (e) { }
    try {
      if (ver('6.9')) tg.setHeaderColor(BG);
      else if (ver('6.1')) tg.setHeaderColor('bg_color');
    } catch (e) { }
    try { if (ver('7.10') && tg.setBottomBarColor) tg.setBottomBarColor(BG); } catch (e) { }

    // ответы Telegram на запрос полного экрана — для экрана диагностики
    try {
      tg.onEvent('fullscreenChanged', function () { log('fullscreenChanged → ' + (tg.isFullscreen ? 'полный экран' : 'обычный режим')); });
      tg.onEvent('fullscreenFailed', function (e) { diag.failed = (e && e.error) || '?'; log('fullscreenFailed → ' + diag.failed); });
    } catch (e) { }
    tryFullscreen('при запуске');
    lockPortrait();

    // при смене размера, полноэкранного режима или безопасных зон — пересчитать раскладку.
    // Небольшая задержка: Telegram сначала обновляет CSS-переменные --tg-*-safe-area-inset-*, потом мы их читаем.
    if (opts.onResize) {
      var relayout = function () { setTimeout(opts.onResize, 30); };
      ['viewportChanged', 'fullscreenChanged', 'safeAreaChanged', 'contentSafeAreaChanged'].forEach(function (name) {
        try { tg.onEvent(name, relayout); } catch (e) { }
      });
    }
    try { if (opts.onPause && ver('8.0')) tg.onEvent('deactivated', opts.onPause); } catch (e) { }
    try {
      if (ver('6.1') && tg.BackButton) tg.BackButton.onClick(function () { if (backHandler) backHandler(); });
    } catch (e) { }
  }

  function isMobile() {
    return /^(android|ios)/.test(String(tg && tg.platform));
  }

  /* ---------- Полноэкранный режим ---------- */
  var diag = { fs: 'ещё не запрашивали', failed: '', events: [] };
  function log(s) {
    diag.events.push(new Date().toTimeString().slice(0, 8) + '  ' + s);
    if (diag.events.length > 10) diag.events.shift();
  }

  // Полный экран без шапки Telegram (Bot API 8.0+). Только на телефонах:
  // на компьютере вертикальная игра на весь монитор смотрится хуже.
  function tryFullscreen(why) {
    if (!tg) { diag.fs = 'нет: Telegram SDK не загрузился'; return; }
    if (!inTG) { diag.fs = 'нет: игра открыта не как мини-приложение (initData пустая)'; return; }
    if (!ver('8.0')) { diag.fs = 'нет: Telegram поддерживает только API ' + tg.version + ' (нужно 8.0+)'; return; }
    if (!isMobile()) { diag.fs = 'нет: не телефон (' + tg.platform + ')'; return; }
    if (typeof tg.requestFullscreen !== 'function') { diag.fs = 'нет: в SDK нет requestFullscreen'; return; }
    if (tg.isFullscreen) { diag.fs = 'уже полный экран'; return; }
    try {
      tg.requestFullscreen();
      diag.fs = 'запрос отправлен (' + why + ')';
      log('requestFullscreen (' + why + ')');
    } catch (e) { diag.fs = 'ошибка: ' + e.message; log('ошибка: ' + e.message); }
  }

  // Некоторые версии Telegram разрешают полный экран только после касания —
  // поэтому при первом касании пробуем ещё раз.
  var gestureDone = false;
  function onUserGesture() {
    if (gestureDone) return;
    gestureDone = true;
    if (inTG && !tg.isFullscreen && diag.failed !== 'UNSUPPORTED') tryFullscreen('после касания');
    lockPortrait();
  }

  function cssVar(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '—'; } catch (e) { return '?'; }
  }

  // Строки для экрана диагностики (5 тапов по логотипу)
  function diagnostics() {
    var L = [];
    L.push('Telegram SDK: ' + (tg ? 'загружен' : 'НЕ ЗАГРУЖЕН (нет доступа к telegram.org?)'));
    L.push('Мини-приложение (initData): ' + (inTG ? 'да, ' + tg.initData.length + ' симв.' : 'НЕТ'));
    if (tg) {
      L.push('Версия API Telegram: ' + tg.version + ' · платформа: ' + tg.platform);
      L.push('Поддержка 8.0: ' + (ver('8.0') ? 'да' : 'нет') + ' · requestFullscreen в SDK: ' + (typeof tg.requestFullscreen === 'function' ? 'есть' : 'нет'));
      L.push('Полный экран сейчас: ' + (tg.isFullscreen ? 'ДА' : 'нет'));
      L.push('Запрос полного экрана: ' + diag.fs);
      if (diag.failed) L.push('Telegram отказал: ' + diag.failed);
      L.push('Ориентация зафиксирована: ' + (orientationLocked ? 'да' : 'нет') + (tg.isOrientationLocked !== undefined ? ' (Telegram: ' + tg.isOrientationLocked + ')' : ''));
      var sa = tg.safeAreaInset || {}, ca = tg.contentSafeAreaInset || {};
      L.push('safeAreaInset: верх ' + (sa.top || 0) + ', низ ' + (sa.bottom || 0));
      L.push('contentSafeAreaInset: верх ' + (ca.top || 0) + ', низ ' + (ca.bottom || 0));
    }
    L.push('CSS --tg-safe-area-inset-top: ' + cssVar('--tg-safe-area-inset-top'));
    L.push('CSS --tg-content-safe-area-inset-top: ' + cssVar('--tg-content-safe-area-inset-top'));
    L.push('Экран: ' + window.innerWidth + '×' + window.innerHeight + ' · dpr ' + (window.devicePixelRatio || 1));
    L.push('Облачные сохранения: ' + (cloud ? 'да' : 'нет'));
    if (diag.events.length) { L.push(''); L.push('События:'); L = L.concat(diag.events); }
    return L;
  }

  // Фиксирует вертикальную ориентацию (Bot API 8.0+). Telegram фиксирует ТЕКУЩУЮ ориентацию,
  // поэтому если телефон сейчас лежит боком — ждём, пока его повернут вертикально (вызывается и при каждом resize).
  var orientationLocked = false;
  function lockPortrait() {
    if (orientationLocked || !inTG || !ver('8.0') || typeof tg.lockOrientation !== 'function') return;
    if (window.innerHeight < window.innerWidth) return;
    try { tg.lockOrientation(); orientationLocked = true; } catch (e) { }
  }

  function showBack(show) {
    if (!inTG || !ver('6.1') || !tg.BackButton) return;
    try { if (show) tg.BackButton.show(); else tg.BackButton.hide(); } catch (e) { }
  }

  // kind: 'jump' | 'death' | 'win' | 'tap' | 'error'
  function haptic(kind) {
    if (inTG && ver('6.1') && tg.HapticFeedback) {
      try {
        var h = tg.HapticFeedback;
        if (kind === 'jump') h.impactOccurred('light');
        else if (kind === 'death') h.impactOccurred('heavy');
        else if (kind === 'win') h.notificationOccurred('success');
        else if (kind === 'error') h.notificationOccurred('error');
        else h.selectionChanged();
      } catch (e) { }
      return;
    }
    // обычный браузер на Android тоже умеет вибрировать (но только после первого касания экрана)
    var ua = navigator.userActivation;
    if (navigator.vibrate && (!ua || ua.hasBeenActive)) {
      try { navigator.vibrate(kind === 'death' ? 35 : kind === 'win' ? [20, 40, 60] : kind === 'jump' ? 6 : 10); } catch (e) { }
    }
  }

  /* ---------- Сохранения ---------- */
  function readLocal() {
    try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  function writeLocal(str) {
    try { localStorage.setItem(KEY, str); } catch (e) { }
  }

  // cb вызывается сразу с локальными данными и ещё раз, когда придут данные из облака Telegram
  function load(cb) {
    cb(readLocal(), 'local');
    if (!cloud) return;
    try {
      cloud.getItem(KEY, function (err, val) {
        if (err || !val) return;
        try { cb(JSON.parse(val), 'cloud'); } catch (e) { }
      });
    } catch (e) { }
  }

  var pending = null, timer = 0;

  function save(obj) {
    var str = JSON.stringify(obj);
    writeLocal(str);
    if (!cloud) return;
    pending = str;
    if (!timer) timer = setTimeout(flush, 2000); // облако пишем не чаще раза в 2 секунды
  }

  function flush() {
    clearTimeout(timer); timer = 0;
    if (!cloud || pending === null) return;
    var str = pending; pending = null;
    try { cloud.setItem(KEY, str, function () { }); } catch (e) { }
  }

  return {
    tg: tg,
    isTelegram: inTG,
    hasCloud: !!cloud,
    init: init,
    lockPortrait: lockPortrait,
    onUserGesture: onUserGesture,
    tryFullscreen: tryFullscreen,
    diagnostics: diagnostics,
    showBack: showBack,
    haptic: haptic,
    load: load,
    save: save,
    flush: flush
  };
})();
