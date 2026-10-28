/* =====================================================================
   KP56 Gold Analysis — candle-validator.js   (Task 9)
   Validates OHLC candle records BEFORE any analysis runs.

   Nothing here invents data. A candle that fails validation is reported and
   dropped — it is never repaired, interpolated or replaced, because a
   fabricated candle presented as market data would be a lie.

   INPUT  : array of { time, open, high, low, close, volume? }
   OUTPUT : {
              ok,            // true when enough valid completed candles remain
              candles,       // cleaned, chronological, completed candles only
              issues,        // [{ type, index, message }]
              stats          // { received, valid, duplicates, gaps, incomplete, dropped }
            }

   Candle completeness rule
   ------------------------
   A candle for timeframe T is COMPLETE when  candle.time + T <= now.
   An unfinished candle can still change shape, so it must not be used for a
   confirmed signal. It is excluded by default (useCompletedOnly: true).
   ===================================================================== */
(function (global) {
  'use strict';

  var TIMEFRAME_MS = {
    M5: 5 * 60 * 1000,
    M15: 15 * 60 * 1000,
    H1: 60 * 60 * 1000
  };

  var MAX_CANDLES = 500;   // analysis window requested in Task 9

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function timeframeMs(timeframe) {
    return TIMEFRAME_MS[timeframe] || null;
  }

  /** A candle is complete when its own bar window has fully elapsed. */
  function isComplete(candle, stepMs, now) {
    if (!candle || !isFiniteNumber(candle.time) || !isFiniteNumber(stepMs)) { return false; }
    return (candle.time + stepMs) <= now;
  }

  /**
   * @param {Array} candles   raw records (may be invalid)
   * @param {string} timeframe 'M5' | 'M15' | 'H1'
   * @param {object} [options] { now, useCompletedOnly, minCandles, maxCandles }
   */
  function validate(candles, timeframe, options) {
    var opts = options || {};
    var now = isFiniteNumber(opts.now) ? opts.now : Date.now();
    var useCompletedOnly = opts.useCompletedOnly !== false;
    var minCandles = isFiniteNumber(opts.minCandles) ? opts.minCandles : 20;
    var maxCandles = isFiniteNumber(opts.maxCandles) ? opts.maxCandles : MAX_CANDLES;

    var issues = [];
    var stats = {
      received: 0, valid: 0, duplicates: 0, gaps: 0, incomplete: 0, dropped: 0, outOfOrder: 0
    };

    function fail(index, type, message) {
      issues.push({ type: type, index: index, message: message });
      stats.dropped++;
    }

    if (!Array.isArray(candles)) {
      return {
        ok: false,
        candles: [],
        issues: [{ type: 'input', index: -1, message: 'Candle input is not an array.' }],
        stats: stats
      };
    }

    stats.received = candles.length;
    var step = timeframeMs(timeframe);
    if (!step) {
      issues.push({ type: 'timeframe', index: -1, message: 'Unknown timeframe "' + timeframe + '"; gap and completeness checks were skipped.' });
    }

    var clean = [];
    var prevTime = null;

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (!c || typeof c !== 'object') { fail(i, 'type', 'Record ' + i + ' is not an object.'); continue; }

      var t = c.time;
      if (!isFiniteNumber(t) || t <= 0) { fail(i, 'timestamp', 'Record ' + i + ' has an invalid timestamp.'); continue; }

      // Ordering, duplicates and gaps are checked against EVERY seen timestamp,
      // including records that are rejected for other reasons: a duplicate is a
      // duplicate whether or not the first copy had valid prices.
      if (prevTime !== null) {
        if (t === prevTime) {
          stats.duplicates++;
          fail(i, 'duplicate', 'Record ' + i + ' repeats the timestamp of the previous record.');
          prevTime = t;
          continue;
        }
        if (t < prevTime) {
          stats.outOfOrder++;
          fail(i, 'order', 'Record ' + i + ' is out of chronological order.');
          prevTime = t;
          continue;
        }
        if (step && (t - prevTime) !== step) {
          // Report the gap. We deliberately do NOT fabricate the missing bars.
          stats.gaps++;
          issues.push({
            type: 'gap', index: i,
            message: 'Time gap of ' + ((t - prevTime) / 60000) + ' minutes before record ' + i +
              '. Missing candles were not invented.'
          });
        }
      }
      prevTime = t;

      var o = c.open, h = c.high, l = c.low, cl = c.close;
      if (!isFiniteNumber(o) || !isFiniteNumber(h) || !isFiniteNumber(l) || !isFiniteNumber(cl)) {
        fail(i, 'non-numeric', 'Record ' + i + ' has a missing or non-numeric OHLC value.'); continue;
      }
      if (o <= 0 || h <= 0 || l <= 0 || cl <= 0) {
        fail(i, 'range', 'Record ' + i + ' has a non-positive price.'); continue;
      }

      // OHLC consistency
      if (h < l) { fail(i, 'ohlc', 'Record ' + i + ': high (' + h + ') is lower than low (' + l + ').'); continue; }
      if (h < o || h < cl) { fail(i, 'ohlc', 'Record ' + i + ': high is lower than open or close.'); continue; }
      if (l > o || l > cl) { fail(i, 'ohlc', 'Record ' + i + ': low is higher than open or close.'); continue; }

      // Completeness
      if (step && useCompletedOnly && !isComplete({ time: t }, step, now)) {
        stats.incomplete++;
        issues.push({ type: 'incomplete', index: i, message: 'Record ' + i + ' is an unfinished candle and is excluded from confirmed analysis.' });
        prevTime = t;
        continue;
      }

      clean.push({
        time: t,
        open: o, high: h, low: l, close: cl,
        volume: isFiniteNumber(c.volume) && c.volume >= 0 ? c.volume : null
      });
      prevTime = t;
    }

    if (clean.length > maxCandles) {
      clean = clean.slice(-maxCandles);   // keep the most recent completed candles
    }
    stats.valid = clean.length;

    var ok = clean.length >= minCandles;
    if (!ok) {
      issues.push({
        type: 'insufficient', index: -1,
        message: 'Only ' + clean.length + ' valid completed candles are available; at least ' + minCandles + ' are required.'
      });
    }

    return { ok: ok, candles: clean, issues: issues, stats: stats };
  }

  /** Human-readable one-line summary of a validation result. */
  function describe(result) {
    if (!result) { return 'No candle data.'; }
    var s = result.stats;
    return s.valid + ' valid completed candle(s) of ' + s.received + ' received · ' +
      s.dropped + ' dropped · ' + s.duplicates + ' duplicate · ' + s.gaps + ' gap(s) · ' +
      s.incomplete + ' incomplete.';
  }

  global.KP56CandleValidator = {
    validate: validate,
    isComplete: isComplete,
    describe: describe,
    timeframeMs: timeframeMs,
    MAX_CANDLES: MAX_CANDLES
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KP56CandleValidator; }

})(typeof window !== 'undefined' ? window : this);
