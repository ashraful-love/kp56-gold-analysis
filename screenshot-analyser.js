/* =====================================================================
   KP56 Gold Analysis — screenshot-analyser.js   (Phase 3, Part 2)
   Three-screenshot upload, timeframe assignment and analysis interface.

   HONEST DESIGN
   -------------
   This environment has no image-analysis model and no backend, so the module:
     * implements the complete upload and review interface,
     * exposes a documented provider interface (KP56ImageAnalysisProvider),
     * reports IMAGE ANALYSIS BACKEND NOT CONFIGURED instead of inventing
       results,
     * and provides a manual-analysis fallback whose findings are recorded in
       exactly the same shape as the candle SMC engine.

   NOTHING is ever uploaded anywhere. Screenshots stay in the browser
   (object URLs). Before a configured provider could receive them, an explicit
   consent step is required and the disclosure is shown.

   PRIVACY
   -------
   * Accepted types: PNG, JPG, JPEG only.
   * Maximum size: 8 MB per image.
   * No file content leaves the browser in this phase.
   ===================================================================== */
(function (global) {
  'use strict';

  var ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
  var ALLOWED_EXT = /\.(png|jpe?g)$/i;
  var MAX_BYTES = 8 * 1024 * 1024;

  var SMC_OPTIONS = [
    { id: 'bos_bull', label: 'Bullish BOS (close above last swing high)' },
    { id: 'bos_bear', label: 'Bearish BOS (close below last swing low)' },
    { id: 'choch_bull', label: 'Bullish CHoCH (structure flipped up)' },
    { id: 'choch_bear', label: 'Bearish CHoCH (structure flipped down)' },
    { id: 'sweep_high', label: 'Buy-side liquidity swept (high taken, closed back inside)' },
    { id: 'sweep_low', label: 'Sell-side liquidity swept (low taken, closed back inside)' },
    { id: 'eqh', label: 'Equal highs (EQH)' },
    { id: 'eql', label: 'Equal lows (EQL)' },
    { id: 'fvg_bull', label: 'Bullish fair value gap' },
    { id: 'fvg_bear', label: 'Bearish fair value gap' },
    { id: 'ob_bull', label: 'Bullish order-block zone' },
    { id: 'ob_bear', label: 'Bearish order-block zone' },
    { id: 'premium', label: 'Price in premium (above equilibrium)' },
    { id: 'discount', label: 'Price in discount (below equilibrium)' },
    { id: 'rejection', label: 'Rejection candle / wick' },
    { id: 'displacement', label: 'Displacement candle' }
  ];

  var CONCEPT_LABELS = {
    bos_bull: 'Bullish BOS', bos_bear: 'Bearish BOS',
    choch_bull: 'Bullish CHoCH', choch_bear: 'Bearish CHoCH',
    sweep_high: 'Buy-side liquidity sweep', sweep_low: 'Sell-side liquidity sweep',
    eqh: 'Equal highs (EQH) liquidity', eql: 'Equal lows (EQL) liquidity',
    fvg_bull: 'Bullish FVG', fvg_bear: 'Bearish FVG',
    ob_bull: 'Bullish order block candidate', ob_bear: 'Bearish order block candidate',
    premium: 'Premium zone', discount: 'Discount zone',
    rejection: 'Rejection candle', displacement: 'Displacement candle'
  };

  /* ---------------- provider interface ---------------- */

  /*
   * FUTURE PROVIDER CONTRACT
   * ------------------------
   * Implement this object and assign it to window.KP56ImageAnalysisProvider
   * to enable genuine automated image analysis:
   *
   *   {
   *     name: 'my vision backend',
   *     configured: true,
   *     disclose: 'Your screenshots are sent to ... for analysis.',
   *     analyse: function (images) {
   *       // images: [{ timeframe, name, blob }]
   *       // must resolve to { findings: [...], notes: '...' }
   *       return Promise.resolve({ findings: [], notes: '' });
   *     }
   *   }
   *
   * The findings must follow the KP56 finding contract (see smc-engine.js):
   * { concept, timeframe, zone, rule, evidence, confirmation, invalidation, source }
   */
  function getProvider() {
    var p = global.KP56ImageAnalysisProvider;
    return (p && p.configured && typeof p.analyse === 'function') ? p : null;
  }

  /* ---------------- state ---------------- */

  var slots = [
    { key: 'H1', file: null, url: null, name: '', size: 0, type: '', status: 'empty', note: '' },
    { key: 'M15', file: null, url: null, name: '', size: 0, type: '', status: 'empty', note: '' },
    { key: 'M5', file: null, url: null, name: '', size: 0, type: '', status: 'empty', note: '' }
  ];
  var listeners = [];
  var busy = false;

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* keep UI alive */ } }); }

  function validateFile(file) {
    if (!file) { return { ok: false, message: 'No file selected.' }; }
    var typeOk = ALLOWED_TYPES.indexOf(file.type) !== -1 || ALLOWED_EXT.test(file.name || '');
    if (!typeOk) { return { ok: false, message: 'Unsupported file type. Please use PNG, JPG or JPEG.' }; }
    if (file.size > MAX_BYTES) {
      return { ok: false, message: 'File is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is 8 MB per image.' };
    }
    if (file.size === 0) { return { ok: false, message: 'The file is empty.' }; }
    return { ok: true };
  }

  function assign(index, file) {
    var slot = slots[index];
    if (!slot) { return { ok: false, message: 'Unknown screenshot slot.' }; }
    var check = validateFile(file);
    if (!check.ok) {
      slot.status = 'error';
      slot.note = check.message;
      emit();
      return check;
    }
    if (slot.url) { URL.revokeObjectURL(slot.url); }
    slot.file = file;
    slot.url = URL.createObjectURL(file);
    slot.name = file.name || 'screenshot';
    slot.size = file.size;
    slot.type = file.type || 'unknown';
    slot.status = 'ready';
    slot.note = 'Ready for review.';
    emit();
    return { ok: true };
  }

  function remove(index) {
    var slot = slots[index];
    if (!slot) { return; }
    if (slot.url) { URL.revokeObjectURL(slot.url); }
    slot.file = null; slot.url = null; slot.name = ''; slot.size = 0; slot.type = '';
    slot.status = 'empty';
    slot.note = 'Removed.';
    emit();
  }

  function setTimeframe(index, tf) {
    var slot = slots[index];
    if (!slot) { return; }
    slot.key = tf;
    emit();
  }

  /** Prevents mixing: every screenshot must have a unique timeframe. */
  function checkAssignments() {
    var problems = [];
    var used = {};
    slots.forEach(function (s) {
      if (!s.file) { return; }
      if (!s.key) { problems.push('"' + s.name + '" has no timeframe assigned.'); return; }
      if (used[s.key]) {
        problems.push('Two screenshots are assigned to ' + s.key + '. Each timeframe must be unique.');
      }
      used[s.key] = true;
    });
    slots.forEach(function (s) {
      if (!s.file) { problems.push('The ' + s.key + ' screenshot is missing.'); }
    });
    return { ok: problems.length === 0, problems: problems, assigned: used };
  }

  function ready() {
    return slots.every(function (s) { return !!s.file; }) && checkAssignments().ok;
  }

  /* ---------------- analysis ---------------- */

  function analyse(onDone) {
    if (busy) { return; }
    var assignment = checkAssignments();
    if (!assignment.ok) {
      emit();
      if (onDone) {
        onDone({
          status: 'incomplete',
          stateLabel: 'WAITING FOR DATA',
          message: 'Cannot analyse yet: ' + assignment.problems.join(' '),
          findings: [],
          source: 'screenshot'
        });
      }
      return;
    }

    var provider = getProvider();
    if (!provider) {
      // Honest state: there is no genuine image-analysis model in this environment.
      if (onDone) {
        onDone({
          status: 'unavailable',
          stateLabel: 'IMAGE ANALYSIS BACKEND NOT CONFIGURED',
          message: 'No image-analysis model or backend is connected, so no automated reading of these ' +
            'screenshots can be produced. Nothing was invented. Use the manual-analysis form below to record ' +
            'what you can see, or configure a vision backend (see the note below the form).',
          findings: [],
          source: 'screenshot',
          provider: null
        });
      }
      return;
    }

    // A configured provider must be disclosed and consented to before sending.
    if (!document.getElementById('shotConsent') || !document.getElementById('shotConsent').checked) {
      if (onDone) {
        onDone({
          status: 'consent-required',
          stateLabel: 'CONSENT REQUIRED',
          message: 'A configured analysis provider would receive your screenshots. Tick the consent box to allow it.',
          findings: [],
          source: 'screenshot'
        });
      }
      return;
    }

    busy = true;
    emit();
    var images = slots.map(function (s) {
      return { timeframe: s.key, name: s.name, file: s.file };
    });

    Promise.resolve(provider.analyse(images)).then(function (result) {
      busy = false;
      var findings = (result && result.findings) || [];
      if (!findings.length) {
        if (onDone) {
          onDone({
            status: 'empty', stateLabel: 'NO FINDINGS',
            message: 'The provider returned no findings. ' + (result && result.notes ? result.notes : ''),
            findings: [], source: 'screenshot', provider: provider.name
          });
        }
        emit();
        return;
      }
      // Normalise provider output to the shared finding contract.
      var normalised = findings.map(function (f) {
        return {
          concept: f.concept || 'Unclassified finding',
          timeframe: f.timeframe || 'unknown',
          zone: f.zone || null,
          rule: f.rule || 'Provided by the image-analysis provider.',
          evidence: f.evidence || '',
          confirmation: f.confirmation || 'tentative',
          invalidation: f.invalidation || null,
          source: 'screenshot'
        };
      });
      if (onDone) {
        onDone({
          status: 'ok', stateLabel: 'SNAPSHOT ANALYSIS',
          message: 'Provider "' + provider.name + '" returned ' + normalised.length + ' finding(s).',
          findings: normalised, source: 'screenshot', provider: provider.name
        });
      }
      emit();
    }).catch(function (err) {
      busy = false;
      if (onDone) {
        onDone({
          status: 'error', stateLabel: 'PROVIDER ERROR',
          message: 'The image-analysis provider failed: ' + (err && err.message ? err.message : 'unknown error') +
            '. No fallback result was invented.',
          findings: [], source: 'screenshot'
        });
      }
      emit();
    });
  }

  /* ---------------- manual-analysis fallback ---------------- */

  /**
   * Builds findings from what the user can actually see in the screenshots.
   * Every field is optional except the concept; unreadable prices stay empty,
   * so no precise level is ever invented.
   */
  function buildManualFindings(entries) {
    var findings = [];
    (entries || []).forEach(function (e) {
      (e.concepts || []).forEach(function (c) {
        var zone = null;
        if (e.zoneHigh && e.zoneLow && isFinite(Number(e.zoneHigh)) && isFinite(Number(e.zoneLow))) {
          zone = { high: Math.max(Number(e.zoneHigh), Number(e.zoneLow)), low: Math.min(Number(e.zoneHigh), Number(e.zoneLow)) };
        }
        findings.push({
          concept: CONCEPT_LABELS[c] || c,
          timeframe: e.timeframe || 'unknown',
          zone: zone,
          rule: 'Recorded manually from an uploaded screenshot.',
          evidence: (e.notes ? e.notes + ' ' : '') +
            (zone ? 'Approximate visible zone ' + zone.low + '-' + zone.high + '.' : 'Price scale was not readable, so no zone is recorded.'),
          confirmation: e.confirmed ? 'confirmed' : 'tentative',
          invalidation: e.invalidation || null,
          source: 'screenshot (manual)'
        });
      });
    });
    return findings;
  }

  function getState() {
    return {
      slots: slots,
      ready: ready(),
      assignments: checkAssignments(),
      provider: getProvider() ? getProvider().name : null,
      providerConfigured: !!getProvider(),
      busy: busy
    };
  }

  /* ---------------- UI wiring ---------------- */

  function render(host) {
    if (!host) { return; }
    var s = getState();
    var html = '';

    slots.forEach(function (slot, index) {
      html +=
        '<div class="shot-card' + (slot.status === 'error' ? ' shot-error' : '') + '">' +
          '<div class="shot-head">' +
            '<span class="mini-label">Screenshot ' + (index + 1) + '</span>' +
            '<label class="shot-tf">Timeframe ' +
              '<select data-shot-tf="' + index + '">' +
                ['H1', 'M15', 'M5'].map(function (tf) {
                  return '<option value="' + tf + '"' + (slot.key === tf ? ' selected' : '') + '>' + tf + '</option>';
                }).join('') +
              '</select>' +
            '</label>' +
          '</div>' +
          '<div class="shot-body">' +
            (slot.url
              ? '<img class="shot-preview" src="' + slot.url + '" alt="Preview of the ' + esc(slot.key) + ' screenshot, ' + esc(slot.name) + '">'
              : '<div class="shot-empty"><span class="mini-label">No image</span><p class="note">PNG, JPG or JPEG · up to 8 MB</p></div>') +
          '</div>' +
          '<div class="shot-meta">' +
            '<span class="mono shot-name">' + esc(slot.name || '—') + '</span>' +
            '<span class="mono shot-size">' + (slot.size ? (slot.size / 1024).toFixed(0) + ' KB' : '') + '</span>' +
          '</div>' +
          '<p class="note shot-note">' + esc(slot.note || '') + '</p>' +
          '<div class="shot-actions">' +
            '<label class="btn btn-line">' + (slot.file ? 'Replace' : 'Choose image') +
              '<input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" data-shot-file="' + index + '" hidden>' +
            '</label>' +
            (slot.file ? '<button type="button" class="btn btn-line" data-shot-remove="' + index + '">Remove</button>' : '') +
          '</div>' +
        '</div>';
    });

    html +=
      '<div class="shot-summary">' +
        '<p class="note">' + (s.assignments.ok
          ? 'All three timeframes are assigned exactly once. Review the previews above before analysing.'
          : esc(s.assignments.problems.join(' '))) + '</p>' +
        '<label class="row row-switch"><span class="mini-label">I consent to sending these screenshots to the configured analysis provider</span>' +
          '<input type="checkbox" id="shotConsent" class="switch-input"' + (s.providerConfigured ? '' : ' disabled') + '></label>' +
        '<p class="note">' + (s.providerConfigured
          ? 'Provider "' + esc(s.provider) + '" is configured. ' + esc((global.KP56ImageAnalysisProvider || {}).disclose || '')
          : 'No external provider is configured, so nothing will be transmitted. The consent switch is disabled.') + '</p>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-gold" id="shotAnalyseBtn"' + (s.ready && !s.busy ? '' : ' disabled') + '>Analyse screenshots</button>' +
          '<button type="button" class="btn btn-line" id="shotClearBtn">Clear all</button>' +
        '</div>' +
        '<p class="form-error" id="shotStatus" role="status">' +
          (s.providerConfigured ? 'Ready.' : 'IMAGE ANALYSIS BACKEND NOT CONFIGURED — upload and review work normally; automated reading is unavailable.') +
        '</p>' +
      '</div>';

    host.innerHTML = html;
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Binds the generated UI. Safe to call once. */
  function bind(host, onResult) {
    if (!host || host.getAttribute('data-shot-bound') === '1') { return; }
    host.setAttribute('data-shot-bound', '1');

    host.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute && t.hasAttribute('data-shot-file')) {
        var index = Number(t.getAttribute('data-shot-file'));
        assign(index, t.files && t.files[0]);
        render(host);
        bind(host, onResult);
      } else if (t.hasAttribute && t.hasAttribute('data-shot-tf')) {
        setTimeframe(Number(t.getAttribute('data-shot-tf')), t.value);
        render(host);
        bind(host, onResult);
      }
    });

    host.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.hasAttribute) { return; }
      if (t.hasAttribute('data-shot-remove')) {
        remove(Number(t.getAttribute('data-shot-remove')));
        render(host);
        bind(host, onResult);
      } else if (t.id === 'shotClearBtn') {
        slots.forEach(function (s, i) { remove(i); });
        render(host);
        bind(host, onResult);
      } else if (t.id === 'shotAnalyseBtn') {
        var statusEl = document.getElementById('shotStatus');
        if (statusEl) { statusEl.textContent = 'Checking screenshots…'; }
        analyse(function (report) {
          if (statusEl) {
            statusEl.textContent = report.stateLabel + ' — ' + report.message;
            statusEl.className = 'form-error' + (report.status === 'ok' ? ' is-ok' : '');
          }
          if (onResult) { onResult(report); }
        });
      }
    });
  }

  function init(hostId, onResult) {
    var host = document.getElementById(hostId || 'shotPanel');
    if (!host) { return null; }
    render(host);
    bind(host, onResult);
    onChange(function () { /* re-render happens explicitly to keep bindings stable */ });
    return {
      getState: getState,
      analyse: analyse,
      render: function () { render(host); bind(host, onResult); },
      buildManualFindings: buildManualFindings
    };
  }

  global.KP56Screenshots = {
    init: init,
    getState: getState,
    analyse: analyse,
    assign: assign,
    remove: remove,
    setTimeframe: setTimeframe,
    checkAssignments: checkAssignments,
    buildManualFindings: buildManualFindings,
    SMC_OPTIONS: SMC_OPTIONS,
    CONCEPT_LABELS: CONCEPT_LABELS,
    MAX_BYTES: MAX_BYTES,
    ALLOWED_TYPES: ALLOWED_TYPES
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KP56Screenshots; }

})(typeof window !== 'undefined' ? window : this);
