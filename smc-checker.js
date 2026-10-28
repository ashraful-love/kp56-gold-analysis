/* =====================================================================
   KP56 Gold Analysis — smc-checker.js   (Phase 3 — Validation Test 2)
   This is the SAME SMC framework as Phase 3 Part 3: it now delegates to
   smc-engine.js instead of carrying its own logic. There is one engine.

   RULES EVALUATED
   ---------------
   1. liquidity_sweep   confirmed sweep on the working timeframe (M5/M15)
   2. fvg               unmitigated imbalance in the setup direction
   3. bos_choch         structure break in the setup direction
   4. order_block       confirmed order-block candidate in that direction
   5. premium_discount  entry location inside the dealing range
   6. support_resistance mapped levels on M15 / H1
   7. mtf_alignment     H1 bias, M15 agreement, M5 confirmation (Part 4)
   8. candle_close      the trigger candle must be closed

   RESULT CONTRACT: unchanged from Phase 2 (status / direction / rows /
   reasons / missing), extended with `findings` and `mtf` for the SMC map.

   HONESTY: these are geometric price patterns. They cannot reveal actual
   institutional orders, and a sweep alone is never a signal.
   ===================================================================== */
(function (global) {
  'use strict';

  var I = global.KP56Indicators;
  var SMC = global.KP56SMC;

  function row(id, label, value, state, note) {
    return { id: id, label: label, value: value, state: state, note: note || '' };
  }

  function zoneText(f) {
    return f && f.zone ? f.zone.low + '-' + f.zone.high : 'no readable zone';
  }

  function evaluate(ctx) {
    var rows = [];
    var missing = [];
    var reasons = [];

    if (!ctx || !ctx.candles) {
      return {
        key: 'smc', name: 'Test 2 - SMC checker', mandatory: true,
        status: 'WAITING', direction: 'unknown', conflict: false,
        summary: 'No candle dataset has been supplied to this test.',
        rows: [row('input', 'Input data', 'NOT SUPPLIED', 'wait', 'Waiting for a dataset.')],
        reasons: ['No data supplied.'], missing: ['Candle datasets for M5, M15 and H1'],
        findings: [], mtf: null
      };
    }

    var source = ctx.source || 'candle data';
    var m5 = I.sanitizeCandles(ctx.candles.M5);
    var m15 = I.sanitizeCandles(ctx.candles.M15);
    var h1 = I.sanitizeCandles(ctx.candles.H1);

    // ---- the integrated SMC engine does the actual detection
    var mtf = SMC.multiTimeframe({ H1: h1, M15: m15, M5: m5 }, { source: source });
    var working = m5.length >= 20 ? mtf.reports.M5 : mtf.reports.M15;
    var workTf = m5.length >= 20 ? 'M5' : 'M15';

    if (m5.length < 20 && m15.length < 20) { missing.push('At least 20 valid candles on M5 or M15.'); }
    if (!h1.length) { missing.push('H1 candles for higher-timeframe context.'); }

    function findByConcept(report, parts) {
      return (report ? report.findings : []).filter(function (f) {
        return parts.some(function (p) { return f.concept.toLowerCase().indexOf(p) !== -1; });
      });
    }

    // ---- 1. liquidity sweep (target vs sweep are distinguished in the engine)
    var sweeps = findByConcept(working, ['liquidity sweep']);
    var sweepConfirmed = sweeps.some(function (f) { return f.confirmation === 'confirmed'; });
    rows.push(row('liquidity_sweep', 'Liquidity sweep (' + workTf + ')',
      sweeps.length ? sweeps.map(function (f) { return f.concept + ' @ ' + zoneText(f); }).join(' / ') : 'NONE DETECTED',
      sweeps.length ? (sweepConfirmed ? 'pass' : 'wait') : 'neutral',
      sweeps.length
        ? sweeps.map(function (f) { return f.evidence + ' ' + (f.invalidation || ''); }).join(' ')
        : 'No swing point has been swept. Liquidity LEVELS (BSL/SSL) are targets, not sweeps, and are listed in the SMC map.'));

    // ---- 2. fair value gaps
    var gaps = findByConcept(working, ['fvg']);
    var openGaps = gaps.filter(function (f) { return f.confirmation !== 'none'; });
    rows.push(row('fvg', 'Fair value gap (' + workTf + ')',
      gaps.length ? gaps.slice(-2).map(function (f) { return f.concept + ' ' + zoneText(f); }).join(' / ') : 'NONE FOUND',
      openGaps.length ? 'pass' : 'fail',
      gaps.length
        ? gaps.slice(-2).map(function (f) { return f.evidence; }).join(' ')
        : 'No unmitigated three-candle imbalance was detected.'));

    // ---- 3. BOS / CHoCH
    var breaks = working.structure ? working.structure.breaks : [];
    rows.push(row('bos_choch', 'BOS / CHoCH (' + workTf + ')',
      breaks.length ? breaks.map(function (f) { return f.concept; }).join(' / ') : 'NONE DETECTED',
      breaks.length ? (breaks.some(function (f) { return f.confirmation === 'confirmed'; }) ? 'pass' : 'wait') : 'fail',
      breaks.length ? breaks.map(function (f) { return f.evidence; }).join(' ') : 'No close beyond the last swing point.'));

    // ---- 4. order blocks (candidates only, never every opposing candle)
    var blocks = working.orderBlocks ? working.orderBlocks.blocks : [];
    rows.push(row('order_block', 'Order block candidate (' + workTf + ')',
      blocks.length ? blocks.map(function (b) { return b.type + ' ' + b.zone.low + '-' + b.zone.high + (b.confirmed ? ' (confirmed)' : ' (tentative)'); }).join(' / ') : 'NONE FOUND',
      blocks.length ? (blocks.some(function (b) { return b.confirmed; }) ? 'pass' : 'wait') : 'fail',
      blocks.length
        ? 'A candidate is the last opposite candle before displacement with a later structure break. Zones are not orders.'
        : 'No candle met the displacement + structure-break rule.'));

    // ---- 5. premium / discount (entry location)
    var range = working.range || {};
    rows.push(row('premium_discount', 'Premium / discount (' + workTf + ')',
      range.available ? range.state.toUpperCase() + ' (eq ' + range.equilibrium + ')' : 'UNAVAILABLE',
      range.available ? (range.state === 'near equilibrium' ? 'wait' : 'pass') : 'wait',
      range.available ? range.explanation : (range.unavailable && range.unavailable.length ? range.unavailable[0].reason : 'Range unavailable.')));
    if (!range.available) { missing.push('A reliable dealing range for premium/discount classification.'); }

    // ---- 6. support & resistance
    var m15Report = mtf.reports.M15;
    var levels = m15Report.liquidity ? m15Report.liquidity.bsl.concat(m15Report.liquidity.ssl) : [];
    rows.push(row('support_resistance', 'Support & resistance (M15)',
      levels.length ? levels.length + ' level(s) mapped' : 'NOT MAPPED',
      levels.length ? 'pass' : 'fail',
      levels.length
        ? levels.slice(0, 4).map(function (f) { return f.concept + ' @ ' + zoneText(f); }).join(' · ')
        : 'No swing levels could be mapped.'));

    // ---- 7. multi-timeframe alignment (Part 4)
    rows.push(row('mtf_alignment', 'Multi-timeframe alignment',
      'H1 ' + mtf.bias.H1 + ' / M15 ' + mtf.bias.M15 + ' / M5 ' + mtf.bias.M5,
      mtf.conflicts ? 'fail' : (mtf.agrees && mtf.m5Confirms ? 'pass' : 'wait'),
      mtf.summary + (mtf.missing.length ? ' Missing: ' + mtf.missing.join(' ') : '')));
    if (mtf.conflicts) { missing.push('H1 and M15 must agree before any setup qualifies.'); }

    // ---- 8. candle close
    var candleClosed = ctx.candleClosed !== false;
    rows.push(row('candle_close', 'Candle-close confirmation',
      candleClosed ? 'CONFIRMED' : 'CANDLE STILL OPEN',
      candleClosed ? 'pass' : 'fail',
      candleClosed ? 'Only completed candles are used for confirmed signals.'
                   : 'A candle that is still open can still change shape.'));

    // ---- direction from the engine findings
    var bullishVotes = 0, bearishVotes = 0;
    mtf.reports[workTf].findings.forEach(function (f) {
      var c = f.concept.toLowerCase();
      if (c.indexOf('bullish') !== -1) { bullishVotes++; }
      if (c.indexOf('bearish') !== -1) { bearishVotes++; }
    });
    var direction = 'unknown';
    var conflict = false;
    if (bullishVotes && bearishVotes) {
      conflict = true;
    } else if (bullishVotes) { direction = 'bullish'; }
    else if (bearishVotes) { direction = 'bearish'; }
    else { direction = 'neutral'; }

    // ---- status
    var fails = rows.filter(function (r) { return r.state === 'fail'; }).length;
    var waits = rows.filter(function (r) { return r.state === 'wait'; }).length;
    var status;

    if (!candleClosed) {
      status = 'WAITING';
      reasons.push('The trigger candle has not closed, so nothing can be confirmed.');
    } else if (mtf.conflicts) {
      status = 'FAIL';
      reasons.push('Higher timeframes conflict, so no directional setup qualifies.');
    } else if (direction === 'unknown' || direction === 'neutral') {
      status = 'FAIL';
      reasons.push('No single directional SMC reading was produced.');
    } else if (fails > 0) {
      status = 'FAIL';
      reasons.push(fails + ' SMC rule(s) failed.');
    } else if (waits > 0) {
      status = 'WAITING';
      reasons.push(waits + ' SMC rule(s) are tentative or unavailable.');
    } else {
      status = 'PASS';
      reasons.push('Sweep, imbalance, structure break, order-block zone, entry location and timeframe alignment all agree on ' + direction + '.');
    }

    var summary = status === 'PASS'
      ? 'SMC conditions line up ' + direction.toUpperCase() + ' on ' + workTf +
        '. These are geometric price patterns only - they cannot show institutional order flow.'
      : 'SMC setup is not complete. ' + reasons.join(' ');

    return {
      key: 'smc', name: 'Test 2 - SMC checker', mandatory: true,
      status: status, direction: direction, conflict: conflict,
      summary: summary, rows: rows, reasons: reasons, missing: missing,
      findings: mtf.reports[workTf].findings,
      mtf: mtf,
      levels: {
        support: mtf.reports.M15.liquidity.ssl.map(function (f) { return f.zone ? f.zone.low : null; }).filter(Boolean),
        resistance: mtf.reports.M15.liquidity.bsl.map(function (f) { return f.zone ? f.zone.high : null; }).filter(Boolean)
      }
    };
  }

  global.SmcChecker = { evaluate: evaluate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.SmcChecker; }

})(typeof window !== 'undefined' ? window : this);
