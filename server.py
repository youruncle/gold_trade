from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import json
import time


ASSETS = {
    "gold": {"symbol": "GC=F", "name": "Gold futures", "source": "Yahoo Finance / COMEX"},
    "silver": {"symbol": "SI=F", "name": "Silver futures", "source": "Yahoo Finance / COMEX"},
    "platinum": {"symbol": "PL=F", "name": "Platinum futures", "source": "Yahoo Finance / NYMEX"},
    "palladium": {"symbol": "PA=F", "name": "Palladium futures", "source": "Yahoo Finance / NYMEX"},
}

MACRO_ASSETS = {
    "dxy": {"symbol": "DX-Y.NYB", "name": "美元指数", "source": "Yahoo Finance"},
    "tnx": {"symbol": "^TNX", "name": "美国10年期收益率", "source": "Yahoo Finance"},
    "gld": {"symbol": "GLD", "name": "GLD 黄金ETF", "source": "Yahoo Finance"},
    "slv": {"symbol": "SLV", "name": "SLV 白银ETF", "source": "Yahoo Finance"},
}

CACHE = {}
CACHE_TTL_SECONDS = 30
ROOT = Path(__file__).resolve().parent


class MarketHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/market/"):
            asset_key = parsed.path.rsplit("/", 1)[-1]
            self.handle_market(asset_key)
            return
        if parsed.path == "/api/macro":
            self.handle_macro()
            return
        super().do_GET()

    def handle_market(self, asset_key):
        if asset_key not in ASSETS:
            self.send_json({"error": "Unknown asset"}, 404)
            return

        cache_key = asset_key
        cached = CACHE.get(cache_key)
        if cached and time.time() - cached["time"] < CACHE_TTL_SECONDS:
            self.send_json(cached["payload"])
            return

        try:
            payload = fetch_yahoo(asset_key)
            CACHE[cache_key] = {"time": time.time(), "payload": payload}
            self.send_json(payload)
        except HTTPError as error:
            self.send_json({"error": f"Market provider returned HTTP {error.code}"}, 502)
        except (URLError, TimeoutError) as error:
            self.send_json({"error": f"Market provider unavailable: {error.reason if hasattr(error, 'reason') else error}"}, 502)
        except ValueError as error:
            self.send_json({"error": str(error)}, 502)

    def handle_macro(self):
        cached = CACHE.get("macro")
        if cached and time.time() - cached["time"] < CACHE_TTL_SECONDS:
            self.send_json(cached["payload"])
            return

        payload = {"items": [], "errors": {}}
        for key, asset in MACRO_ASSETS.items():
            try:
                symbol = asset["symbol"].replace("^", "%5E")
                chart = fetch_yahoo_chart(symbol, "1y", "1d")
                points = chart["points"]
                if len(points) < 20:
                    raise ValueError("Incomplete macro history")
                payload["items"].append({
                    "key": key,
                    "symbol": asset["symbol"],
                    "name": asset["name"],
                    "source": asset["source"],
                    "points": points,
                })
            except Exception as error:
                payload["errors"][key] = str(error)

        CACHE["macro"] = {"time": time.time(), "payload": payload}
        self.send_json(payload)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def fetch_yahoo(asset_key):
    asset = ASSETS[asset_key]
    symbol = asset["symbol"].replace("=", "%3D")
    daily = fetch_yahoo_chart(symbol, "5y", "1d")
    intraday = fetch_yahoo_chart(symbol, "1d", "5m")

    if len(daily["points"]) < 30:
        raise ValueError("Market provider returned incomplete daily history")

    meta = daily["meta"]
    return {
        "asset": asset_key,
        "symbol": asset["symbol"],
        "name": asset["name"],
        "source": asset["source"],
        "currency": meta.get("currency", "USD"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "regularMarketTime": meta.get("regularMarketTime"),
        "regularMarketPrice": meta.get("regularMarketPrice"),
        "points": daily["points"],
        "intradayPoints": intraday["points"],
    }


def fetch_yahoo_chart(symbol, range_value, interval):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range_value}&interval={interval}"
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json,text/plain,*/*",
        },
    )

    with urlopen(request, timeout=8) as response:
        data = json.loads(response.read().decode("utf-8"))

    result = (data.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise ValueError("Market provider returned no chart result")

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    points = []
    for index, (timestamp, close) in enumerate(zip(timestamps, closes)):
        if isinstance(close, (int, float)):
            open_price = opens[index] if index < len(opens) and isinstance(opens[index], (int, float)) else close
            high_price = highs[index] if index < len(highs) and isinstance(highs[index], (int, float)) else max(open_price, close)
            low_price = lows[index] if index < len(lows) and isinstance(lows[index], (int, float)) else min(open_price, close)
            volume = volumes[index] if index < len(volumes) and isinstance(volumes[index], (int, float)) else None
            points.append({
                "date": timestamp * 1000,
                "price": close,
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close,
                "volume": volume,
            })

    return {"meta": result.get("meta") or {}, "points": points}


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 4173), MarketHandler)
    print("Serving metals desk on http://localhost:4173")
    server.serve_forever()
