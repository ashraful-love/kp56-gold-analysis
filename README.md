# KP56 Gold Analysis — XAUUSD dashboard (Phase 3, final integration)

A mobile-first **XAUUSD (gold) analysis dashboard** that runs as a static website.
Plain HTML, CSS and vanilla JavaScript — no build step, no Node.js, no framework —
so it can be published for free with **GitHub Pages** and edited from an Android phone.

> **IMPORTANT — this is still a DEMO interface.**
> Every price, candle, indicator value, signal and history record is **synthetic
> demonstration data** generated inside your browser. It is **not** live XAUUSD data,
> **not** financial advice, and it does **not** guarantee profitable trades.
> The website never places an order and never sends a notification.

---

## 0. What Phase 3 added (final integration)

**Three analysis modes, one website.** The mode switch is at the top of the dashboard and
the active source is always visible in the status banner and the header chip.

| Mode | Source | Status shown | Notes |
|---|---|---|---|
| **A · MT5 live** | Your own MT5 broker via `backend/mt5_server.py` | `LIVE` / `STALE` / `OFFLINE` / `NOT CONNECTED` | Requires a Windows machine (or VPS) with the MT5 terminal. |
| **B · Screenshots** | Three uploaded charts: H1, M15, M5 | `SNAPSHOT ANALYSIS` | Findings are what you can actually see; never presented as live prices. |
| **C · Demo** | Deterministic synthetic candles | `DEMO` | The default. Nothing here is a real market price. |

**Three-screenshot analysis.** Upload PNG/JPG/JPEG images (8 MB limit), assign each to a
unique timeframe, review the previews, then analyse. Because this environment has **no
vision model and no backend**, the panel reports **IMAGE ANALYSIS BACKEND NOT CONFIGURED**
and invents nothing. A manual-analysis fallback records only what you can see, in the same
finding format the candle engine uses. To enable genuine automated reading later, implement
`window.KP56ImageAnalysisProvider` (contract documented in `screenshot-analyser.js`) and get
explicit consent before any image is transmitted. **No screenshot ever leaves your browser
in this phase.**

**Full SMC engine (`smc-engine.js`).** One engine, used by the Test 2 checker and the SMC map:
market structure (swings, HH/HL, LH/LL, BOS, CHoCH, internal vs swing structure, strong/weak
swing points, structure-shift candidates), liquidity (BSL, SSL, EQH, EQL, pools, sweeps,
sweep-and-reclaim, inducement, previous session/day/week levels from timestamps), fair value
gaps (boundaries, size, partial/full mitigation, invalidation, overlapping imbalances),
order blocks (candidate discipline, displacement + structure-break confirmation, mitigation,
breaker blocks), premium/discount (dealing range + equilibrium, or "unavailable" with a
reason), displacement and rejection, and advanced modules (mitigation blocks, rejection
blocks, balanced price ranges, session liquidity, Judas-swing candidates, internal/external
range liquidity) — each marked **confirmed**, **tentative**, or **unavailable**, with its
detection rule, evidence, price zone and invalidation. Nothing here claims to read
institutional orders.

**Multi-timeframe report.** Six explicit questions answered every refresh: H1 bias, M15
agreement, zones per timeframe, M5 entry confirmation, conflicts with higher timeframes and
what is still missing. A single bullish timeframe is never enough for a signal.

**MT5 backend (`backend/mt5_server.py`).** Read-only Python bridge using the official
`MetaTrader5` package: `/api/health`, `/api/market/status`, `/api/market/price`,
`/api/market/candles`, `/api/market/symbol-info`. It validates OHLC consistency, ordering,
duplicates, gaps and incomplete candles server-side, never invents missing candles, never
places an order, and never returns credentials. Symbol names differ between brokers
(`XAUUSD`, `XAUUSDm`, `GOLD`) — configure `MT5_SYMBOL` and the site reports whatever the
broker actually uses. Credentials live only in environment variables on that machine.

### Setting up the backend (needs Windows + MT5)

```
cd backend
pip install -r requirements.txt
set MT5_LOGIN=your_account_number
set MT5_PASSWORD=your_password
set MT5_SERVER=YourBroker-Live
set MT5_SYMBOL=XAUUSD
set ALLOWED_ORIGIN=https://your-username.github.io
python mt5_server.py
```

Then in the dashboard choose **A · MT5 live** and enter the backend address
(e.g. `http://localhost:8000`, or `https://your-vps.example.com`).

**What you can prepare from Android:** every frontend file, the README, the repository,
GitHub Pages settings, and reading the API documentation. **What needs a running Windows
environment:** installing MT5, `pip install MetaTrader5`, running `mt5_server.py`, and
keeping it online. GitHub Pages cannot run it, and no free host guarantees continuous
operation — so expect `OFFLINE` / `NOT CONNECTED` whenever that machine is not running.
The site then shows **no price at all** rather than a stale or invented one.

### Data statuses used anywhere in the site

`LIVE` · `DEMO` · `SNAPSHOT ANALYSIS` · `STALE` · `OFFLINE` · `NOT CONNECTED` ·
`IMAGE ANALYSIS BACKEND NOT CONFIGURED`. An HTTP 200 alone is never treated as proof:
freshness, candle counts and OHLC consistency are checked, stale data is marked `STALE`,
and any `STALE` / `OFFLINE` / `NOT CONNECTED` state blocks signals.

## 1. What Phase 2 added

Phase 1 built the interface. Phase 2 built the **analysis behind it**:

* **Candle data validation** — every candle is checked (timestamps, positive finite
  OHLC, high/low consistency, duplicates, ordering, gaps, unfinished candles) before
  anything is analysed. Invalid candles are dropped and reported, never invented.
* **Indicator module** — EMA, RSI, ADX (+DI/−DI), ATR, swings, support/resistance,
  candle body/wick maths and volatility measures, with documented formulas and
  periods. Insufficient history returns `null` instead of a misleading number.
* **Test 1 — Trend checker**: EMA trend, swing structure, HH/HL and LH/LL, BOS/CHoCH,
  and M15/H1 agreement. Conflicting timeframes never produce a direction.
* **Test 2 — SMC checker**: liquidity sweeps (with explicit confirmation rules),
  fair value gaps, BOS/CHoCH, candidate order blocks, support/resistance and
  candle-close confirmation. A sweep alone never triggers a trade, and the code
  never claims candles can reveal institutional order flow.
* **Test 3 — Entry quality checker**: RSI, ADX, ATR volatility, spread, candle close,
  data freshness and indicator availability, all driven by **your saved settings**.
  An unavailable spread is reported as unavailable — it is never fabricated.
* **Test 4 — Risk & forecast validator**: directionally correct geometry
  (BUY stop below entry, SELL stop above entry, TP2 beyond TP1), minimum risk/reward
  (1:2 by default), forecast status, duplicate-signal protection and setup
  invalidation.
* **Central signal engine** — one function decides BUY / SELL / NO TRADE /
  WAITING FOR DATA from the four test results, records every reason, suppresses
  duplicates, and **never** produces a signal from demo data.
* **Settings dialog** with real Save / Close / Reset behaviour and browser storage.
* **Automated tests** — 20 deterministic tests in `tests.html`.

## 2. File structure

| File | What it does |
|---|---|
| `index.html` | Page structure, dashboard sections and the settings dialog. |
| `styles.css` | All styling, dark and light theme, responsive layout, dialog. |
| `app.js` | Orchestrator: data loading, validation, rendering, all controls. |
| `chart.js` | Hand-drawn canvas candlestick chart. No chart library. |
| `data-provider.js` | Data adapter (`getLatestPrice`, `getCandles`, `getDataStatus`, `getLastUpdateTime`). |
| `candle-validator.js` | **New.** Validates OHLC records before analysis. |
| `indicators.js` | **Rewritten.** EMA, RSI, ADX, ATR, swings, S/R, body/wick, volatility. |
| `trend-checker.js` | **Rewritten.** Test 1 — transparent rule-by-rule trend evaluation. |
| `smc-checker.js` | **Rewritten.** Test 2 — smart-money concepts with explicit definitions. |
| `entry-checker.js` | **Rewritten.** Test 3 — entry quality using your settings. |
| `risk-forecast.js` | **Rewritten.** Test 4 + risk calculator maths + forecast placeholder. |
| `signal-engine.js` | **New.** The single final-decision function. |
| `settings.js` | **Rewritten.** Settings validation and browser storage. |
| `tests.js` | **New.** 20 deterministic automated tests. |
| `tests.html` | **New.** Test runner page (open it in any browser). |
| `README.md` | This file. |

Script load order (already correct at the bottom of `index.html`):
`data-provider → candle-validator → indicators → chart → trend → smc → entry →
risk-forecast → signal-engine → settings → app`.

## 3. External assets and licences

There is **no JavaScript library** in this project, so no CDN can break your charts.

| Asset | Source | Licence | If it is unavailable |
|---|---|---|---|
| Fonts: *Bodoni Moda*, *IBM Plex Sans*, *IBM Plex Mono* | Google Fonts | SIL Open Font License | Falls back to Georgia / system sans / system mono. Layout and function unchanged. |
| Hero photograph | Pexels | Pexels Licence (free to use) | The `onerror` handler removes the image; the gold gradient remains. |

## 4. The Settings dialog — how it behaves

| Action | Behaviour |
|---|---|
| **Open settings** | Shows the **last successfully saved** values. |
| **Save settings** | Validates first. Invalid values show a visible error and the dialog stays open. Valid values are saved to the browser, applied to the dashboard, then the dialog closes with a confirmation message. |
| **Close (×) / Close without saving** | Discards unsaved edits. Re-opening shows the last saved values again. |
| **Reset to defaults** | Loads the documented defaults into the form and says so. Nothing is saved until you press **Save settings**. |
| **Storage fails** (private mode) | Settings still work for the session, and a clear notice explains that they cannot be stored. |

Only display preferences are stored. **No API key, password or Telegram bot token is
ever stored in the browser.**

---

## 5. Work on the site from an Android phone

### Create the repository
1. Install the **GitHub** app (or use `github.com` in your browser) and sign in.
2. Tap **+** → **New repository**, name it e.g. `kp56-gold-analysis`, set it **Public**,
   tick **Add a README file**, then **Create repository**.

### Add or replace a file
1. Open the repository → tap **Add file** → **Create new file** (or open an existing
   file and tap the pencil icon to edit).
2. Type the exact file name in the **root** folder (for example `app.js`).
3. Paste the complete new content, replacing everything that was there.
4. Tap **Commit changes** and write a short note, e.g. `update app.js (Phase 2)`.

> File names are case sensitive. Keep them in the root folder, or GitHub Pages will
> not find them.

### Publish (GitHub Pages)
1. In a browser open the repository → **Settings** → **Pages**.
2. **Deploy from a branch** → branch `main` → folder **`/ (root)`** → **Save**.
3. After 1–3 minutes your site appears at
   `https://your-username.github.io/kp56-gold-analysis/`.
4. The test runner is at `.../kp56-gold-analysis/tests.html`.

### Test a change on the phone
1. Open your site, then open `tests.html` and tap **Run all tests** — every test
   should read **PASS** (a couple may read **SKIPPED** if your browser blocks the
   test frame; that is expected and stated).
2. Check the dashboard: the header chip must say **DEMO**, the telegram chip
   **TG · NOT CONNECTED**, and the signal must read **WAITING FOR DATA** or
   **NO TRADE**.

### Revert a bad commit (no laptop needed)
1. Open the repository in a browser → **Commits**.
2. Tap the commit that broke something → tap **Browse files** at that commit.
3. Open the broken file, copy its old content, then go back to the latest version,
   tap the pencil icon, paste the old content and commit.
4. Alternatively: **Settings → Pages** can be disabled and re-enabled to force a
   fresh publish if the site looks cached.

---

## 6. How to tell DEMO data from live data

| Where to look | Phase 2 value |
|---|---|
| Header chip | **DEMO** (never LIVE) |
| Telegram chip | **TG · NOT CONNECTED** |
| Chart watermark | `DEMO · SYNTHETIC CANDLES` |
| Chart level labels | suffixed `(demo)` |
| Overview price note | `SYNTHETIC SAMPLE · NOT A LIVE QUOTE` |
| Data-quality line | how many candles were validated, dropped or missing |
| Forecast badge | **FORECAST NOT AVAILABLE** |
| Final signal | **WAITING FOR DATA** or **NO TRADE**, with a **BLOCKED** stamp |
| Signal fields | `DEMO EXAMPLE - NOT A RECOMMENDATION` |

**Rule:** if a value is not accompanied by a provider status of `LIVE`, treat it as an
illustration. The mock provider reports `DEMO` permanently — enforced in code.

---

## 7. What works now

* Deterministic synthetic candles (M5/M15/H1), validated before use.
* Candlestick chart with historical vs hypothetical candles, volume, S/R and a
  clearly labelled demo trade-plan overlay.
* Four real validation tests with rule-by-rule output, reasons and missing items.
* A central signal engine with blocked reasons, duplicate suppression and no
  probability claims.
* Risk calculator with directionally correct geometry and withheld lot sizes until
  broker specifications are entered.
* Settings dialog with validated save, safe reset, and browser persistence.
* 20 automated tests with deterministic fixtures.

## 8. What needs a later phase

* Live MT5 / broker data, real spread and real data freshness.
* A validated probabilistic 50-candle forecast **with backtesting** (until then the
  panel reads FORECAST NOT AVAILABLE and the risk validator keeps the signal blocked).
* Telegram message delivery from a server.
* Durable signal history storage.
* Automated trading — **not planned at all**.

## 9. Why MT5 and Telegram need a backend

A browser cannot hold a MetaTrader 5 connection, and a Telegram bot token must never
live in a file your visitors can read. A small always-on service (a PC, a VPS or a
free cloud tier) has to read the terminal, keep the token in an environment variable
and send messages. GitHub Pages hosts static files only. Cooldowns, duplicate
protection and delivery logs are also only trustworthy on a machine that keeps running
when your phone is off.

## 10. Why secrets must never be published

A repository is readable by anyone (if public) and the page source is readable by every
visitor even when the repository is private. Never commit Telegram bot tokens, broker
API keys, account numbers or passwords — and never put them in browser storage. If a
secret is ever committed, revoke it immediately: deleting the file is not enough
because it stays in the commit history.

---

## 11. Test plan (Task 12)

| # | Test | Where |
|---|---|---|
| 1 | Settings save and dialog close | `tests.html` (real dialog in a frame) |
| 2 | Settings persist after reload | `tests.js` |
| 3 | Invalid settings rejected | `tests.js` |
| 4 | Reset to defaults does not persist early | `tests.js` |
| 5–7 | EMA / RSI / ADX / ATR calculations | `tests.js` (hand-computed cases) |
| 8–10 | Bullish, bearish and conflicting trend examples | `tests.js` |
| 11–12 | Liquidity sweep and incomplete SMC setup | `tests.js` |
| 13 | Unavailable spread and stale data | `tests.js` |
| 14–16 | BUY / SELL / invalid risk geometry | `tests.js` |
| 17 | Missing and invalid candle data | `tests.js` |
| 18 | Duplicate-signal prevention | `tests.js` |
| 19 | Demo data never produces a notification | `tests.js` |
| 20 | Mandatory FAIL or WAITING always blocks | `tests.js` |

Tests that cannot run in a given browser are reported as **SKIPPED** with a reason.
They are never counted as passing.

## 12. Disclaimer

Analysis shown by this tool is informational only. It is not financial advice, it does
not guarantee profitable trades, and it never executes an order. Trading gold with
leverage carries a substantial risk of loss. You are responsible for your own decisions.
