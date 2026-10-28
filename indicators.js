/* =====================================================================
   KP56 Gold Analysis — indicators.js   (Task 3)
   Reusable, side-effect-free technical indicator functions.

   CONVENTIONS
   -----------
   * Input candles:  [{ time, open, high, low, close, volume? }] chronological.
   * Input series:   array of finite numbers (already sanitised).
   * When there is not enough history, or the values are invalid, the function
     returns null (or { available:false }) — NEVER a misleading number.
   * Indicators are computed on COMPLETED candles by default; call
     KP56CandleValidator.validate() first.

   DOCUMENTED FORMULAS / PERIODS
   -----------------------------
   SMA(n)   : mean of the last n values.
   EMA(n)   : EMA[0] = value[0]; EMA[i] = value[i]*k + EMA[i-1]*(1-k), k = 2/(n+1).
              Needs at least 1 value; the caller decides whether that is enough.
   RSI(14)  : Wilder. First avg gain/loss = mean of first 14 changes, then
              avg = (prev*(n-1) + current)/n. RSI = 100 - 100/(1+RS), RS = gain/loss.
              Needs at least 15 values, otherwise null.
   ATR(14)  : True range TR = max(high-low, |high-prevClose|, |low-prevClose|);
              Wilder smoothing as above. Needs at least 15 candles, otherwise null.
   ADX(14)  : +DM/-DM directional movement, Wilder-smoothed; +DI = 100*+DM/TR;
              DX = 100*|+DI - -DI|/(+DI + -DI); ADX = Wilder mean of DX.
              Needs at least 2*14+2 = 30 candles, otherwise { available:false }.
   Swings   : fractal with lookback L: a swing high is a high strictly greater
              than the L highs on each side (default L = 2).
   Body     : |close - open|; upper wick = high - max(open, close);
              lower wick = min(open, close) - low; range = high - low.
   Volatility: stdev of the last n closes; ATR ratio = ATR(now)/ATR(reference);
              relative range = (high - low)/close.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------- basic helpers ---------------- */

  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  /** Removes non-finite values. Returns a new array. */
  function sanitizeValues(values) {
    if (!Array.isArray(values)) { return []; }
    var out = [];
    for (var i = 0; i < values.length; i++) {
      if (isFiniteNumber(values[i])) { out.push(values[i]); }
    }
    return out;
  }

  /** Keeps only structurally valid candles (does not fix them). */
  function sanitizeCandles(candles) {
    if (!Array.isArray(candles)) { return []; }
    var out = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (!c || typeof c !== 'object') { continue; }
      if (!isFiniteNumber(c.time) || !isFiniteNumber(c.open) || !isFiniteNumber(c.high) ||
          !isFiniteNumber(c.low) || !isFiniteNumber(c.close)) { continue; }
      if (c.high < c.low) { continue; }
      out.push(c);
    }
    return out;
  }

  function last(arr) { return (Array.isArray(arr) && arr.length) ? arr[arr.length - 1] : null; }
  function closesOf(candles) {
    return sanitizeCandles(candles).map(function (c) { return c.close; });
  }
  function round(n, d) {
    if (!isFiniteNumber(n)) { return null; }
    var f = Math.pow(10, d === undefined ? 2 : d);
    return Math.round(n * f) / f;
  }

  /* ---------------- moving averages ---------------- */

  function sma(values, period) {
    var v = sanitizeValues(values);
    if (!isFiniteNumber(period) || period < 1) { return null; }
    if (v.length < period) { return null; }        // not enough history -> no value
    var sum = 0;
    for (var i = v.length - period; i < v.length; i++) { sum += v[i]; }
    return sum / period;
  }

  /** Full EMA series. Returns [] for empty/invalid input. */
  function ema(values, period) {
    var v = sanitizeValues(values);
    if (!isFiniteNumber(period) || period < 1 || !v.length) { return []; }
    var k = 2 / (period + 1);
    var out = [v[0]];
    for (var i = 1; i < v.length; i++) {
      out.push(v[i] * k + out[i - 1] * (1 - k));
    }
    return out;
  }

  /** Last EMA value, or null when there is not enough history. */
  function emaLast(values, period, minBars) {
    var v = sanitizeValues(values);
    var need = isFiniteNumber(minBars) ? minBars : period;
    if (v.length < need) { return null; }
    var series = ema(v, period);
    return last(series);
  }

  /* ---------------- RSI (Wilder, period 14) ---------------- */

  function rsi(values, period) {
    period = isFiniteNumber(period) ? period : 14;
    var v = sanitizeValues(values);
    if (v.length <= period) { return null; }       // needs period+1 values
    var gain = 0, loss = 0, i;
    for (i = 1; i <= period; i++) {
      var d = v[i] - v[i - 1];
      if (d >= 0) { gain += d; } else { loss -= d; }
    }
    gain /= period; loss /= period;
    for (i = period + 1; i < v.length; i++) {
      var diff = v[i] - v[i - 1];
      gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    if (loss === 0) { return gain === 0 ? 50 : 100; }   // flat or one-way market
    var rs = gain / loss;
    return round(100 - 100 / (1 + rs), 2);
  }

  /* ---------------- ATR (Wilder, period 14) ---------------- */

  function trueRanges(candles) {
    var cs = sanitizeCandles(candles);
    var out = [];
    for (var i = 1; i < cs.length; i++) {
      var c = cs[i], p = cs[i - 1];
      out.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    return out;
  }

  function atr(candles, period) {
    period = isFiniteNumber(period) ? period : 14;
    var cs = sanitizeCandles(candles);
    if (cs.length <= period) { return null; }      // needs period+1 candles
    var trs = trueRanges(cs);
    var val = sma(trs.slice(0, period), period);
    if (val === null) { return null; }
    for (var j = period; j < trs.length; j++) {
      val = (val * (period - 1) + trs[j]) / period;
    }
    return round(val, 3);
  }

  /* ---------------- ADX (Wilder, period 14) ---------------- */

  function adx(candles, period) {
    period = isFiniteNumber(period) ? period : 14;
    var cs = sanitizeCandles(candles);
    var empty = { available: false, adx: null, plusDI: null, minusDI: null, reason: '' };
    if (cs.length < period * 2 + 2) {
      empty.reason = 'ADX(14) needs at least ' + (period * 2 + 2) + ' candles; ' + cs.length + ' supplied.';
      return empty;
    }

    var plusDM = [], minusDM = [], trs = [];
    for (var i = 1; i < cs.length; i++) {
      var c = cs[i], p = cs[i - 1];
      var up = c.high - p.high;
      var down = p.low - c.low;
      plusDM.push(up > down && up > 0 ? up : 0);
      minusDM.push(down > up && down > 0 ? down : 0);
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }

    function wilder(arr) {
      var v = sma(arr.slice(0, period), period);
      if (v === null) { return []; }
      var out = [v];
      for (var k = period; k < arr.length; k++) {
        v = (v * (period - 1) + arr[k]) / period;
        out.push(v);
      }
      return out;
    }

    var trS = wilder(trs), pdmS = wilder(plusDM), mdmS = wilder(minusDM);
    if (!trS.length) { return empty; }

    var dx = [];
    for (var m = 0; m < trS.length; m++) {
      var pDI = trS[m] ? (pdmS[m] / trS[m]) * 100 : 0;
      var mDI = trS[m] ? (mdmS[m] / trS[m]) * 100 : 0;
      var sum = pDI + mDI;
      dx.push(sum ? (Math.abs(pDI - mDI) / sum) * 100 : 0);
    }

    var idx = trS.length - 1;
    var adxVal = dx.length >= period ? sma(dx.slice(-period), period) : sma(dx, dx.length);
    if (adxVal === null) { return empty; }

    return {
      available: true,
      adx: round(adxVal, 2),
      plusDI: round(trS[idx] ? (pdmS[idx] / trS[idx]) * 100 : 0, 2),
      minusDI: round(trS[idx] ? (mdmS[idx] / trS[idx]) * 100 : 0, 2)
    };
  }

  /* ---------------- candle geometry ---------------- */

  /** Body and wick sizes for a single candle. Returns null for invalid input. */
  function candleMetrics(candle) {
    if (!candle || typeof candle !== 'object') { return null; }
    var o = candle.open, h = candle.high, l = candle.low, c = candle.close;
    if (!isFiniteNumber(o) || !isFiniteNumber(h) || !isFiniteNumber(l) || !isFiniteNumber(c)) { return null; }
    if (h < l) { return null; }
    var body = Math.abs(c - o);
    return {
      body: body,
      bodyPct: o ? round((body / o) * 100, 4) : null,
      upperWick: h - Math.max(o, c),
      lowerWick: Math.min(o, c) - l,
      range: h - l,
      bullish: c > o,
      bearish: c < o,
      doji: body <= (h - l) * 0.1
    };
  }

  /* ---------------- volatility ---------------- */

  function stdev(values, period) {
    var v = sanitizeValues(values);
    if (!isFiniteNumber(period) || period < 2 || v.length < period) { return null; }
    var slice = v.slice(-period);
    var mean = slice.reduce(function (a, b) { return a + b; }, 0) / period;
    if (!isFiniteNumber(mean)) { return null; }
    var variance = slice.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / period;
    return round(Math.sqrt(variance), 4);
  }

  /**
   * Volatility snapshot.
   * ratio > 1 means volatility is above the reference average.
   */
  function volatility(candles, period, referenceCandles) {
    var cs = sanitizeCandles(candles);
    var closes = closesOf(cs);
    var atrNow = atr(cs, period);
    var ref = referenceCandles && referenceCandles.length ? referenceCandles : cs;
    var atrRef = atr(sanitizeCandles(ref), period);
    if (atrNow === null) {
      return { available: false, atr: null, atrReference: null, ratio: null, stdev: null, relativeRange: null,
        reason: 'Not enough candles for ATR(' + (period || 14) + ').' };
    }
    var lastCandle = last(cs);
    return {
      available: true,
      atr: atrNow,
      atrReference: atrRef,
      ratio: atrRef ? round(atrNow / atrRef, 3) : null,
      stdev: stdev(closes, period),
      relativeRange: lastCandle && lastCandle.close
        ? round((lastCandle.high - lastCandle.low) / lastCandle.close, 5) : null
    };
  }

  /* ---------------- swings, structure, levels ---------------- */

  function swings(candles, lookback) {
    var cs = sanitizeCandles(candles);
    lookback = isFiniteNumber(lookback) ? lookback : 2;
    var highs = [], lows = [];
    if (cs.length < lookback * 2 + 1) { return { highs: highs, lows: lows, available: false }; }
    for (var i = lookback; i < cs.length - lookback; i++) {
      var isHigh = true, isLow = true;
      for (var j = 1; j <= lookback; j++) {
        if (cs[i].high <= cs[i - j].high || cs[i].high <= cs[i + j].high) { isHigh = false; }
        if (cs[i].low >= cs[i - j].low || cs[i].low >= cs[i + j].low) { isLow = false; }
      }
      if (isHigh) { highs.push({ index: i, price: cs[i].high, time: cs[i].time }); }
      if (isLow) { lows.push({ index: i, price: cs[i].low, time: cs[i].time }); }
    }
    return { highs: highs, lows: lows, available: highs.length > 0 || lows.length > 0 };
  }

  /**
   * Market structure from the two most recent swings of each type.
   * HH+HL = 'UP', LH+LL = 'DOWN', otherwise 'RANGE'.
   */
  function marketStructure(candles, lookback) {
    var cs = sanitizeCandles(candles);
    var s = swings(cs, lookback);
    var h = s.highs, l = s.lows;
    if (h.length < 2 || l.length < 2) {
      return { trend: 'UNKNOWN', available: false, detail: 'Not enough swing points to read structure.', highs: h, lows: l };
    }
    var hh = h[h.length - 1].price > h[h.length - 2].price;
    var hl = l[l.length - 1].price > l[l.length - 2].price;
    var lh = h[h.length - 1].price < h[h.length - 2].price;
    var ll = l[l.length - 1].price < l[l.length - 2].price;
    var trend = 'RANGE';
    if (hh && hl) { trend = 'UP'; }
    else if (lh && ll) { trend = 'DOWN'; }
    return {
      trend: trend,
      available: true,
      detail: 'Last swings: ' + (hh ? 'HH' : lh ? 'LH' : 'EQ-H') + ' / ' + (hl ? 'HL' : ll ? 'LL' : 'EQ-L'),
      higherHighs: hh, higherLows: hl, lowerHighs: lh, lowerLows: ll,
      highs: h, lows: l
    };
  }

  /** Support / resistance from swing points around the last close. */
  function supportResistance(candles, count) {
    var cs = sanitizeCandles(candles);
    count = isFiniteNumber(count) ? count : 2;
    var s = swings(cs, 2);
    var lastClose = cs.length ? last(cs).close : null;
    if (lastClose === null) { return { available: false, resistance: [], support: [], lastClose: null }; }
    var resistance = s.highs.map(function (h) { return round(h.price); })
      .filter(function (p) { return p > lastClose; })
      .sort(function (a, b) { return a - b; }).slice(0, count);
    var support = s.lows.map(function (l) { return round(l.price); })
      .filter(function (p) { return p < lastClose; })
      .sort(function (a, b) { return b - a; }).slice(0, count);
    return { available: true, resistance: resistance, support: support, lastClose: round(lastClose) };
  }

  /* ---------------- SMC primitives (explicit definitions) ---------------- */

  /*
   * LIQUIDITY SWEEP — price trades beyond a previous swing high (or low) and
   * then closes back inside the range within the last `window` candles.
   * A sweep alone is NOT a trade signal: it must be confirmed by structure.
   *
   * FAIR VALUE GAP (FVG) — a 3-candle imbalance:
   *   bullish: candle[i-2].high < candle[i].low   (gap below price)
   *   bearish: candle[i-2].low  > candle[i].high  (gap above price)
   *
   * ORDER BLOCK (candidate) — the last opposite-coloured candle before a
   * displacement candle at least `bodyFactor` times its body size.
   *
   * BOS / CHoCH — a close beyond the last swing high (bullish) or low
   * (bearish). 'CHoCH' when it goes against the prevailing structure.
   *
   * IMPORTANT: these are geometric descriptions of price. Candles cannot show
   * institutional order flow, so this project never claims otherwise.
   */

  function findLiquiditySweep(candles, window) {
    var cs = sanitizeCandles(candles);
    window = isFiniteNumber(window) ? window : 6;
    var s = swings(cs, 2);
    var res = {
      available: s.available,
      sweptHigh: false, sweptLow: false,
      direction: 'NONE',
      sweptHighLevel: null, sweptLowLevel: null,
      confirmed: false, note: ''
    };
    if (!s.available || cs.length < 3) {
      res.note = 'Not enough swing points to judge liquidity.';
      return res;
    }
    var recent = cs.slice(-window);
    var lastClose = last(cs).close;

    s.highs.forEach(function (h) {
      recent.forEach(function (c) {
        if (c.high > h.price && c.close < h.price) {
          res.sweptHigh = true;
          res.sweptHighLevel = round(h.price);
        }
      });
    });
    s.lows.forEach(function (l) {
      recent.forEach(function (c) {
        if (c.low < l.price && c.close > l.price) {
          res.sweptLow = true;
          res.sweptLowLevel = round(l.price);
        }
      });
    });

    if (res.sweptHigh && !res.sweptLow) { res.direction = 'BEARISH'; }
    else if (res.sweptLow && !res.sweptHigh) { res.direction = 'BULLISH'; }
    else if (res.sweptHigh && res.sweptLow) { res.direction = 'MIXED'; }

    // Confirmation = the close is back inside the swept range.
    res.confirmed = (res.direction === 'BULLISH' || res.direction === 'BEARISH') && isFiniteNumber(lastClose);
    res.note = res.direction === 'NONE'
      ? 'No swing high or low was swept in the last ' + window + ' candles.'
      : 'Sweep of ' + res.direction.toLowerCase() + ' liquidity' +
        (res.sweptHighLevel !== null ? ' above ' + res.sweptHighLevel : '') +
        (res.sweptLowLevel !== null ? ' below ' + res.sweptLowLevel : '') +
        '. A sweep alone is not a trade signal.';
    return res;
  }

  function findFVG(candles, minSize) {
    var cs = sanitizeCandles(candles);
    minSize = isFiniteNumber(minSize) ? minSize : 0.5;
    if (cs.length < 3) { return null; }
    for (var i = cs.length - 2; i >= 2; i--) {
      var a = cs[i - 2], c = cs[i];
      if (a.high < c.low && (c.low - a.high) >= minSize) {
        return { type: 'BULLISH', top: round(c.low), bottom: round(a.high), index: i, size: round(c.low - a.high) };
      }
      if (c.high < a.low && (a.low - c.high) >= minSize) {
        return { type: 'BEARISH', top: round(c.high), bottom: round(a.low), index: i, size: round(a.low - c.high) };
      }
    }
    return null;
  }

  function findOrderBlock(candles, bodyFactor) {
    var cs = sanitizeCandles(candles);
    bodyFactor = isFiniteNumber(bodyFactor) ? bodyFactor : 1.8;
    if (cs.length < 3) { return null; }
    for (var i = cs.length - 3; i >= 1; i--) {
      var base = cs[i], move = cs[i + 1];
      var moveBody = Math.abs(move.close - move.open);
      var baseBody = Math.abs(base.close - base.open);
      if (baseBody === 0 || moveBody <= baseBody * bodyFactor) { continue; }
      if (move.close > move.open && base.close < base.open) {
        return { type: 'BULLISH', top: round(base.high), bottom: round(base.low), index: i };
      }
      if (move.close < move.open && base.close > base.open) {
        return { type: 'BEARISH', top: round(base.high), bottom: round(base.low), index: i };
      }
    }
    return null;
  }

  function findBOS(candles) {
    var cs = sanitizeCandles(candles);
    if (cs.length < 5) {
      return { type: 'NONE', direction: 'NONE', available: false, detail: 'Not enough candles for structure analysis.' };
    }
    var s = swings(cs, 2);
    if (!s.highs.length || !s.lows.length) {
      return { type: 'NONE', direction: 'NONE', available: false, detail: 'No swing points available.' };
    }
    var lastCandle = last(cs);
    var lastHigh = s.highs[s.highs.length - 1].price;
    var lastLow = s.lows[s.lows.length - 1].price;
    var st = marketStructure(cs);

    if (lastCandle.close > lastHigh) {
      return {
        type: st.trend === 'UP' ? 'BOS' : 'CHoCH', direction: 'BULLISH', available: true,
        level: round(lastHigh),
        detail: 'Close ' + round(lastCandle.close) + ' broke swing high ' + round(lastHigh) + '.'
      };
    }
    if (lastCandle.close < lastLow) {
      return {
        type: st.trend === 'DOWN' ? 'BOS' : 'CHoCH', direction: 'BEARISH', available: true,
        level: round(lastLow),
        detail: 'Close ' + round(lastCandle.close) + ' broke swing low ' + round(lastLow) + '.'
      };
    }
    return {
      type: 'NONE', direction: 'NONE', available: true, level: null,
      detail: 'No break of the last swing high (' + round(lastHigh) + ') or low (' + round(lastLow) + ').'
    };
  }

  global.KP56Indicators = {
    isFiniteNumber: isFiniteNumber,
    sanitizeValues: sanitizeValues,
    sanitizeCandles: sanitizeCandles,
    last: last,
    closesOf: closesOf,
    round: round,
    sma: sma,
    ema: ema,
    emaLast: emaLast,
    rsi: rsi,
    atr: atr,
    adx: adx,
    trueRanges: trueRanges,
    candleMetrics: candleMetrics,
    stdev: stdev,
    volatility: volatility,
    swings: swings,
    marketStructure: marketStructure,
    supportResistance: supportResistance,
    findLiquiditySweep: findLiquiditySweep,
    findFVG: findFVG,
    findOrderBlock: findOrderBlock,
    findBOS: findBOS
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KP56Indicators; }

})(typeof window !== 'undefined' ? window : this);
