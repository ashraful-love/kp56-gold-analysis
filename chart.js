/* =====================================================================
   KP56 Gold Analysis — chart.js
   Hand-drawn canvas candlestick renderer. NO external chart library, so
   nothing here breaks when a CDN is unavailable.

   ADAPTER CONTRACT
   ----------------
     var chart = new KP56Chart(document.getElementById('mainChart'));
     chart.render({
       candles:  [{time, open, high, low, close, volume}...],  // historical
       forecast: [{time, open, high, low, close, volume}...],  // hypothetical
       levels:   [{label:'Entry', value:2381.4, kind:'entry'}...],
       showVolume: true, showLevels: true, showForecast: true,
       mode: 'DEMO'
     });

   Any OHLC array produced by data-provider.js can be passed straight in.
   ===================================================================== */
(function (global) {
  'use strict';

  function KP56Chart(canvas, options) {
    if (!canvas || !canvas.getContext) {
      this.dead = true;
      return;
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = Object.assign({
      showVolume: true, showLevels: true, showForecast: true, showPlan: true
    }, options || {});
    this.dataset = null;
    this._boundResize = this.resize.bind(this);
    global.addEventListener('resize', this._boundResize);
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this._ro = new ResizeObserver(this._boundResize);
      this._ro.observe(canvas.parentElement);
    }
    this.resize();
  }

  KP56Chart.prototype.destroy = function () {
    global.removeEventListener('resize', this._boundResize);
    if (this._ro) { this._ro.disconnect(); }
  };

  KP56Chart.prototype.resize = function () {
    if (this.dead) { return; }
    var rect = this.canvas.getBoundingClientRect();
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.max(rect.width, 240);
    var h = Math.max(rect.height, 200);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = w;
    this.cssHeight = h;
    this.draw();
  };

  /** Read palette from CSS variables so theme switching is respected. */
  KP56Chart.prototype.palette = function () {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var val = (cs.getPropertyValue(name) || '').trim();
      return val || fallback;
    }
    return {
      bg: v('--ink-2', '#100E0A'),
      grid: v('--rule-soft', '#221E15'),
      text: v('--text-mute', '#A2977F'),
      textStrong: v('--text', '#EFE7D5'),
      bull: v('--bull', '#37B26C'),
      bear: v('--bear', '#D64A41'),
      gold: v('--gold', '#D9A521'),
      goldLt: v('--gold-lt', '#F2CE6B'),
      sl: v('--bear', '#D64A41'),
      tp: v('--bull-dim', '#1E5F3D'),
      sr: v('--text-dim', '#7B7261'),
      volume: v('--text-dim', '#7B7261')
    };
  };

  KP56Chart.prototype.render = function (dataset) {
    if (this.dead) { return; }
    this.dataset = dataset || null;
    this.draw();
  };

  KP56Chart.prototype.draw = function () {
    if (this.dead) { return; }
    var ctx = this.ctx;
    var W = this.cssWidth, H = this.cssHeight;
    if (!W || !H) { return; }
    var p = this.palette();
    var d = this.dataset;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);

    if (!d || !d.candles || !d.candles.length) {
      ctx.fillStyle = p.text;
      ctx.font = '500 12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO CANDLE DATA LOADED', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    var candles = d.candles;
    var forecast = (this.options.showForecast !== false && d.forecast) ? d.forecast : [];
    var levels = (this.options.showLevels !== false && d.levels) ? d.levels : [];
    var showVolume = this.options.showVolume !== false && d.hasVolume !== false;

    var padL = 8, padR = 66, padT = 18, padB = 26;
    var volH = showVolume ? Math.round((H - padT - padB) * 0.16) : 0;
    var plotW = W - padL - padR;
    var priceH = H - padT - padB - volH;

    // ---- price range across history + forecast + levels
    var min = Infinity, max = -Infinity;
    function eat(c) {
      if (c.low < min) { min = c.low; }
      if (c.high > max) { max = c.high; }
    }
    candles.forEach(eat);
    forecast.forEach(eat);
    levels.forEach(function (l) {
      if (typeof l.value === 'number') {
        if (l.value < min) { min = l.value; }
        if (l.value > max) { max = l.value; }
      }
    });
    if (!isFinite(min) || !isFinite(max) || max === min) { min -= 1; max += 1; }
    var span = max - min;
    min -= span * 0.06;
    max += span * 0.06;
    span = max - min;

    function y(price) { return padT + ((max - price) / span) * priceH; }

    var total = candles.length + forecast.length;
    var slot = plotW / total;
    var bodyW = Math.max(1.2, Math.min(slot * 0.66, 14));

    // ---- horizontal grid + price labels
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var price = min + (span * g) / 4;
      var gy = y(price);
      ctx.strokeStyle = p.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(gy) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(gy) + 0.5);
      ctx.stroke();
      ctx.fillStyle = p.text;
      ctx.textAlign = 'left';
      ctx.fillText(price.toFixed(2), padL + plotW + 8, gy);
    }

    // ---- volume
    if (showVolume) {
      var maxVol = 0;
      candles.forEach(function (c) { if (c.volume > maxVol) { maxVol = c.volume; } });
      var volTop = padT + priceH + 6;
      var volHeight = volH - 12;
      if (maxVol > 0) {
        candles.forEach(function (c, i) {
          var h = (c.volume / maxVol) * volHeight;
          var x = padL + slot * (i + 0.5) - bodyW / 2;
          ctx.fillStyle = c.close >= c.open ? p.bull : p.bear;
          ctx.globalAlpha = 0.32;
          ctx.fillRect(x, volTop + (volHeight - h), bodyW, h);
          ctx.globalAlpha = 1;
        });
      }
    }

    // ---- historical candles
    candles.forEach(function (c, i) {
      var x = padL + slot * (i + 0.5);
      var up = c.close >= c.open;
      var colour = up ? p.bull : p.bear;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y(c.high));
      ctx.lineTo(Math.round(x) + 0.5, y(c.low));
      ctx.stroke();
      var top = y(Math.max(c.open, c.close));
      var bottom = y(Math.min(c.open, c.close));
      ctx.fillStyle = colour;
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(bottom - top, 1));
    });

    // ---- forecast candles (hypothetical, hollow + dashed)
    if (forecast.length) {
      var startX = padL + slot * candles.length;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = p.gold;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(startX) + 0.5, padT - 6);
      ctx.lineTo(Math.round(startX) + 0.5, padT + priceH + (volH ? volH - 6 : 0));
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = p.gold;
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('HYPOTHETICAL FORECAST', startX + 6, padT - 8);
      ctx.fillStyle = p.text;
      ctx.fillText('SYNTHETIC HISTORY', padL, padT - 8);

      ctx.save();
      ctx.setLineDash([2, 2]);
      forecast.forEach(function (c, i) {
        var x = startX + slot * (i + 0.5);
        var up = c.close >= c.open;
        var colour = up ? p.bull : p.bear;
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - bodyW / 2, y(Math.max(c.open, c.close)), bodyW,
          Math.max(y(Math.min(c.open, c.close)) - y(Math.max(c.open, c.close)), 1));
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, y(c.high));
        ctx.lineTo(Math.round(x) + 0.5, y(c.low));
        ctx.stroke();
      });
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = p.text;
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('SYNTHETIC HISTORY', padL, padT - 8);
    }

    // ---- overlays: entry / SL / TP / support & resistance
    if (levels.length) {
      ctx.font = '500 9px "IBM Plex Mono", monospace';
      levels.forEach(function (l) {
        if (typeof l.value !== 'number') { return; }
        var ly = y(l.value);
        if (ly < padT - 20 || ly > padT + priceH + 20) { return; }
        var colour = l.kind === 'sl' ? p.sl : l.kind === 'tp' ? p.tp : l.kind === 'sr' ? p.sr : p.gold;
        ctx.save();
        ctx.setLineDash(l.kind === 'sr' ? [1, 3] : [6, 4]);
        ctx.strokeStyle = colour;
        ctx.lineWidth = l.kind === 'sr' ? 1 : 1.4;
        ctx.beginPath();
        ctx.moveTo(padL, ly);
        ctx.lineTo(padL + plotW, ly);
        ctx.stroke();
        ctx.restore();
        // Demo levels must never look like real market prices.
        var text = l.label + ' ' + l.value.toFixed(2) + (d.mode === 'DEMO' ? ' (demo)' : '');
        var tw = ctx.measureText(text).width + 10;
        ctx.fillStyle = p.bg;
        ctx.fillRect(padL + plotW + 2, ly - 8, Math.min(tw, padR - 4), 16);
        ctx.fillStyle = colour;
        ctx.textAlign = 'left';
        ctx.fillText(text, padL + plotW + 6, ly);
      });
    }

    // ---- time axis (sparse labels)
    ctx.fillStyle = p.text;
    ctx.font = '500 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    var every = Math.max(1, Math.round(total / 5));
    for (var t = 0; t < total; t += every) {
      var src = t < candles.length ? candles[t] : forecast[t - candles.length];
      if (!src) { continue; }
      var label = new Date(src.time);
      var txt = ('0' + label.getHours()).slice(-2) + ':' + ('0' + label.getMinutes()).slice(-2);
      ctx.fillText(txt, padL + slot * (t + 0.5), H - padB / 2 + 4);
    }
    ctx.textAlign = 'left';

    // ---- DEMO watermark chip
    var chip = (d.mode || 'DEMO') + ' · SYNTHETIC CANDLES';
    ctx.font = '600 9px "IBM Plex Mono", monospace';
    var cw = ctx.measureText(chip).width + 14;
    ctx.fillStyle = p.gold;
    ctx.fillRect(padL + 4, padT + 4, cw, 16);
    ctx.fillStyle = '#12100A';
    ctx.fillText(chip, padL + 11, padT + 12.5);
    ctx.textBaseline = 'alphabetic';
  };

  global.KP56Chart = KP56Chart;

})(typeof window !== 'undefined' ? window : this);
