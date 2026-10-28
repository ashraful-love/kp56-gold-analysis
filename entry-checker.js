/* =====================================================================
   KP56 Gold Analysis — entry-checker.js   (Task 6 — Validation Test 3)
   Entry quality on M5, using the user's saved settings.

   RULES
   -----
   1. rsi            RSI(14) inside the configured window (default 35-68)
   2. adx            ADX(14) at or above the configured minimum (default 20)
   3. atr_volatility ATR ratio at or below the configured maximum (default 1.55)
   4. spread         real spread <= configured maximum, or WAITING when the
                     spread is genuinely unavailable (never fabricated)
   5. candle_close   the trigger candle must be closed
   6. freshness      data age must be within the configured limit and the
                     provider must be LIVE; stale/missing data blocks a signal
   7. availability   every required indicator must actually be computable

   RESULT CONTRACT: see trend-checker.js.
   ===================================================================== */
(function (global) {
  'use strict';

  var I = global.KP56Indicators;

  function row(id, label, value, state, note) {
    return { id: id, label: label, value: value, state: state, note: note || '' };
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function evaluate(ctx) {
    var rows = [];
    var missing = [];
    var reasons = [];

    if (!ctx || !ctx.candles || !ctx.candles.M5) {
      return {
        key: 'entry', name: 'Test 3 - Entry quality checker', mandatory: true,
        status: 'WAITING', direction: 'unknown', conflict: false,
        summary: 'No candle dataset has been supplied to this test.',
        rows: [row('input', 'Input data', 'NOT SUPPLIED', 'wait', 'Waiting for a dataset.')],
        reasons: ['No data supplied.'], missing: ['Candle dataset for M5']
      };
    }

    var settings = ctx.settings || {};
    var rsiMin = num(settings.rsiMin, 35);
    var rsiMax = num(settings.rsiMax, 68);
    var adxMin = num(settings.adxMin, 20);
    var volMax = num(settings.volMaxRatio, 1.55);
    var maxSpread = num(settings.maxSpread, 35);
    var maxDataAge = num(settings.maxDataAgeSeconds, 300);

    var m5 = I.sanitizeCandles(ctx.candles.M5);
    var closes = I.closesOf(m5);

    // ---- required indicator availability
    var rsiVal = closes.length > 14 ? I.rsi(closes, 14) : null;
    var adxVal = I.adx(m5, 14);
    var vol = I.volatility(m5, 14, m5.length > 60 ? m5.slice(-60) : m5);

    var unavailable = [];
    if (rsiVal === null) { unavailable.push('RSI(14)'); }
    if (!adxVal.available) { unavailable.push('ADX(14)'); }
    if (!vol.available) { unavailable.push('ATR(14)'); }
    if (unavailable.length) {
      unavailable.forEach(function (name) { missing.push('Enough candles to compute ' + name + '.'); });
    }
    rows.push(row('availability', 'Required indicators',
      unavailable.length ? 'MISSING: ' + unavailable.join(', ') : 'RSI, ADX, ATR all available',
      unavailable.length ? 'wait' : 'pass',
      unavailable.length
        ? 'An indicator is never computed from too little history - it is reported as unavailable instead.'
        : 'RSI(14), ADX(14) and ATR(14) computed on ' + m5.length + ' completed M5 candles.'));

    // ---- 1. RSI
    rows.push(row('rsi', 'RSI (14) window ' + rsiMin + '-' + rsiMax,
      rsiVal === null ? 'UNAVAILABLE' : String(rsiVal),
      rsiVal === null ? 'wait' : (rsiVal >= rsiMin && rsiVal <= rsiMax ? 'pass' : 'fail'),
      rsiVal === null
        ? 'Not enough M5 candles for RSI(14) (needs 15 or more).'
        : (rsiVal >= rsiMin && rsiVal <= rsiMax
            ? 'Inside the configured entry window.'
            : 'Outside the configured window; momentum is either exhausted or too weak.')));

    // ---- 2. ADX
    rows.push(row('adx', 'ADX (14) minimum ' + adxMin,
      adxVal.available ? String(adxVal.adx) : 'UNAVAILABLE',
      adxVal.available ? (adxVal.adx >= adxMin ? 'pass' : 'fail') : 'wait',
      adxVal.available
        ? '+DI ' + adxVal.plusDI + ', -DI ' + adxVal.minusDI + '.'
        : adxVal.reason));

    // ---- 3. ATR / volatility
    rows.push(row('atr_volatility', 'ATR volatility ratio (max ' + volMax + ')',
      vol.available && vol.ratio !== null ? String(vol.ratio) : (vol.available ? String(vol.atr) : 'UNAVAILABLE'),
      vol.available ? (vol.ratio === null ? 'wait' : (vol.ratio <= volMax ? 'pass' : 'fail')) : 'wait',
      vol.available
        ? 'ATR(14) ' + vol.atr + ' versus recent reference ' + (vol.atrReference === null ? 'n/a' : vol.atrReference) +
          '. Expanded volatility widens slippage risk.'
        : vol.reason));

    // ---- 4. Spread (never fabricated)
    var spread = ctx.spread;
    var spreadKnown = typeof spread === 'number' && isFinite(spread) && spread >= 0;
    rows.push(row('spread', 'Spread (max ' + maxSpread + ' points)',
      spreadKnown ? spread + ' points' : 'UNAVAILABLE',
      spreadKnown ? (spread <= maxSpread ? 'pass' : 'fail') : 'wait',
      spreadKnown
        ? (spread <= maxSpread ? 'Within the configured maximum.' : 'Above the configured maximum.')
        : 'No live broker feed exists, so no real spread can be measured. A spread is never invented.'));
    if (!spreadKnown) { missing.push('A real spread measurement from the broker feed.'); }

    // ---- 5. Candle close
    var closed = ctx.candleClosed !== false;
    rows.push(row('candle_close', 'Candle-close confirmation',
      closed ? 'CONFIRMED' : 'CANDLE STILL OPEN',
      closed ? 'pass' : 'fail',
      closed ? 'Only completed candles are used for confirmed signals.'
             : 'The trigger candle is still forming; it must close first.'));
    if (!closed) { missing.push('A closed trigger candle.'); }

    // ---- 6. Data freshness
    var status = ctx.dataStatus || { mode: 'DEMO', live: false, providerName: 'unknown' };
    var age = isFinite(Number(ctx.dataAgeSeconds)) ? Number(ctx.dataAgeSeconds) : null;
    var fresh = status.live === true && age !== null && age <= maxDataAge;
    rows.push(row('freshness', 'Data freshness',
      status.live ? (age === null ? 'UNKNOWN AGE' : age + 's old') : 'DEMO / SYNTHETIC',
      fresh ? 'pass' : 'fail',
      status.live
        ? (age === null ? 'The provider reports live data but no timestamp age.'
            : (age <= maxDataAge ? 'Within the configured limit of ' + maxDataAge + 's.'
                : 'Older than the configured limit of ' + maxDataAge + 's - stale data blocks a live signal.'))
        : 'Provider "' + (status.providerName || 'unknown') + '" reports mode ' + (status.mode || 'UNKNOWN') +
          '. Demo data can never satisfy a freshness test.'));
    if (!fresh) { missing.push('Verified, fresh live data (currently ' + (status.mode || 'UNKNOWN') + ').'); }

    // ---- entry location (premium / discount) — Part 5 integration
    var range = global.KP56SMC && m5.length ? global.KP56SMC.analyseRange(m5, 'M5', ctx.source || 'candle data') : null;
    var locOk = !!(range && range.available && range.state !== 'near equilibrium');
    rows.push(row('entry_location', 'Entry location (premium / discount)',
      range && range.available ? range.state.toUpperCase() + ' (eq ' + range.equilibrium + ')' : 'UNAVAILABLE',
      range && range.available ? (locOk ? 'pass' : 'wait') : 'wait',
      range && range.available ? range.explanation
        : (range && range.unavailable && range.unavailable.length ? range.unavailable[0].reason : 'No dealing range available.')));
    if (!range || !range.available) { missing.push('A reliable dealing range for entry location.'); }

    // ---- screenshot honesty: numerical indicators are NOT readable from an image
    var fromImage = String(ctx.source || '').indexOf('screenshot') !== -1;
    if (fromImage) {
      rows.forEach(function (r) {
        if (r.id === 'rsi' || r.id === 'adx' || r.id === 'atr_volatility' || r.id === 'spread') {
          r.state = 'wait';
          r.value = 'NOT READABLE FROM A SCREENSHOT';
          r.note = 'RSI, ADX, ATR and spread cannot be read reliably from an image and are never invented.';
        }
      });
    }

    // ---- status
    var fails = rows.filter(function (r) { return r.state === 'fail'; }).length;
    var waits = rows.filter(function (r) { return r.state === 'wait'; }).length;

    var resultStatus;
    if (fails > 0) {
      resultStatus = 'FAIL';
      reasons.push(fails + ' entry-quality rule(s) failed.');
    } else if (waits > 0) {
      resultStatus = 'WAITING';
      reasons.push(waits + ' required input(s) are unavailable, so entry quality cannot be confirmed.');
    } else {
      resultStatus = 'PASS';
      reasons.push('All entry-quality rules passed with the configured settings.');
    }

    return {
      key: 'entry', name: 'Test 3 - Entry quality checker', mandatory: true,
      status: resultStatus,
      direction: 'neutral',
      conflict: false,
      summary: resultStatus === 'PASS'
        ? 'Entry quality is acceptable under the saved settings (RSI window ' + rsiMin + '-' + rsiMax +
          ', ADX minimum ' + adxMin + ', volatility ratio maximum ' + volMax + ').'
        : 'Entry quality is not confirmed. ' + reasons.join(' '),
      rows: rows, reasons: reasons, missing: missing
    };
  }

  global.EntryChecker = { evaluate: evaluate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.EntryChecker; }

})(typeof window !== 'undefined' ? window : this);
