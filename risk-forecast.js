/* =====================================================================
   KP56 Gold Analysis — risk-forecast.js
   * Task 7 — Validation Test 4: risk & forecast validator
   * Risk arithmetic for the calculator (direction-aware)
   * The 50-candle forecast placeholder (kept honest)

   DIRECTIONALLY CORRECT GEOMETRY
   ------------------------------
   BUY  : stop loss BELOW entry, targets ABOVE entry, TP2 above TP1.
   SELL : stop loss ABOVE entry, targets BELOW entry, TP2 below TP1.
   risk distance  = |entry - stop loss|
   reward distance= |target - entry|
   R:R            = reward / risk   (never divide by zero)

   FORECAST POLICY
   ---------------
   No forecasting model is implemented. Forecast validation is therefore a
   MANDATORY condition that returns WAITING, which blocks a real signal. The
   illustrative paths drawn in the panel are clearly labelled hypothetical.

   RESULT CONTRACT: see trend-checker.js.
   ===================================================================== */
(function (global) {
  'use strict';

  var I = global.KP56Indicators;

  function row(id, label, value, state, note) {
    return { id: id, label: label, value: value, state: state, note: note || '' };
  }

  function finite(v) { var n = Number(v); return isFinite(n) ? n : null; }

  /* ---------------- directional geometry helper ---------------- */

  /**
   * Validates trade geometry for a given direction.
   * @returns {{ok:boolean, errors:string[], risk:number|null, reward:number|null, rr:number|null}}
   */
  function validateGeometry(plan, direction) {
    var errors = [];
    var entry = finite(plan.entry);
    var sl = finite(plan.sl);
    var tp1 = finite(plan.tp1);
    var tp2 = plan.tp2 === undefined || plan.tp2 === null || plan.tp2 === '' ? null : finite(plan.tp2);
    var dir = (direction || plan.direction || '').toUpperCase();

    if (entry === null || entry <= 0) { errors.push('Entry price is missing or not a positive number.'); }
    if (sl === null || sl <= 0) { errors.push('Stop loss price is missing or not a positive number.'); }
    if (tp1 === null || tp1 <= 0) { errors.push('TP1 price is missing or not a positive number.'); }

    if (dir !== 'BUY' && dir !== 'SELL') {
      errors.push('Direction must be BUY or SELL; received "' + (dir || 'nothing') + '".');
    }

    if (!errors.length) {
      var risk = dir === 'BUY' ? entry - sl : sl - entry;
      if (risk <= 0) {
        errors.push(dir === 'BUY'
          ? 'Invalid BUY geometry: the stop loss must be BELOW the entry price.'
          : 'Invalid SELL geometry: the stop loss must be ABOVE the entry price.');
      }
      if (risk === 0) { errors.push('Zero risk distance is not allowed.'); }

      var reward = dir === 'BUY' ? tp1 - entry : entry - tp1;
      if (reward <= 0) {
        errors.push(dir === 'BUY'
          ? 'Invalid BUY target: TP1 must be ABOVE the entry price.'
          : 'Invalid SELL target: TP1 must be BELOW the entry price.');
      }

      if (tp2 !== null) {
        if (tp2 <= 0) { errors.push('TP2 price must be a positive number.'); }
        else if (dir === 'BUY' && tp2 <= tp1) { errors.push('Invalid BUY target order: TP2 must be above TP1.'); }
        else if (dir === 'SELL' && tp2 >= tp1) { errors.push('Invalid SELL target order: TP2 must be below TP1.'); }
      }

      return {
        ok: errors.length === 0,
        errors: errors,
        risk: risk > 0 ? I.round(risk, 4) : null,
        reward: reward > 0 ? I.round(reward, 4) : null,
        rr: (risk > 0 && reward > 0) ? I.round(reward / risk, 3) : null
      };
    }

    return { ok: false, errors: errors, risk: null, reward: null, rr: null };
  }

  /* ---------------- risk arithmetic (calculator) ---------------- */

  /**
   * @param {{balance, riskPct, entry, sl, target}} input
   * @param {{contractSize, tickValue, tickSize}} broker
   * @param {string} direction 'BUY' | 'SELL'
   */
  function calculateRisk(input, broker, direction) {
    var errors = [];
    var balance = finite(input.balance);
    var riskPct = finite(input.riskPct);
    var entry = finite(input.entry);
    var sl = finite(input.sl);
    var hasTarget = input.target !== '' && input.target !== null && input.target !== undefined;
    var target = hasTarget ? finite(input.target) : null;
    var dir = (direction || 'BUY').toUpperCase();

    if (balance === null || balance <= 0) { errors.push('Account balance must be a number greater than zero.'); }
    if (riskPct === null || riskPct <= 0 || riskPct > 100) { errors.push('Risk percentage must be between 0.01 and 100.'); }
    if (entry === null || entry <= 0) { errors.push('Entry price must be a number greater than zero.'); }
    if (sl === null || sl <= 0) { errors.push('Stop loss price must be a number greater than zero.'); }
    if (entry !== null && sl !== null && entry === sl) { errors.push('Stop loss cannot equal the entry price (zero risk distance).'); }
    if (target !== null && target <= 0) { errors.push('Target price must be a positive number.'); }
    if (target !== null && entry !== null && target === entry) { errors.push('Target price cannot equal the entry price.'); }

    // Directional correctness
    if (!errors.length) {
      if (dir === 'BUY' && sl >= entry) { errors.push('For a BUY, the stop loss must be below the entry price.'); }
      if (dir === 'SELL' && sl <= entry) { errors.push('For a SELL, the stop loss must be above the entry price.'); }
      if (target !== null) {
        if (dir === 'BUY' && target <= entry) { errors.push('For a BUY, the target must be above the entry price.'); }
        if (dir === 'SELL' && target >= entry) { errors.push('For a SELL, the target must be below the entry price.'); }
      }
    }

    if (errors.length) {
      return {
        ok: false, errors: errors,
        riskAmount: null, stopDistance: null, targetDistance: null, rr: null, lotSize: null,
        lotNote: 'Calculation blocked until the input errors above are fixed.'
      };
    }

    var riskAmount = balance * (riskPct / 100);
    var stopDistance = Math.abs(entry - sl);
    var targetDistance = target === null ? null : Math.abs(target - entry);
    var rr = targetDistance === null ? null : targetDistance / stopDistance;

    var b = broker || {};
    var cs = finite(b.contractSize), tv = finite(b.tickValue), ts = finite(b.tickSize);
    var lotSize = null;
    var lotNote;
    if (cs !== null && cs > 0 && tv !== null && tv > 0 && ts !== null && ts > 0) {
      var valuePerPriceUnitPerLot = tv / ts;
      var lossPerLot = stopDistance * valuePerPriceUnitPerLot;
      if (lossPerLot > 0) {
        lotSize = Math.floor((riskAmount / lossPerLot) * 100) / 100;
        lotNote = 'ESTIMATE. risk amount / (stop distance x tick value / tick size). Brokers round lot sizes, ' +
          'charge commission and swap, so always verify on the broker platform. This website never places an order.';
      } else {
        lotNote = 'The broker specification produced a zero loss-per-lot value, so no size can be computed.';
      }
    } else {
      lotNote = 'Lot size deliberately withheld: broker contract size, tick value and tick size are not all configured.';
    }

    return {
      ok: true, errors: [],
      riskAmount: riskAmount,
      stopDistance: stopDistance,
      targetDistance: targetDistance,
      rr: rr,
      lotSize: lotSize,
      lotNote: lotNote
    };
  }

  /* ---------------- demonstration trade plan ---------------- */

  /**
   * Builds a clearly-labelled DEMO example plan with directionally correct
   * geometry. Illustration only - never a recommendation.
   */
  function buildDemoPlan(candles, direction, atrValue) {
    var cs = I.sanitizeCandles(candles);
    if (!cs.length) { return null; }
    var dir = (direction || 'BUY').toUpperCase();
    if (dir !== 'BUY' && dir !== 'SELL') { dir = 'BUY'; }

    var atr = finite(atrValue) || I.atr(cs, 14) || 4;
    var entry = I.round(I.last(cs).close);
    var sign = dir === 'BUY' ? 1 : -1;
    var sl = I.round(entry - sign * atr * 1.2);
    var tp1 = I.round(entry + sign * atr * 2.4);
    var tp2 = I.round(entry + sign * atr * 4.0);

    return {
      synthetic: true,
      direction: dir,
      entry: entry,
      sl: sl,
      tp1: tp1,
      tp2: tp2,
      rr: I.round((Math.abs(tp1 - entry) / Math.abs(entry - sl)) || 0, 2),
      invalidation: I.round(entry - sign * atr * 2.0),
      expiry: 'Valid until the next H1 candle close (demo example)',
      label: 'DEMO EXAMPLE - NOT A RECOMMENDATION'
    };
  }

  /* ---------------- forecast placeholder (kept honest) ---------------- */

  /**
   * Illustrative paths ONLY. `implemented` is false until a real, backtested
   * probabilistic model exists. Nothing here is a prediction.
   */
  function buildForecast(candles, horizon) {
    horizon = horizon || 50;
    var cs = I.sanitizeCandles(candles);
    if (cs.length < 20) { return null; }

    var atr = I.atr(cs, 14) || 2;
    var lastCandle = I.last(cs);
    var tfMs = cs.length > 1 ? (cs[1].time - cs[0].time) : 3600000;
    var start = lastCandle.time + tfMs;

    function path(drift, seedOffset) {
      var out = [];
      var price = lastCandle.close;
      for (var i = 0; i < horizon; i++) {
        var wobble = Math.sin((i + seedOffset) / 4.2) * atr * 0.45;
        var open = price;
        var close = open + drift + wobble * 0.35;
        out.push({
          time: start + i * tfMs,
          open: I.round(open),
          high: I.round(Math.max(open, close) + atr * 0.35),
          low: I.round(Math.min(open, close) - atr * 0.35),
          close: I.round(close),
          volume: null
        });
        price = close;
      }
      return out;
    }

    var bull = path(atr * 0.12, 1);
    var bear = path(-atr * 0.12, 3);
    var side = path(0, 5);

    return {
      implemented: false,
      status: 'FORECAST NOT AVAILABLE',
      horizon: horizon,
      synthetic: true,
      paths: { bull: bull, bear: bear, side: side },
      scenarios: {
        bull: { label: 'BULLISH (illustration)', end: I.round(bull[bull.length - 1].close) },
        bear: { label: 'BEARISH (illustration)', end: I.round(bear[bear.length - 1].close) },
        side: { label: 'SIDEWAYS (illustration)', end: I.round(side[side.length - 1].close) }
      },
      uncertainty: {
        low: null, high: null,
        note: 'NOT AVAILABLE. A calibrated uncertainty band requires a real probability model, which has not been built yet.'
      },
      missing: [
        'A documented probabilistic model over a 50-candle horizon',
        'Backtesting with measured error on out-of-sample data',
        'A calibrated confidence interval (no accuracy figure is claimed)'
      ],
      method: 'Illustrative deterministic paths only. Not a forecast, not a prediction, not a guarantee.'
    };
  }

  /**
   * Forecast validation — mandatory, therefore WAITING until implemented.
   */
  function assessForecast(forecast) {
    if (!forecast) {
      return {
        state: 'wait', value: 'NOT GENERATED',
        note: 'No forecast dataset exists. Forecast validation is mandatory, so the signal stays blocked.',
        missing: ['A validated forecasting model']
      };
    }
    if (forecast.implemented !== true) {
      return {
        state: 'wait', value: 'FORECAST NOT AVAILABLE',
        note: 'The forecasting module is not implemented and has not been backtested. ' +
          'Illustrative paths are drawn in the panel but carry no predictive meaning.',
        missing: forecast.missing || ['A validated forecasting model']
      };
    }
    return {
      state: 'pass', value: 'AVAILABLE',
      note: 'Forecast model present and validated.',
      missing: []
    };
  }

  /* ---------------- validation test 4 ---------------- */

  function evaluate(ctx) {
    var rows = [];
    var missing = [];
    var reasons = [];

    if (!ctx || !ctx.plan) {
      return {
        key: 'risk', name: 'Test 4 - Risk & forecast validator', mandatory: true,
        status: 'WAITING', direction: 'unknown', conflict: false,
        summary: 'No trade plan has been generated, so risk geometry cannot be validated.',
        rows: [row('plan', 'Trade plan', 'NOT GENERATED', 'wait', 'Waiting for a plan.')],
        reasons: ['No trade plan supplied.'],
        missing: ['A trade plan with entry, stop loss and targets']
      };
    }

    var plan = ctx.plan;
    var settings = ctx.settings || {};
    var minRR = Number(settings.minRR);
    if (!isFinite(minRR) || minRR < 1) { minRR = 2; }
    var direction = (ctx.direction || plan.direction || '').toUpperCase();

    // ---- 1. Entry validation
    var refPrice = finite(ctx.price);
    var m5 = I.sanitizeCandles(ctx.candles && ctx.candles.M5 ? ctx.candles.M5 : []);
    var atr = m5.length > 14 ? I.atr(m5, 14) : null;
    var entryVal = finite(plan.entry);
    var entryOk = entryVal !== null && entryVal > 0 && refPrice !== null &&
      Math.abs(entryVal - refPrice) <= (atr || 5) * 2;
    rows.push(row('entry_validation', 'Entry price validation',
      entryVal === null ? 'INVALID' : String(entryVal),
      entryOk ? 'pass' : 'fail',
      'Reference price ' + (refPrice === null ? 'unavailable' : refPrice) + ', ATR(14) ' + (atr === null ? 'n/a' : atr) +
      '. The entry must be a positive number within 2 ATR of the reference price.'));

    // ---- 2. Directional geometry (entry / SL / TP1 / TP2)
    var geometry = validateGeometry(plan, direction);
    var slDistance = geometry.risk;
    rows.push(row('sl_validation', 'Stop loss validation (' + (direction || 'UNKNOWN') + ')',
      geometry.ok ? 'VALID' : 'INVALID', geometry.ok ? 'pass' : 'fail',
      geometry.ok
        ? 'Stop distance ' + slDistance + ' price units' +
          (atr ? ' (ATR(14) ' + atr + ', ratio ' + I.round(slDistance / atr, 2) + ')' : '') +
          '. Stop is on the correct side of the entry for a ' + direction + '.'
        : geometry.errors.join(' ')));

    rows.push(row('tp_validation', 'TP1 / TP2 validation (' + (direction || 'UNKNOWN') + ')',
      geometry.ok ? 'VALID (TP1 ' + plan.tp1 + ', TP2 ' + plan.tp2 + ')' : 'INVALID',
      geometry.ok ? 'pass' : 'fail',
      geometry.ok
        ? 'Targets are on the correct side of the entry and correctly ordered for a ' + direction + '.'
        : 'Target geometry rejected: ' + (geometry.errors.join(' ') || 'no target data.')));

    // ---- 3. Risk / reward, directionally correct
    var rr = geometry.rr;
    var rrOk = rr !== null && rr >= minRR;
    rows.push(row('rr_validation', 'Risk / reward (minimum 1 : ' + minRR + ')',
      rr === null ? 'NOT CALCULABLE' : '1 : ' + rr,
      rr === null ? 'fail' : (rrOk ? 'pass' : 'fail'),
      rr === null
        ? 'Risk/reward cannot be calculated with zero or invalid distances.'
        : 'Directionally correct calculation: reward / risk for a ' + direction + '.'));

    // ---- 4. Forecast uncertainty (mandatory, currently WAITING)
    var forecastCheck = assessForecast(ctx.forecast);
    rows.push(row('forecast_uncertainty', 'Forecast uncertainty',
      forecastCheck.value, forecastCheck.state, forecastCheck.note));
    if (forecastCheck.state === 'wait') {
      (forecastCheck.missing || []).forEach(function (m) { missing.push(m); });
    }

    // ---- 5. Duplicate-signal protection
    var key = (plan.direction || '?') + '@' + plan.entry + '@' + plan.sl;
    var recent = Array.isArray(ctx.recentSignalKeys) ? ctx.recentSignalKeys : [];
    var duplicate = recent.indexOf(key) !== -1;
    rows.push(row('duplicate_protection', 'Duplicate-signal protection',
      duplicate ? 'DUPLICATE FOUND' : 'NO DUPLICATE', duplicate ? 'fail' : 'pass',
      duplicate
        ? 'An identical setup key was already issued: ' + key
        : 'Setup key ' + key + ' has not been issued before in this session. Server-side protection arrives later.'));

    // ---- 6. Setup invalidation
    var invalidation = finite(plan.invalidation);
    var invalidationOk = invalidation !== null && (
      direction === 'BUY' ? invalidation < plan.entry : invalidation > plan.entry
    );
    rows.push(row('invalidation', 'Setup invalidation level',
      invalidation === null ? 'NOT DEFINED' : String(invalidation),
      invalidationOk ? 'pass' : 'wait',
      invalidationOk
        ? 'The setup is invalidated if price closes beyond ' + invalidation + '.'
        : 'A defined invalidation level is required before a real signal can be issued.'));

    // ---- 7. Data quality (supplied by the caller, e.g. candle validation)
    var dq = ctx.dataQuality || null;
    rows.push(row('data_quality', 'Data quality',
      dq ? dq.label : 'NOT REPORTED',
      dq && dq.ok ? 'pass' : 'wait',
      dq ? dq.note : 'No data-quality report was supplied. Invalid or stale data can never produce a signal.'));

    // ---- 8. Signal expiry (Part 8)
    var expiryOk = !!plan.expiry;
    rows.push(row('signal_expiry', 'Signal expiry',
      plan.expiry ? String(plan.expiry) : 'NOT DEFINED',
      expiryOk ? 'pass' : 'wait',
      expiryOk
        ? 'The setup stops being valid after this time or when the invalidation level is reached.'
        : 'An expiry must be defined before a real signal can be issued.'));

    // ---- status: FAIL beats WAITING beats PASS
    var fails = rows.filter(function (r) { return r.state === 'fail'; }).length;
    var waits = rows.filter(function (r) { return r.state === 'wait'; }).length;

    var status;
    if (fails > 0) {
      status = 'FAIL';
      reasons.push(fails + ' risk rule(s) failed: the trade geometry is not acceptable.');
    } else if (waits > 0) {
      status = 'WAITING';
      reasons.push(waits + ' mandatory rule(s) are unresolved (including the forecast requirement).');
    } else {
      status = 'PASS';
      reasons.push('All risk rules passed, including a validated forecast.');
    }

    return {
      key: 'risk', name: 'Test 4 - Risk & forecast validator', mandatory: true,
      status: status,
      direction: direction === 'BUY' || direction === 'SELL' ? direction.toLowerCase() : 'unknown',
      conflict: false,
      summary: 'Risk geometry for ' + (direction || 'an unknown direction') + ' is ' +
        (geometry.ok ? 'valid' : 'invalid') + '. ' + reasons.join(' '),
      rows: rows, reasons: reasons, missing: missing
    };
  }

  global.RiskForecast = {
    validateGeometry: validateGeometry,
    calculateRisk: calculateRisk,
    buildDemoPlan: buildDemoPlan,
    buildForecast: buildForecast,
    assessForecast: assessForecast,
    evaluate: evaluate
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.RiskForecast; }

})(typeof window !== 'undefined' ? window : this);
