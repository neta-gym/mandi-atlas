"""Weather in the main growing belts: last 30 days + next 16 days (Open-Meteo, free, no key).

For each commodity we check 3-5 belt locations against crop-specific limits:
  heavy rain  : a day >= 64.5 mm (IMD "heavy rainfall" threshold)
  heat        : a day with max temperature >= the crop's heat limit
  cold/frost  : a day with min temperature <= the crop's cold limit
The thresholds are deliberately simple; whether they matter depends on the crop stage
(see the crop calendar on each page).
Writes site/data/weather/<slug>.json
"""
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COMMODITIES, DATA_DIR, UA, write_json  # noqa: E402

HEAVY = 64.5
# slug: (heat limit degC, cold limit degC, [(belt, lat, lon), ...])
BELTS = {
    "onion": (38, 5, [("Nashik–Lasalgaon", 20.15, 74.23), ("Ahilyanagar", 19.09, 74.74), ("Indore (Malwa)", 22.72, 75.86), ("Chitradurga", 14.23, 76.40)]),
    "tomato": (35, 8, [("Kolar", 13.14, 78.13), ("Madanapalle", 13.55, 78.50), ("Narayangaon", 19.12, 73.97), ("Solan", 30.90, 77.10), ("Shivpuri", 25.43, 77.66)]),
    "potato": (32, 2, [("Agra", 27.18, 78.01), ("Farrukhabad", 27.39, 79.58), ("Hooghly", 22.90, 88.39), ("Nalanda", 25.13, 85.45), ("Deesa", 24.26, 72.19)]),
    "brinjal": (38, 10, [("Nadia", 23.47, 88.55), ("Cuttack", 20.46, 85.88), ("Anand", 22.56, 72.95), ("Sagar", 23.84, 78.74)]),
    "cauliflower": (30, 2, [("Nadia", 23.47, 88.55), ("Vaishali", 25.69, 85.22), ("Sonipat", 28.99, 77.02), ("Kullu", 31.96, 77.11)]),
    "green-chilli": (36, 12, [("Khargone (Nimar)", 21.82, 75.61), ("Haveri", 14.79, 75.40), ("Nandurbar", 21.37, 74.24), ("Guntur", 16.31, 80.44)]),
    "banana": (40, 12, [("Jalgaon", 21.01, 75.56), ("Anantapur", 14.68, 77.60), ("Bharuch", 21.71, 72.98), ("Theni", 10.01, 77.48)]),
    "mango": (43, 8, [("Ratnagiri", 16.99, 73.31), ("Malihabad", 26.92, 80.71), ("Chittoor", 13.22, 79.10), ("Junagadh", 21.52, 70.46)]),
    "apple": (32, -5, [("Shopian", 33.72, 74.83), ("Sopore", 34.30, 74.47), ("Kotkhai (Shimla)", 31.12, 77.53), ("Kinnaur", 31.54, 78.27)]),
    "grapes": (40, 8, [("Niphad (Nashik)", 20.08, 74.11), ("Sangli", 16.85, 74.58), ("Vijayapura", 16.83, 75.71)]),
    "garlic": (35, 0, [("Mandsaur", 24.07, 75.07), ("Neemuch", 24.47, 74.87), ("Kota", 25.18, 75.83), ("Jamnagar", 22.47, 70.06)]),
    "ginger": (35, 12, [("Shivamogga", 13.93, 75.57), ("Ri-Bhoi (Meghalaya)", 25.90, 91.88), ("Koraput", 18.81, 82.71), ("Wayanad", 11.69, 76.08)]),
    "cabbage": (30, 0, [("Hooghly", 22.90, 88.39), ("Cuttack", 20.46, 85.88), ("Vaishali", 25.69, 85.22), ("Belagavi", 15.85, 74.50)]),
    "okra": (40, 15, [("Anand", 22.56, 72.95), ("Nadia", 23.47, 88.55), ("Vaishali", 25.69, 85.22), ("Cuttack", 20.46, 85.88)]),
    "green-peas": (30, 0, [("Jabalpur", 23.18, 79.95), ("Barabanki", 26.93, 81.19), ("Jalandhar", 31.33, 75.58), ("Shimla", 31.10, 77.17)]),
    "capsicum": (33, 10, [("Chikkaballapur", 13.43, 77.73), ("Solan", 30.90, 77.10), ("Sehore", 23.20, 77.08), ("Pune", 18.52, 73.86)]),
    "pomegranate": (42, 5, [("Solapur", 17.66, 75.91), ("Satana (Nashik)", 20.60, 74.20), ("Bagalkot", 16.18, 75.70), ("Bhuj (Kutch)", 23.24, 69.67)]),
    "orange": (42, 5, [("Nagpur", 21.15, 79.09), ("Warud (Amravati)", 21.47, 78.27), ("Jhalawar", 24.60, 76.16), ("Abohar (kinnow)", 30.14, 74.20)]),
    "papaya": (40, 10, [("Anand", 22.56, 72.95), ("East Godavari", 17.00, 81.80), ("Barwani", 22.03, 74.90), ("Chitradurga", 14.23, 76.40)]),
    "guava": (42, 5, [("Prayagraj", 25.44, 81.85), ("Gwalior", 26.22, 78.18), ("Ahilyanagar", 19.09, 74.74), ("Vaishali", 25.69, 85.22)]),
}


def fetch(locs):
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(l[1]) for l in locs), "longitude": ",".join(str(l[2]) for l in locs),
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "past_days": 30, "forecast_days": 16, "timezone": "Asia/Kolkata"})
    req = urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode())
    return d if isinstance(d, list) else [d]


def summarise(day, heat, cold):
    rain = [x or 0 for x in day["rain"]]
    return {"rain_mm": round(sum(rain)), "heavy_days": sum(1 for x in rain if x >= HEAVY),
            "max_tmax": max(day["tmax"]), "min_tmin": min(day["tmin"]),
            "heat_days": sum(1 for x in day["tmax"] if x >= heat), "cold_days": sum(1 for x in day["tmin"] if x <= cold)}


def main():
    today = dt.date.today().isoformat()
    for slug in COMMODITIES:
        if slug not in BELTS:
            continue
        heat, cold, locs = BELTS[slug]
        try:
            res = fetch(locs)
        except Exception as e:
            print(f"{slug}: {e}")
            continue
        out_locs = []
        for (name, lat, lon), r in zip(locs, res):
            d = r["daily"]
            rows = [{"d": t, "rain": p, "tmax": a, "tmin": b} for t, p, a, b in
                    zip(d["time"], d["precipitation_sum"], d["temperature_2m_max"], d["temperature_2m_min"])
                    if a is not None and b is not None]
            past = [x for x in rows if x["d"] < today]
            nxt = [x for x in rows if x["d"] >= today]
            col = lambda xs: {"rain": [x["rain"] for x in xs], "tmax": [x["tmax"] for x in xs], "tmin": [x["tmin"] for x in xs]}  # noqa: E731
            sp, sn = summarise(col(past), heat, cold), summarise(col(nxt), heat, cold)
            flags = []
            if sn["heavy_days"]:
                flags.append(f"Heavy rain forecast on {sn['heavy_days']} day(s)")
            if sn["heat_days"]:
                flags.append(f"Heat ≥{heat} °C on {sn['heat_days']} day(s)")
            if sn["cold_days"]:
                flags.append(f"Cold ≤{cold} °C on {sn['cold_days']} day(s)")
            if sp["heavy_days"]:
                flags.append(f"Had heavy rain on {sp['heavy_days']} day(s) in the last 30 days")
            out_locs.append({"name": name, "lat": lat, "lon": lon, "past30": sp, "next16": sn, "flags": flags,
                             "daily": [x for x in rows if x["d"] >= (dt.date.today() - dt.timedelta(days=14)).isoformat()]})
        write_json(os.path.join(DATA_DIR, "weather", f"{slug}.json"),
                   {"fetched": today, "source": "https://open-meteo.com/", "heat_limit": heat, "cold_limit": cold,
                    "heavy_mm": HEAVY, "locations": out_locs})
        print(slug, [(l["name"], l["flags"]) for l in out_locs if l["flags"]])


if __name__ == "__main__":
    main()
