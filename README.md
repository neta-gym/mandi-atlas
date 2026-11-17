# Mandi Atlas

A static website that puts everything about India's main perishable commodities in one place: where they are grown, crop calendars, weather that hurts them, pests, storage, how they move from farm to city, prices in mandis, in shops and on quick commerce, and a tested seasonal price forecast.

Launch set (10): onion, tomato, potato, brinjal, cauliflower, green chilli, banana, mango, apple, grapes.

## What is on the site

| Page | Contents |
|---|---|
| Rate board (`#board`) | Today's DoCA retail and wholesale prices, a Blinkit snapshot, seasonal position this month, 3-month outlook, 36-month sparkline, the price year as a heat map, weather risks active this month |
| Commodity dossier (`#onion` etc.) | 14 sections: overview and key numbers, prices (2008–2025 mandi history, daily series, yearly price and arrivals, state comparison, quick commerce, city mark-ups), outlook and forecast with backtest, crop calendar and seasonal pattern, state tile map (production share / mandi arrivals / mandi price), belts and top mandi districts, climate and weather risks, pests and diseases, post-harvest and storage, supply chain and routes with today's price build-up, markets and varieties, trade and policy timeline, price history (known episodes + largest deviations in the data), signals and business notes, sources |
| Calendar (`#calendar`) | All ten side by side: seasonal price, mandi arrivals, harvest windows, weather-risk months |
| Supply chain (`#supply-chain`) | How the mandi system works, who takes what, transport, cold chain, quick commerce, glossary |
| Sources (`#sources`) | 40+ data sources with what they hold, granularity, frequency, access method and whether the site uses them |
| Method (`#method`) | Pipeline, models, limits, backtest accuracy table |

## Data sources actually wired in

| Source | Script | What we take | Notes |
|---|---|---|---|
| CEDA Agri-Market Data, Ashoka University (cleaned Agmarknet) | `pipeline/fetch_ceda.py` | All-India monthly modal/min/max price and arrivals since 2008, last 120 days daily, top-6 state series, state and district arrivals, state prices | Series currently ends Oct 2025 |
| Dept. of Consumer Affairs, Price Monitoring System | `pipeline/fetch_doca.py` | Today's all-India average retail (₹/kg) and wholesale (₹/qtl) for onion, potato, tomato, brinjal, banana | Homepage only; detailed reports are behind a CAPTCHA and are not touched. Run daily to build a series |
| National Horticulture Board market information | `pipeline/fetch_nhb.py` | Monthly wholesale, retail and arrivals by city (31 centres) since 2010 | Used for retail ÷ wholesale mark-ups |
| data.gov.in daily mandi prices (Agmarknet feed) | `pipeline/fetch_ogd.py` | Every market's min/max/modal for the day | Needs a free API key and an Indian network (the portal refuses most foreign IPs). When present, the forecast also conditions on today's price |
| Blinkit | manual snapshot in `site/data/retail/quick_commerce.json` | Shelf prices in Connaught Place, Delhi on 16 Nov 2026 | No public API; not scraped automatically |

Reference facts (production, seasons, climate, pests, storage, routes, policy) are in `site/data/kb/<slug>.json` with their sources. Numbers marked "approx." are rounded from official estimates and summaries.

## Run locally

```bash
python3 -m http.server 8765 -d site
```

Open http://localhost:8765. (Opening `index.html` directly from disk will not work because the page loads JSON.)

## Refresh the data

Requires Python 3.9+ and numpy.

```bash
python3 pipeline/fetch_doca.py                 # daily
python3 pipeline/fetch_ceda.py                 # weekly is plenty
python3 pipeline/fetch_nhb.py --from 2010      # history; later runs: --from <last year>
DATA_GOV_IN_API_KEY=xxxx python3 pipeline/fetch_ogd.py   # optional, from India
python3 pipeline/build_analytics.py            # always last
```

`.github/workflows/refresh.yml` does this on GitHub: DoCA every day, CEDA and NHB on Mondays, then rebuilds analytics, commits the data and deploys `site/` to GitHub Pages. To include the daily mandi feed, add a `DATA_GOV_IN_API_KEY` secret and run the job on a self-hosted runner in India.

## Forecast method

* **Seasonal index:** price ÷ centred 12-month moving average, median by calendar month (2008–2025).
* **Seasonal analog outlook:** distribution (median, 10th, 90th percentile) of past price changes from the current calendar month, 1–6 months ahead. Shown for every commodity.
* **Mean-reversion model:** log price = 8-year linear trend + seasonal index + an AR(1) shock that fades over time. Needs today's mandi price, so it switches on once `fetch_ogd.py` has run.
* **Backtest:** rolling origin over the last 8 years against "no change" and "same month last year". At 3 months ahead the model's mean absolute error is 25% for onion (vs 41% for "no change"), 27% for tomato (vs 49%), 19% for potato (vs 28%), 9% for apple (vs 26%).

Not modelled: policy shocks (export bans, buffer releases), weather forecasts. Adding IMD district rainfall and temperature for producing belts is the next step.

## Add a commodity

1. Add it to `COMMODITIES` in `pipeline/common.py` and its CEDA commodity id to `IDS` in `pipeline/fetch_ceda.py` (ids come from `https://agmarknet.ceda.ashoka.edu.in/api/commodities`).
2. Copy any file in `site/data/kb/` to `<slug>.json` and fill it in.
3. Run the fetchers and `build_analytics.py`. The site reads the list from `site/data/manifest.json`.

## Layout

```
pipeline/      data fetchers and analytics (stdlib + numpy)
site/          the static website (index.html, assets/, data/)
  data/kb/         commodity knowledge base (hand-curated, sourced)
  data/ceda/       mandi history (generated)
  data/nhb/        city price history (generated)
  data/doca/       daily retail/wholesale snapshots (generated, grows daily)
  data/analytics/  seasonality, outlook, backtests (generated)
data/raw/      merge store for incremental NHB fetches
```

Not trading or investment advice.
