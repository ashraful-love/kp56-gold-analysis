/* =====================================================================
   KP56 Gold Analysis — settings.js   (Task 2 — data layer)
   Non-sensitive UI preferences only.

   SECURITY RULE
   -------------
   Never store API keys, passwords or Telegram bot tokens in localStorage.
   Anything secret belongs on a backend server as an environment variable.

   SAVE SEMANTICS (the fix for the Settings dialog)
   -----------------------------------------------
   * load()             -> last SUCCESSFULLY saved preferences (or defaults)
   * validate(candidate)-> { ok, errors, value }   never throws
   * save(candidate)    -> validates, writes to storage, returns { ok, errors,
                           value, persisted }
   * resetToDefaults()  -> returns the defaults WITHOUT writing anything, so
                           "Reset" never persists before the user presses Save
   * clearStored()      -> removes the stored value (used by Reset after Save)
   ===================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'kp56.settings.v2';

  var DEFAULTS = {
    timeframe: 'M15',        // 'M5' | 'M15' | 'H1'
    minRR: 2,                // minimum reward-to-risk ratio (1:2 by default)
    riskPct: 1,              // percentage of account risked per trade
    maxSpread: 35,           // maximum spread in points (placeholder until live data)
    theme: 'dark',           // 'dark' | 'light'
    notify: false,           // notifications enabled
    notifyBuy: true,
    notifySell: true,
    notifyError: true,
    cooldown: 15,            // minutes between notifications

    // Entry-quality filters used by Test 3
    rsiMin: 35,
    rsiMax: 68,
    adxMin: 20,
    volMaxRatio: 1.55,       // ATR ratio versus recent reference
    maxDataAgeSeconds: 300   // data older than this is treated as stale
  };

  var ENUMS = {
    timeframe: ['M5', 'M15', 'H1'],
    theme: ['dark', 'light']
  };

  function clone(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

  function storageAvailable() {
    try {
      if (!global.localStorage) { return false; }
      var probe = '__kp56_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;   // private mode, disabled storage or quota problems
    }
  }

  function readRaw() {
    try {
      if (!global.localStorage) { return null; }
      var raw = global.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;    // corrupt JSON must never break the app
    }
  }

  function writeRaw(settings) {
    try {
      if (!global.localStorage) { return false; }
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch (err) {
      return false;
    }
  }

  function clearStored() {
    try {
      if (global.localStorage) { global.localStorage.removeItem(STORAGE_KEY); }
      return true;
    } catch (err) {
      return false;
    }
  }

  /** The documented defaults, as a fresh object. */
  function getDefaults() { return clone(DEFAULTS); }

  /**
   * Validates a candidate settings object.
   * Returns { ok, errors[], value } where `value` is always a safe, complete
   * settings object (defaults for anything invalid).
   */
  function validate(candidate) {
    var errors = [];
    var value = clone(DEFAULTS);
    candidate = candidate || {};

    if (ENUMS.timeframe.indexOf(candidate.timeframe) === -1) {
      errors.push('Preferred timeframe must be M5, M15 or H1.');
    } else { value.timeframe = candidate.timeframe; }

    var minRR = Number(candidate.minRR);
    if (!isFinite(minRR) || minRR < 1 || minRR > 20) {
      errors.push('Minimum risk/reward must be a number between 1 and 20.');
    } else { value.minRR = minRR; }

    var riskPct = Number(candidate.riskPct);
    if (!isFinite(riskPct) || riskPct <= 0 || riskPct > 100) {
      errors.push('Risk percentage must be between 0.01 and 100.');
    } else { value.riskPct = riskPct; }

    var maxSpread = Number(candidate.maxSpread);
    if (!isFinite(maxSpread) || maxSpread < 0) {
      errors.push('Maximum spread must be zero or more points.');
    } else { value.maxSpread = maxSpread; }

    var cooldown = Number(candidate.cooldown);
    if (!isFinite(cooldown) || cooldown < 0 || cooldown > 1440) {
      errors.push('Cooldown must be between 0 and 1440 minutes.');
    } else { value.cooldown = cooldown; }

    var rsiMin = Number(candidate.rsiMin);
    var rsiMax = Number(candidate.rsiMax);
    if (!isFinite(rsiMin) || rsiMin < 0 || rsiMin > 100) {
      errors.push('RSI minimum must be between 0 and 100.');
    } else { value.rsiMin = rsiMin; }
    if (!isFinite(rsiMax) || rsiMax < 0 || rsiMax > 100) {
      errors.push('RSI maximum must be between 0 and 100.');
    } else if (rsiMax <= value.rsiMin) {
      errors.push('RSI maximum must be greater than RSI minimum.');
    } else { value.rsiMax = rsiMax; }

    var adxMin = Number(candidate.adxMin);
    if (!isFinite(adxMin) || adxMin < 0 || adxMin > 100) {
      errors.push('ADX minimum must be between 0 and 100.');
    } else { value.adxMin = adxMin; }

    var volMax = Number(candidate.volMaxRatio);
    if (!isFinite(volMax) || volMax <= 0 || volMax > 20) {
      errors.push('Maximum volatility ratio must be greater than zero and at most 20.');
    } else { value.volMaxRatio = volMax; }

    var maxAge = Number(candidate.maxDataAgeSeconds);
    if (!isFinite(maxAge) || maxAge < 1 || maxAge > 86400) {
      errors.push('Maximum data age must be between 1 and 86400 seconds.');
    } else { value.maxDataAgeSeconds = maxAge; }

    if (ENUMS.theme.indexOf(candidate.theme) === -1) {
      errors.push('Theme must be dark or light.');
    } else { value.theme = candidate.theme; }

    value.notify = !!candidate.notify;
    value.notifyBuy = !!candidate.notifyBuy;
    value.notifySell = !!candidate.notifySell;
    value.notifyError = !!candidate.notifyError;

    return { ok: errors.length === 0, errors: errors, value: value };
  }

  /**
   * Loads the last successfully saved preferences.
   * Falls back to defaults field by field — it never overwrites saved values
   * with defaults unless they are missing or invalid.
   */
  function load() {
    var stored = readRaw();
    if (!stored || typeof stored !== 'object') { return clone(DEFAULTS); }

    var merged = clone(DEFAULTS);
    Object.keys(DEFAULTS).forEach(function (key) {
      if (stored[key] !== undefined) { merged[key] = stored[key]; }
    });

    // Validate the merged result so a hand-edited or corrupt value cannot break the app.
    var checked = validate(merged);
    return checked.value;
  }

  /**
   * Validates and persists. Returns { ok, errors, value, persisted }.
   * `persisted` is false when storage is unavailable — the values are still
   * returned so the caller can apply them for the session.
   */
  function save(candidate) {
    var result = validate(candidate);
    if (!result.ok) { return { ok: false, errors: result.errors, value: result.value, persisted: false }; }
    var persisted = writeRaw(result.value);
    return { ok: true, errors: [], value: result.value, persisted: persisted };
  }

  /** Returns the defaults WITHOUT persisting anything. */
  function resetToDefaults() { return clone(DEFAULTS); }

  function applyTheme(theme) {
    if (typeof document === 'undefined' || !document.documentElement) { return; }
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  global.KP56Settings = {
    DEFAULTS: DEFAULTS,
    STORAGE_KEY: STORAGE_KEY,
    getDefaults: getDefaults,
    validate: validate,
    load: load,
    save: save,
    resetToDefaults: resetToDefaults,
    clearStored: clearStored,
    storageAvailable: storageAvailable,
    applyTheme: applyTheme
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KP56Settings; }

})(typeof window !== 'undefined' ? window : this);
