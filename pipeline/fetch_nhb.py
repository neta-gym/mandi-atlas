"""National Horticulture Board - month-wise annual price & arrival report.

Source: https://www.nhb.gov.in/OnlineClient/MonthwiseAnnualPriceandArrivalReport.aspx
Gives, per reporting centre (Delhi, Mumbai, Lasalgaon, Bengaluru ...) and month:
  wholesale average price (Rs/quintal), retail average price (Rs/quintal),
  total arrivals (tonnes).
History goes back to 2000; no CAPTCHA. ASP.NET form, so we replay postbacks.

Usage:  python3 pipeline/fetch_nhb.py [--from 2010] [--to 2026] [--only onion,tomato]
Writes: data/raw/nhb/<commodity>.json and site/data/nhb/<commodity>.json
"""
import argparse
import datetime as dt
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COMMODITIES, DATA_DIR, RAW_DIR, Session, parse_form, parse_tables, read_json, write_json  # noqa: E402

URL = "https://www.nhb.gov.in/OnlineClient/MonthwiseAnnualPriceandArrivalReport.aspx"
P = "ctl00$ContentPlaceHolder1$"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def opt_value(options, text):
    for o in options:
        if o["text"].strip().upper() == text.upper():
            return o["value"]
    return None


def state_fields(form, **sel):
    f = dict(form.hidden)
    f.update(sel)
    return f


def setup_crop(s, category, crop):
    html = s.get(URL)
    form = parse_form(html)
    cat_v = opt_value(form.selects[P + "drpCategoryName"], category)
    year = form.selects[P + "ddlyear"][0]["value"]
    base = {P + "ddlyear": year}

    html = s.post(URL, state_fields(form, __EVENTTARGET=P + "drpCategoryName", __EVENTARGUMENT="",
                                    **base, **{P + "drpCategoryName": cat_v}))
    form = parse_form(html)
    crop_v = opt_value(form.selects.get(P + "drpCropName", []), crop)
    if crop_v is None:
        raise RuntimeError(f"crop {crop} not in NHB list: {[o['text'] for o in form.selects.get(P + 'drpCropName', [])]}")

    html = s.post(URL, state_fields(form, __EVENTTARGET=P + "drpCropName", __EVENTARGUMENT="",
                                    **base, **{P + "drpCategoryName": cat_v, P + "drpCropName": crop_v}))
    form = parse_form(html)
    varieties = [o for o in form.selects.get(P + "ddlvariety", []) if o["value"] not in ("0", "")]
    centres = [o["value"] for o in form.selects.get(P + "LsboxCenterList", [])]
    return form, cat_v, crop_v, varieties, centres


def num(x):
    try:
        return float(x.replace(",", ""))
    except ValueError:
        return 0.0


def parse_report(html):
    """Return list of {centre, months:[{wp, rp, arr}]*12}."""
    out = []
    for t in parse_tables(html):
        for row in t:
            if len(row) >= 38 and re.fullmatch(r"\d+", row[0] or ""):
                name = row[1].split("/")[0].strip().title()
                vals = [num(v) for v in row[2:38]]
                months = []
                for m in range(12):
                    wp, rp, arr = vals[m * 3: m * 3 + 3]
                    months.append({"wp": wp or None, "rp": rp or None, "arr": arr or None})
                out.append({"centre": name, "months": months})
    return out


def fetch_commodity(slug, years):
    category, crop = COMMODITIES[slug]["nhb"]
    s = Session()
    form, cat_v, crop_v, varieties, centres = setup_crop(s, category, crop)
    # prefer the variety that shares the crop's name, else every variety
    named = [v for v in varieties if v["text"].upper() == crop.upper()]
    use = named or varieties
    series = {}  # centre -> {YYYY-MM: {...}}
    for v in use:
        for y in years:
            fields = state_fields(form, __EVENTTARGET="", __EVENTARGUMENT="", **{
                P + "ddlyear": str(y), P + "drpCategoryName": cat_v, P + "drpCropName": crop_v,
                P + "ddlvariety": v["value"], P + "LsboxCenterList": centres, P + "btnSearch": "Search",
            })
            try:
                html = s.post(URL, fields)
            except Exception as e:  # keep going on one bad year
                print(f"  ! {slug} {y} {v['text']}: {e}")
                continue
            new_form = parse_form(html)
            if new_form.hidden.get("__VIEWSTATE"):
                form = new_form
            rows = parse_report(html)
            for r in rows:
                c = series.setdefault(r["centre"], {})
                for m, cell in enumerate(r["months"]):
                    if not any(cell.values()):
                        continue
                    key = f"{y}-{m + 1:02d}"
                    prev = c.get(key)
                    if prev and prev.get("arr") and cell.get("arr"):
                        # several varieties -> arrival-weighted merge
                        w1, w2 = prev["arr"], cell["arr"]
                        for k in ("wp", "rp"):
                            if prev.get(k) and cell.get(k):
                                prev[k] = round((prev[k] * w1 + cell[k] * w2) / (w1 + w2), 1)
                        prev["arr"] = w1 + w2
                    elif not prev:
                        c[key] = cell
            print(f"  {slug} {v['text']} {y}: {len(rows)} centres")
            time.sleep(0.6)
    return {"varieties": [v["text"] for v in use], "centres": series}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="y0", type=int, default=2012)
    ap.add_argument("--to", dest="y1", type=int, default=dt.date.today().year)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    slugs = [x for x in a.only.split(",") if x] or list(COMMODITIES)
    years = list(range(a.y0, a.y1 + 1))
    for slug in slugs:
        print(f"NHB {slug} {years[0]}-{years[-1]}")
        try:
            got = fetch_commodity(slug, years)
        except Exception as e:
            print(f"  ! failed {slug}: {e}")
            continue
        raw_path = os.path.join(RAW_DIR, "nhb", f"{slug}.json")
        old = read_json(raw_path, {"centres": {}})
        for c, months in got["centres"].items():
            old["centres"].setdefault(c, {}).update(months)
        old["varieties"] = got["varieties"]
        old["source"] = URL
        old["units"] = {"wp": "Rs/quintal (wholesale avg)", "rp": "Rs/quintal (retail avg)", "arr": "tonnes"}
        old["fetched"] = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ")
        write_json(raw_path, old)
        write_json(os.path.join(DATA_DIR, "nhb", f"{slug}.json"), old)


if __name__ == "__main__":
    main()
