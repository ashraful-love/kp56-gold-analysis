#!/usr/bin/env python3
"""
KP56 Gold Analysis — MT5 backend (Phase 3, Part 6)
==================================================
Read-only bridge between the KP56 website and a MetaTrader 5 terminal.

WHAT IT DOES
------------
Serves XAUUSD market data from YOUR OWN MT5 terminal over HTTP so the static
website (which GitHub Pages hosts) can read real broker data.

WHAT IT DOES NOT DO
-------------------
* It never places, modifies or closes orders. There is no trading endpoint.
* It never exposes login, password or server names through the API.
* It never invents candles: missing or invalid data is reported, not filled.

REQUIREMENTS
------------
* Windows (or a Windows VM / VPS) with the MetaTrader 5 terminal installed.
* Python 3.8+ and the official package:  pip install MetaTrader5
* The terminal must be running and logged in to your broker account.

RUN
---
  set MT5_LOGIN=12345678
  set MT5_PASSWORD=your_password
  set MT5_SERVER=YourBroker-Live
  set MT5_SYMBOL=XAUUSD          & rem brokers vary: XAUUSDm, GOLD, ...
  set MT5_PATH=C:\\Program Files\\MetaTrader 5\\terminal64.exe   (optional)
  set ALLOWED_ORIGIN=https://your-username.github.io
  python mt5_server.py

ENVIRONMENT VARIABLES ONLY. Never paste credentials into a file that is
committed to GitHub, and never into the website's JavaScript.

API
---
GET /api/health                 -> { ok, terminal, symbol, serverTime }
GET /api/market/status          -> { mode, symbol, connected, serverTime, spread }
GET /api/market/price           -> { symbol, bid, ask, spread, time }
GET /api/market/candles         -> ?symbol=XAUUSD&timeframe=M15&limit=500
                                   { symbol, timeframe, count, candles, receivedAt }
GET /api/market/symbol-info     -> { symbol, point, tickValue, tickSize,
                                     contractSize, spread, ... }
"""

import json
import os
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:                     # documented, honest fallback
    mt5 = None
    MT5_AVAILABLE = False

PORT = int(os.environ.get("PORT", "8000"))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
SYMBOL_DEFAULT = os.environ.get("MT5_SYMBOL", "XAUUSD")
MAX_CANDLES = 500

TIMEFRAMES = {
    "M1": getattr(mt5, "TIMEFRAME_M1", 1) if MT5_AVAILABLE else 1,
    "M5": getattr(mt5, "TIMEFRAME_M5", 5) if MT5_AVAILABLE else 5,
    "M15": getattr(mt5, "TIMEFRAME_M15", 15) if MT5_AVAILABLE else 15,
    "H1": getattr(mt5, "TIMEFRAME_H1", 16385) if MT5_AVAILABLE else 16385,
}
TF_SECONDS = {"M1": 60, "M5": 300, "M15": 900, "H1": 3600}

_connected = False
_last_error = ""


# ----------------------------------------------------------------- helpers

def log(*args):
    print(datetime.now().strftime("%H:%M:%S"), *args, flush=True)


def ensure_terminal():
    """Initialise the terminal once. Returns (ok, message)."""
    global _connected, _last_error
    if not MT5_AVAILABLE:
        _last_error = "The MetaTrader5 Python package is not installed (pip install MetaTrader5)."
        return False, _last_error
    if _connected:
        return True, "connected"

    kwargs = {}
    path = os.environ.get("MT5_PATH")
    login = os.environ.get("MT5_LOGIN")
    password = os.environ.get("MT5_PASSWORD")
    server = os.environ.get("MT5_SERVER")
    if path:
        kwargs["path"] = path
    if login and password and server:
        kwargs["login"] = int(login)
        kwargs["password"] = password
        kwargs["server"] = server

    if not mt5.initialize(**kwargs):
        _last_error = "mt5.initialize() failed: " + str(mt5.last_error())
        return False, _last_error

    _connected = True
    _last_error = ""
    log("MT5 terminal initialised.")
    return True, "connected"


def validate_candles(rows, timeframe):
    """
    Data validation (Part 6): OHLC consistency, positive prices, ordering,
    duplicates, gaps and incomplete candles. Invalid rows are dropped and
    reported — NEVER invented.
    """
    step = TF_SECONDS.get(timeframe, 900) * 1000
    now_ms = int(time.time() * 1000)
    clean, issues = [], []
    prev = None
    for idx, r in enumerate(rows):
        t = int(r.get("time", 0)) * 1000
        o, h, l, c = r.get("open"), r.get("high"), r.get("low"), r.get("close")
        if not all(isinstance(v, (int, float)) for v in (o, h, l, c)):
            issues.append(f"row {idx}: non-numeric OHLC")
            continue
        if min(o, h, l, c) <= 0:
            issues.append(f"row {idx}: non-positive price")
            continue
        if h < l or h < max(o, c) or l > min(o, c):
            issues.append(f"row {idx}: inconsistent OHLC")
            continue
        if prev is not None:
            if t == prev:
                issues.append(f"row {idx}: duplicate timestamp")
                continue
            if t < prev:
                issues.append(f"row {idx}: out of order")
                continue
            if t - prev != step:
                issues.append(f"row {idx}: gap of {(t - prev) // 60000} minutes (missing candles not invented)")
        prev = t
        if t + step > now_ms:
            issues.append(f"row {idx}: incomplete candle excluded")
            continue
        clean.append({
            "time": t, "open": o, "high": h, "low": l, "close": c,
            "volume": r.get("tick_volume") or r.get("real_volume") or 0,
        })
    return clean[-MAX_CANDLES:], issues


# ----------------------------------------------------------------- handlers

class Handler(BaseHTTPRequestHandler):
    server_version = "KP56MT5/1.0"

    def _send(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        symbol = params.get("symbol", SYMBOL_DEFAULT)

        try:
            if parsed.path == "/api/health":
                ok, message = ensure_terminal()
                info = mt5.symbol_info(symbol) if (ok and MT5_AVAILABLE) else None
                self._send({
                    "ok": bool(ok and info is not None),
                    "terminal": "MetaTrader 5" if MT5_AVAILABLE else "package missing",
                    "symbol": symbol,
                    "visible": bool(info and info.visible) if info else False,
                    "serverTime": datetime.now(timezone.utc).isoformat(),
                    "message": message if ok else message,
                })
                return

            ok, message = ensure_terminal()
            if not ok:
                self._send({"error": message, "connected": False}, 503)
                return

            if parsed.path == "/api/market/status":
                tick = mt5.symbol_info_tick(symbol)
                info = mt5.symbol_info(symbol)
                self._send({
                    "mode": "MT5",
                    "symbol": symbol,
                    "connected": True,
                    "visible": bool(info and info.visible) if info else False,
                    "spread": getattr(info, "spread", None) if info else None,
                    "bid": getattr(tick, "bid", None) if tick else None,
                    "ask": getattr(tick, "ask", None) if tick else None,
                    "serverTime": datetime.now(timezone.utc).isoformat(),
                })
                return

            if parsed.path == "/api/market/price":
                tick = mt5.symbol_info_tick(symbol)
                if tick is None:
                    self._send({"error": "no tick for " + symbol}, 503)
                    return
                info = mt5.symbol_info(symbol)
                self._send({
                    "symbol": symbol,
                    "bid": tick.bid,
                    "ask": tick.ask,
                    "spread": getattr(info, "spread", None) if info else None,
                    "time": int(tick.time * 1000),
                })
                return

            if parsed.path == "/api/market/candles":
                tf = params.get("timeframe", "M15").upper()
                if tf not in TIMEFRAMES:
                    self._send({"error": "unknown timeframe " + tf}, 400)
                    return
                limit = min(int(params.get("limit", "500")), MAX_CANDLES)
                rows = mt5.copy_rates_from_pos(symbol, TIMEFRAMES[tf], 1, limit)
                if rows is None:
                    self._send({"error": "no candles returned: " + str(mt5.last_error())}, 503)
                    return
                raw = [dict(r) for r in rows]
                clean, issues = validate_candles(raw, tf)
                self._send({
                    "symbol": symbol,
                    "timeframe": tf,
                    "requested": limit,
                    "count": len(clean),
                    "dropped": len(raw) - len(clean),
                    "issues": issues[:20],
                    "candles": clean,
                    "receivedAt": datetime.now(timezone.utc).isoformat(),
                })
                return

            if parsed.path == "/api/market/symbol-info":
                info = mt5.symbol_info(symbol)
                if info is None:
                    self._send({"error": "unknown symbol " + symbol}, 404)
                    return
                self._send({
                    "symbol": info.name,
                    "point": info.point,
                    "digits": info.digits,
                    "tickValue": info.trade_tick_value,
                    "tickSize": info.trade_tick_size,
                    "contractSize": info.trade_contract_size,
                    "volumeMin": info.volume_min,
                    "volumeStep": info.volume_step,
                    "spread": info.spread,
                    "tradeMode": info.trade_mode,
                })
                return

            self._send({"error": "unknown endpoint " + parsed.path}, 404)

        except Exception as exc:            # never leak credentials in errors
            log("error:", exc)
            self._send({"error": str(exc), "connected": False}, 500)

    def log_message(self, fmt, *args):
        log("http:", fmt % args)


def main():
    if not MT5_AVAILABLE:
        log("WARNING: the MetaTrader5 package is not installed.")
        log("Install it with:  pip install MetaTrader5")
        log("The server will still start and report /api/health as not ok.")
    log(f"KP56 MT5 backend listening on http://localhost:{PORT}")
    log(f"CORS origin: {ALLOWED_ORIGIN}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
