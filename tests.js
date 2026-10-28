/* =====================================================================
   KP56 Gold Analysis — tests.js   (Task 12)
   Deterministic unit tests for the Phase 2 analysis logic.

   HOW TO RUN
   ----------
   * Open tests.html in a browser (works on Android, works on GitHub Pages).
   * Or open the console on index.html and run:  KP56Tests.run()

   Every fixture is built from an explicit, deterministic rule (see the
   helper functions below). Expected results are derived from those rules,
   not copied from the code's output — otherwise the tests would prove
   nothing.

   The DOM tests use the real index.html inside an iframe. If the browser
   blocks that (for example some file:// configurations), those tests are
   reported as SKIPPED with a reason instead of silently passing.
   ===================================================================== */
(function (global) {
  'use strict';

  var I = global.KP56Indicators;
  var V = global.KP56CandleValidator;
  var Settings = global.KP56Settings;

  /* ---------------- assertion helper ---------------- */

  function assert(condition, message) {
    if (!condition) { throw new Error(message); }
  }
  function approx(actual, expected, tolerance, message) {
    if (actual === null || actual === undefined || Math.abs(actual - expected) > (tolerance || 1e-9)) {
      throw new Error(message + ' (expected ' + expected + ', got ' + actual + ')');
    }
  }

  /* ---------------- deterministic fixtures ---------------- */

  // Rising (or falling) series with regular swings and a final break of the
  // last swing point, so BOS/CHoCH and HH/HL are unambiguous.
  function trendSeries(count, direction) {
    var dir = direction === 'bearish' ? -1 : 1;
    var candles = [];
    for (var i = 0; i < count; i++) {
      var base = 2000 + dir * (0.9 * i) + 7 * Math.sin(i / 3);
      var open = base;
      var close = base + dir * 0.6;
      candles.push({
        time: 1700000000000 + i * 60000,
        open: Math.round(open * 100) / 100,
        high: Math.round((Math.max(open, close) + 1.4) * 100) / 100,
        low: Math.round((Math.min(open, close) - 1.4) * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: 1000
      });
    }
    // Final candle breaks the last swing point in the trend direction.
    var highs = candles.map(function (c) { return c.high; });
    var lows = candles.map(function (c) { return c.low; });
    var lastCandle = candles[candles.length - 1];
    if (dir > 0) {
      var top = Math.max.apply(null, highs) + 3;
      lastCandle.open = top - 1;
      lastCandle.close = top;
      lastCandle.high = top + 1;
      lastCandle.low = top - 2;
    } else {
      var bottom = Math.min.apply(null, lows) - 3;
      lastCandle.open = bottom + 1;
      lastCandle.close = bottom;
      lastCandle.high = bottom + 2;
      lastCandle.low = bottom - 1;
    }
    return candles;
  }

  // A hand-built series with an unmistakable swing low at index 4 (low 1991),
  // followed by a candle that trades below it (low 1989) and closes back above
  // it (close 1998): exactly the definition of a bullish liquidity sweep.
  function sweepSeries() {
    var raw = [
      [2000, 2002, 1998, 1999],
      [1999, 2000, 1995, 1996],
      [1996, 1997, 1993, 1994],
      [1994, 1996, 1992, 1995],
      [1995, 1996, 1991, 1995.5],   // <- swing low at 1991
      [1995.5, 1998, 1994, 1997],
      [1997, 1999, 1996, 1998],
      [1998, 2000, 1997, 1999],
      [1999, 2001, 1998, 2000],
      [2000, 2001, 1989, 1998]      // <- sweeps the 1991 low, closes back above
    ];
    return raw.map(function (r, i) {
      return {
        time: 1700000000000 + i * 60000,
        open: r[0], high: r[1], low: r[2], close: r[3], volume: 500
      };
    });
  }

  function flatSeries(count, price) {
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        time: 1700000000000 + i * 60000,
        open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 100
      });
    }
    return out;
  }

  function settings(overrides) {
    var s = Settings.getDefaults();
    Object.keys(overrides || {}).forEach(function (k) { s[k] = overrides[k]; });
    return s;
  }

  /* ---------------- the tests ---------------- */

  var TESTS = [

    {
      id: 1,
      name: 'Settings save and dialog close',
      run: function (dom) {
        if (!dom) { return { skipped: 'The index.html iframe was not reachable in this browser context.' }; }
        var doc = dom.document;
        doc.getElementById('settingsOpenBtn').click();
        assert(doc.getElementById('settingsModal').hidden === false, 'Dialog did not open.');
        doc.getElementById('setRr').value = '3';
        doc.getElementById('settingsSaveBtn').click();
        assert(doc.getElementById('settingsModal').hidden === true, 'Dialog did not close after a successful save.');
        var stored = JSON.parse(dom.localStorage.getItem(Settings.STORAGE_KEY));
        assert(stored && Number(stored.minRR) === 3, 'Saved value was not persisted (minRR should be 3).');
        return { detail: 'Save persists minRR=3 and the dialog closes.' };
      }
    },

    {
      id: 2,
      name: 'Settings persist after reload',
      run: function () {
        var saved = Settings.save(settings({ riskPct: 2.5 }));
        assert(saved.ok && saved.persisted, 'Save did not persist.');
        var reloaded = Settings.load();   // load() always reads localStorage fresh
        assert(Number(reloaded.riskPct) === 2.5, 'Reloaded risk percentage differs from the saved value.');
        return { detail: 'load() returned the previously saved risk percentage of 2.5%.' };
      }
    },

    {
      id: 3,
      name: 'Invalid settings are rejected',
      run: function () {
        var bad = Settings.validate(settings({ minRR: 0 }));
        assert(bad.ok === false, 'minRR = 0 should be rejected.');
        assert(bad.errors.length > 0, 'No error message was produced.');
        var bad2 = Settings.validate(settings({ rsiMin: 80, rsiMax: 40 }));
        assert(bad2.ok === false, 'RSI maximum below RSI minimum should be rejected.');
        var saved = Settings.save(settings({ riskPct: -5 }));
        assert(saved.ok === false && saved.persisted === false, 'An invalid value must never be written to storage.');
        return { detail: 'Out-of-range risk, inverted RSI window and zero risk/reward are all rejected.' };
      }
    },

    {
      id: 4,
      name: 'Reset to defaults does not persist before saving',
      run: function () {
        Settings.save(settings({ minRR: 5, theme: 'light' }));
        var defaults = Settings.resetToDefaults();
        assert(Number(defaults.minRR) === 2, 'resetToDefaults() must return the documented default of 2.');
        var stillStored = Settings.load();
        assert(Number(stillStored.minRR) === 5, 'Reset must NOT overwrite saved settings before Save is pressed.');
        Settings.clearStored();
        return { detail: 'Defaults returned without touching storage; saved value survived.' };
      }
    },

    {
      id: 5,
      name: 'EMA calculation',
      run: function () {
        var values = [1, 2, 3, 4, 5];
        var series = I.ema(values, 3);          // k = 2/(3+1) = 0.5
        approx(series[0], 1, 1e-9, 'EMA seed should be the first value');
        approx(series[1], 1.5, 1e-9, 'EMA[1]');
        approx(series[2], 2.25, 1e-9, 'EMA[2]');
        approx(series[4], 4.0625, 1e-9, 'EMA[4]');
        assert(I.ema([], 5).length === 0, 'Empty input must return an empty series.');
        assert(I.emaLast([1, 2, 3], 50, 50) === null, 'EMA must return null before enough history exists.');
        return { detail: 'EMA(3) of 1..5 matched the hand-computed series 1, 1.5, 2.25, 3.125, 4.0625.' };
      }
    },

    {
      id: 6,
      name: 'RSI calculation',
      run: function () {
        approx(I.rsi([1, 2, 1], 2), 50, 1e-9, 'RSI(2) of 1,2,1 should be exactly 50');
        assert(I.rsi([1, 2, 3, 4, 5], 14) === null, 'RSI must return null before enough history exists.');
        var rising = [];
        for (var i = 0; i < 20; i++) { rising.push(10 + i); }
        approx(I.rsi(rising, 14), 100, 1e-9, 'A strictly rising series must give RSI 100');
        var falling = rising.slice().reverse();
        approx(I.rsi(falling, 14), 0, 1e-9, 'A strictly falling series must give RSI 0');
        assert(I.rsi([1, null, 3, 4], 2) !== undefined, 'Non-numeric values must be ignored, not crash.');
        return { detail: 'RSI(2)=50 hand case, RSI=100 rising, RSI=0 falling, null on short input.' };
      }
    },

    {
      id: 7,
      name: 'ADX and ATR calculation',
      run: function () {
        var candles = [
          { time: 1, open: 10, high: 12, low: 9, close: 11 },
          { time: 2, open: 11, high: 13, low: 10, close: 12 },
          { time: 3, open: 12, high: 16, low: 11, close: 15 }
        ];
        // With period 1 the Wilder smoothing collapses to the last true range:
        // TR3 = max(16-11, |16-12|, |11-12|) = 5
        approx(I.atr(candles, 1), 5, 1e-9, 'ATR(1) should equal the last true range of 5');
        assert(I.atr(candles, 14) === null, 'ATR must return null before enough history exists.');

        var short = I.adx(candles, 14);
        assert(short.available === false && short.adx === null, 'ADX must report unavailable instead of a number on short input.');

        var rising = trendSeries(60, 'bullish');
        var full = I.adx(rising, 14);
        assert(full.available === true, 'ADX should be available on 60 candles.');
        assert(full.adx > 20, 'A strong trend should give ADX above 20, got ' + full.adx);
        assert(full.plusDI > full.minusDI, 'In a rising series +DI must exceed -DI.');
        return { detail: 'ATR hand case matched; ADX refuses short input and reads a trend correctly.' };
      }
    },

    {
      id: 8,
      name: 'Bullish trend example (M15 + H1 agree)',
      run: function () {
        var result = global.TrendChecker.evaluate({
          candles: { M5: trendSeries(60, 'bullish'), M15: trendSeries(60, 'bullish'), H1: trendSeries(60, 'bullish') }
        });
        assert(result.status === 'PASS', 'Expected PASS, got ' + result.status + ' — ' + result.summary);
        assert(result.direction === 'bullish', 'Expected a bullish direction, got ' + result.direction);
        assert(result.rows.length >= 5, 'Rule-by-rule results are missing.');
        return { detail: 'PASS / bullish with per-rule results and reasons.' };
      }
    },

    {
      id: 9,
      name: 'Bearish trend example (M15 + H1 agree)',
      run: function () {
        var result = global.TrendChecker.evaluate({
          candles: { M5: trendSeries(60, 'bearish'), M15: trendSeries(60, 'bearish'), H1: trendSeries(60, 'bearish') }
        });
        assert(result.status === 'PASS', 'Expected PASS, got ' + result.status);
        assert(result.direction === 'bearish', 'Expected a bearish direction, got ' + result.direction);
        return { detail: 'PASS / bearish.' };
      }
    },

    {
      id: 10,
      name: 'Conflicting timeframes never give a direction',
      run: function () {
        var result = global.TrendChecker.evaluate({
          candles: { M5: trendSeries(60, 'bullish'), M15: trendSeries(60, 'bullish'), H1: trendSeries(60, 'bearish') }
        });
        assert(result.status === 'FAIL', 'A conflict must not pass, got ' + result.status);
        assert(result.direction === 'unknown', 'A conflict must not report a direction, got ' + result.direction);
        assert(result.conflict === true, 'The conflict must be flagged.');
        return { detail: 'M15 bullish vs H1 bearish -> FAIL / unknown / conflict flagged.' };
      }
    },

    {
      id: 11,
      name: 'Valid liquidity sweep is detected',
      run: function () {
        var candles = sweepSeries();
        var sweep = I.findLiquiditySweep(candles, 6);
        assert(sweep.sweptLow === true, 'The prior swing low should be flagged as swept.');
        assert(sweep.direction === 'BULLISH', 'A sweep of a low that closes back above is bullish, got ' + sweep.direction);
        assert(sweep.sweptLowLevel !== null, 'The swept price level must be reported.');
        return { detail: 'Swept low ' + sweep.sweptLowLevel + ' detected and reported with its level.' };
      }
    },

    {
      id: 12,
      name: 'Incomplete SMC setup does not pass',
      run: function () {
        // Flat candles: no sweep, no imbalance, no structure break.
        var result = global.SmcChecker.evaluate({
          candles: { M5: flatSeries(40, 2000), M15: flatSeries(40, 2000), H1: flatSeries(40, 2000) },
          candleClosed: true
        });
        assert(result.status !== 'PASS', 'A flat market must not produce a passing SMC setup, got ' + result.status);
        assert(result.direction !== 'bullish' && result.direction !== 'bearish', 'A flat market must not give a direction.');

        var open = global.SmcChecker.evaluate({
          candles: { M5: trendSeries(60, 'bullish'), M15: trendSeries(60, 'bullish'), H1: trendSeries(60, 'bullish') },
          candleClosed: false
        });
        assert(open.status === 'WAITING', 'An unclosed candle must leave the test WAITING, got ' + open.status);
        return { detail: 'Flat data fails; an open candle forces WAITING.' };
      }
    },

    {
      id: 13,
      name: 'Unavailable spread and stale data block entry quality',
      run: function () {
        var base = {
          candles: { M5: trendSeries(60, 'bullish'), M15: trendSeries(60, 'bullish'), H1: trendSeries(60, 'bullish') },
          // Momentum filters are widened here so that this test isolates the
          // spread and freshness rules rather than failing on RSI/ADX.
          settings: settings({ rsiMin: 0, rsiMax: 100, adxMin: 1, volMaxRatio: 20 }),
          candleClosed: true,
          dataStatus: { mode: 'LIVE', live: true, providerName: 'test' },
          dataAgeSeconds: 10
        };
        var noSpread = global.EntryChecker.evaluate(Object.assign({}, base, { spread: null }));
        var spreadRow = noSpread.rows.filter(function (r) { return r.id === 'spread'; })[0];
        assert(spreadRow.state === 'wait', 'An unavailable spread must be marked unavailable, not fabricated.');
        assert(noSpread.status === 'WAITING', 'With an unavailable spread the test must wait, got ' + noSpread.status);

        var tooWide = global.EntryChecker.evaluate(Object.assign({}, base, { spread: 500 }));
        assert(tooWide.status === 'FAIL', 'A spread above the maximum must fail, got ' + tooWide.status);

        var stale = global.EntryChecker.evaluate(Object.assign({}, base, { spread: 5, dataAgeSeconds: 99999 }));
        assert(stale.status === 'FAIL', 'Stale data must block the entry, got ' + stale.status);
        return { detail: 'No spread -> WAITING; oversized spread -> FAIL; stale data -> FAIL.' };
      }
    },

    {
      id: 14,
      name: 'Valid BUY risk geometry',
      run: function () {
        var g = global.RiskForecast.validateGeometry(
          { direction: 'BUY', entry: 2000, sl: 1990, tp1: 2020, tp2: 2040 }, 'BUY');
        assert(g.ok === true, 'Valid BUY geometry was rejected: ' + g.errors.join(' '));
        assert(g.risk === 10, 'Risk distance should be 10, got ' + g.risk);
        approx(g.rr, 2, 1e-9, 'Reward to risk should be 2');
        var calc = global.RiskForecast.calculateRisk(
          { balance: 1000, riskPct: 1, entry: 2000, sl: 1990, target: 2020 }, {}, 'BUY');
        assert(calc.ok && calc.riskAmount === 10, 'Monetary risk should be 10, got ' + calc.riskAmount);
        assert(calc.lotSize === null, 'Lot size must be withheld without broker specifications.');
        return { detail: 'Risk 10 units, R:R 1:2, monetary risk $10, lot size withheld.' };
      }
    },

    {
      id: 15,
      name: 'Valid SELL risk geometry',
      run: function () {
        var g = global.RiskForecast.validateGeometry(
          { direction: 'SELL', entry: 2000, sl: 2010, tp1: 1980, tp2: 1960 }, 'SELL');
        assert(g.ok === true, 'Valid SELL geometry was rejected: ' + g.errors.join(' '));
        assert(g.risk === 10, 'Risk distance should be 10, got ' + g.risk);
        approx(g.rr, 2, 1e-9, 'Reward to risk should be 2');
        return { detail: 'SELL with stop above entry and targets below validates correctly.' };
      }
    },

    {
      id: 16,
      name: 'Invalid stop loss and target geometry is rejected',
      run: function () {
        var cases = [
          [{ direction: 'BUY', entry: 2000, sl: 2010, tp1: 2020 }, 'BUY stop above entry'],
          [{ direction: 'BUY', entry: 2000, sl: 1990, tp1: 1980 }, 'BUY target below entry'],
          [{ direction: 'SELL', entry: 2000, sl: 1990, tp1: 1980 }, 'SELL stop below entry'],
          [{ direction: 'SELL', entry: 2000, sl: 2010, tp1: 2020 }, 'SELL target above entry'],
          [{ direction: 'BUY', entry: 2000, sl: 2000, tp1: 2020 }, 'zero risk distance'],
          [{ direction: 'BUY', entry: 2000, sl: 1990, tp1: 2020, tp2: 2010 }, 'TP2 below TP1']
        ];
        cases.forEach(function (c) {
          var g = global.RiskForecast.validateGeometry(c[0], c[0].direction);
          assert(g.ok === false && g.errors.length > 0, 'Should be rejected: ' + c[1]);
        });
        var noData = global.RiskForecast.validateGeometry({ direction: 'BUY' }, 'BUY');
        assert(noData.ok === false, 'Missing prices must be rejected.');
        return { detail: 'All six wrong-side / zero-distance / misordered cases are rejected.' };
      }
    },

    {
      id: 17,
      name: 'Missing and invalid candle data is not analysed',
      run: function () {
        var empty = V.validate([], 'M15');
        assert(empty.ok === false, 'Empty input must not validate.');
        var broken = V.validate([
          { time: 1700000000000, open: 2000, high: 1990, low: 1995, close: 2001 },  // high < low
          { time: 1700000000000, open: 2000, high: 2005, low: 1995, close: 2001 },  // duplicate timestamp
          { time: 'nope', open: 2000, high: 2005, low: 1995, close: 2001 },         // bad timestamp
          { time: 1700000060000, open: 2000, high: 2005, low: 1995, close: 2001 }
        ], 'M15');
        assert(broken.stats.dropped >= 3, 'Invalid records must be dropped, not repaired.');
        assert(broken.candles.length === 1, 'Only the valid record should survive.');

        var waiting = global.TrendChecker.evaluate({ candles: { M5: [], M15: [], H1: [] } });
        assert(waiting.status === 'WAITING', 'No data must produce WAITING, got ' + waiting.status);
        assert(waiting.direction === 'unknown', 'No data must not produce a direction.');
        return { detail: 'Invalid OHLC, duplicate timestamps and missing data are all refused.' };
      }
    },

    {
      id: 18,
      name: 'Duplicate signals are suppressed',
      run: function () {
        var plan = { direction: 'BUY', entry: 2000, sl: 1990, tp1: 2020, tp2: 2040, rr: 2 };
        var key = plan.direction + '@' + plan.entry + '@' + plan.sl;
        var passing = [{ name: 'T', status: 'PASS', direction: 'bullish', summary: 'ok' }];
        var decision = global.SignalEngine.evaluate({
          tests: passing,
          dataStatus: { mode: 'LIVE', live: true, providerName: 'test' },
          plan: plan,
          forecast: { implemented: true },          // a validated forecast, for this test only
          recentSignalKeys: [key]
        });
        assert(decision.state === 'NO TRADE', 'A duplicate must be suppressed, got ' + decision.state);
        assert(decision.duplicate === true, 'The duplicate must be flagged.');
        return { detail: 'An already-issued setup key is suppressed as a duplicate.' };
      }
    },

    {
      id: 19,
      name: 'Demo data never produces a live notification',
      run: function () {
        var passing = [
          { name: 'T1', status: 'PASS', direction: 'bullish', summary: 'ok' },
          { name: 'T2', status: 'PASS', direction: 'bullish', summary: 'ok' }
        ];
        var decision = global.SignalEngine.evaluate({
          tests: passing,
          dataStatus: { mode: 'DEMO', live: false, providerName: 'Deterministic Mock Provider v1 (Phase 1)' },
          plan: { direction: 'BUY', entry: 2000, sl: 1990, tp1: 2020, tp2: 2040, rr: 2 },
          forecast: { implemented: true },
          recentSignalKeys: []
        });
        assert(decision.state !== 'BUY' && decision.state !== 'SELL',
          'Demo data must never yield a tradable signal, got ' + decision.state);
        assert(decision.blockReasons.join(' ').indexOf('Demo') !== -1 ||
               decision.blockReasons.join(' ').indexOf('DEMO') !== -1,
               'The demo-data blocking reason must be recorded.');
        assert(typeof global.TelegramSender === 'undefined',
          'No Telegram sending code may exist in the frontend.');
        return { detail: 'Demo data yields ' + decision.state + ' and the reason is recorded.' };
      }
    },

    {
      id: 20,
      name: 'A mandatory FAIL or WAITING always blocks the signal',
      run: function () {
        var live = { mode: 'LIVE', live: true, providerName: 'test' };
        var plan = { direction: 'BUY', entry: 2000, sl: 1990, tp1: 2020, tp2: 2040, rr: 2 };
        var forecast = { implemented: true };

        var withFail = global.SignalEngine.evaluate({
          tests: [
            { name: 'T1', status: 'PASS', direction: 'bullish', summary: 'ok' },
            { name: 'T2', status: 'FAIL', direction: 'bearish', summary: 'setup incomplete' }
          ],
          dataStatus: live, plan: plan, forecast: forecast, recentSignalKeys: []
        });
        assert(withFail.state === 'NO TRADE', 'A mandatory FAIL must block, got ' + withFail.state);

        var withWait = global.SignalEngine.evaluate({
          tests: [
            { name: 'T1', status: 'PASS', direction: 'bullish', summary: 'ok' },
            { name: 'T2', status: 'WAITING', direction: 'unknown', summary: 'waiting for data' }
          ],
          dataStatus: live, plan: plan, forecast: forecast, recentSignalKeys: []
        });
        assert(withWait.state === 'WAITING FOR DATA', 'A mandatory WAITING must block, got ' + withWait.state);

        var noForecast = global.SignalEngine.evaluate({
          tests: [{ name: 'T1', status: 'PASS', direction: 'bullish', summary: 'ok' }],
          dataStatus: live, plan: plan, forecast: { implemented: false }, recentSignalKeys: []
        });
        assert(noForecast.state !== 'BUY' && noForecast.state !== 'SELL',
          'An unvalidated forecast must block the signal.');
        return { detail: 'FAIL -> NO TRADE, WAITING -> WAITING FOR DATA, no forecast -> blocked.' };
      }
    },

    /* ---------------- Phase 3 tests (Part 11) ---------------- */

    {
      id: 21,
      name: 'SMC engine detects a bullish structure break',
      run: function () {
        var report = global.KP56SMC.analyse(trendSeries(60, 'bullish'), 'M5');
        var breaks = report.structure.breaks;
        assert(breaks.length > 0, 'No structure break was detected on a rising series.');
        assert(/Bullish/.test(breaks[0].concept), 'Expected a bullish break, got ' + breaks[0].concept);
        assert(breaks[0].confirmation === 'confirmed', 'A close beyond the swing point must be confirmed.');
        assert(breaks[0].rule && breaks[0].evidence && breaks[0].source, 'Every finding needs rule, evidence and source.');
        return { detail: breaks[0].concept + ' at ' + breaks[0].zone.high + ' with rule and invalidation recorded.' };
      }
    },

    {
      id: 22,
      name: 'Order blocks require displacement, not just an opposing candle',
      run: function () {
        var quiet = global.KP56SMC.analyseOrderBlocks(trendSeries(40, 'bullish'), 'M5');
        assert(quiet.blocks.length === 0, 'A quiet series must not produce order-block candidates.');

        var candles = [
          { time: 1, open: 2000, high: 2001, low: 1999, close: 2000.2 },
          { time: 2, open: 2000.2, high: 2000.6, low: 1998.5, close: 1999 },   // opposite candle
          { time: 3, open: 1999, high: 2010, low: 1998.8, close: 2009 },        // displacement
          { time: 4, open: 2009, high: 2012, low: 2008, close: 2011 },          // structure break
          { time: 5, open: 2011, high: 2013, low: 2010, close: 2012 },
          { time: 6, open: 2012, high: 2013, low: 2011, close: 2012.5 }
        ];
        var loud = global.KP56SMC.analyseOrderBlocks(candles, 'M5');
        assert(loud.blocks.length > 0, 'A displacement should produce a candidate.');
        assert(loud.blocks[0].type === 'BULLISH', 'Expected a bullish candidate, got ' + loud.blocks[0].type);
        assert(loud.blocks[0].confirmed === true, 'A later structure break must confirm the candidate.');
        assert(loud.blocks[0].zone.high === 2000.6, 'Zone must be the opposing candle high.');
        return { detail: 'Quiet series produced none; displacement + break produced a confirmed candidate.' };
      }
    },

    {
      id: 23,
      name: 'A liquidity level is not the same thing as a liquidity sweep',
      run: function () {
        var targetReport = global.KP56SMC.analyse(trendSeries(60, 'bullish'), 'M5');
        var targets = targetReport.liquidity.bsl.concat(targetReport.liquidity.ssl);
        assert(targetReport.liquidity.sweeps.length === 0, 'A rising series with no sweep must report no sweep.');
        assert(targets.length > 0, 'Liquidity targets should still be listed.');
        targets.forEach(function (f) {
          assert(f.confirmation === 'none', 'A target level must not be reported as a confirmed event.');
        });

        var padded = flatSeries(20, 2001).concat(sweepSeries().map(function (c) {
          return { time: c.time + 20 * 60000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
        }));
        var sweepReport = global.KP56SMC.analyse(padded, 'M5');
        assert(sweepReport.liquidity.sweeps.length > 0, 'The hand-built sweep must be detected.');
        assert(sweepReport.liquidity.sweeps[0].zone, 'The swept level must be reported.');
        return { detail: 'Targets are marked "none" (targets), sweeps are separate events with levels.' };
      }
    },

    {
      id: 24,
      name: 'FVG mitigation status is classified, not guessed',
      run: function () {
        var base = [
          { time: 1, open: 2000, high: 2001, low: 1999, close: 2000 },
          { time: 2, open: 2000.5, high: 2003, low: 2000.2, close: 2002 },
          { time: 3, open: 2002.6, high: 2006, low: 2002.5, close: 2005 }       // bullish gap 2001-2002.5
        ];
        var untouched = global.KP56SMC.analyseImbalances(base.concat([
          { time: 4, open: 2005, high: 2007, low: 2004, close: 2006 }
        ]), 'M5');
        assert(untouched.gaps.length === 1, 'Exactly one gap should be detected.');
        assert(untouched.gaps[0].status === 'unmitigated', 'Expected unmitigated, got ' + untouched.gaps[0].status);

        var filled = global.KP56SMC.analyseImbalances(base.concat([
          { time: 4, open: 2003, high: 2003.5, low: 1999.5, close: 2002 }
        ]), 'M5');
        assert(filled.gaps[0].status === 'fully mitigated', 'Expected fully mitigated, got ' + filled.gaps[0].status);
        return { detail: 'Unmitigated and fully mitigated gaps are classified from later candles.' };
      }
    },

    {
      id: 25,
      name: 'Premium / discount returns unavailable when the range is unreliable',
      run: function () {
        var flat = global.KP56SMC.analyseRange(flatSeries(40, 2000), 'M5');
        assert(flat.available === false, 'A flat series has no valid dealing range.');
        assert(flat.state === 'unavailable', 'State must read unavailable.');
        assert(flat.explanation.length > 0, 'An explanation is required when unavailable.');

        var trending = global.KP56SMC.analyseRange(trendSeries(60, 'bullish'), 'M5');
        if (trending.available) {
          assert(['premium', 'discount', 'near equilibrium'].indexOf(trending.state) !== -1,
            'Unexpected state ' + trending.state);
          assert(trending.high > trending.low, 'Range boundaries are inverted.');
        } else {
          assert(trending.unavailable.length > 0, 'Unavailability must state a reason.');
        }
        return { detail: 'Flat data -> unavailable with a reason; trending data -> documented state or documented reason.' };
      }
    },

    {
      id: 26,
      name: 'Multi-timeframe alignment and conflict',
      run: function () {
        var aligned = global.KP56SMC.multiTimeframe({
          H1: trendSeries(60, 'bullish'), M15: trendSeries(60, 'bullish'), M5: trendSeries(60, 'bullish')
        });
        assert(aligned.agrees === true, 'H1 and M15 should agree.');
        assert(aligned.m5Confirms === true, 'M5 should confirm.');
        assert(aligned.conflicts === false, 'There is no conflict.');

        var conflict = global.KP56SMC.multiTimeframe({
          H1: trendSeries(60, 'bearish'), M15: trendSeries(60, 'bullish'), M5: trendSeries(60, 'bullish')
        });
        assert(conflict.conflicts === true, 'Opposite H1/M15 bias must be flagged as a conflict.');
        assert(conflict.agrees === false, 'Conflicting timeframes must not agree.');
        assert(conflict.missing.length > 0, 'A conflict must list what is missing.');
        return { detail: 'Aligned case confirms; conflicting case blocks and lists missing conditions.' };
      }
    },

    {
      id: 27,
      name: 'The SMC engine invents nothing from empty data',
      run: function () {
        var report = global.KP56SMC.analyse([], 'M5');
        assert(report.findings.length === 0, 'No findings may be produced from no data.');
        assert(report.structure.available === false, 'Structure must report unavailable.');
        assert(report.range.available === false, 'Range must report unavailable.');
        assert(report.unavailable.length > 0, 'Unavailability reasons must be listed.');
        return { detail: 'Empty input produces no findings and explicit unavailability reasons.' };
      }
    },

    {
      id: 28,
      name: 'Screenshot upload validation and timeframe assignment',
      run: function () {
        var S = global.KP56Screenshots;
        var good = new Blob(['fake-png-bytes'], { type: 'image/png' });
        good.name = 'h1-chart.png';
        var bad = new Blob(['plain text'], { type: 'text/plain' });
        bad.name = 'notes.txt';

        var rejected = S.assign(1, bad);
        assert(rejected.ok === false, 'A non-image file must be rejected.');
        assert(/PNG|JPG|JPEG/i.test(rejected.message), 'The rejection must say which types are allowed.');

        var accepted = S.assign(0, good);
        assert(accepted.ok === true, 'A PNG file must be accepted.');

        var missing = S.checkAssignments();
        assert(missing.ok === false, 'Two missing screenshots must block analysis.');
        assert(missing.problems.length >= 2, 'Each missing screenshot must be reported.');

        // Two screenshots assigned to the same timeframe must be refused.
        var second = new Blob(['more'], { type: 'image/jpeg' });
        second.name = 'm15-chart.jpg';
        S.assign(1, second);
        S.setTimeframe(1, S.getState().slots[0].key);
        var clash = S.checkAssignments();
        assert(clash.ok === false, 'Duplicate timeframe assignment must be refused.');

        S.remove(0); S.remove(1); S.remove(2);
        return { detail: 'Bad type rejected, missing slots reported, duplicate timeframe refused.' };
      }
    },

    {
      id: 29,
      name: 'Screenshot analysis reports the missing backend instead of inventing results',
      run: function () {
        var S = global.KP56Screenshots;
        var report = null;
        // Three valid, uniquely assigned screenshots are required to reach the provider step.
        [0, 1, 2].forEach(function (i) {
          var b = new Blob(['img'], { type: 'image/png' });
          b.name = 'shot' + i + '.png';
          S.assign(i, b);
        });
        S.setTimeframe(0, 'H1'); S.setTimeframe(1, 'M15'); S.setTimeframe(2, 'M5');
        S.analyse(function (r) { report = r; });
        assert(report !== null, 'The analyse callback must always fire.');
        assert(report.status === 'unavailable', 'Expected unavailable without a provider, got ' + report.status);
        assert(report.stateLabel === 'IMAGE ANALYSIS BACKEND NOT CONFIGURED', 'The honest status label is required.');
        assert(report.findings.length === 0, 'No findings may be fabricated.');
        [0, 1, 2].forEach(function (i) { S.remove(i); });
        return { detail: 'Status reads IMAGE ANALYSIS BACKEND NOT CONFIGURED and zero findings are returned.' };
      }
    },

    {
      id: 30,
      name: 'Snapshot evidence never becomes a live signal',
      run: function () {
        var decision = global.SignalEngine.evaluate({
          tests: [
            { name: 'T1', status: 'PASS', direction: 'bullish', summary: 'from screenshots' },
            { name: 'T2', status: 'PASS', direction: 'bullish', summary: 'from screenshots' }
          ],
          dataStatus: { mode: 'SNAPSHOT ANALYSIS', status: 'SNAPSHOT ANALYSIS', live: false, providerName: 'screenshots' },
          plan: null,
          forecast: { implemented: true },
          recentSignalKeys: []
        });
        assert(decision.state !== 'BUY' && decision.state !== 'SELL',
          'Screenshot evidence must never yield a tradable signal, got ' + decision.state);
        return { detail: 'Snapshot mode yields ' + decision.state + ' with recorded reasons.' };
      }
    },

    {
      id: 31,
      name: 'MT5 mode shows no data rather than fake data when disconnected',
      run: function () {
        var P = global.KP56DataProvider;
        var previous = P.getMode();
        P.setMode('mt5');
        var candles = P.getCandles('XAUUSD', 'M15', 50);
        assert(candles.candles.length === 0, 'Disconnected MT5 mode must return no candles, never demo candles.');
        assert(candles.synthetic === false, 'MT5 data must never be marked synthetic.');
        var price = P.getLatestPrice('XAUUSD');
        assert(price.price === null, 'A missing live quote must be null, never invented.');
        var status = P.getDataStatus();
        assert(['NOT CONNECTED', 'OFFLINE', 'STALE', 'LIVE'].indexOf(status.status) !== -1,
          'Unexpected MT5 status ' + status.status);
        assert(status.live === false, 'Without a successful read the feed is not live.');
        P.setMode(previous);
        return { detail: 'Disconnected MT5 mode returns empty candles and a null price, with status ' + status.status + '.' };
      }
    },

    {
      id: 32,
      name: 'Provider status transitions are explicit',
      run: function () {
        var P = global.KP56DataProvider;
        P.setMode('demo');
        var demo = P.getDataStatus();
        assert(demo.status === 'DEMO' && demo.live === false, 'Demo mode must always report DEMO.');
        assert(demo.status !== 'LIVE', 'Demo mode can never report LIVE.');

        P.setMode('snapshot');
        var snap = P.getDataStatus();
        assert(snap.status === 'SNAPSHOT ANALYSIS', 'Snapshot mode must report SNAPSHOT ANALYSIS.');

        P.setMode('demo');
        return { detail: 'DEMO -> SNAPSHOT ANALYSIS -> DEMO transitions report the correct status.' };
      }
    },

    {
      id: 33,
      name: 'No credentials can be stored by the settings module',
      run: function () {
        var keys = Object.keys(global.KP56Settings.DEFAULTS);
        var forbidden = keys.filter(function (k) {
          return /token|password|secret|apikey|api_key|login/i.test(k);
        });
        assert(forbidden.length === 0, 'Settings must never hold credential fields: ' + forbidden.join(', '));
        var saved = global.KP56Settings.load();
        Object.keys(saved).forEach(function (k) {
          assert(!/token|password|secret/i.test(k), 'Stored settings contain a credential-like key: ' + k);
        });
        return { detail: 'Settings schema contains no token, password or secret fields.' };
      }
    },

    {
      id: 34,
      name: 'An unvalidated forecast cannot pass the risk validator',
      run: function () {
        var result = global.RiskForecast.evaluate({
          plan: { direction: 'BUY', entry: 2000, sl: 1990, tp1: 2020, tp2: 2040, rr: 2, invalidation: 1985, expiry: 'demo' },
          candles: { M5: trendSeries(60, 'bullish') },
          price: 2000,
          settings: settings({ minRR: 2 }),
          forecast: { implemented: false },
          recentSignalKeys: [],
          dataQuality: { ok: true, label: '60 valid candles', note: 'validated' }
        });
        assert(result.status !== 'PASS', 'A placeholder forecast must not allow PASS, got ' + result.status);
        var forecastRow = result.rows.filter(function (r) { return r.id === 'forecast_uncertainty'; })[0];
        assert(forecastRow && forecastRow.state === 'wait', 'The forecast rule must read WAITING.');
        return { detail: 'Risk validator status is ' + result.status + ' with the forecast rule WAITING.' };
      }
    }
  ];

  /* ---------------- runner ---------------- */

  function getFrameWindow() {
    try {
      var frame = document.getElementById('kp56-frame');
      if (!frame || !frame.contentWindow) { return null; }
      var w = frame.contentWindow;
      if (!w.document || !w.document.getElementById('settingsModal')) { return null; }
      return w;
    } catch (err) {
      return null;
    }
  }

  function run() {
    var dom = getFrameWindow();
    var results = TESTS.map(function (test) {
      var started = Date.now();
      try {
        var outcome = test.run(dom) || {};
        if (outcome.skipped) {
          return { id: test.id, name: test.name, status: 'skipped', detail: outcome.skipped, ms: Date.now() - started };
        }
        return { id: test.id, name: test.name, status: 'pass', detail: outcome.detail || 'ok', ms: Date.now() - started };
      } catch (err) {
        return { id: test.id, name: test.name, status: 'fail', detail: err.message, ms: Date.now() - started };
      }
    });
    return results;
  }

  function render(hostId) {
    var host = document.getElementById(hostId || 'results');
    var results = run();
    if (!host) { return results; }
    var counts = { pass: 0, fail: 0, skipped: 0 };
    results.forEach(function (r) { counts[r.status]++; });

    host.innerHTML =
      '<p class="test-summary"><strong>' + counts.pass + ' passed</strong> · ' +
      counts.fail + ' failed · ' + counts.skipped + ' skipped</p>' +
      results.map(function (r) {
        return '<div class="row">' +
          '<span class="row-label">' + r.id + '. ' + r.name + '</span>' +
          '<span class="row-state st-' + (r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : 'wait') + '">' +
          r.status.toUpperCase() + '</span>' +
          '<span class="row-note">' + String(r.detail).replace(/</g, '&lt;') + '</span>' +
          '</div>';
      }).join('');
    return results;
  }

  global.KP56Tests = { run: run, render: render, TESTS: TESTS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KP56Tests; }

})(typeof window !== 'undefined' ? window : this);
