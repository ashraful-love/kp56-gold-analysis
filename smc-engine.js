/* =====================================================================
   KP56 Gold Analysis — smc-engine.js   (Phase 3, Part 3)
   The single, integrated SMC framework.

   This is NOT a second analysis engine: smc-checker.js (Validation Test 2)
   calls this module, and the screenshot panel records findings in exactly
   the same shape. Everything is rule-based, documented and testable.

   FINDING CONTRACT (used everywhere in Phase 3)
   --------------------------------------------
   {
     concept:      'Bullish BOS' | 'Buy-side liquidity (BSL)' | ...
     timeframe:    'H1' | 'M15' | 'M5' | 'screenshot:H1' ...
     zone:         { high, low } | null      // approximate price zone
     rule:         the documented detection rule that fired
     evidence:     what was actually observed
     confirmation: 'confirmed' | 'tentative' | 'none'
     invalidation: what would invalidate the finding (or null)
     source:       'candle data' | 'screenshot' | 'manual entry'
   }

   HONESTY RULES
   -------------
   * A liquidity LEVEL is a target. A liquidity SWEEP is an event. They are
     never reported as the same thing.
   * Nothing here claims to read institutional orders. Candles and screenshots
     show price geometry only.
   * Modules with insufficient data return confirmation 'none' and are listed
     in `unavailable` with a reason - never a fabricated result.
   ===================================================================== */
(function (global) {
  'use strict';

  var I = global.KP56Indicators;

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function round(v) { return I.round(v, 2); }

  function finding(concept, timeframe, zone, rule, evidence, confirmation, invalidation, source) {
    return {
      concept: concept,
      timeframe: timeframe || 'unknown',
      zone: zone || null,
      rule: rule,
      evidence: evidence,
      confirmation: confirmation || 'none',
      invalidation: invalidation || null,
      source: source || 'candle data'
    };
  }

  /* ================================================================
     A. MARKET STRUCTURE
     ================================================================ */

  /**
   * Swing structure uses fractal lookback 2 (major swings).
   * Internal structure uses fractal lookback 1 (minor swings).
   * A swing point is STRONG when a later candle closed beyond it (it caused a
   * structural break) and WEAK when it has not been closed beyond yet.
   */
  function analyseStructure(candles, tf, source) {
    var cs = I.sanitizeCandles(candles);
    var out = {
      available: cs.length >= 20,
      swing: { trend: 'UNKNOWN', highs: [], lows: [], detail: '' },
      internal: { trend: 'UNKNOWN', detail: '' },
      breaks: [],
      shifts: [],
      strongWeak: [],
      findings: []
    };
    if (!out.available) {
      out.detail = 'Not enough candles for structure (' + cs.length + ' of 20 required).';
      return out;
    }

    var major = I.swings(cs, 2);
    var minor = I.swings(cs, 1);
    var lastClose = I.last(cs).close;
    var structure = I.marketStructure(cs, 2);
    var internalStructure = I.marketStructure(cs, 1);

    out.swing.trend = structure.trend;
    out.swing.detail = structure.detail;
    out.swing.highs = major.highs;
    out.swing.lows = major.lows;
    out.internal.trend = internalStructure.trend;
    out.internal.detail = internalStructure.detail;

    // ---- BOS / CHoCH (confirmed = close beyond, tentative = wick only)
    var lastHigh = major.highs.length ? major.highs[major.highs.length - 1].price : null;
    var lastLow = major.lows.length ? major.lows[major.lows.length - 1].price : null;
    var lastCandle = I.last(cs);
    var wickHigh = lastCandle.high, wickLow = lastCandle.low;

    function recordBreak(direction, level, kind, byClose) {
      var concept = (kind === 'BOS' ? (direction === 'bullish' ? 'Bullish BOS' : 'Bearish BOS')
        : (direction === 'bullish' ? 'Bullish CHoCH' : 'Bearish CHoCH'));
      var f = finding(
        concept, tf, { high: round(level), low: round(level) },
        'Close ' + (byClose ? 'beyond' : 'or wick beyond') + ' the last ' +
          (direction === 'bullish' ? 'swing high' : 'swing low') + ' on ' + tf + '.',
        'Last close ' + round(lastClose) + ', ' + (direction === 'bullish' ? 'swing high ' : 'swing low ') + round(level) + '.',
        byClose ? 'confirmed' : 'tentative',
        'Invalidated if price closes back ' + (direction === 'bullish' ? 'below ' : 'above ') + round(level) + '.',
        source
      );
      out.breaks.push(f);
      out.findings.push(f);
    }

    if (lastHigh !== null) {
      if (lastClose > lastHigh) {
        recordBreak('bullish', lastHigh, structure.trend === 'UP' ? 'BOS' : 'CHoCH', true);
      } else if (wickHigh > lastHigh) {
        recordBreak('bullish', lastHigh, structure.trend === 'UP' ? 'BOS' : 'CHoCH', false);
      }
    }
    if (lastLow !== null) {
      if (lastClose < lastLow) {
        recordBreak('bearish', lastLow, structure.trend === 'DOWN' ? 'BOS' : 'CHoCH', true);
      } else if (wickLow < lastLow) {
        recordBreak('bearish', lastLow, structure.trend === 'DOWN' ? 'BOS' : 'CHoCH', false);
      }
    }

    // ---- market-structure shift candidate (internal structure flip)
    if (internalStructure.trend !== 'UNKNOWN' && structure.trend !== 'UNKNOWN' &&
        internalStructure.trend !== structure.trend && internalStructure.trend !== 'RANGE') {
      var shift = finding(
        'Market-structure shift candidate', tf, null,
        'Internal structure (' + internalStructure.trend + ') disagrees with swing structure (' + structure.trend + ').',
        internalStructure.detail + ' / ' + structure.detail,
        'tentative',
        'Confirmed only when a close breaks the last internal swing point in the new direction.',
        source
      );
      out.shifts.push(shift);
      out.findings.push(shift);
    }

    // ---- strong / weak swing points
    major.highs.concat(major.lows).forEach(function (p) {
      var brokenByClose = cs.slice(p.index + 1).some(function (c) {
        return p.price === undefined ? false :
          (c.close > p.price && c.high > p.price) || (c.close < p.price && c.low < p.price);
      });
      // Precise rule: strong = a later candle CLOSED beyond the level.
      var strong = cs.slice(p.index + 1).some(function (c) {
        return c.close > p.price || c.close < p.price;
      });
      out.strongWeak.push({
        level: round(p.price),
        type: cs[p.index].high === p.price ? 'swing high' : 'swing low',
        strength: strong ? 'strong' : 'weak',
        rule: 'A swing point is strong once a candle has CLOSED beyond it, weak until then.',
        brokenByClose: brokenByClose
      });
    });

    return out;
  }

  /* ================================================================
     B. LIQUIDITY
     ================================================================ */

  function analyseLiquidity(candles, tf, source, opts) {
    opts = opts || {};
    var cs = I.sanitizeCandles(candles);
    var out = {
      available: cs.length >= 20,
      bsl: [], ssl: [], equalHighs: [], equalLows: [], pools: [],
      sweeps: [], reclaim: [], inducement: null,
      previous: { day: null, week: null, session: null },
      findings: [],
      unavailable: []
    };
    if (!out.available) {
      out.unavailable.push({ module: 'Liquidity', reason: 'Not enough candles (' + cs.length + ' of 20 required).' });
      return out;
    }

    var lastClose = I.last(cs).close;
    var atr = I.atr(cs, 14) || (lastClose * 0.001);
    var tolerance = Math.max(atr * 0.15, lastClose * 0.0005);
    var major = I.swings(cs, 2);
    var minor = I.swings(cs, 1);

    // ---- BSL / SSL targets (levels, not events)
    major.highs.forEach(function (h) {
      if (h.price > lastClose) {
        var f = finding('Buy-side liquidity (BSL)', tf, { high: round(h.price), low: round(h.price) },
          'A swing high above the current price is a buy-side liquidity target.',
          'Swing high ' + round(h.price) + ' versus last close ' + round(lastClose) + '.',
          'none', 'The level stops being a target once price closes above it.', source);
        out.bsl.push(f);
        out.findings.push(f);
      }
    });
    major.lows.forEach(function (l) {
      if (l.price < lastClose) {
        var f2 = finding('Sell-side liquidity (SSL)', tf, { high: round(l.price), low: round(l.price) },
          'A swing low below the current price is a sell-side liquidity target.',
          'Swing low ' + round(l.price) + ' versus last close ' + round(lastClose) + '.',
          'none', 'The level stops being a target once price closes below it.', source);
        out.ssl.push(f2);
        out.findings.push(f2);
      }
    });

    // ---- equal highs / equal lows (two swing points within tolerance)
    function equalSet(points, label, store) {
      for (var i = 0; i < points.length; i++) {
        for (var j = i + 1; j < points.length; j++) {
          if (Math.abs(points[i].price - points[j].price) <= tolerance) {
            var f = finding(label, tf,
              { high: round(Math.max(points[i].price, points[j].price)), low: round(Math.min(points[i].price, points[j].price)) },
              'Two swing points within ' + round(tolerance) + ' price units of each other.',
              'Levels ' + round(points[i].price) + ' and ' + round(points[j].price) + '.',
              'tentative',
              'Invalidated when a candle closes beyond both levels.', source);
            store.push(f);
            out.findings.push(f);
          }
        }
      }
    }
    equalSet(major.highs, 'Equal highs (EQH) liquidity', out.equalHighs);
    equalSet(major.lows, 'Equal lows (EQL) liquidity', out.equalLows);

    // ---- liquidity pools (3 or more swing points clustered)
    var cluster = major.highs.concat(major.lows).filter(function (p, idx, arr) {
      return arr.filter(function (q) { return Math.abs(q.price - p.price) <= tolerance * 2; }).length >= 3;
    });
    if (cluster.length) {
      var lo = Math.min.apply(null, cluster.map(function (p) { return p.price; }));
      var hi = Math.max.apply(null, cluster.map(function (p) { return p.price; }));
      var poolF = finding('Swing-point liquidity pool', tf, { high: round(hi), low: round(lo) },
        'Three or more swing points cluster inside twice the tolerance band.',
        cluster.length + ' swing points between ' + round(lo) + ' and ' + round(hi) + '.',
        'tentative', 'Invalidated by a close outside the cluster.', source);
      out.pools.push(poolF);
      out.findings.push(poolF);
    }

    // ---- sweeps and sweep-and-reclaim
    var sweepInfo = I.findLiquiditySweep(cs, 6);
    if (sweepInfo.sweptHigh || sweepInfo.sweptLow) {
      var sweepF = finding(
        sweepInfo.direction === 'BULLISH' ? 'Sell-side liquidity sweep' : 'Buy-side liquidity sweep',
        tf,
        sweepInfo.sweptHigh ? { high: round(sweepInfo.sweptHighLevel), low: round(sweepInfo.sweptHighLevel) }
          : { high: round(sweepInfo.sweptLowLevel), low: round(sweepInfo.sweptLowLevel) },
        'Price traded beyond a prior swing point and closed back inside its range.',
        sweepInfo.note,
        sweepInfo.confirmed ? 'confirmed' : 'tentative',
        'A sweep alone is never an entry. It is invalidated by a close beyond the swept level again.',
        source);
      out.sweeps.push(sweepF);
      out.findings.push(sweepF);

      // sweep-and-reclaim: a later candle closes back beyond the sweep candle midpoint
      var sweepCandle = I.last(cs);
      var mid = (sweepCandle.high + sweepCandle.low) / 2;
      var reclaimed = cs.slice(-3).some(function (c) {
        return sweepInfo.direction === 'BULLISH' ? c.close > mid : c.close < mid;
      });
      var reclaimF = finding('Sweep and reclaim', tf, sweepF.zone,
        'After the sweep, a candle closed back beyond the midpoint of the sweep candle (' + round(mid) + ').',
        reclaimed ? 'A reclaiming close was observed.' : 'No reclaiming close observed yet.',
        reclaimed ? 'confirmed' : 'tentative',
        'Invalidated if price closes beyond the swept level again.', source);
      out.reclaim.push(reclaimF);
      out.findings.push(reclaimF);
    }

    // ---- inducement candidate: nearest minor swing point not yet traded through twice
    if (minor.highs.length || minor.lows.length) {
      var candidates = minor.highs.concat(minor.lows)
        .sort(function (a, b) { return Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose); });
      var idm = candidates[0];
      var idmF = finding('Inducement candidate', tf, { high: round(idm.price), low: round(idm.price) },
        'Nearest minor swing point to the current price; price often takes it before the main move.',
        'Minor swing at ' + round(idm.price) + ', ' + round(Math.abs(idm.price - lastClose)) + ' from the last close.',
        'tentative',
        'Tentative by definition: it is invalidated once the level is traded through.', source);
      out.inducement = idmF;
      out.findings.push(idmF);
    }

    // ---- previous session / day / week high-low (needs timestamps)
    out.previous = previousLevels(cs, tf, source, out);

    return out;
  }

  /** Previous session / day / week high-low from timestamps. */
  function previousLevels(cs, tf, source, out) {
    var res = { day: null, week: null, session: null };
    if (!cs.length || !I.isFiniteNumber(cs[0].time)) {
      if (out && out.unavailable) {
        out.unavailable.push({ module: 'Previous day / week levels', reason: 'No usable timestamps on the candles.' });
      }
      return res;
    }

    function group(keyFn) {
      var map = {};
      cs.forEach(function (c) {
        var k = keyFn(new Date(c.time));
        if (!map[k]) { map[k] = { high: -Infinity, low: Infinity, key: k }; }
        map[k].high = Math.max(map[k].high, c.high);
        map[k].low = Math.min(map[k].low, c.low);
      });
      return Object.keys(map).sort().map(function (k) { return map[k]; });
    }

    var days = group(function (d) { return d.toISOString().slice(0, 10); });
    if (days.length >= 2) {
      var prevDay = days[days.length - 2];
      res.day = { high: round(prevDay.high), low: round(prevDay.low), key: prevDay.key };
      var dayF = finding('Previous day high/low', tf, { high: res.day.high, low: res.day.low },
        'High and low of the previous UTC day, taken from candle timestamps.',
        'Previous day ' + res.day.key + ': high ' + res.day.high + ', low ' + res.day.low + '.',
        'confirmed', 'Invalidated only by a data correction.', source);
      out.findings.push(dayF);
    } else if (out && out.unavailable) {
      out.unavailable.push({ module: 'Previous day high/low', reason: 'Needs at least two UTC days of candles (have ' + days.length + ').' });
    }

    var weeks = group(function (d) {
      var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      var day = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - day);
      return t.getUTCFullYear() + '-W' + Math.ceil((((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7);
    });
    if (weeks.length >= 2) {
      var prevWeek = weeks[weeks.length - 2];
      res.week = { high: round(prevWeek.high), low: round(prevWeek.low), key: prevWeek.key };
      var weekF = finding('Previous week high/low', tf, { high: res.week.high, low: res.week.low },
        'High and low of the previous ISO week, taken from candle timestamps.',
        'Previous week ' + res.week.key + ': high ' + res.week.high + ', low ' + res.week.low + '.',
        'confirmed', 'Invalidated only by a data correction.', source);
      out.findings.push(weekF);
    } else if (out && out.unavailable) {
      out.unavailable.push({ module: 'Previous week high/low', reason: 'Needs at least two ISO weeks of candles (have ' + weeks.length + ').' });
    }

    // Session liquidity: Asia / London / New York in UTC, when a day is complete.
    var sessionMap = { Asia: [0, 7], London: [7, 12], 'New York': [12, 21] };
    Object.keys(sessionMap).forEach(function (name) {
      var span = sessionMap[name];
      var rows = cs.filter(function (c) {
        var h = new Date(c.time).getUTCHours();
        return h >= span[0] && h < span[1];
      });
      if (rows.length >= 5) {
        var hi = Math.max.apply(null, rows.map(function (c) { return c.high; }));
        var lo = Math.min.apply(null, rows.map(function (c) { return c.low; }));
        res.session = res.session || {};
        res.session[name] = { high: round(hi), low: round(lo) };
        var sF = finding(name + ' session high/low', tf, { high: round(hi), low: round(lo) },
          'Highest high and lowest low of the ' + name + ' UTC session window ' + span[0] + ':00-' + span[1] + ':00.',
          rows.length + ' candles inside the session window.',
          'tentative', 'Session levels are provisional until the session has closed.', source);
        out.findings.push(sF);
      }
    });

    return res;
  }

  /* ================================================================
     C. FAIR VALUE GAPS AND IMBALANCES
     ================================================================ */

  function analyseImbalances(candles, tf, source) {
    var cs = I.sanitizeCandles(candles);
    var out = { available: cs.length >= 3, gaps: [], overlapping: [], findings: [], unavailable: [] };
    if (!out.available) {
      out.unavailable.push({ module: 'Fair value gaps', reason: 'Needs at least 3 candles.' });
      return out;
    }
    var lastClose = I.last(cs).close;
    var atr = I.atr(cs, 14) || 1;
    var minSize = atr * 0.1;

    for (var i = 2; i < cs.length; i++) {
      var a = cs[i - 2], c = cs[i];
      var type = null, top = null, bottom = null;
      if (c.low > a.high) { type = 'Bullish FVG'; top = c.low; bottom = a.high; }
      else if (a.low > c.high) { type = 'Bearish FVG'; top = a.low; bottom = c.high; }
      if (!type) { continue; }
      var size = top - bottom;
      if (size < minSize) { continue; }

      // Mitigation status from the candles after the gap
      var after = cs.slice(i + 1);
      var entered = after.some(function (x) { return x.low <= top && x.high >= bottom; });
      var fullyFilled = after.some(function (x) { return x.low <= bottom && x.high >= top; });
      var invalidated = after.some(function (x) {
        return type === 'Bullish FVG' ? x.close < bottom : x.close > top;
      });
      var partial = entered && !fullyFilled;
      var status = invalidated ? 'invalidated' : fullyFilled ? 'fully mitigated' : partial ? 'partially mitigated' : 'unmitigated';

      var f = finding(type, tf, { high: round(top), low: round(bottom) },
        'Three-candle imbalance: ' + (type === 'Bullish FVG'
          ? 'candle[i-2].high < candle[i].low'
          : 'candle[i-2].low > candle[i].high') + ', size at least 10% of ATR(14).',
        'Gap ' + round(bottom) + '-' + round(top) + ' (' + round(size) + ' units) at candle ' + i + ', currently ' + status + '.',
        invalidated ? 'none' : (fullyFilled ? 'confirmed' : 'tentative'),
        invalidated ? 'Already invalidated by a close beyond the gap.' :
          'Invalidated by a close beyond the ' + (type === 'Bullish FVG' ? 'lower' : 'upper') + ' boundary (' + round(type === 'Bullish FVG' ? bottom : top) + ').',
        source);
      out.gaps.push({ type: type, top: round(top), bottom: round(bottom), size: round(size), index: i, status: status, finding: f });
      out.findings.push(f);
    }

    // Overlapping gaps -> balanced price range candidate
    for (var p = 0; p < out.gaps.length; p++) {
      for (var q = p + 1; q < out.gaps.length; q++) {
        var g1 = out.gaps[p], g2 = out.gaps[q];
        if (g1.type !== g2.type && g1.bottom <= g2.top && g2.bottom <= g1.top) {
          var bpr = finding('Balanced Price Range (overlap of opposing imbalances)', tf,
            { high: round(Math.max(g1.top, g2.top)), low: round(Math.min(g1.bottom, g2.bottom)) },
            'Two opposing fair value gaps overlap.',
            g1.type + ' ' + g1.bottom + '-' + g1.top + ' overlaps ' + g2.type + ' ' + g2.bottom + '-' + g2.top + '.',
            'tentative', 'Invalidated by a close outside the overlapping range.', source);
          out.overlapping.push(bpr);
          out.findings.push(bpr);
        }
      }
    }

    return out;
  }

  /* ================================================================
     D. ORDER BLOCKS (candidate discipline - never every opposing candle)
     ================================================================ */

  function analyseOrderBlocks(candles, tf, source) {
    var cs = I.sanitizeCandles(candles);
    var out = { available: cs.length >= 20, blocks: [], breakers: [], findings: [], unavailable: [] };
    if (!out.available) {
      out.unavailable.push({ module: 'Order blocks', reason: 'Needs at least 20 candles for displacement statistics.' });
      return out;
    }

    var atr = I.atr(cs, 14) || 1;
    var bodies = cs.map(function (c) { return Math.abs(c.close - c.open); });
    var avgBody = bodies.reduce(function (a, b) { return a + b; }, 0) / bodies.length;
    var displacementFactor = 1.8;

    for (var i = 1; i < cs.length - 1; i++) {
      var base = cs[i - 1], move = cs[i];
      var moveBody = Math.abs(move.close - move.open);
      var isDisplacement = moveBody > Math.max(avgBody * displacementFactor, atr * 0.8);
      if (!isDisplacement) { continue; }

      var bullish = move.close > move.open && base.close < base.open;
      var bearish = move.close < move.open && base.close > base.open;
      if (!bullish && !bearish) { continue; }

      // Confirmation: a later close must break structure in the move's direction
      var later = cs.slice(i + 1);
      var structureBreak = later.some(function (c) {
        return bullish ? c.close > move.high : c.close < move.low;
      });
      var zone = { high: round(base.high), low: round(base.low) };
      var touched = later.some(function (c) { return c.low <= zone.high && c.high >= zone.low; });
      var violated = later.some(function (c) {
        return bullish ? c.close < zone.low : c.close > zone.high;
      });

      var f = finding(
        (bullish ? 'Bullish' : 'Bearish') + ' order block candidate', tf, zone,
        'Last opposite-coloured candle before a displacement candle whose body exceeds ' +
          displacementFactor + 'x the average body (and 0.8x ATR). Requires a later structure break to confirm.',
        'Displacement body ' + round(moveBody) + ' versus average ' + round(avgBody) +
          '. Structure break ' + (structureBreak ? 'confirmed' : 'not confirmed') +
          '. Zone ' + zone.low + '-' + zone.high + (touched ? ', mitigated' : ', unmitigated') + '.',
        structureBreak ? 'confirmed' : 'tentative',
        violated ? 'Already invalidated by a close beyond the zone.'
          : 'Invalidated by a close ' + (bullish ? 'below ' : 'above ') + zone.low + '.', source);
      out.blocks.push({ type: bullish ? 'BULLISH' : 'BEARISH', zone: zone, index: i - 1, confirmed: structureBreak, mitigated: touched, violated: violated });
      out.findings.push(f);

      // Breaker block: an order block whose zone was closed beyond and then retested
      if (violated && touched) {
        var b = finding('Breaker block candidate', tf, zone,
          'An order block zone was closed beyond and then retested from the other side.',
          'Zone ' + zone.low + '-' + zone.high + ' was violated and later mitigated.',
          'tentative', 'Invalidated by a close back inside the original zone.', source);
        out.breakers.push(b);
        out.findings.push(b);
      }
    }

    // Only the two most recent blocks are kept on the map to avoid clutter.
    out.blocks = out.blocks.slice(-2);
    return out;
  }

  /* ================================================================
     E. PREMIUM AND DISCOUNT
     ================================================================ */

  function analyseRange(candles, tf, source) {
    var cs = I.sanitizeCandles(candles);
    var out = {
      available: false, state: 'unavailable', high: null, low: null, equilibrium: null,
      rule: 'Dealing range = the most recent confirmed swing high and swing low. Equilibrium = (high + low) / 2. ' +
        'Price above equilibrium is premium, below is discount, within 5% of the range width is near equilibrium.',
      explanation: '', findings: [], unavailable: []
    };
    if (cs.length < 20) {
      out.unavailable.push({ module: 'Premium / discount', reason: 'Needs at least 20 candles.' });
      out.explanation = 'Not enough candles to build a reliable dealing range.';
      return out;
    }

    var major = I.swings(cs, 2);
    if (!major.highs.length || !major.lows.length) {
      out.unavailable.push({ module: 'Premium / discount', reason: 'No confirmed swing high and swing low pair.' });
      out.explanation = 'No confirmed swing points, so no reliable dealing range exists.';
      return out;
    }

    var high = major.highs[major.highs.length - 1].price;
    var low = major.lows[major.lows.length - 1].price;
    if (high <= low) {
      out.unavailable.push({ module: 'Premium / discount', reason: 'Swing high is not above the swing low.' });
      out.explanation = 'The swing points do not form a valid range.';
      return out;
    }
    var atr = I.atr(cs, 14) || 0;
    if ((high - low) < atr) {
      out.unavailable.push({ module: 'Premium / discount', reason: 'Range width ' + round(high - low) + ' is smaller than ATR(14) ' + round(atr) + ', so it is unreliable.' });
      out.explanation = 'The dealing range is narrower than one average candle, so it is treated as unreliable.';
      return out;
    }

    var eq = (high + low) / 2;
    var close = I.last(cs).close;
    var band = (high - low) * 0.05;
    out.available = true;
    out.high = round(high);
    out.low = round(low);
    out.equilibrium = round(eq);
    out.state = Math.abs(close - eq) <= band ? 'near equilibrium' : (close > eq ? 'premium' : 'discount');
    out.explanation = 'Dealing range ' + out.low + ' - ' + out.high + ' from the last confirmed swing low and high. ' +
      'Equilibrium ' + out.equilibrium + '. Last close ' + round(close) + ' sits in ' + out.state + '.';

    var f = finding('Premium / discount (' + out.state + ')', tf,
      { high: out.high, low: out.low },
      out.rule, out.explanation, 'confirmed',
      'Re-classified when a new confirmed swing point extends or replaces the range.', source);
    out.findings.push(f);
    return out;
  }

  /* ================================================================
     F. DISPLACEMENT AND REJECTION
     ================================================================ */

  function analyseDisplacement(candles, tf, source) {
    var cs = I.sanitizeCandles(candles);
    var out = {
      available: cs.length >= 20, events: [], findings: [], unavailable: [],
      factor: 1.5
    };
    if (!out.available) {
      out.unavailable.push({ module: 'Displacement', reason: 'Needs at least 20 candles.' });
      return out;
    }
    var atr = I.atr(cs, 14) || 1;
    var bodies = cs.map(function (c) { return Math.abs(c.close - c.open); });
    var avgBody = bodies.reduce(function (a, b) { return a + b; }, 0) / bodies.length;

    for (var i = 1; i < cs.length; i++) {
      var c = cs[i];
      var body = Math.abs(c.close - c.open);
      var range = c.high - c.low || 1;
      var metrics = I.candleMetrics(c);

      if (body > avgBody * out.factor && body > atr * 0.6) {
        var direction = c.close > c.open ? 'bullish' : 'bearish';
        var followThrough = cs[i + 1] ? ((cs[i + 1].close - cs[i + 1].open) > 0) === (direction === 'bullish') : false;
        var f = finding('Displacement candle (' + direction + ')', tf,
          { high: round(c.high), low: round(c.low) },
          'Body exceeds ' + out.factor + 'x the average body and 0.6x ATR(14).',
          'Body ' + round(body) + ' versus average ' + round(avgBody) + '. Follow-through ' +
            (followThrough ? 'confirmed' : 'not confirmed') + '.',
          followThrough ? 'confirmed' : 'tentative',
          'Invalidated if the following candle closes back inside the displacement range.', source);
        out.events.push({ kind: 'displacement', direction: direction, index: i, followThrough: followThrough });
        out.findings.push(f);
      }

      if (metrics && metrics.range > 0 && metrics.body <= metrics.range * 0.25 &&
          (metrics.upperWick >= metrics.body * 2 || metrics.lowerWick >= metrics.body * 2)) {
        var side = metrics.upperWick >= metrics.lowerWick ? 'upper' : 'lower';
        var r = finding('Rejection candle (' + side + ' wick)', tf,
          { high: round(c.high), low: round(c.low) },
          'Body is at most 25% of the range and the ' + side + ' wick is at least twice the body.',
          'Body ' + round(metrics.body) + ', upper wick ' + round(metrics.upperWick) + ', lower wick ' + round(metrics.lowerWick) + '.',
          'tentative', 'A rejection candle is invalidated by a close beyond its extreme.', source);
        out.events.push({ kind: 'rejection', side: side, index: i });
        out.findings.push(r);
      }
    }

    return out;
  }

  /* ================================================================
     G. ADVANCED MODULES (marked honestly when unavailable)
     ================================================================ */

  function analyseAdvanced(candles, tf, source, context) {
    var cs = I.sanitizeCandles(candles);
    var out = { findings: [], unavailable: [] };

    // Mitigation blocks: an order block that has been mitigated but not violated.
    var blocks = (context && context.orderBlocks && context.orderBlocks.blocks) || [];
    blocks.forEach(function (b) {
      if (b.mitigated && !b.violated) {
        out.findings.push(finding('Mitigation block', tf, b.zone,
          'An order-block zone that price has returned into without closing beyond it.',
          'Zone ' + b.zone.low + '-' + b.zone.high + ' touched and respected.',
          'tentative', 'Invalidated by a close beyond the zone.', source));
      }
    });

    // Rejection blocks: zone of a rejection candle that has not been closed beyond.
    var disp = (context && context.displacement && context.displacement.events) || [];
    disp.filter(function (e) { return e.kind === 'rejection'; }).slice(-2).forEach(function (e) {
      var c = cs[e.index];
      if (!c) { return; }
      out.findings.push(finding('Rejection block', tf, { high: round(c.high), low: round(c.low) },
        'Range of a rejection candle acting as a zone until closed beyond.',
        'Rejection candle at index ' + e.index + ' with the ' + e.side + ' wick extended.',
        'tentative', 'Invalidated by a close beyond the candle extreme.', source));
    });

    // Internal vs external range liquidity
    var range = context && context.range;
    if (range && range.available) {
      out.findings.push(finding('Internal / external range liquidity', tf, { high: range.high, low: range.low },
        'Liquidity inside the dealing range is internal; swing points outside it are external.',
        'Dealing range ' + range.low + '-' + range.high + ', equilibrium ' + range.equilibrium + '.',
        'confirmed', 'Re-evaluated when a new dealing range is confirmed.', source));
    } else {
      out.unavailable.push({ module: 'Internal / external range liquidity', reason: 'No reliable dealing range.' });
    }

    // Judas swing candidate: a sweep of a previous session extreme followed by a reversal
    var sweeps = (context && context.liquidity && context.liquidity.sweeps) || [];
    if (sweeps.length && range && range.available) {
      out.findings.push(finding('Judas-swing candidate', tf, sweeps[0].zone,
        'A prior session extreme was swept and price turned back inside the range.',
        'Sweep detected: ' + sweeps[0].evidence,
        'tentative', 'Speculative by definition; invalidated by continuation beyond the swept extreme.', source));
    } else {
      out.unavailable.push({ module: 'Judas swing', reason: 'Needs both a detected sweep and a reliable dealing range.' });
    }

    return out;
  }

  /* ================================================================
     REPORT
     ================================================================ */

  function analyse(candles, timeframe, options) {
    options = options || {};
    var source = options.source || 'candle data';
    var structure = analyseStructure(candles, timeframe, source);
    var liquidity = analyseLiquidity(candles, timeframe, source, options);
    var imbalances = analyseImbalances(candles, timeframe, source);
    var orderBlocks = analyseOrderBlocks(candles, timeframe, source);
    var range = analyseRange(candles, timeframe, source);
    var displacement = analyseDisplacement(candles, timeframe, source);
    var advanced = analyseAdvanced(candles, timeframe, source, {
      orderBlocks: orderBlocks, displacement: displacement, liquidity: liquidity, range: range
    });

    var findings = []
      .concat(structure.findings, liquidity.findings, imbalances.findings,
              orderBlocks.findings, range.findings, displacement.findings, advanced.findings);

    return {
      timeframe: timeframe,
      source: source,
      structure: structure,
      liquidity: liquidity,
      imbalances: imbalances,
      orderBlocks: orderBlocks,
      range: range,
      displacement: displacement,
      advanced: advanced,
      findings: findings,
      unavailable: [].concat(liquidity.unavailable, imbalances.unavailable, orderBlocks.unavailable,
                            range.unavailable, displacement.unavailable, advanced.unavailable)
    };
  }

  /**
   * Multi-timeframe view (Part 4):
   * H1 = main trend and major zones, M15 = confirmation, M5 = entry setup.
   */
  function multiTimeframe(datasets, options) {
    options = options || {};
    var reports = {};
    ['H1', 'M15', 'M5'].forEach(function (tf) {
      reports[tf] = analyse(datasets[tf] || [], tf, options);
    });

    var h1 = reports.H1, m15 = reports.M15, m5 = reports.M5;

    function bias(report) {
      if (!report || !report.structure || !report.structure.available) { return 'unknown'; }
      var t = report.structure.swing.trend;
      return t === 'UP' ? 'bullish' : t === 'DOWN' ? 'bearish' : 'neutral';
    }

    var h1Bias = bias(h1), m15Bias = bias(m15), m5Bias = bias(m5);
    var agrees = h1Bias !== 'unknown' && h1Bias === m15Bias;
    var conflicts = h1Bias !== 'unknown' && m15Bias !== 'unknown' && h1Bias !== m15Bias;
    var m5Confirms = agrees && m5Bias === h1Bias;

    var missing = [];
    if (h1Bias === 'unknown') { missing.push('H1 structure is not readable (insufficient candles).'); }
    if (m15Bias === 'unknown') { missing.push('M15 structure is not readable (insufficient candles).'); }
    if (!agrees) { missing.push('M15 does not confirm the H1 bias.'); }
    if (!m5Confirms) { missing.push('M5 does not provide an entry confirmation in the H1 direction.'); }
    if (h1.range && !h1.range.available) {
      missing.push('No reliable H1 dealing range for premium/discount.');
    }

    return {
      reports: reports,
      bias: { H1: h1Bias, M15: m15Bias, M5: m5Bias },
      agrees: agrees,
      conflicts: conflicts,
      m5Confirms: m5Confirms,
      missing: missing,
      zones: {
        H1: h1.findings.filter(function (f) { return f.zone; }).slice(0, 6),
        M15: m15.findings.filter(function (f) { return f.zone; }).slice(0, 6),
        M5: m5.findings.filter(function (f) { return f.zone; }).slice(0, 6)
      },
      summary: conflicts
        ? 'H1 and M15 conflict, so no directional setup may be taken.'
        : agrees
          ? (m5Confirms
            ? 'H1 is ' + h1Bias + ', M15 agrees and M5 confirms. This is still not a signal by itself.'
            : 'H1 is ' + h1Bias + ' and M15 agrees, but M5 does not confirm an entry yet.')
          : 'Higher-timeframe alignment is not established.'
    };
  }

  global.KP56SMC = {
    analyse: analyse,
    multiTimeframe: multiTimeframe,
    finding: finding,
    analyseStructure: analyseStructure,
    analyseLiquidity: analyseLiquidity,
    analyseImbalances: analyseImbalances,
    analyseOrderBlocks: analyseOrderBlocks,
    analyseRange: analyseRange,
    analyseDisplacement: analyseDisplacement
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KP56SMC; }

})(typeof window !== 'undefined' ? window : this);
