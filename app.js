/* =====================================================================
   KP56 Gold Analysis — app.js   (Phase 2)
   Orchestrator: validates candle data, runs the four checkers, feeds the
   central signal engine, renders every panel and wires every control.

   HARD RULES ENFORCED HERE
   ------------------------
   * Data is validated before analysis (candle-validator.js).
   * The data source is DEMO, so the final signal can never be BUY or SELL.
   * Nothing is sent anywhere, and no order is ever placed.
   * Settings are only persisted after a successful Save.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Provider = window.KP56DataProvider;
  var Ind = window.KP56Indicators;
  var Validator = window.KP56CandleValidator;
  var RF = window.RiskForecast;
  var Settings = window.KP56Settings;

  var state = {
    timeframe: 'M15',
    settings: null,
    data: { M5: null, M15: null, H1: null },   // { candles, validation, hasVolume }
    price: null,
    checks: [],
    plan: null,
    forecast: null,
    recentSignalKeys: [],
    broker: { contractSize: null, tickValue: null, tickSize: null },
    mainChart: null,
    forecastChart: null,
    scenario: 'base',
    lastFocused: null
  };

  /* ---------------- small helpers ---------------- */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function price(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) : '—'; }
  function clockTime(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—'
      : ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }
  function setText(id, text) { var el = $(id); if (el) { el.textContent = text; } }
  function setValueClass(id, tone) { var el = $(id); if (el) { el.className = 'value ' + (tone || ''); } }
  function readNumber(id) { var el = $(id); return el ? String(el.value).trim() : ''; }

  var toastTimer = null;
  function showToast(message, ok) {
    var el = $('toast');
    if (!el) { return; }
    el.textContent = message;
    el.className = 'toast' + (ok ? ' toast-ok' : ' toast-err');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { el.className = 'toast'; el.textContent = ''; }, 5000);
  }

  /* ---------------- data loading (with validation) ---------------- */

  /** Stores one dataset after validating it (nothing is analysed unvalidated). */
  function store(tf, raw) {
    var validation = Validator.validate(raw.candles || [], tf, {
      now: Date.now(),
      useCompletedOnly: true,
      minCandles: 20,
      maxCandles: Validator.MAX_CANDLES
    });
    state.data[tf] = {
      timeframe: tf,
      candles: validation.candles,
      validation: validation,
      hasVolume: !!raw.hasVolume
    };
  }

  function loadAllData() {
    var tfs = ['M5', 'M15', 'H1'];

    // MT5 mode reads the broker feed asynchronously. If the backend is not
    // reachable the arrays stay EMPTY — demo candles are never substituted.
    if (Provider.getMode() === 'mt5') {
      tfs.forEach(function (tf) {
        Provider.fetchCandles('XAUUSD', tf, tf === 'M5' ? 120 : 90).then(function (payload) {
          store(tf, payload);
          state.price = Provider.getLatestPrice('XAUUSD');
          state.forecast = RF.buildForecast(state.data[state.timeframe].candles, 50);
          renderAll();
          if (state.checks.length) { runValidation(); }
        });
      });
      state.price = Provider.getLatestPrice('XAUUSD');
      return;
    }

    tfs.forEach(function (tf) {
      store(tf, Provider.getCandles('XAUUSD', tf, tf === 'M5' ? 120 : 90));
    });
    state.price = Provider.getLatestPrice('XAUUSD');
    state.forecast = RF.buildForecast(state.data[state.timeframe].candles, 50);
  }

  function renderStatus() {
    var status = Provider.getDataStatus();
    var chip = $('dataStatusChip');
    if (chip) {
      chip.textContent = status.mode;
      chip.title = status.providerName + ' — ' + status.reason;
    }
    setText('telegramStatusChip', 'TG · ' + status.telegram);
    var iso = Provider.getLastUpdateTime();
    var t = $('lastUpdate');
    if (t) { t.textContent = clockTime(iso); t.setAttribute('datetime', iso); }
    setText('certDataChip', 'DATA: ' + status.mode + ' / ' +
      (status.live ? 'VERIFIED BROKER FEED' : status.mode === 'SNAPSHOT ANALYSIS' ? 'SCREENSHOT EVIDENCE' : 'SYNTHETIC'));
    setText('setSource', status.mode + ' — ' + status.providerName + '. ' + status.reason +
      ' No API key is used anywhere in this project.');
  }

  /* ---------------- overview ledger ---------------- */

  function renderOverview() {
    var tf = state.timeframe;
    var entry = state.data[tf];
    var candles = entry ? entry.candles : [];
    var closes = Ind.closesOf(candles);

    setText('ovPrice', price(state.price ? state.price.price : null));
    setValueClass('ovPrice', state.price && state.price.synthetic === false && state.price.price !== null ? 'val-bull' : 'val-gold');
    setText('ovPriceNote', state.price
      ? state.price.label +
        (state.price.synthetic ? ' · anchor ' + price(Provider.getMeta().syntheticAnchor) : '') +
        (state.price.bid ? ' · bid ' + price(state.price.bid) + ' / ask ' + price(state.price.ask) : '')
      : 'No price available from the current source.');

    var structure = candles.length > 20 ? Ind.marketStructure(candles) : { trend: 'UNKNOWN', detail: 'Not enough data.' };
    var dirText = structure.trend === 'UP' ? 'BULLISH' : structure.trend === 'DOWN' ? 'BEARISH' :
      structure.trend === 'RANGE' ? 'RANGE-BOUND' : 'UNKNOWN';
    setText('ovDirection', dirText);
    setValueClass('ovDirection', structure.trend === 'UP' ? 'val-bull' : structure.trend === 'DOWN' ? 'val-bear' : 'val-wait');
    setText('ovDirectionNote', tf + ' structure · ' + structure.detail);

    [['ovH1', 'ovH1Note', 'H1'], ['ovM15', 'ovM15Note', 'M15']].forEach(function (spec) {
      var d = state.data[spec[2]];
      var cs = d ? Ind.closesOf(d.candles) : [];
      if (cs.length < 50) {
        setText(spec[0], 'NO DATA');
        setValueClass(spec[0], 'val-wait');
        setText(spec[1], 'Waiting for ' + spec[2] + ' candles');
        return;
      }
      var bias = window.TrendChecker.timeframeBias(d.candles);
      setText(spec[0], bias.bias === 'bullish' ? 'BULLISH' : bias.bias === 'bearish' ? 'BEARISH' : 'NEUTRAL');
      setValueClass(spec[0], bias.bias === 'bullish' ? 'val-bull' : bias.bias === 'bearish' ? 'val-bear' : 'val-wait');
      setText(spec[1], 'EMA20 ' + price(bias.ema20) + ' · EMA50 ' + price(bias.ema50) + ' · close ' + price(bias.close));
    });

    var m5 = state.data.M5 ? state.data.M5.candles : [];
    var rsiVal = Ind.closesOf(m5).length > 14 ? I_rsi(m5) : null;
    var adxVal = Ind.adx(m5, 14);
    var ready = rsiVal !== null && adxVal.available &&
      rsiVal >= state.settings.rsiMin && rsiVal <= state.settings.rsiMax && adxVal.adx >= state.settings.adxMin;
    setText('ovM5', ready ? 'CONDITIONS MET' : (rsiVal === null || !adxVal.available) ? 'WAITING' : 'NOT READY');
    setValueClass('ovM5', ready ? 'val-bull' : (rsiVal === null || !adxVal.available) ? 'val-wait' : 'val-bear');
    setText('ovM5Note', 'RSI ' + (rsiVal === null ? 'n/a' : rsiVal) + ' · ADX ' + (adxVal.available ? adxVal.adx : 'n/a') +
      ' · limits ' + state.settings.rsiMin + '-' + state.settings.rsiMax + ' / ' + state.settings.adxMin);

    var vol = Ind.volatility(m5, 14, m5.length > 60 ? m5.slice(-60) : m5);
    var ratio = vol.available ? vol.ratio : null;
    var volText = !vol.available ? 'UNKNOWN' : ratio === null ? 'NORMAL' :
      ratio > state.settings.volMaxRatio ? 'EXPANDED' : ratio < 0.65 ? 'COMPRESSED' : 'NORMAL';
    setText('ovVol', volText);
    setValueClass('ovVol', !vol.available ? 'val-wait' : volText === 'EXPANDED' ? 'val-bear' : 'val-gold');
    setText('ovVolNote', vol.available
      ? 'ATR(14) ' + vol.atr + ' · ratio ' + (ratio === null ? 'n/a' : ratio) + ' · max ' + state.settings.volMaxRatio
      : vol.reason);

    var hints = {
      M5: 'M5 selected — trigger timeframe for entries.',
      M15: 'M15 selected — swing structure and setup quality.',
      H1: 'H1 selected — higher-timeframe trend context.'
    };
    setText('tfHint', hints[tf] || '');

    // Data-quality line under the ledger
    var q = entry ? entry.validation : null;
    setText('dataQuality', q
      ? Validator.describe(q) + ' (completed candles only; missing candles are never invented.)'
      : 'No data.');
  }

  function I_rsi(m5) { return Ind.rsi(Ind.closesOf(m5), 14); }

  /* ---------------- charts ---------------- */

  function levelSet() {
    var levels = [];
    var entry = state.data[state.timeframe];
    if (!entry) { return levels; }
    if ($('tglLevels') && $('tglLevels').checked) {
      var sr = Ind.supportResistance(entry.candles, 2);
      sr.resistance.forEach(function (p, i) { levels.push({ label: 'R' + (i + 1), value: p, kind: 'sr' }); });
      sr.support.forEach(function (p, i) { levels.push({ label: 'S' + (i + 1), value: p, kind: 'sr' }); });
    }
    if (state.plan && $('tglPlan') && $('tglPlan').checked) {
      levels.push({ label: 'Entry', value: state.plan.entry, kind: 'entry' });
      levels.push({ label: 'SL', value: state.plan.sl, kind: 'sl' });
      levels.push({ label: 'TP1', value: state.plan.tp1, kind: 'tp' });
      levels.push({ label: 'TP2', value: state.plan.tp2, kind: 'tp' });
    }
    return levels;
  }

  function renderMainChart() {
    if (!state.mainChart) { return; }
    var entry = state.data[state.timeframe];
    if (!entry) { return; }
    var forecast = ($('tglForecast') && $('tglForecast').checked && state.forecast) ? state.forecast.paths.side : [];
    state.mainChart.options.showVolume = !!($('tglVolume') && $('tglVolume').checked && entry.hasVolume);
    state.mainChart.render({
      candles: entry.candles,
      forecast: forecast,
      levels: levelSet(),
      hasVolume: entry.hasVolume,
      mode: 'DEMO'
    });
  }

  function renderForecastChart() {
    if (!state.forecastChart || !state.forecast) { return; }
    var key = state.scenario === 'bull' ? 'bull' : state.scenario === 'bear' ? 'bear' : 'side';
    var entry = state.data[state.timeframe];
    state.forecastChart.options.showVolume = false;
    state.forecastChart.render({
      candles: entry ? entry.candles.slice(-25) : [],
      forecast: state.forecast.paths[key],
      levels: [],
      hasVolume: false,
      mode: 'DEMO'
    });
  }

  function renderForecastPanel() {
    state.forecast = RF.buildForecast(state.data[state.timeframe].candles, 50);
    setText('forecastTf', state.timeframe);
    setText('forecastStatus', state.forecast ? state.forecast.status : 'FORECAST NOT AVAILABLE');
    if (!state.forecast) {
      setText('scBull', '—'); setText('scBear', '—'); setText('scSide', '—');
      setText('scUncertainty', 'NOT AVAILABLE');
      return;
    }
    var s = state.forecast.scenarios;
    setText('scBull', s.bull.label + ' · end ' + price(s.bull.end));
    setText('scBear', s.bear.label + ' · end ' + price(s.bear.end));
    setText('scSide', s.side.label + ' · end ' + price(s.side.end));
    setText('scUncertainty', 'NOT AVAILABLE — ' + state.forecast.uncertainty.note);
    setText('forecastMissing', 'Still missing: ' + state.forecast.missing.join(' · '));
    renderForecastChart();
  }

  /* ---------------- validation cards ---------------- */

  var STATE_TEXT = { pass: 'PASS', fail: 'FAIL', wait: 'WAIT', neutral: 'INFO' };

  function renderCheck(prefix, result) {
    var badge = $(prefix + 'Status');
    if (badge) {
      badge.textContent = result.status;
      badge.className = 'badge ' + (result.status === 'PASS' ? 'badge-pass' : result.status === 'FAIL' ? 'badge-fail' : 'badge-wait');
    }
    setText(prefix + 'Summary', result.summary + (result.direction ? '  ·  Direction: ' + result.direction.toUpperCase() : ''));

    var rowsHost = $(prefix + 'Rows');
    if (rowsHost) {
      rowsHost.innerHTML = result.rows.map(function (r) {
        return '<div class="row">' +
          '<span class="row-label">' + esc(r.label) + '</span>' +
          '<span class="row-value">' + esc(r.value) + '</span>' +
          '<span class="row-state st-' + esc(r.state) + '">' + (STATE_TEXT[r.state] || 'INFO') + '</span>' +
          (r.note ? '<span class="row-note">' + esc(r.note) + '</span>' : '') +
          '</div>';
      }).join('');
    }

    var missingHost = $(prefix + 'Missing');
    if (missingHost) {
      var items = (result.missing || []).concat(
        (result.status !== 'PASS' && result.reasons && result.reasons.length)
          ? result.reasons.map(function (r) { return 'Reason: ' + r; }) : []
      );
      missingHost.innerHTML = items.length
        ? '<strong>Missing requirements / reasons</strong><ul>' + items.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
        : '<strong>Missing requirements</strong> None reported by this test.';
    }
  }

  function agreedDirection(trend, smc) {
    if (trend && (trend.direction === 'bullish' || trend.direction === 'bearish')) { return trend.direction; }
    if (smc && (smc.direction === 'bullish' || smc.direction === 'bearish')) { return smc.direction; }
    return 'bullish';   // demo plan direction when no evidence exists (clearly labelled DEMO)
  }

  function runValidation() {
    var ctx = {
      candles: {
        M5: state.data.M5 ? state.data.M5.candles : [],
        M15: state.data.M15 ? state.data.M15.candles : [],
        H1: state.data.H1 ? state.data.H1.candles : []
      },
      price: state.price ? state.price.price : null,
      // Only a REAL spread from the broker feed is ever passed. The configured
      // maximum is a limit, not a measurement, so it is never used as one.
      spread: (Provider.getDataStatus().spread !== undefined && Provider.getDataStatus().spread !== null)
        ? Provider.getDataStatus().spread : null,
      source: 'candle data',
      dataQuality: {
        ok: !!(state.data[state.timeframe] && state.data[state.timeframe].validation.ok),
        label: state.data[state.timeframe] ? Validator.describe(state.data[state.timeframe].validation) : 'NO DATA',
        note: 'Candles were validated before analysis: invalid records dropped, unfinished candles excluded, missing candles never invented.'
      },
      settings: state.settings,
      dataStatus: Provider.getDataStatus(),
      dataAgeSeconds: Math.round((Date.now() - new Date(Provider.getLastUpdateTime()).getTime()) / 1000),
      candleClosed: true,                 // only completed candles are analysed
      recentSignalKeys: state.recentSignalKeys,
      forecast: state.forecast
    };

    // Tests 1 and 2 first, so the demo plan matches the detected direction.
    var trend = window.TrendChecker.evaluate(ctx);
    var smc = window.SmcChecker.evaluate(ctx);
    var dir = agreedDirection(trend, smc);
    state.plan = RF.buildDemoPlan(ctx.candles.M15.length ? ctx.candles.M15 : ctx.candles.M5,
      dir === 'bearish' ? 'SELL' : 'BUY', null);
    ctx.plan = state.plan;
    ctx.direction = state.plan ? state.plan.direction : null;

    var entry = window.EntryChecker.evaluate(ctx);
    var risk = RF.evaluate(ctx);
    state.checks = [trend, smc, entry, risk];

    renderCheck('trend', trend);
    renderCheck('smc', smc);
    renderCheck('entry', entry);
    renderCheck('risk', risk);

    var decision = window.SignalEngine.evaluate({
      tests: state.checks,
      dataStatus: Provider.getDataStatus(),
      plan: state.plan,
      settings: state.settings,
      forecast: state.forecast,
      recentSignalKeys: state.recentSignalKeys
    });
    renderSignal(decision);

    // Duplicate-signal protection: remember the setup key for later runs.
    if (state.plan) {
      state.recentSignalKeys.push(state.plan.direction + '@' + state.plan.entry + '@' + state.plan.sl);
      if (state.recentSignalKeys.length > 5) { state.recentSignalKeys.shift(); }
    }

    setText('runNote', 'Last run at ' + clockTime(Provider.getLastUpdateTime()) +
      ' on validated synthetic candles (' + Validator.describe(state.data[state.timeframe].validation) +
      '). Demonstration results only — the production analysis engine and live data are not connected.');
    renderMainChart();
    if (window.KP56Phase3) { window.KP56Phase3.refresh(); }
  }

  /* ---------------- final signal certificate ---------------- */

  function renderSignal(decision) {
    var stateEl = $('signalState');
    if (stateEl) {
      stateEl.textContent = decision.state;
      stateEl.setAttribute('data-state', decision.stateKey);
    }
    setText('signalSub', decision.stateKey === 'waiting'
      ? 'Required data or validation is missing, so no decision can be made.'
      : decision.stateKey === 'buy' || decision.stateKey === 'sell'
        ? 'A directional decision was produced by the engine.'
        : 'A signal is blocked. Read the reasons below.');

    var stampEl = $('signalStamp');
    if (stampEl) {
      stampEl.hidden = false;
      if (decision.stateKey === 'blocked') {
        stampEl.textContent = 'BLOCKED';
        stampEl.style.borderColor = 'var(--bear)';
        stampEl.style.color = 'var(--bear)';
        stampEl.classList.remove('stamp-in');
        void stampEl.offsetWidth;
        stampEl.classList.add('stamp-in');
      } else if (decision.stateKey === 'waiting') {
        stampEl.textContent = 'PENDING';
        stampEl.style.borderColor = 'var(--wait)';
        stampEl.style.color = 'var(--wait)';
      } else {
        stampEl.textContent = decision.state === 'BUY' ? 'BUY' : 'SELL';
        stampEl.style.borderColor = 'var(--bull)';
        stampEl.style.color = 'var(--bull)';
      }
    }

    var plan = decision.plan;
    if (plan && decision.stateKey !== 'waiting') {
      setText('sigEntry', price(plan.entry));
      setText('sigSl', price(plan.sl));
      setText('sigTp1', price(plan.tp1));
      setText('sigTp2', price(plan.tp2));
      setText('sigRr', '1 : ' + price(plan.rr));
      setText('sigFieldStatus', decision.planLabel);
      setText('sigExpiry', 'Placeholder — expiry rules are defined in a later phase');
      setText('sigInvalid', plan.invalidation ? price(plan.invalidation) + ' (demo example)' : 'Not defined');
    } else {
      setText('sigEntry', '—'); setText('sigSl', '—');
      setText('sigTp1', '—'); setText('sigTp2', '—'); setText('sigRr', '—');
      setText('sigFieldStatus', 'NOT SET');
      setText('sigExpiry', 'Not defined in this phase');
      setText('sigInvalid', 'Not defined in this phase');
    }

    var reasons = $('signalReasons');
    if (reasons) {
      var items = (decision.reasons || []).slice();
      if (decision.blockReasons && decision.blockReasons.length) {
        items = items.concat(decision.blockReasons.map(function (b) { return 'Blocking condition: ' + b; }));
      }
      items.push('No probability of success is reported, because none has been measured.');
      reasons.innerHTML = items.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    }
  }

  /* ---------------- risk calculator (direction aware) ---------------- */

  function markInvalid(id, invalid) {
    var el = $(id);
    if (el) { el.setAttribute('aria-invalid', invalid ? 'true' : 'false'); }
  }

  function runRiskCalculator(event) {
    if (event) { event.preventDefault(); }
    var errEl = $('rcError');
    var dirEl = $('rcDirection');
    var direction = dirEl && dirEl.value === 'SELL' ? 'SELL' : 'BUY';
    var result = RF.calculateRisk({
      balance: readNumber('rcBalance'),
      riskPct: readNumber('rcRisk'),
      entry: readNumber('rcEntry'),
      sl: readNumber('rcSl'),
      target: readNumber('rcTarget')
    }, state.broker, direction);

    var inputIds = ['rcBalance', 'rcRisk', 'rcEntry', 'rcSl', 'rcTarget'];
    if (!result.ok) {
      inputIds.forEach(function (id) { markInvalid(id, true); });
      if (errEl) {
        errEl.className = 'form-error';
        errEl.textContent = 'Please fix the following: ' + result.errors.join(' ');
      }
      setText('rcRiskAmount', '—'); setText('rcStopDist', '—');
      setText('rcTargetDist', '—'); setText('rcRr', '—'); setText('rcLot', '—');
      return;
    }

    inputIds.forEach(function (id) { markInvalid(id, false); });
    if (errEl) {
      errEl.className = 'form-error is-ok';
      errEl.textContent = 'Calculation complete (' + direction + '). Values are ESTIMATES — this website never places an order.';
    }
    setText('rcRiskAmount', '$' + result.riskAmount.toFixed(2));
    setText('rcStopDist', price(result.stopDistance) + ' price units');
    setText('rcTargetDist', result.targetDistance === null ? 'Not supplied' : price(result.targetDistance) + ' price units');
    setText('rcRr', result.rr === null ? 'Needs a target price' : '1 : ' + result.rr.toFixed(2));
    setText('rcLot', result.lotSize === null ? 'WITHHELD' : result.lotSize.toFixed(2) + ' lots');
    setText('rcLotNote', result.lotNote);
  }

  function clearRiskCalculator() {
    ['rcEntry', 'rcSl', 'rcTarget'].forEach(function (id) { var el = $(id); if (el) { el.value = ''; markInvalid(id, false); } });
    setText('rcRiskAmount', '—'); setText('rcStopDist', '—');
    setText('rcTargetDist', '—'); setText('rcRr', '—'); setText('rcLot', '—');
    var errEl = $('rcError');
    if (errEl) { errEl.textContent = ''; errEl.className = 'form-error'; }
  }

  function applyBrokerSpecs() {
    var cs = Number(readNumber('bsContract'));
    var tv = Number(readNumber('bsTickValue'));
    var ts = Number(readNumber('bsTickSize'));
    var errEl = $('rcError');
    if (!(cs > 0) || !(tv > 0) || !(ts > 0)) {
      state.broker = { contractSize: null, tickValue: null, tickSize: null };
      setText('bsStatus', 'Broker specifications: not configured. All three values must be greater than zero.');
      if (errEl) { errEl.textContent = 'Broker specifications must all be numbers greater than zero.'; errEl.className = 'form-error'; }
      return;
    }
    state.broker = { contractSize: cs, tickValue: tv, tickSize: ts };
    setText('bsStatus', 'Broker specifications applied for this session: contract size ' + cs +
      ', tick value ' + tv + ', tick size ' + ts + '. Lot sizes remain ESTIMATES and are not stored anywhere.');
    if (errEl) { errEl.textContent = ''; }
  }

  /* ---------------- telegram panel ---------------- */

  function renderTelegram() {
    var s = state.settings;
    if (!s) { return; }
    if ($('tgEnabled')) { $('tgEnabled').checked = !!s.notify; }
    if ($('tgBuy')) { $('tgBuy').checked = !!s.notifyBuy; }
    if ($('tgSell')) { $('tgSell').checked = !!s.notifySell; }
    if ($('tgErr')) { $('tgErr').checked = !!s.notifyError; }
    if ($('tgCooldown')) { $('tgCooldown').value = s.cooldown; }
    setText('tgStatus', 'NOT CONNECTED');
  }

  function telegramTest() {
    var msg = $('tgMessage');
    if (msg) {
      msg.className = 'form-error';
      msg.textContent = 'Backend not configured (a later phase). No message was sent, and no bot token is used or stored in this page.';
    }
  }

  function telegramSave() {
    var cooldown = Number(readNumber('tgCooldown'));
    if (!isFinite(cooldown) || cooldown < 0 || cooldown > 1440) {
      setText('tgMessage', 'Cooldown must be between 0 and 1440 minutes.');
      return;
    }
    var candidate = Object.assign({}, state.settings, {
      notify: !!($('tgEnabled') && $('tgEnabled').checked),
      notifyBuy: !!($('tgBuy') && $('tgBuy').checked),
      notifySell: !!($('tgSell') && $('tgSell').checked),
      notifyError: !!($('tgErr') && $('tgErr').checked),
      cooldown: cooldown
    });
    var saved = Settings.save(candidate);
    if (!saved.ok) {
      setText('tgMessage', 'Not saved: ' + saved.errors.join(' '));
      return;
    }
    state.settings = saved.value;
    var msg = $('tgMessage');
    if (msg) {
      msg.className = 'form-error is-ok';
      msg.textContent = saved.persisted
        ? 'Notification preferences saved in this browser only. They are not transmitted anywhere.'
        : 'Preferences kept for this session only — browser storage is unavailable.';
    }
  }

  /* ---------------- signal history ---------------- */

  var DEMO_RECORDS = [
    { ts: '2026-02-11 09:35', dir: 'BUY',  entry: 2374.20, sl: 2368.10, tp1: 2386.40, tp2: 2396.10, val: 'DEMO 3/4', out: 'EXPIRED' },
    { ts: '2026-02-11 13:05', dir: 'SELL', entry: 2388.60, sl: 2394.30, tp1: 2377.20, tp2: 2368.90, val: 'DEMO 2/4', out: 'CANCELLED' },
    { ts: '2026-02-12 08:20', dir: 'BUY',  entry: 2369.80, sl: 2363.40, tp1: 2382.60, tp2: 2391.20, val: 'DEMO 4/4', out: 'TP1 HIT (sim)' },
    { ts: '2026-02-12 15:45', dir: 'SELL', entry: 2391.10, sl: 2397.80, tp1: 2379.00, tp2: 2370.40, val: 'DEMO 1/4', out: 'BLOCKED' },
    { ts: '2026-02-13 10:10', dir: 'BUY',  entry: 2376.50, sl: 2370.20, tp1: 2388.90, tp2: 2397.30, val: 'DEMO 3/4', out: 'SL HIT (sim)' }
  ];

  function renderHistory(records) {
    var body = $('historyBody');
    var empty = $('historyEmpty');
    if (!body) { return; }
    if (!records.length) {
      body.innerHTML = '';
      if (empty) { empty.hidden = false; }
      return;
    }
    if (empty) { empty.hidden = true; }
    body.innerHTML = records.map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.ts) + '</td>' +
        '<td class="' + (r.dir === 'BUY' ? 'dir-buy' : 'dir-sell') + '">' + esc(r.dir) + '</td>' +
        '<td>' + price(r.entry) + '</td><td>' + price(r.sl) + '</td>' +
        '<td>' + price(r.tp1) + '</td><td>' + price(r.tp2) + '</td>' +
        '<td>' + esc(r.val) + '</td><td>' + esc(r.out) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------------- settings modal (Task 2) ---------------- */

  function fillSettingsForm(s) {
    if (!s) { return; }
    if ($('setTimeframe')) { $('setTimeframe').value = s.timeframe; }
    if ($('setRr')) { $('setRr').value = s.minRR; }
    if ($('setRisk')) { $('setRisk').value = s.riskPct; }
    if ($('setSpread')) { $('setSpread').value = s.maxSpread; }
    if ($('setRsiMin')) { $('setRsiMin').value = s.rsiMin; }
    if ($('setRsiMax')) { $('setRsiMax').value = s.rsiMax; }
    if ($('setAdxMin')) { $('setAdxMin').value = s.adxMin; }
    if ($('setVolMax')) { $('setVolMax').value = s.volMaxRatio; }
    if ($('setMaxAge')) { $('setMaxAge').value = s.maxDataAgeSeconds; }
    if ($('setNotify')) { $('setNotify').checked = !!s.notify; }
    if ($('setNotifyBuy')) { $('setNotifyBuy').checked = !!s.notifyBuy; }
    if ($('setNotifySell')) { $('setNotifySell').checked = !!s.notifySell; }
    var radio = document.querySelector('input[name="theme"][value="' + s.theme + '"]');
    if (radio) { radio.checked = true; }
  }

  function readSettingsForm() {
    var themeEl = document.querySelector('input[name="theme"]:checked');
    return {
      timeframe: $('setTimeframe') ? $('setTimeframe').value : 'M15',
      minRR: readNumber('setRr'),
      riskPct: readNumber('setRisk'),
      maxSpread: readNumber('setSpread'),
      theme: themeEl ? themeEl.value : 'dark',
      notify: !!($('setNotify') && $('setNotify').checked),
      notifyBuy: !!($('setNotifyBuy') && $('setNotifyBuy').checked),
      notifySell: !!($('setNotifySell') && $('setNotifySell').checked),
      notifyError: true,
      cooldown: state.settings ? state.settings.cooldown : 15,
      rsiMin: readNumber('setRsiMin'),
      rsiMax: readNumber('setRsiMax'),
      adxMin: readNumber('setAdxMin'),
      volMaxRatio: readNumber('setVolMax'),
      maxDataAgeSeconds: readNumber('setMaxAge')
    };
  }

  /** Requirement D: always open with the last SUCCESSFULLY saved values. */
  function openSettings() {
    state.lastFocused = document.activeElement;
    state.draft = Settings.load();
    fillSettingsForm(state.draft);
    var msg = $('settingsMessage');
    if (msg) { msg.textContent = ''; msg.className = 'form-error'; }
    var modal = $('settingsModal');
    if (modal) {
      modal.hidden = false;
      document.body.classList.add('modal-open');
      var first = $('setTimeframe');
      if (first) { first.focus(); }
    }
  }

  /** Requirement B: close WITHOUT saving and restore saved values next time. */
  function closeSettings() {
    var modal = $('settingsModal');
    if (modal) { modal.hidden = true; }
    document.body.classList.remove('modal-open');
    Settings.applyTheme(state.settings.theme);   // undo any theme preview
    fillSettingsForm(state.settings);            // discard unsaved edits
    if (state.lastFocused && state.lastFocused.focus) { state.lastFocused.focus(); }
    state.draft = null;
  }

  /** Requirement A: validate, persist, apply, close, confirm — in that order. */
  function saveSettings(event) {
    if (event) { event.preventDefault(); }
    var msg = $('settingsMessage');
    var candidate = readSettingsForm();
    var checked = Settings.validate(candidate);

    if (!checked.ok) {
      if (msg) {
        msg.className = 'form-error';
        msg.textContent = 'Not saved — please fix: ' + checked.errors.join(' ');
      }
      showToast('Settings not saved: ' + checked.errors[0], false);
      return;                                  // modal stays open on failure
    }

    var saved = Settings.save(checked.value);
    if (!saved.ok) {
      if (msg) {
        msg.className = 'form-error';
        msg.textContent = 'Not saved: ' + saved.errors.join(' ');
      }
      return;
    }

    // Apply the saved values to the dashboard.
    state.settings = saved.value;
    Settings.applyTheme(state.settings.theme);
    state.timeframe = state.settings.timeframe;
    syncTimeframeButtons();
    renderAll();
    renderTelegram();
    renderSettingsSummary();
    resetCheckCards();
    state.checks = [];
    renderSignal({
      state: 'WAITING FOR DATA', stateKey: 'waiting',
      reasons: ['Settings changed. Re-run the 4-stage validation to refresh the results.'],
      blockReasons: [], plan: null
    });

    closeSettings();
    showToast(saved.persisted
      ? 'Settings saved in this browser.'
      : 'Settings applied for this session (browser storage unavailable).', true);

    var sectionMsg = $('settingsNotice');
    if (sectionMsg) {
      sectionMsg.className = 'form-error is-ok';
      sectionMsg.textContent = 'Settings saved at ' + clockTime(new Date().toISOString()) +
        (saved.persisted ? ' and persisted in this browser.' : ' for this session only.') +
        ' No secrets are ever stored here.';
    }
  }

  /** Requirement C: load defaults into the form, do NOT persist, do NOT close. */
  function resetSettings() {
    var defaults = Settings.resetToDefaults();
    fillSettingsForm(defaults);
    Settings.applyTheme(defaults.theme);        // live preview only
    var msg = $('settingsMessage');
    if (msg) {
      msg.className = 'form-error';
      msg.textContent = 'Default values are loaded into the form. Press "Save settings" to keep them, or close the dialog to discard.';
    }
    showToast('Defaults loaded — press Save settings to keep them.', false);
    var sectionMsg = $('settingsNotice');
    if (sectionMsg) {
      sectionMsg.className = 'form-error';
      sectionMsg.textContent = 'Defaults are shown in the dialog but have NOT been saved yet.';
    }
  }

  function renderSettingsSummary() {
    var s = state.settings;
    var host = $('settingsSummary');
    if (!host || !s) { return; }
    var items = [
      ['Preferred timeframe', s.timeframe],
      ['Minimum risk / reward', '1 : ' + s.minRR],
      ['Risk per trade', s.riskPct + '%'],
      ['Maximum spread', s.maxSpread + ' points'],
      ['RSI entry window', s.rsiMin + ' – ' + s.rsiMax],
      ['ADX minimum', String(s.adxMin)],
      ['Max volatility ratio', String(s.volMaxRatio)],
      ['Max data age', s.maxDataAgeSeconds + ' s'],
      ['Theme', s.theme],
      ['Notifications', s.notify ? 'enabled' : 'disabled'],
      ['Data source', Provider.getDataStatus().mode]
    ];
    host.innerHTML = items.map(function (it) {
      return '<div class="row"><span class="row-label">' + esc(it[0]) + '</span>' +
        '<span class="row-value">' + esc(it[1]) + '</span></div>';
    }).join('');
  }

  /* ---------------- timeframe + scenario controls ---------------- */

  function syncTimeframeButtons() {
    var buttons = document.querySelectorAll('.js-tf');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var active = btn.getAttribute('data-tf') === state.timeframe;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function setTimeframe(tf) {
    if (['M5', 'M15', 'H1'].indexOf(tf) === -1) { return; }
    state.timeframe = tf;
    syncTimeframeButtons();
    renderOverview();
    renderForecastPanel();
    renderMainChart();
    state.checks = [];
    resetCheckCards();
    renderSignal({
      state: 'WAITING FOR DATA', stateKey: 'waiting',
      reasons: ['Timeframe changed to ' + tf + '. Re-run the 4-stage validation to refresh the results.'],
      blockReasons: [], plan: null
    });
  }

  function resetCheckCards() {
    [['trend', 'Test 1'], ['smc', 'Test 2'], ['entry', 'Test 3'], ['risk', 'Test 4']].forEach(function (spec) {
      var badge = $(spec[0] + 'Status');
      if (badge) { badge.textContent = 'WAITING'; badge.className = 'badge badge-wait'; }
      setText(spec[0] + 'Summary', 'Results were cleared because the inputs changed. Run the validation again.');
      var rowsHost = $(spec[0] + 'Rows');
      if (rowsHost) { rowsHost.innerHTML = '<p class="empty-row">Awaiting validation run.</p>'; }
      var missingHost = $(spec[0] + 'Missing');
      if (missingHost) { missingHost.innerHTML = ''; }
    });
  }

  function setScenario(key) {
    state.scenario = key;
    var buttons = document.querySelectorAll('.js-scenario');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-active', buttons[i].getAttribute('data-sc') === key);
    }
    renderForecastChart();
  }

  /* ---------------- refresh ---------------- */

  function refresh() {
    loadAllData();
    renderStatus();
    renderOverview();
    renderForecastPanel();
    renderMainChart();
    if (state.checks.length) { runValidation(); }
    var note = $('topbarNote');
    if (note) {
      note.textContent = 'Demo data regenerated at ' + clockTime(Provider.getLastUpdateTime()) +
        ' from the deterministic mock provider and validated before analysis. Live data is NOT configured.';
    }
  }

  /* ---------------- tab highlight ---------------- */

  function setupTabHighlight() {
    if (!('IntersectionObserver' in window)) { return; }
    var links = document.querySelectorAll('.tabbar a');
    var map = {};
    for (var i = 0; i < links.length; i++) { map[links[i].getAttribute('href').slice(1)] = links[i]; }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = map[entry.target.id];
        if (link && entry.isIntersecting) {
          Object.keys(map).forEach(function (k) { map[k].classList.remove('is-current'); });
          link.classList.add('is-current');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) { var el = $(id); if (el) { observer.observe(el); } });
  }

  /* ---------------- render everything ---------------- */

  function renderAll() {
    renderStatus();
    renderOverview();
    renderForecastPanel();
    renderMainChart();
    renderSettingsSummary();
    if (window.KP56Phase3) { window.KP56Phase3.refresh(); }
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    var tfButtons = document.querySelectorAll('.js-tf');
    for (var i = 0; i < tfButtons.length; i++) {
      tfButtons[i].addEventListener('click', function (e) { setTimeframe(e.currentTarget.getAttribute('data-tf')); });
    }

    ['tglVolume', 'tglLevels', 'tglForecast', 'tglPlan'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('change', renderMainChart); }
    });

    var scButtons = document.querySelectorAll('.js-scenario');
    for (var j = 0; j < scButtons.length; j++) {
      scButtons[j].addEventListener('click', function (e) { setScenario(e.currentTarget.getAttribute('data-sc')); });
    }

    if ($('refreshBtn')) { $('refreshBtn').addEventListener('click', refresh); }
    if ($('runValidationBtn')) { $('runValidationBtn').addEventListener('click', runValidation); }
    if ($('ackBtn')) {
      $('ackBtn').addEventListener('click', function () {
        setText('ackNote', 'Acknowledged at ' + clockTime(new Date().toISOString()) +
          '. This button never executes a trade and stores nothing.');
      });
    }

    if ($('riskForm')) { $('riskForm').addEventListener('submit', runRiskCalculator); }
    if ($('rcClearBtn')) { $('rcClearBtn').addEventListener('click', clearRiskCalculator); }
    if ($('bsApplyBtn')) { $('bsApplyBtn').addEventListener('click', applyBrokerSpecs); }

    if ($('tgTestBtn')) { $('tgTestBtn').addEventListener('click', telegramTest); }
    if ($('tgSaveBtn')) { $('tgSaveBtn').addEventListener('click', telegramSave); }

    if ($('historySeedBtn')) { $('historySeedBtn').addEventListener('click', function () { renderHistory(DEMO_RECORDS); }); }
    if ($('historyClearBtn')) { $('historyClearBtn').addEventListener('click', function () { renderHistory([]); }); }

    // Settings modal wiring (one listener per control, bound once)
    ['settingsBtn', 'settingsOpenBtn'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('click', function (e) { e.preventDefault(); openSettings(); });
      }
    });
    if ($('settingsCloseBtn')) { $('settingsCloseBtn').addEventListener('click', closeSettings); }
    if ($('settingsCancelBtn')) { $('settingsCancelBtn').addEventListener('click', closeSettings); }
    if ($('settingsBackdrop')) { $('settingsBackdrop').addEventListener('click', closeSettings); }
    if ($('settingsForm')) { $('settingsForm').addEventListener('submit', saveSettings); }
    if ($('settingsResetBtn')) { $('settingsResetBtn').addEventListener('click', resetSettings); }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('settingsModal') && !$('settingsModal').hidden) { closeSettings(); }
    });

    // Theme radios: live preview only, applied for real on Save.
    var radios = document.querySelectorAll('input[name="theme"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener('change', function (e) {
        Settings.applyTheme(e.currentTarget.value);
        renderMainChart();
        renderForecastChart();
      });
    }
  }

  /* ---------------- init ---------------- */

  function init() {
    try {
      state.settings = Settings.load();            // last successfully saved values
      Settings.applyTheme(state.settings.theme);
      state.timeframe = state.settings.timeframe;

      loadAllData();

      try {
        state.mainChart = new window.KP56Chart($('mainChart'));
        state.forecastChart = new window.KP56Chart($('forecastChart'));
      } catch (chartError) {
        var fb = $('chartFallback');
        if (fb) { fb.hidden = false; }
      }

      // Phase 3: expose a small bridge so the integration module can read the
      // same validated candles and settings without duplicating state.
      window.KP56Bridge = {
        getCandles: function (tf) { return state.data[tf] ? state.data[tf].candles : []; },
        getSettings: function () { return state.settings; },
        reload: function () {
          loadAllData();
          renderAll();
          if (state.checks.length) { runValidation(); }
        }
      };

      bindEvents();
      syncTimeframeButtons();
      fillSettingsForm(state.settings);
      renderTelegram();
      renderAll();
      renderHistory([]);
      setupTabHighlight();
      if (window.KP56Phase3) { window.KP56Phase3.init(); }

      renderSignal({
        state: 'WAITING FOR DATA',
        stateKey: 'waiting',
        reasons: [
          'No validation run has been performed yet.',
          'Data source is DEMO — synthetic candles cannot produce a tradable signal.',
          'Telegram notifications are not connected, so no alert could be delivered.'
        ],
        blockReasons: [], plan: null
      });

      setText('bsStatus', 'Broker specifications: not configured.');
      if (!Settings.storageAvailable()) {
        var notice = $('settingsNotice');
        if (notice) {
          notice.className = 'form-error';
          notice.textContent = 'Browser storage is unavailable (private mode?). Settings will only last for this session.';
        }
      }
    } catch (error) {
      var note = $('topbarNote');
      if (note) {
        note.textContent = 'A JavaScript error occurred while starting the dashboard: ' + error.message +
          ' The written content is still readable.';
      }
      if (window.console && console.error) { console.error('KP56 init error:', error); }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
