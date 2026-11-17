"""Seasonality, volatility, shock history and price outlook for each commodity.

Inputs  : site/data/ceda/<slug>.json      (national monthly modal price + arrivals, 2008-)
          site/data/nhb/<slug>.json       (optional: centre wholesale vs retail -> mark-ups)
          site/data/ogd/<slug>.json       (optional: today's national mandi modal from data.gov.in)
          site/data/doca/daily.json       (optional: today's all-India retail price)
Output  : site/data/analytics/<slug>.json

Models (all on log prices, monthly):
  * Seasonal index  - ratio of price to a centred 12-month moving average, median by calendar month.
  * Analog outlook  - for the current calendar month, the distribution across past years of the
                      price change h = 1..6 months ahead (median, 10th and 90th percentile).
  * Mean-reversion  - price = trend x season x shock, where the shock decays as AR(1): phi^h.
                      Used when a current mandi price is available (data.gov.in feed).
  * Backtest        - rolling origin over the last 8 years vs persistence and seasonal-naive.
Run: python3 pipeline/build_analytics.py
"""
import datetime as dt
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COMMODITIES, DATA_DIR, read_json, write_json  # noqa: E402

H = 6
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def month_index(t):
    y, m = map(int, t.split("-")[:2])
    return y * 12 + (m - 1)


def from_index(i):
    return f"{i // 12}-{i % 12 + 1:02d}"


def series(rows, key):
    pts = {month_index(r["t"]): r[key] for r in rows if r.get(key)}
    if not pts:
        return None, None
    i0, i1 = min(pts), max(pts)
    arr = np.full(i1 - i0 + 1, np.nan)
    for i, v in pts.items():
        arr[i - i0] = v
    return i0, arr


def centred_ma12(x):
    out = np.full_like(x, np.nan)
    for i in range(6, len(x) - 6):
        w = x[i - 6:i + 7]
        if np.isnan(w).any():
            continue
        out[i] = (0.5 * w[0] + w[1:12].sum() + 0.5 * w[12]) / 12
    return out


def seasonal_index(i0, x):
    ma = centred_ma12(x)
    ratio = x / ma
    by_m = [[] for _ in range(12)]
    for k, r in enumerate(ratio):
        if not np.isnan(r):
            by_m[(i0 + k) % 12].append(r)
    med = np.array([np.median(b) if b else np.nan for b in by_m])
    norm = np.nanmean(med)
    rows = []
    for m in range(12):
        b = np.array(by_m[m]) / norm if by_m[m] else np.array([np.nan])
        rows.append({"m": m + 1, "med": round(float(np.median(b)) * 100, 1),
                     "p25": round(float(np.percentile(b, 25)) * 100, 1),
                     "p75": round(float(np.percentile(b, 75)) * 100, 1), "n": len(by_m[m])})
    return rows, med / norm


def fit_model(i0, x, upto=None):
    """Fit season + linear trend + AR(1) shock on log price using data up to index `upto`."""
    n = len(x) if upto is None else upto + 1
    xs = x[:n]
    _, si = seasonal_index(i0, xs)
    if np.isnan(si).any():
        return None
    logp = np.log(xs)
    s = np.array([math.log(si[(i0 + k) % 12]) for k in range(n)])
    y = logp - s
    ok = ~np.isnan(y)
    tt = np.arange(n)
    # trend on the most recent 8 years only (structural level shifts are common)
    recent = ok & (tt >= n - 96)
    b, a = np.polyfit(tt[recent], y[recent], 1)
    d = y - (a + b * tt)
    pairs = [(d[k - 1], d[k]) for k in range(1, n) if not np.isnan(d[k]) and not np.isnan(d[k - 1])]
    d0, d1 = np.array(pairs).T
    phi = float(np.clip((d0 * d1).sum() / (d0 * d0).sum(), 0, 0.99))
    return {"si": si, "a": a, "b": b, "phi": phi, "d": d, "sigma": float(np.nanstd(d1 - phi * d0))}


def model_forecast(i0, mdl, origin_k, origin_logp, h):
    m_origin = (i0 + origin_k) % 12
    d_now = origin_logp - math.log(mdl["si"][m_origin]) - (mdl["a"] + mdl["b"] * origin_k)
    k = origin_k + h
    return math.exp(mdl["a"] + mdl["b"] * k + (mdl["phi"] ** h) * d_now + math.log(mdl["si"][(i0 + k) % 12]))


def analog_changes(i0, x, start_m, h, before_k=None):
    """log changes from calendar month start_m to h months later, across all years."""
    out = []
    for k in range(len(x) - h):
        if (i0 + k) % 12 != start_m:
            continue
        if before_k is not None and k + h > before_k:
            continue
        a, b = x[k], x[k + h]
        if not (np.isnan(a) or np.isnan(b)):
            out.append(math.log(b / a))
    return out


def backtest(i0, x):
    n = len(x)
    origins = [k for k in range(max(60, n - 96), n - 1)]
    err = {"analog": [[] for _ in range(H)], "model": [[] for _ in range(H)],
           "persistence": [[] for _ in range(H)], "seasonal_naive": [[] for _ in range(H)]}
    hits = [[] for _ in range(H)]
    for k in origins:
        if np.isnan(x[k]):
            continue
        mdl = fit_model(i0, x, upto=k)
        for h in range(1, H + 1):
            if k + h >= n or np.isnan(x[k + h]):
                continue
            actual = x[k + h]
            ch = analog_changes(i0, x, (i0 + k) % 12, h, before_k=k)
            if len(ch) >= 4:
                f = x[k] * math.exp(float(np.median(ch)))
                err["analog"][h - 1].append(abs(f / actual - 1))
                hits[h - 1].append((f > x[k]) == (actual > x[k]))
            if mdl:
                f = model_forecast(i0, mdl, k, math.log(x[k]), h)
                err["model"][h - 1].append(abs(f / actual - 1))
            err["persistence"][h - 1].append(abs(x[k] / actual - 1))
            if k + h - 12 >= 0 and not np.isnan(x[k + h - 12]):
                err["seasonal_naive"][h - 1].append(abs(x[k + h - 12] / actual - 1))
    mape = {m: [round(float(np.mean(e)) * 100, 1) if e else None for e in v] for m, v in err.items()}
    return {"origins": len(origins), "from": from_index(i0 + origins[0]), "to": from_index(i0 + origins[-1]),
            "mape": mape, "direction_hit": [round(float(np.mean(h)) * 100) if h else None for h in hits]}


def shocks(i0, x, mdl, top=6):
    d = mdl["d"]
    idx = [k for k in range(len(d)) if not np.isnan(d[k])]
    hi = sorted(idx, key=lambda k: -d[k])
    lo = sorted(idx, key=lambda k: d[k])

    def pick(order):
        chosen = []
        for k in order:
            if all(abs(k - c) > 6 for c in chosen):
                chosen.append(k)
            if len(chosen) == top:
                break
        return [{"t": from_index(i0 + k), "pct_vs_normal": round((math.exp(d[k]) - 1) * 100),
                 "price": round(float(x[k]))} for k in chosen]
    return pick(hi), pick(lo)


def nhb_markups(nhb):
    out = []
    for centre, months in (nhb or {}).get("centres", {}).items():
        ratios = [v["rp"] / v["wp"] for t, v in months.items()
                  if v.get("rp") and v.get("wp") and v["wp"] > 0 and t >= "2015" and 1 < v["rp"] / v["wp"] < 6]
        if len(ratios) >= 12:
            last = sorted(months)[-1]
            out.append({"centre": centre, "markup": round(float(np.median(ratios)), 2), "n": len(ratios),
                        "last": last})
    return sorted(out, key=lambda r: -r["n"])[:12]


def build(slug, today):
    ceda = read_json(os.path.join(DATA_DIR, "ceda", f"{slug}.json"))
    if not ceda:
        return None
    nm = ceda["national_monthly"]
    i0, x = series(nm, "modal")
    j0, q = series(nm, "qty")
    sp, _ = seasonal_index(i0, x)
    sq, _ = seasonal_index(j0, q) if q is not None else (None, None)
    mdl = fit_model(i0, x)
    meds = [r["med"] for r in sp]
    cheap, dear = int(np.argmin(meds)), int(np.argmax(meds))

    lr = np.diff(np.log(x))
    lr = lr[~np.isnan(lr)]
    years = {}
    for r in nm:
        y = r["t"][:4]
        years.setdefault(y, {"p": [], "q": 0.0})
        if r.get("modal"):
            years[y]["p"].append(r["modal"])
        years[y]["q"] += r.get("qty") or 0
    annual = [{"year": int(y), "modal": round(sum(v["p"]) / len(v["p"])), "qty": round(v["q"]),
               "months": len(v["p"])} for y, v in sorted(years.items()) if v["p"]]

    start_m = today.month - 1
    outlook = []
    for h in range(1, H + 1):
        ch = analog_changes(i0, x, start_m, h)
        if not ch:
            continue
        a = np.array(ch)
        outlook.append({"h": h, "month": MON[(start_m + h) % 12],
                        "med": round((math.exp(np.median(a)) - 1) * 100, 1),
                        "p10": round((math.exp(np.percentile(a, 10)) - 1) * 100, 1),
                        "p90": round((math.exp(np.percentile(a, 90)) - 1) * 100, 1),
                        "up_share": round(float((a > 0).mean()) * 100), "n": len(a)})

    # Anchors for a rupee path: today's mandi modal (data.gov.in) and DoCA retail
    anchors = {}
    ogd = read_json(os.path.join(DATA_DIR, "ogd", f"{slug}.json"))
    if ogd and ogd.get("national_modal"):
        anchors["mandi_modal"] = {"date": ogd["date"], "value": ogd["national_modal"], "unit": "Rs/quintal",
                                  "src": "data.gov.in daily mandi prices (simple mean of market modal prices)"}
        # conditional model path from today's level
        k_now = month_index(ogd["date"][:7]) - i0
        anchors["model_path"] = [{"h": h, "month": MON[(start_m + h) % 12],
                                  "value": round(model_forecast(i0, mdl, k_now, math.log(ogd["national_modal"]), h))}
                                 for h in range(1, H + 1)]
    doca = read_json(os.path.join(DATA_DIR, "doca", "daily.json"))
    name = COMMODITIES[slug]["doca"]
    if doca and name:
        snap = doca["days"].get(doca["latest"], {})
        if snap.get("retail_rs_per_kg", {}).get(name):
            anchors["retail"] = {"date": doca["latest"], "value": snap["retail_rs_per_kg"][name], "unit": "Rs/kg",
                                 "src": "DoCA all-India average retail"}
        if snap.get("wholesale_rs_per_qtl", {}).get(name):
            anchors["wholesale"] = {"date": doca["latest"], "value": snap["wholesale_rs_per_qtl"][name],
                                    "unit": "Rs/quintal", "src": "DoCA all-India average wholesale"}

    spikes, crashes = shocks(i0, x, mdl)
    half_life = math.log(0.5) / math.log(mdl["phi"]) if 0 < mdl["phi"] < 1 else None
    out = {
        "slug": slug, "built": today.isoformat(), "data_to": nm[-1]["t"], "data_from": nm[0]["t"],
        "seasonal_price": sp, "seasonal_arrivals": sq,
        "cheapest_month": MON[cheap], "dearest_month": MON[dear],
        "seasonal_swing_pct": round((max(meds) / min(meds) - 1) * 100),
        "volatility": {"monthly_sd_pct": round(float(np.std(lr)) * 100, 1),
                       "share_months_move_gt_20pct": round(float((np.abs(lr) > math.log(1.2)).mean()) * 100),
                       "max_monthly_rise_pct": round((math.exp(float(lr.max())) - 1) * 100),
                       "max_monthly_fall_pct": round((math.exp(float(lr.min())) - 1) * 100)},
        "trend_pct_per_year": round((math.exp(mdl["b"] * 12) - 1) * 100, 1),
        "shock_phi": round(mdl["phi"], 3), "shock_half_life_months": round(half_life, 1) if half_life else None,
        "annual": annual, "spikes": spikes, "crashes": crashes,
        "outlook": {"start_month": MON[start_m], "rows": outlook,
                    "method": "Distribution of past price changes starting in the same calendar month (CEDA/Agmarknet all-India modal price)."},
        "anchors": anchors,
        "backtest": backtest(i0, x),
        "markups": nhb_markups(read_json(os.path.join(DATA_DIR, "nhb", f"{slug}.json"))),
        "recent": [{"t": r["t"], "modal": r["modal"]} for r in nm[-36:]],
        "now_index": next(r["med"] for r in sp if r["m"] == today.month),
        "now_arrivals_index": next((r["med"] for r in (sq or []) if r["m"] == today.month), None),
    }
    return out


def main():
    today = dt.date.today()
    summary = {}
    for slug in COMMODITIES:
        out = build(slug, today)
        if not out:
            print(f"skip {slug}: no CEDA data")
            continue
        write_json(os.path.join(DATA_DIR, "analytics", f"{slug}.json"), out)
        bt = out["backtest"]["mape"]
        summary[slug] = {k: out[k] for k in ("cheapest_month", "dearest_month", "seasonal_swing_pct",
                                              "trend_pct_per_year", "shock_half_life_months", "data_to")}
        summary[slug]["outlook_3m"] = next((r for r in out["outlook"]["rows"] if r["h"] == 3), None)
        print(f"{slug:13s} cheap {out['cheapest_month']} dear {out['dearest_month']} swing {out['seasonal_swing_pct']}% "
              f"halflife {out['shock_half_life_months']} | MAPE h3 analog {bt['analog'][2]} model {bt['model'][2]} "
              f"persist {bt['persistence'][2]} snaive {bt['seasonal_naive'][2]} | markups {len(out['markups'])}")
    write_json(os.path.join(DATA_DIR, "analytics", "_summary.json"), {"built": today.isoformat(), "items": summary})

    # Manifest: the list of commodities the site renders, plus data freshness.
    items = []
    for slug in COMMODITIES:
        kb = read_json(os.path.join(DATA_DIR, "kb", f"{slug}.json"))
        if not kb:
            continue
        items.append({"slug": slug, "name": kb["name"], "local": kb["local"], "group": kb["group"],
                      "color": kb["color"]})
    doca = read_json(os.path.join(DATA_DIR, "doca", "daily.json"), {})
    qc = read_json(os.path.join(DATA_DIR, "retail", "quick_commerce.json"), {})
    ogd_dates = [read_json(os.path.join(DATA_DIR, "ogd", f"{s}.json"), {}).get("date") for s in COMMODITIES]
    ceda_to = [summary[s]["data_to"] for s in summary]
    write_json(os.path.join(DATA_DIR, "manifest.json"), {
        "built": today.isoformat(),
        "commodities": items,
        "freshness": {
            "doca": doca.get("latest"),
            "ceda": max(ceda_to) if ceda_to else None,
            "quick_commerce": qc.get("captured"),
            "ogd": max([d for d in ogd_dates if d], default=None),
            "nhb": max([(read_json(os.path.join(DATA_DIR, "nhb", f"{s}.json"), {}) or {}).get("fetched", "")
                        for s in COMMODITIES], default="")[:10] or None,
        },
    })


if __name__ == "__main__":
    main()
