/* =====================================================================
   KP56 Gold Analysis — trend-checker.js   (Task 4 — Validation Test 1)
   Transparent trend evaluation on H1 + M15.

   RULES EVALUATED
   ---------------
   1. h1_ema         H1 EMA20 vs EMA50 and close position        (EMA-based trend)
   2. m15_ema        M15 EMA20 vs EMA50 and close position
   3. h1_structure   H1 swing structure: HH/HL vs LH/LL          (swing structure)
   4. m15_structure  M15 swing structure
   5. bos_choch      Break of structure / change of character    (BOS & CHoCH)
   6. agreement      H1 bias vs M15 bias                         (agreement / conflict)
   7. final          Final trend assessment

   RESULT CONTRACT (used by every checker in this project)
   -------------------------------------------------------
   {
     key, name, mandatory, status: 'PASS'|'FAIL'|'WAITING',
     direction: 'bullish'|'bearish'|'neutral'|'unknown',
     conflict: bool,
     summary, rows: [{ id, label, value, state, note }], reasons: [], missing: []
   }

   RULES
   -----
   * A BUY setup requires a confirmed BULLISH trend; a SELL setup requires a
     confirmed BEARISH trend. This module only reports the trend — it never
     issues a trade.
   * Conflicting timeframes => direction 'unknown', status FAIL, no direction.
   * Insufficient data     => status WAITING, no direction.
   ===================================================================== */
(function (global) {
  'use strict';

  var I = global.KP56Indicators;

  var RSI_NOTE = 'EMA period 20 / 50, computed on completed candles only.';

  function row(id, label, value, state, note) {
    return { id: id, label: label, value: value, state: state, note: note || '' };
  }

  /**
   * Single-timeframe bias from EMA trend and swing structure.
   * @returns {{bias:string, emaTrend:string, structure:string, detail:string, available:boolean}}
   */
  function timeframeBias(candles) {
    var cs = I.sanitizeCandles(candles);
    var out = {
      available: false, bias: 'unknown', emaTrend: 'UNKNOWN', structure: 'UNKNOWN',
      ema20: null, ema50: null, close: null, detail: 'Not enough candles.'
    };
    if (cs.length < 50) { return out; }                 // EMA50 needs 50 bars

    var closes = I.closesOf(cs);
    var e20 = I.emaLast(closes, 20, 20);
    var e50 = I.emaLast(closes, 50, 50);
    var lastClose = I.last(closes);
    if (e20 === null || e50 === null) { return out; }

    out.available = true;
    out.ema20 = I.round(e20);
    out.ema50 = I.round(e50);
    out.close = I.round(lastClose);
    out.emaTrend = (e20 > e50 && lastClose > e20) ? 'UP' : (e20 < e50 && lastClose < e20) ? 'DOWN' : 'RANGE';

    var st = I.marketStructure(cs);
    out.structure = st.trend;
    out.structureDetail = st.detail;

    if (out.emaTrend === 'UP' && st.trend !== 'DOWN') { out.bias = 'bullish'; }
    else if (out.emaTrend === 'DOWN' && st.trend !== 'UP') { out.bias = 'bearish'; }
    else { out.bias = 'neutral'; }

    out.detail = 'EMA ' + out.ema20 + ' / ' + out.ema50 + ' (close ' + out.close + '), structure ' + st.trend + '. ' + st.detail;
    return out;
  }

  function labelFor(bias) {
    return bias === 'bullish' ? 'BULLISH' : bias === 'bearish' ? 'BEARISH' :
      bias === 'neutral' ? 'NEUTRAL' : 'UNKNOWN';
  }

  function evaluate(ctx) {
    var rows = [];
    var missing = [];
    var reasons = [];

    if (!ctx || !ctx.candles) {
      return {
        key: 'trend', name: 'Test 1 - Trend checker', mandatory: true,
        status: 'WAITING', direction: 'unknown', conflict: false,
        summary: 'No candle dataset has been supplied to this test.',
        rows: [row('input', 'Input data', 'NOT SUPPLIED', 'wait', 'Waiting for a dataset.')],
        reasons: ['No data supplied.'], missing: ['Candle datasets for H1 and M15']
      };
    }

    var h1 = timeframeBias(ctx.candles.H1);
    var m15 = timeframeBias(ctx.candles.M15);

    if (!h1.available) { missing.push('At least 50 valid completed H1 candles (required for EMA50).'); }
    if (!m15.available) { missing.push('At least 50 valid completed M15 candles (required for EMA50).'); }

    rows.push(row('h1_ema', 'H1 trend (EMA 20/50)',
      h1.available ? labelFor(h1.bias) : 'NO DATA',
      h1.available ? (h1.bias === 'bullish' ? 'pass' : h1.bias === 'bearish' ? 'fail' : 'wait') : 'wait',
      h1.available ? 'EMA20 ' + h1.ema20 + ' / EMA50 ' + h1.ema50 + ', close ' + h1.close + '. ' + RSI_NOTE
        : 'Waiting for H1 candles.'));

    rows.push(row('m15_ema', 'M15 trend (EMA 20/50)',
      m15.available ? labelFor(m15.bias) : 'NO DATA',
      m15.available ? (m15.bias === 'bullish' ? 'pass' : m15.bias === 'bearish' ? 'fail' : 'wait') : 'wait',
      m15.available ? 'EMA20 ' + m15.ema20 + ' / EMA50 ' + m15.ema50 + ', close ' + m15.close + '. ' + RSI_NOTE
        : 'Waiting for M15 candles.'));

    rows.push(row('h1_structure', 'H1 structure (HH/HL, LH/LL)',
      h1.available ? h1.structure : 'NO DATA',
      h1.available ? (h1.structure === 'UP' ? 'pass' : h1.structure === 'DOWN' ? 'fail' : 'wait') : 'wait',
      h1.available ? (h1.structureDetail || '') : 'Waiting for H1 candles.'));

    rows.push(row('m15_structure', 'M15 structure (HH/HL, LH/LL)',
      m15.available ? m15.structure : 'NO DATA',
      m15.available ? (m15.structure === 'UP' ? 'pass' : m15.structure === 'DOWN' ? 'fail' : 'wait') : 'wait',
      m15.available ? (m15.structureDetail || '') : 'Waiting for M15 candles.'));

    // BOS / CHoCH on the working timeframe (M15), H1 as context
    var bosM15 = m15.available ? I.findBOS(ctx.candles.M15) : null;
    rows.push(row('bos_choch', 'BOS / CHoCH (M15)',
      bosM15 ? bosM15.type + ' ' + bosM15.direction : 'NO DATA',
      bosM15 ? (bosM15.type === 'NONE' ? 'wait' : 'pass') : 'wait',
      bosM15 ? bosM15.detail : 'Waiting for M15 candles.'));

    // Agreement between timeframes
    var conflict = false;
    var direction = 'unknown';
    var agreementState = 'wait';
    var agreementValue = 'UNKNOWN';
    var agreementNote = 'Both timeframes must agree before a direction is reported.';

    if (h1.available && m15.available) {
      if (h1.bias === 'unknown' || m15.bias === 'unknown') {
        agreementValue = 'UNKNOWN';
      } else if (h1.bias === m15.bias) {
        direction = h1.bias === 'bullish' || h1.bias === 'bearish' ? h1.bias : 'neutral';
        agreementValue = direction === 'neutral' ? 'BOTH NEUTRAL' : 'AGREED: ' + labelFor(direction);
        agreementState = direction === 'neutral' ? 'wait' : 'pass';
        agreementNote = 'H1 and M15 both read ' + labelFor(direction) + '.';
      } else {
        conflict = true;
        direction = 'unknown';
        agreementValue = 'CONFLICT: H1 ' + labelFor(h1.bias) + ' vs M15 ' + labelFor(m15.bias);
        agreementState = 'fail';
        agreementNote = 'Conflicting timeframes must not produce a directional signal.';
      }
    } else {
      agreementValue = 'NOT ENOUGH DATA';
      agreementNote = 'Waiting for both timeframes.';
    }

    rows.push(row('agreement', 'M15 / H1 agreement', agreementValue, agreementState, agreementNote));

    // Final assessment
    var status;
    if (!h1.available || !m15.available) {
      status = 'WAITING';
      reasons.push('Insufficient candle history on one or both timeframes.');
    } else if (conflict) {
      status = 'FAIL';
      reasons.push('H1 and M15 disagree, so no direction may be used.');
    } else if (direction === 'neutral') {
      status = 'FAIL';
      reasons.push('Both timeframes are neutral or range-bound, so there is no trend to trade.');
    } else if (bosM15 && bosM15.type !== 'NONE' && bosM15.direction.toLowerCase() === direction) {
      status = 'PASS';
      reasons.push('H1 and M15 agree on a ' + direction + ' bias and M15 shows a ' + bosM15.type + ' in the same direction.');
    } else {
      status = 'FAIL';
      reasons.push('No break of structure in the direction of the trend was confirmed on M15.');
    }

    rows.push(row('final', 'Final trend assessment',
      status === 'PASS' ? labelFor(direction) : (status === 'WAITING' ? 'NOT DETERMINED' : 'NO USABLE TREND'),
      status === 'PASS' ? 'pass' : status === 'WAITING' ? 'wait' : 'fail',
      status === 'PASS'
        ? 'A ' + direction + ' trend is confirmed on both timeframes.'
        : 'No directional trend may be used for a signal.'));

    var summary = status === 'PASS'
      ? 'Trend is confirmed ' + direction.toUpperCase() + ' on H1 and M15. (Computed from the loaded dataset.)'
      : status === 'WAITING'
        ? 'Trend cannot be judged yet: ' + missing.join(' ')
        : 'Trend test does not pass. ' + reasons.join(' ');

    return {
      key: 'trend', name: 'Test 1 - Trend checker', mandatory: true,
      status: status, direction: direction, conflict: conflict,
      summary: summary, rows: rows, reasons: reasons, missing: missing
    };
  }

  global.TrendChecker = { evaluate: evaluate, timeframeBias: timeframeBias };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.TrendChecker; }

})(typeof window !== 'undefined' ? window : this);
