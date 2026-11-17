"""Department of Consumer Affairs - Price Monitoring Division daily snapshot.

Source: https://fcainfoweb.nic.in/Default.aspx  (homepage tables, no CAPTCHA)
Publishes the all-India average RETAIL price (Rs/kg) and WHOLESALE price (Rs/quintal)
for the day, computed from ~550+ reporting centres.
The detailed centre-wise reports sit behind a CAPTCHA, which this pipeline does NOT touch.

Run daily (see .github/workflows/refresh.yml); each run appends one date to
site/data/doca/daily.json so a time series builds up over time.
"""
import datetime as dt
import html as htmllib
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA_DIR, Session, read_json, write_json  # noqa: E402

URL = "https://fcainfoweb.nic.in/Default.aspx"
TRACK = ["Potato", "Onion", "Tomato", "Brinjal", "Banana", "Garlic", "Ginger"]


def text_of(page):
    t = re.sub(r"<(script|style).*?</\1>", " ", page, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", htmllib.unescape(t))


def grab(section, name):
    m = re.search(r"\b" + re.escape(name) + r"\s+([\d.]+)", section)
    return float(m.group(1)) if m else None


def main():
    page = Session().get(URL)
    t = text_of(page)
    i_r = t.find("All India Average Retail Price")
    i_w = t.find("All India Average Wholesale Price")
    if i_r < 0 or i_w < 0:
        raise SystemExit("DoCA layout changed - retail/wholesale headings not found")
    retail, wholesale = t[i_r:i_w], t[i_w:]
    m = re.search(r"As on (\d{2})/(\d{2})/(\d{4})", retail)
    day = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else dt.date.today().isoformat()
    snap = {
        "retail_rs_per_kg": {k: grab(retail, k) for k in TRACK if grab(retail, k) is not None},
        "wholesale_rs_per_qtl": {k: grab(wholesale, k) for k in TRACK if grab(wholesale, k) is not None},
    }
    path = os.path.join(DATA_DIR, "doca", "daily.json")
    store = read_json(path, {"source": URL, "note": "All-India average of DoCA reporting centres", "days": {}})
    store["days"][day] = snap
    store["latest"] = day
    write_json(path, store)
    print(day, snap)


if __name__ == "__main__":
    main()
