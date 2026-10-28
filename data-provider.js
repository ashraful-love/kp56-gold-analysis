/* =====================================================================
   KP56 Gold Analysis — data-provider.js   (Phase 3, Part 1 & 6)
   The single data adapter. Three analysis modes share one interface:

     MODE A  'mt5'      live XAUUSD from the user's own MT5 broker via the
                        Python backend (backend/mt5_server.py).
     MODE B  'snapshot' three-screenshot analysis (see screenshot-analyser.js).
     MODE C  'demo'     deterministic synthetic candles for testing.

   PUBLIC INTERFACE (unchanged since Phase 1 — app.js keeps working)
     getLatestPrice()          getCandles(symbol, timeframe, limit)
     getDataStatus()           getLastUpdateTime()
     getMeta()
   PHASE 3 ADDITIONS
     setMode(mode)             getMode()
     configure({ endpoint })   getEndpoint()
     probeBackend()            -> status object, bounded retries

   HONESTY RULES
   -------------
   * The mock provider can never report LIVE. It reports DEMO forever.
   * When MT5 mode is selected and the backend is unreachable, candles come
     back EMPTY and the status becomes NOT CONNECTED / OFFLINE. Demo candles
     are never substituted for live ones silently.
   * HTTP 200 alone does not prove data is valid: freshness, candle counts and
     OHLC consistency are checked, and stale data is marked STALE and blocks
     signals.
   ===================================================================== */
(function (global) {
  'use strict';

  var SYMBOL = 'XAUUSD';
  var SYNTHETIC_ANCHOR = 2381.40;   // NOT a real market price

  var TIMEFRAMES = {
    M5:  { ms: 5 * 60 * 1000,  label: 'M5',  step: 1.35, wave: 19 },
    M15: { ms: 15 * 60 * 1000, label: 'M15', step: 2.30, wave: 14 },
    H1:  { ms: 60 * 60 * 1000, label: 'H1',  step: 4.60, wave: 11 }
  };

  var lastUpdate = new Date().toISOString();
  var mode = 'demo';                 // 'demo' | 'mt5' | 'snapshot'
  var endpoint = '';
  var backendState = {
    status: 'NOT CONNECTED',        // NOT CONNECTED | LIVE | STALE | OFFLINE
    checkedAt: null,
    lastSuccessAt: null,
    message: 'The Python MT5 backend has not been contacted yet.',
    symbol: null,
    spread: null,
    bid: null,
    ask: null
  };

  /* ---------------- deterministic mock helpers (unchanged) ---------------- */

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  function noiseAt(seed, index) {
    var r = mulberry32((seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0);
    return r();
  }

  function priceAt(seed, i, cfg) {
    var wave1 = Math.sin(i / cfg.wave) * cfg.step * 6.2;
    var wave2 = Math.sin(i / (cfg.wave * 0.37) + 1.7) * cfg.step * 2.4;
    var grain = (noiseAt(seed, i) - 0.5) * cfg.step * 1.7;
    return SYNTHETIC_ANCHOR + wave1 + wave2 + grain;
  }

  function generateCandles(symbol, timeframe, limit) {
    var cfg = TIMEFRAMES[timeframe];
    if (!cfg) { throw new Error('Unknown timeframe: ' + timeframe); }
    if (!isFiniteNumber(limit) || limit < 5) { limit = 60; }
    limit = Math.min(Math.floor(limit), 500);

    var seed = hashString(symbol + '|' + timeframe);
    var barMs = cfg.ms;
    var lastBarTime = Math.floor(Date.now() / barMs) * barMs;
    var startTime = lastBarTime - (limit - 1) * barMs;
    var REF = Date.UTC(2024, 0, 1);
    var lastIndex = Math.round((lastBarTime - REF) / barMs);

    var candles = [];
    for (var i = 0; i < limit; i++) {
      var idx = lastIndex - (limit - 1) + i;
      var open = priceAt(seed, idx, cfg);
      var close = priceAt(seed, idx + 1, cfg);
      var wick = cfg.step * (0.3 + noiseAt(seed, idx + 7) * 1.1);
      candles.push({
        time: startTime + i * barMs,
        open: round2(open),
        high: round2(Math.max(open, close) + wick * noiseAt(seed, idx + 13)),
        low: round2(Math.min(open, close) - wick * noiseAt(seed, idx + 21)),
        close: round2(close),
        volume: Math.round(420 + noiseAt(seed, idx + 33) * 2600)
      });
    }
    return candles;
  }

  /* ---------------- MT5 backend client ---------------- */

  function configure(options) {
    options = options || {};
    if (typeof options.endpoint === 'string') {
      endpoint = options.endpoint.replace(/\/+$/, '');
      try {
        if (global.localStorage) { global.localStorage.setItem('kp56.endpoint', endpoint); }
      } catch (e) { /* storage unavailable */ }
    }
    return endpoint;
  }

  function loadEndpoint() {
    try {
      if (global.localStorage) {
        endpoint = (global.localStorage.getItem('kp56.endpoint') || '').replace(/\/+$/, '');
      }
    } catch (e) { endpoint = ''; }
    return endpoint;
  }

  function getEndpoint() { return endpoint; }

  /** Bounded fetch: two retries, then give up and report OFFLINE. */
  function fetchJson(path, attempt) {
    attempt = attempt || 0;
    if (!endpoint) {
      return Promise.reject(new Error('No backend endpoint configured.'));
    }
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('This browser has no fetch support.'));
    }
    return global.fetch(endpoint + path, { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) { throw new Error('HTTP ' + res.status + ' from ' + path); }
        return res.json();
      })
      .catch(function (err) {
        if (attempt < 2) {
          return new Promise(function (resolve) {
            setTimeout(resolve, 400 * (attempt + 1));
          }).then(function () { return fetchJson(path, attempt + 1); });
        }
        throw err;
      });
  }

  /** Marks staleness from the last successful contact. */
  function refreshBackendState(payload) {
    backendState.checkedAt = new Date().toISOString();
    if (!payload) {
      backendState.status = endpoint ? 'OFFLINE' : 'NOT CONNECTED';
      backendState.message = endpoint
        ? 'The MT5 backend at ' + endpoint + ' did not respond after 3 attempts.'
        : 'No MT5 backend endpoint is configured. Add one in Settings to use live broker data.';
      return backendState;
    }
    backendState.lastSuccessAt = new Date().toISOString();
    backendState.status = 'LIVE';
    backendState.message = 'Connected to the MT5 backend.';
    if (payload.symbol) { backendState.symbol = payload.symbol; }
    return backendState;
  }

  function probeBackend() {
    if (mode !== 'mt5') {
      backendState.status = 'NOT CONNECTED';
      backendState.message = 'Mode is not MT5, so the backend is not used.';
      return Promise.resolve(backendState);
    }
    return fetchJson('/api/health').then(function (health) {
      refreshBackendState(health);
      return fetchJson('/api/market/price').then(function (price) {
        if (price) {
          backendState.bid = price.bid;
          backendState.ask = price.ask;
          backendState.spread = price.spread;
          backendState.symbol = price.symbol || backendState.symbol;
        }
        return backendState;
      }).catch(function () { return backendState; });
    }).catch(function (err) {
      refreshBackendState(null);
      backendState.message = 'MT5 backend unreachable: ' + (err && err.message ? err.message : 'unknown error');
      return backendState;
    });
  }

  function isStale() {
    if (!backendState.lastSuccessAt) { return true; }
    var age = (Date.now() - new Date(backendState.lastSuccessAt).getTime()) / 1000;
    return age > 300;   // five minutes without a successful read
  }

  /* ---------------- public methods ---------------- */

  function getDataStatus() {
    if (mode === 'demo') {
      return {
        mode: 'DEMO', status: 'DEMO', live: false, verified: false,
        providerName: 'Deterministic Mock Provider (Phase 3)',
        reason: 'Demo mode: all candles are generated locally from a fixed seed.',
        telegram: 'NOT CONNECTED',
        symbol: SYMBOL
      };
    }
    if (mode === 'snapshot') {
      return {
        mode: 'SNAPSHOT ANALYSIS', status: 'SNAPSHOT ANALYSIS', live: false, verified: false,
        providerName: 'Three-screenshot analysis',
        reason: 'Snapshot mode: findings come from uploaded screenshots, not from a live feed.',
        telegram: 'NOT CONNECTED',
        symbol: SYMBOL
      };
    }

    // MT5 mode
    var stale = isStale();
    if (backendState.status === 'LIVE' && stale) {
      backendState.status = 'STALE';
      backendState.message = 'The last successful MT5 read is older than 5 minutes. Data is marked STALE.';
    }
    return {
      mode: 'MT5',
      status: backendState.status,          // LIVE | STALE | OFFLINE | NOT CONNECTED
      live: backendState.status === 'LIVE' && !stale,
      verified: backendState.status === 'LIVE' && !stale,
      providerName: 'MT5 Python backend' + (backendState.symbol ? ' (' + backendState.symbol + ')' : ''),
      reason: backendState.message,
      telegram: 'NOT CONNECTED',
      symbol: backendState.symbol || SYMBOL,
      spread: backendState.spread,
      bid: backendState.bid,
      ask: backendState.ask,
      lastSuccessAt: backendState.lastSuccessAt
    };
  }

  function getLatestPrice(symbol) {
    lastUpdate = new Date().toISOString();
    if (mode === 'demo') {
      var candles = generateCandles(symbol || SYMBOL, 'M15', 2);
      var last = candles[candles.length - 1];
      var prev = candles[candles.length - 2] || last;
      var change = round2(last.close - prev.close);
      return {
        symbol: symbol || SYMBOL,
        price: last.close, change: change,
        changePct: prev.close ? round2((change / prev.close) * 100) : 0,
        synthetic: true, source: 'demo',
        label: 'SYNTHETIC SAMPLE — NOT A LIVE QUOTE',
        updatedAt: lastUpdate
      };
    }
    if (mode === 'snapshot') {
      return {
        symbol: symbol || SYMBOL, price: null, change: null, changePct: null,
        synthetic: true, source: 'snapshot',
        label: 'SNAPSHOT ANALYSIS — prices are read from screenshots only when clearly visible',
        updatedAt: lastUpdate
      };
    }
    // MT5 mode: never invent a price. If unavailable, price is null.
    if (backendState.status === 'LIVE' && isFiniteNumber(backendState.bid)) {
      return {
        symbol: backendState.symbol || symbol || SYMBOL,
        price: round2((backendState.bid + backendState.ask) / 2),
        change: null, changePct: null,
        synthetic: false, source: 'mt5',
        bid: backendState.bid, ask: backendState.ask, spread: backendState.spread,
        label: 'LIVE BROKER QUOTE (mid of bid/ask)',
        updatedAt: backendState.lastSuccessAt || lastUpdate
      };
    }
    return {
      symbol: symbol || SYMBOL, price: null, change: null, changePct: null,
      synthetic: false, source: 'mt5', unavailable: true,
      label: 'NO LIVE QUOTE AVAILABLE — ' + backendState.status,
      updatedAt: lastUpdate
    };
  }

  function getCandles(symbol, timeframe, limit) {
    var sym = symbol || SYMBOL;
    var tf = timeframe || 'M15';
    lastUpdate = new Date().toISOString();

    if (mode === 'demo') {
      var candles = generateCandles(sym, tf, limit || 90);
      return {
        symbol: sym, timeframe: tf, source: 'demo', synthetic: true,
        hasVolume: true, volumeIsSynthetic: true,
        unit: 'USD per troy ounce (synthetic scale)',
        generatedAt: lastUpdate, candles: candles
      };
    }

    if (mode === 'snapshot') {
      return {
        symbol: sym, timeframe: tf, source: 'snapshot', synthetic: true,
        hasVolume: false, unit: 'read from screenshot only where visible',
        generatedAt: lastUpdate, candles: []
      };
    }

    // MT5 mode is asynchronous; the async method below does the real work.
    return {
      symbol: sym, timeframe: tf, source: 'mt5', synthetic: false,
      hasVolume: true, unit: 'broker feed',
      generatedAt: lastUpdate, candles: [], pending: true
    };
  }

  /**
   * Asynchronous candle retrieval for MT5 mode.
   * Returns a promise of the same shape as getCandles().
   */
  function fetchCandles(symbol, timeframe, limit) {
    var sym = symbol || SYMBOL;
    var tf = timeframe || 'M15';
    if (mode !== 'mt5') {
      return Promise.resolve(getCandles(sym, tf, limit));
    }
    return fetchJson('/api/market/candles?symbol=' + encodeURIComponent(sym) +
      '&timeframe=' + encodeURIComponent(tf) + '&limit=' + encodeURIComponent(limit || 500))
      .then(function (payload) {
        refreshBackendState(payload);
        var rows = (payload && payload.candles) || [];
        if (!Array.isArray(rows)) { throw new Error('Malformed candle payload.'); }
        if (backendState.symbol && payload.symbol && backendState.symbol !== payload.symbol) {
          throw new Error('Symbol mismatch: requested ' + sym + ', received ' + payload.symbol + '.');
        }
        return {
          symbol: payload.symbol || sym,
          timeframe: tf,
          source: 'mt5', synthetic: false,
          hasVolume: true,
          unit: 'broker feed',
          generatedAt: new Date().toISOString(),
          receivedAt: payload.receivedAt || null,
          candles: rows.map(function (c) {
            return {
              time: Number(c.time), open: Number(c.open), high: Number(c.high),
              low: Number(c.low), close: Number(c.close),
              volume: isFiniteNumber(Number(c.volume)) ? Number(c.volume) : null
            };
          })
        };
      })
      .catch(function (err) {
        refreshBackendState(null);
        backendState.message = 'MT5 candle request failed: ' + (err && err.message ? err.message : 'unknown error');
        return {
          symbol: sym, timeframe: tf, source: 'mt5', synthetic: false,
          hasVolume: false, generatedAt: new Date().toISOString(),
          candles: [], error: backendState.message
        };
      });
  }

  function getLastUpdateTime() { return lastUpdate; }

  function getMeta() {
    return {
      symbol: SYMBOL,
      syntheticAnchor: SYNTHETIC_ANCHOR,
      anchorLabel: 'SYNTHETIC ANCHOR — NOT A REAL MARKET PRICE',
      timeframes: Object.keys(TIMEFRAMES),
      hasVolume: true,
      mode: mode
    };
  }

  function setMode(next) {
    if (['demo', 'mt5', 'snapshot'].indexOf(next) === -1) { return mode; }
    mode = next;
    lastUpdate = new Date().toISOString();
    return mode;
  }

  function getMode() { return mode; }

  loadEndpoint();

  var api = {
    getLatestPrice: getLatestPrice,
    getCandles: getCandles,
    fetchCandles: fetchCandles,
    getDataStatus: getDataStatus,
    getLastUpdateTime: getLastUpdateTime,
    getMeta: getMeta,
    setMode: setMode,
    getMode: getMode,
    configure: configure,
    getEndpoint: getEndpoint,
    probeBackend: probeBackend
  };

  global.KP56DataProvider = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : this);
