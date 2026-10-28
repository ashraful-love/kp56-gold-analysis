/* =====================================================================
   KP56 Gold Analysis — phase3-ui.js   (Phase 3, Parts 1, 2, 4, 7)
   Integration layer for the Phase 3 additions:
     * analysis-mode switch (MT5 / screenshots / demo) and status banner,
     * three-screenshot panel + manual-analysis fallback,
     * the SMC map (findings with confirmed vs tentative distinction),
     * the multi-timeframe report (H1 / M15 / M5 questions from Part 4).

   It reads data through the shared adapter and renders into the existing
   dashboard. It does not replace any Phase 1 or Phase 2 component.
   ===================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Provider = global.KP56DataProvider;
  var SMC = global.KP56SMC;
  var Settings = global.KP56Settings;

  var state = {
    mode: 'demo',
    snapshot: null,          // last screenshot/manual analysis report
    screenshots: null,
    lastSmc: null
  };

  var STATUS_TEXT = {
    'LIVE': 'LIVE — connected to the MT5 broker feed',
    'DEMO': 'DEMO — synthetic sample data, not real market prices',
    'SNAPSHOT ANALYSIS': 'SNAPSHOT ANALYSIS — findings read from your screenshots',
    'STALE': 'STALE — the last successful data read is old; signals are blocked',
    'OFFLINE': 'OFFLINE — the MT5 backend did not respond',
    'NOT CONNECTED': 'NOT CONNECTED — no live data source is configured',
    'IMAGE ANALYSIS BACKEND NOT CONFIGURED': 'IMAGE ANALYSIS BACKEND NOT CONFIGURED'
  };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function price(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) : '—'; }

  /* ---------------- bridge to the rest of the app ---------------- */

  function bridge() { return global.KP56Bridge || null; }

  function candlesFor(tf) {
    var b = bridge();
    if (b && typeof b.getCandles === 'function') {
      var rows = b.getCandles(tf);
      if (Array.isArray(rows)) { return rows; }
    }
    var data = Provider.getCandles('XAUUSD', tf, 120);
    return data && data.candles ? data.candles : [];
  }

  function settings() {
    var b = bridge();
    if (b && typeof b.getSettings === 'function' && b.getSettings()) { return b.getSettings(); }
    return Settings.load();
  }

  /* ---------------- mode + status banner ---------------- */

  function setMode(mode) {
    if (['mt5', 'snapshot', 'demo'].indexOf(mode) === -1) { return; }
    state.mode = mode;
    Provider.setMode(mode);
    var buttons = document.querySelectorAll('.js-mode');
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute('data-mode') === mode;
      buttons[i].classList.toggle('is-active', active);
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    var mt5Panel = $('mt5Panel');
    if (mt5Panel) { mt5Panel.hidden = mode !== 'mt5'; }
    var shotSection = $('snapshotSection');
    if (shotSection) { shotSection.hidden = mode !== 'snapshot'; }
    renderStatus();
    if (mode === 'mt5') {
      Provider.probeBackend().then(function () {
        renderStatus();
        if (bridge() && bridge().reload) { bridge().reload(); }
      });
    } else if (bridge() && bridge().reload) {
      bridge().reload();
    }
  }

  function renderStatus() {
    var status = Provider.getDataStatus();
    var label = STATUS_TEXT[status.status] || status.status;
    var host = $('modeStatus');
    if (host) {
      host.innerHTML =
        '<span class="badge ' + (status.live ? 'badge-pass' : status.status === 'DEMO' ? 'badge-wait' : 'badge-fail') + '">' +
        esc(status.status) + '</span>' +
        '<p class="note">' + esc(label) + ' · provider: ' + esc(status.providerName) + ' · ' + esc(status.reason) + '</p>' +
        '<p class="note">Source symbol: <strong>' + esc(status.symbol || 'XAUUSD') + '</strong>' +
        (status.spread ? ' · spread ' + esc(status.spread) + ' points' : ' · spread not available') +
        (status.bid ? ' · bid ' + price(status.bid) + ' / ask ' + price(status.ask) : '') + '</p>';
    }
    var chip = $('dataStatusChip');
    if (chip) { chip.textContent = status.status; }
    var endpoint = $('mt5Endpoint');
    if (endpoint && !endpoint.value) { endpoint.value = Provider.getEndpoint() || ''; }
  }

  /* ---------------- SMC map ---------------- */

  function confirmationClass(c) {
    return c === 'confirmed' ? 'find-confirmed' : c === 'tentative' ? 'find-tentative' : 'find-none';
  }

  function renderSmcMap() {
    var host = $('smcMap');
    if (!host) { return; }
    var datasets = { H1: candlesFor('H1'), M15: candlesFor('M15'), M5: candlesFor('M5') };
    var mtf = SMC.multiTimeframe(datasets, { source: 'candle data' });
    state.lastSmc = mtf;

    var rows = [];
    ['H1', 'M15', 'M5'].forEach(function (tf) {
      mtf.reports[tf].findings.forEach(function (f) {
        rows.push(f);
      });
    });

    if (!rows.length) {
      host.innerHTML = '<p class="empty-row">No SMC findings could be detected from the current dataset.</p>';
      return;
    }

    host.innerHTML =
      '<div class="table-wrap"><table class="history-table smc-table">' +
        '<thead><tr><th>Concept</th><th>TF</th><th>Price zone</th><th>Confirmation</th>' +
        '<th>Detection rule &amp; evidence</th><th>Invalidation</th><th>Source</th></tr></thead><tbody>' +
        rows.map(function (f) {
          return '<tr class="' + confirmationClass(f.confirmation) + '">' +
            '<td>' + esc(f.concept) + '</td>' +
            '<td>' + esc(f.timeframe) + '</td>' +
            '<td>' + (f.zone ? price(f.zone.low) + ' – ' + price(f.zone.high) : 'not readable') + '</td>' +
            '<td>' + esc(f.confirmation) + '</td>' +
            '<td class="smc-evidence">' + esc(f.rule) + ' ' + esc(f.evidence) + '</td>' +
            '<td>' + esc(f.invalidation || '—') + '</td>' +
            '<td>' + esc(f.source) + '</td>' +
            '</tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<p class="note smc-note">Confirmed findings are marked with a solid accent, tentative findings are muted. ' +
      'These are geometric price patterns read from candles — they cannot reveal actual institutional orders, ' +
      'and no finding guarantees direction. Modules with insufficient data are listed as unavailable rather than guessed.</p>' +
      (function () {
        var un = [];
        ['H1', 'M15', 'M5'].forEach(function (tf) {
          mtf.reports[tf].unavailable.forEach(function (u) { un.push(tf + ' · ' + u.module + ': ' + u.reason); });
        });
        return un.length
          ? '<p class="note"><strong>Unavailable in this dataset:</strong><br>' + un.slice(0, 8).map(esc).join('<br>') + '</p>'
          : '';
      })();
  }

  /* ---------------- multi-timeframe report (Part 4) ---------------- */

  function renderMtf() {
    var host = $('mtfReport');
    if (!host) { return; }
    var mtf = state.lastSmc || SMC.multiTimeframe(
      { H1: candlesFor('H1'), M15: candlesFor('M15'), M5: candlesFor('M5') }, { source: 'candle data' });

    var zones = function (tf) {
      var list = mtf.zones[tf];
      return list.length
        ? list.map(function (f) { return esc(f.concept) + ' ' + (f.zone ? price(f.zone.low) + '-' + price(f.zone.high) : ''); }).join(' · ')
        : 'none detected';
    };

    var questions = [
      ['1. Is H1 bullish, bearish or neutral?', mtf.bias.H1.toUpperCase()],
      ['2. Does M15 agree with H1?', mtf.agrees ? 'YES' : (mtf.conflicts ? 'NO — CONFLICT' : 'NOT ESTABLISHED')],
      ['3. Important zones on each timeframe', 'H1: ' + zones('H1') + ' | M15: ' + zones('M15') + ' | M5: ' + zones('M5')],
      ['4. Does M5 provide an entry confirmation?', mtf.m5Confirms ? 'YES' : 'NO'],
      ['5. Does the setup conflict with higher timeframes?', mtf.conflicts ? 'YES — no setup may be taken' : 'NO'],
      ['6. Which conditions are still missing?', mtf.missing.length ? mtf.missing.join(' ') : 'None reported by the structure engine']
    ];

    host.innerHTML = questions.map(function (q) {
      return '<div class="row"><span class="row-label">' + esc(q[0]) + '</span>' +
        '<span class="row-value">' + esc(q[1]) + '</span></div>';
    }).join('') +
      '<p class="note mtf-summary">' + esc(mtf.summary) +
      ' A single bullish timeframe is never enough to issue a BUY or SELL.</p>';
  }

  /* ---------------- manual-analysis fallback ---------------- */

  function renderManualForm() {
    var host = $('shotManual');
    if (!host) { return; }
    var options = global.KP56Screenshots.SMC_OPTIONS;

    host.innerHTML =
      '<h3 class="panel-title">Manual analysis fallback <span class="est-tag">WHAT YOU CAN SEE</span></h3>' +
      '<p class="note">Record only what is actually visible in your screenshots. Leave a price zone empty if the ' +
      'scale is unreadable — no price is ever invented. These findings are labelled as screenshot evidence and can ' +
      'never become a live trading signal.</p>' +
      ['H1', 'M15', 'M5'].map(function (tf) {
        return '<details class="manual-block"><summary>' + tf + ' evidence</summary>' +
          '<div class="manual-grid">' +
            options.map(function (o) {
              return '<label class="check"><input type="checkbox" data-manual-tf="' + tf + '" value="' + o.id + '"> ' +
                esc(o.label) + '</label>';
            }).join('') +
          '</div>' +
          '<div class="split-fields">' +
            '<div class="field"><label for="zoneHigh' + tf + '">Visible zone high (optional)</label>' +
              '<input type="number" id="zoneHigh' + tf + '" step="any" placeholder="leave empty if unreadable"></div>' +
            '<div class="field"><label for="zoneLow' + tf + '">Visible zone low (optional)</label>' +
              '<input type="number" id="zoneLow' + tf + '" step="any" placeholder="leave empty if unreadable"></div>' +
          '</div>' +
          '<div class="field"><label for="notes' + tf + '">Notes (what you can see)</label>' +
            '<input type="text" id="notes' + tf + '" maxlength="180" placeholder="e.g. swept the Asian low, closed back inside"></div>' +
          '<label class="check"><input type="checkbox" id="confirmed' + tf + '"> Evidence is clear enough to count as confirmed</label>' +
          '</details>';
      }).join('') +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-gold" id="manualRecordBtn">Record manual findings</button>' +
        '<button type="button" class="btn btn-line" id="manualClearBtn">Clear findings</button>' +
      '</div>' +
      '<p class="form-error" id="manualStatus" role="status"></p>';

    var recordBtn = $('manualRecordBtn');
    if (recordBtn) {
      recordBtn.addEventListener('click', recordManualFindings);
    }
    var clearBtn = $('manualClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        state.snapshot = null;
        renderSnapshotResult();
        setText('manualStatus', 'Findings cleared.');
      });
    }
  }

  function setText(id, text) { var el = $(id); if (el) { el.textContent = text; } }

  function recordManualFindings() {
    var entries = [];
    ['H1', 'M15', 'M5'].forEach(function (tf) {
      var checked = document.querySelectorAll('input[data-manual-tf="' + tf + '"]:checked');
      var concepts = [];
      for (var i = 0; i < checked.length; i++) { concepts.push(checked[i].value); }
      entries.push({
        timeframe: tf,
        concepts: concepts,
        zoneHigh: $('zoneHigh' + tf) ? $('zoneHigh' + tf).value : '',
        zoneLow: $('zoneLow' + tf) ? $('zoneLow' + tf).value : '',
        notes: $('notes' + tf) ? $('notes' + tf).value : '',
        confirmed: $('confirmed' + tf) ? $('confirmed' + tf).checked : false,
        invalidation: null
      });
    });

    var findings = global.KP56Screenshots.buildManualFindings(entries);
    if (!findings.length) {
      setText('manualStatus', 'Nothing selected. Tick at least one visible concept before recording.');
      return;
    }

    // Direction evidence from the recorded concepts only.
    var bullish = findings.filter(function (f) { return /bullish|discount|sell-side liquidity sweep/i.test(f.concept); }).length;
    var bearish = findings.filter(function (f) { return /bearish|premium|buy-side liquidity sweep/i.test(f.concept); }).length;

    var tests = buildSnapshotTests(findings, bullish, bearish);
    var decision = global.SignalEngine.evaluate({
      tests: tests,
      dataStatus: Provider.getDataStatus(),     // mode 'snapshot' -> never a live signal
      plan: null,
      settings: settings(),
      forecast: { implemented: false },
      recentSignalKeys: []
    });

    state.snapshot = {
      findings: findings,
      decision: decision,
      evidence: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
      bullish: bullish,
      bearish: bearish
    };
    renderSnapshotResult();
    setText('manualStatus', findings.length + ' finding(s) recorded from the screenshots.');
  }

  /**
   * Screenshot evidence is turned into the four familiar test results, with
   * screenshot honesty: numeric indicators are NOT known from an image, so
   * Test 3 is always WAITING unless a verified data source provides them.
   */
  function buildSnapshotTests(findings, bullish, bearish) {
    var hasStructure = findings.some(function (f) { return /BOS|CHoCH/i.test(f.concept); });
    var hasLiquidity = findings.some(function (f) { return /liquidity|EQH|EQL/i.test(f.concept); });
    var hasZone = findings.some(function (f) { return /FVG|order block/i.test(f.concept); });

    return [
      {
        name: 'Test 1 - Trend (from screenshots)',
        status: hasStructure ? (bullish !== bearish ? 'PASS' : 'FAIL') : 'WAITING',
        direction: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'unknown',
        summary: hasStructure
          ? 'Structure evidence recorded from the screenshots.'
          : 'No BOS or CHoCH was recorded, so the trend cannot be judged from these images.'
      },
      {
        name: 'Test 2 - SMC (from screenshots)',
        status: (hasLiquidity && hasZone) ? 'PASS' : 'WAITING',
        direction: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'unknown',
        summary: (hasLiquidity && hasZone)
          ? 'Liquidity and zone evidence recorded from the screenshots.'
          : 'Some SMC evidence is missing in the recorded findings.'
      },
      {
        name: 'Test 3 - Entry quality',
        status: 'WAITING',
        direction: 'unknown',
        summary: 'RSI, ADX, ATR and spread are NOT readable from a screenshot and no verified data source is connected, so entry quality stays WAITING.'
      },
      {
        name: 'Test 4 - Risk & forecast',
        status: 'WAITING',
        direction: 'unknown',
        summary: 'Without verified entry, stop and target prices there is no trade geometry to validate, and the forecast remains unavailable.'
      }
    ];
  }

  function renderSnapshotResult() {
    var host = $('snapshotResult');
    if (!host) { return; }
    if (!state.snapshot) {
      host.innerHTML = '<p class="empty-row">No snapshot analysis recorded yet.</p>';
      return;
    }
    var s = state.snapshot;
    host.innerHTML =
      '<div class="cert-top"><span class="mini-label">Snapshot result</span>' +
        '<span class="chip chip-ghost">SOURCE: SCREENSHOTS</span></div>' +
      '<p class="cert-state" data-state="' + (s.decision.stateKey === 'waiting' ? 'waiting' : 'blocked') + '">' +
        esc(s.decision.state) + '</p>' +
      '<p class="cert-sub">Evidence direction from the recorded screenshots: ' + esc(s.evidence.toUpperCase()) +
        ' (' + s.bullish + ' bullish / ' + s.bearish + ' bearish findings)</p>' +
      '<div class="rows">' +
        s.findings.map(function (f) {
          return '<div class="row"><span class="row-label">' + esc(f.concept) + ' · ' + esc(f.timeframe) + '</span>' +
            '<span class="row-value">' + (f.zone ? price(f.zone.low) + '-' + price(f.zone.high) : 'zone not readable') + '</span>' +
            '<span class="row-state st-' + (f.confirmation === 'confirmed' ? 'pass' : 'wait') + '">' + esc(f.confirmation) + '</span>' +
            '<span class="row-note">' + esc(f.evidence) + (f.invalidation ? ' Invalidation: ' + esc(f.invalidation) : '') + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="cert-reasons"><span class="mini-label">Why this is not a trading signal</span><ul>' +
        s.decision.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') +
      '</ul></div>';
  }

  /* ---------------- MT5 endpoint panel ---------------- */

  function bindMt5Panel() {
    var btn = $('mt5ConnectBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var input = $('mt5Endpoint');
        var statusEl = $('mt5Status');
        var url = input ? String(input.value).trim() : '';
        if (!url) {
          if (statusEl) {
            statusEl.className = 'form-error';
            statusEl.textContent = 'Enter the address of your MT5 backend, for example http://localhost:8000 — ' +
              'or leave MT5 mode and use Demo mode.';
          }
          return;
        }
        Provider.configure({ endpoint: url });
        if (statusEl) { statusEl.className = 'form-error'; statusEl.textContent = 'Connecting…'; }
        Provider.probeBackend().then(function (s) {
          renderStatus();
          if (statusEl) {
            statusEl.className = 'form-error' + (s.status === 'LIVE' ? ' is-ok' : '');
            statusEl.textContent = s.status + ' — ' + s.message +
              (s.status === 'LIVE' ? '' : ' The dashboard will not display invented prices while the feed is unavailable.');
          }
          if (bridge() && bridge().reload) { bridge().reload(); }
        });
      });
    }
    var refresh = $('mt5RefreshBtn');
    if (refresh) {
      refresh.addEventListener('click', function () {
        Provider.probeBackend().then(function () {
          renderStatus();
          if (bridge() && bridge().reload) { bridge().reload(); }
        });
      });
    }
  }

  /* ---------------- init / refresh ---------------- */

  function init() {
    var modeButtons = document.querySelectorAll('.js-mode');
    for (var i = 0; i < modeButtons.length; i++) {
      modeButtons[i].addEventListener('click', function (e) {
        setMode(e.currentTarget.getAttribute('data-mode'));
      });
    }
    bindMt5Panel();

    state.screenshots = global.KP56Screenshots.init('shotPanel', function (report) {
      state.snapshot = state.snapshot || null;
      setText('shotStatus', report.stateLabel + ' — ' + report.message);
      if (report.findings && report.findings.length) {
        state.snapshot = {
          findings: report.findings,
          decision: global.SignalEngine.evaluate({
            tests: buildSnapshotTests(report.findings, 0, 0),
            dataStatus: Provider.getDataStatus(),
            plan: null,
            settings: settings(),
            forecast: { implemented: false },
            recentSignalKeys: []
          }),
          evidence: 'from provider',
          bullish: 0,
          bearish: 0
        };
        renderSnapshotResult();
      } else {
        renderSnapshotResult();
      }
    });

    renderManualForm();
    renderStatus();
    renderSmcMap();
    renderMtf();
    renderSnapshotResult();
  }

  function refresh() {
    renderStatus();
    renderSmcMap();
    renderMtf();
    renderSnapshotResult();
    // The screenshot panel is NOT re-rendered here: re-rendering would wipe the
    // user's selected images and consent state mid-review.
  }

  global.KP56Phase3 = {
    init: init,
    refresh: refresh,
    setMode: setMode,
    renderStatus: renderStatus,
    renderSmcMap: renderSmcMap,
    renderMtf: renderMtf,
    getSnapshot: function () { return state.snapshot; }
  };

})(typeof window !== 'undefined' ? window : this);
