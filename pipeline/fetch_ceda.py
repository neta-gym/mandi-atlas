"""CEDA (Ashoka University) Agri-Market Data - cleaned Agmarknet mandi prices & arrivals.

Portal: https://agmarknet.ceda.ashoka.edu.in/   (data: Agmarknet, DMI, MoA&FW)
JSON API used by the portal itself:
  POST /api/prices      {state_id, commodity_id, district_id, calculation_type: d|m|y,
                         start_date, end_date, [chart_type: "map"]}
  POST /api/quantities  same body; returns arrivals in tonnes
State/district ids follow Census 2011.

For every commodity this writes site/data/ceda/<slug>.json with:
  national_monthly : [{t, min, max, modal, qty}]  (Rs/quintal, tonnes)
  national_daily   : last ~120 days available
  state_monthly    : {state: [{t, modal}]} for the top arrival states
  state_arrivals   : {year: {state: tonnes}}
  district_arrivals: top districts (mandi hubs) by arrivals, latest full year
  state_price_year : {state: modal Rs/qtl} for latest year
Usage: python3 pipeline/fetch_ceda.py [--only onion,tomato]
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA_DIR, RAW_DIR, UA, write_json  # noqa: E402

BASE = "https://agmarknet.ceda.ashoka.edu.in/api/"
IDS = {
    "onion": 23, "tomato": 78, "potato": 24, "brinjal": 35, "cauliflower": 34,
    "green-chilli": 87, "banana": 19, "mango": 20, "apple": 17, "grapes": 22,
}


def post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={"User-Agent": UA, "Content-Type": "application/json"}, method="POST")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode()).get("data", [])
        except Exception as e:
            if attempt == 2:
                print(f"  ! {path} {body}: {e}")
                return []
            time.sleep(3 * (attempt + 1))
    return []


def body(cid, calc, start, end, state=0, chart=None):
    b = {"state_id": state, "commodity_id": cid, "district_id": 0,
         "calculation_type": calc, "start_date": start, "end_date": end}
    if chart:
        b["chart_type"] = chart
    return b


def r1(x):
    return None if x is None else round(float(x), 1)


def fetch(slug, cid, today):
    end = today.isoformat()
    out = {"commodity_id": cid, "source": "https://agmarknet.ceda.ashoka.edu.in/",
           "units": {"price": "Rs/quintal", "qty": "tonnes"}}

    prices = post("prices", body(cid, "m", "2008-01-01", end))
    qty = post("quantities", body(cid, "m", "2008-01-01", end))
    qmap = {q["t"]: q["qty"] for q in qty}
    nm = sorted(({"t": p["t"], "min": r1(p["p_min"]), "max": r1(p["p_max"]), "modal": r1(p["p_modal"]),
                  "qty": r1(qmap.get(p["t"]))} for p in prices), key=lambda x: x["t"])
    out["national_monthly"] = nm
    last = nm[-1]["t"] if nm else end[:7]
    out["last_month"] = last

    # daily for the last ~120 days of available data
    ly, lm = map(int, last.split("-"))
    last_day = (dt.date(ly + (lm == 12), lm % 12 + 1, 1) - dt.timedelta(days=1))
    d0 = (last_day - dt.timedelta(days=120)).isoformat()
    daily = post("prices", body(cid, "d", d0, last_day.isoformat()))
    dq = {q["t"]: q["qty"] for q in post("quantities", body(cid, "d", d0, last_day.isoformat()))}
    out["national_daily"] = sorted(({"t": p["t"], "modal": r1(p["p_modal"]), "min": r1(p["p_min"]),
                                     "max": r1(p["p_max"]), "qty": r1(dq.get(p["t"]))} for p in daily),
                                   key=lambda x: x["t"])

    # district-level arrivals per year -> state shares and top mandi districts
    years = [ly - 2, ly - 1, ly]
    state_arr = {}
    dist_latest = []
    for y in years:
        rows = post("quantities", body(cid, "y", f"{y}-01-01", f"{y}-12-31", chart="map"))
        agg = defaultdict(float)
        for r in rows:
            agg[r.get("state") or "?"] += r.get("qty") or 0
        state_arr[str(y)] = {k: round(v) for k, v in sorted(agg.items(), key=lambda kv: -kv[1])}
        if y == ly - 1:  # latest full calendar year
            dist_latest = sorted(({"district": r["district"], "state": r["state"], "qty": round(r["qty"] or 0)}
                                  for r in rows), key=lambda x: -x["qty"])[:25]
        time.sleep(0.5)
    out["state_arrivals"] = state_arr
    out["district_arrivals"] = {"year": ly - 1, "rows": dist_latest}

    # state-level price (district rows averaged, weighted equally) for the latest full year
    prow = post("prices", body(cid, "y", f"{ly - 1}-01-01", f"{ly - 1}-12-31", chart="map"))
    sp = defaultdict(list)
    for r in prow:
        if r.get("p_modal"):
            sp[r.get("state") or "?"].append(r["p_modal"])
    out["state_price_year"] = {"year": ly - 1, "modal": {k: r1(sum(v) / len(v)) for k, v in sp.items()}}
    out["district_price_year"] = sorted(({"district": r["district"], "state": r["state"], "modal": r1(r["p_modal"])}
                                         for r in prow if r.get("p_modal")), key=lambda x: -x["modal"])

    # monthly price series for the 6 biggest arrival states
    top_states = list(state_arr.get(str(ly - 1), {}).keys())[:6]
    states = json.load(open(os.path.join(RAW_DIR, "ceda", "states.json")))
    sid = {s["census_state_name"]: s["census_state_id"] for s in states}
    sm = {}
    for st in top_states:
        if st not in sid:
            continue
        rows = post("prices", body(cid, "m", "2015-01-01", end, state=sid[st]))
        sm[st] = sorted(({"t": r["t"], "modal": r1(r["p_modal"])} for r in rows), key=lambda x: x["t"])
        time.sleep(0.5)
    out["state_monthly"] = sm
    out["fetched"] = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    slugs = [x for x in a.only.split(",") if x] or list(IDS)
    os.makedirs(os.path.join(RAW_DIR, "ceda"), exist_ok=True)
    req = urllib.request.Request(BASE + "states", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        json.dump(json.loads(r.read().decode())["data"], open(os.path.join(RAW_DIR, "ceda", "states.json"), "w"))
    today = dt.date.today()
    for slug in slugs:
        print(f"CEDA {slug}")
        out = fetch(slug, IDS[slug], today)
        print(f"  monthly {len(out['national_monthly'])} pts, last {out['last_month']}, "
              f"daily {len(out['national_daily'])}, states {list(out['state_monthly'])}")
        write_json(os.path.join(DATA_DIR, "ceda", f"{slug}.json"), out)


if __name__ == "__main__":
    main()
