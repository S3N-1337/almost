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
    if (!tg) return;
    try { tg.ready(); } catch (e) { }
    if (!inTG) return;
    try { tg.expand(); } catch (e) { }
    try { if (ver('7.7') && tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { }
    try { if (ver('6.1')) tg.setBackgroundColor(BG); } catch (e) { }
    try {
      if (ver('6.9')) tg.setHeaderColor(BG);
      else if (ver('6.1')) tg.setHeaderColor('bg_color');
    } catch (e) { }
    try { if (ver('7.10') && tg.setBottomBarColor) tg.setBottomBarColor(BG); } catch (e) { }

    // Полноэкранный режим без шапки Telegram (Bot API 8.0+). Только на телефонах:
    // на компьютере вертикальная игра на весь монитор смотрится хуже.
    try {
      if (ver('8.0') && isMobile() && typeof tg.requestFullscreen === 'function' && !tg.isFullscreen) tg.requestFullscreen();
    } catch (e) { }
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
    showBack: showBack,
    haptic: haptic,
    load: load,
    save: save,
    flush: flush
  };
})();
