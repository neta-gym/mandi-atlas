"""data.gov.in - "Current Daily Price of Various Commodities from Various Markets (Mandi)".

Resource : 9ef84268-d588-465a-a308-a864a43d0070  (Agmarknet feed, refreshed daily)
Needs    : a free API key from https://data.gov.in (set DATA_GOV_IN_API_KEY)
           and a network path the portal accepts (it refuses many non-Indian IPs; run it
           from India or from a self-hosted GitHub Actions runner in India).

Writes site/data/ogd/<slug>.json:
  date, national_modal (simple mean of market modal prices, Rs/quintal, comparable to CEDA),
  markets: [{state, district, market, variety, min, max, modal}], by_state: {state: mean modal}
When present, build_analytics.py uses national_modal as today's anchor for the
mean-reversion forecast.
"""
import datetime as dt
import json
import os
import statistics
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COMMODITIES, DATA_DIR, UA, write_json  # noqa: E402

RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070"
BASE = f"https://api.data.gov.in/resource/{RESOURCE}"


def fetch_all(key, commodity):
    rows, offset, limit = [], 0, 1000
    while True:
        q = urllib.parse.urlencode({"api-key": key, "format": "json", "limit": limit, "offset": offset,
                                    "filters[commodity]": commodity})
        req = urllib.request.Request(f"{BASE}?{q}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read().decode())
        recs = d.get("records", [])
        rows += recs
        if len(recs) < limit:
            return rows
        offset += limit


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    key = os.environ.get("DATA_GOV_IN_API_KEY")
    if not key:
        raise SystemExit("Set DATA_GOV_IN_API_KEY (free at https://data.gov.in -> My Account -> Generate key)")
    for slug, names in COMMODITIES.items():
        try:
            recs = fetch_all(key, names["ogd"])
        except Exception as e:  # geo-block or outage: keep yesterday's file
            print(f"{slug}: {e}")
            continue
        if not recs:
            print(f"{slug}: no records today")
            continue
        g = lambda r, k: r.get(k) or r.get(k.capitalize()) or r.get(k.title())  # noqa: E731
        markets = []
        for r in recs:
            modal = num(g(r, "modal_price"))
            if not modal:
                continue
            markets.append({"state": g(r, "state"), "district": g(r, "district"), "market": g(r, "market"),
                            "variety": g(r, "variety"), "min": num(g(r, "min_price")),
                            "max": num(g(r, "max_price")), "modal": modal, "date": g(r, "arrival_date")})
        dates = sorted({m["date"] for m in markets if m["date"]},
                       key=lambda s: dt.datetime.strptime(s, "%d/%m/%Y"))
        latest = dates[-1] if dates else None
        today_rows = [m for m in markets if m["date"] == latest]
        by_state = {}
        for m in today_rows:
            by_state.setdefault(m["state"], []).append(m["modal"])
        out = {
            "source": f"https://data.gov.in/resource/{RESOURCE}",
            "date": dt.datetime.strptime(latest, "%d/%m/%Y").date().isoformat() if latest else None,
            "national_modal": round(statistics.mean(m["modal"] for m in today_rows), 1) if today_rows else None,
            "n_markets": len(today_rows),
            "by_state": {s: round(statistics.mean(v), 1) for s, v in sorted(by_state.items())},
            "markets": sorted(today_rows, key=lambda m: (m["state"] or "", m["market"] or "")),
        }
        write_json(os.path.join(DATA_DIR, "ogd", f"{slug}.json"), out)
        print(f"{slug}: {out['n_markets']} markets on {out['date']}, national modal {out['national_modal']}")


if __name__ == "__main__":
    main()
