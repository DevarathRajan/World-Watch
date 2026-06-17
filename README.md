# World-Watch Drop 1

A standalone real-time global intelligence dashboard. Built as a fully independent application.

![Status](https://img.shields.io/badge/status-active-brightgreen) ![Port](https://img.shields.io/badge/port-9766-blue)

---

## What it does

Displays live global data across a single full-screen dashboard:

- **World map** with conflict zones, military activity, nuclear sites, and more — toggle layers, zoom, click events
- **Live news** from BBC, Reuters, Al Jazeera, DW, France24, Bloomberg, Asianet News
- **Flight radar** powered by OpenSky Network — location-aware, switchable by region
- **Market data** — BTC, ETH, USD/AED, USD/INR, EUR, GBP via CoinGecko and Frankfurter
- **Seismic activity** from USGS (M4+)
- **Cyber alerts** from CISA and NVD
- **Live broadcast** — Al Jazeera, DW, France24, Sky News, WION and more
- **Live webcams** across major cities
- **Regional feeds** — news columns by geography
- **Infrastructure cascade** — undersea cables, pipelines, ports, chokepoints
- **Strategic risk gauge** and AI assessment panel

---

## Stack

- **Backend** — Python, FastAPI, uvicorn, httpx, feedparser
- **Frontend** — Vanilla JS, D3.js, TopoJSON, dc-runtime (React-based component system)
- **Desktop** — Electron (optional)

---

## Running it

```powershell
# First time only
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Browser mode — opens Chrome automatically
python server.py --mode browser

# Electron mode — opens a frameless desktop window
python server.py --mode electron

# Or via npm
npm install
npm start
```

Runs on `http://localhost:9766`.

---

## Project structure

```
World Watch/
├── server.py        ← FastAPI backend + static serving
├── main.js          ← Electron entry point
├── package.json
├── requirements.txt
└── static/
    ├── index.html   ← Structure
    ├── style.css    ← All styling
    ├── world.js     ← All component logic
    └── support.js   ← dc-runtime
```

> **Note:** `support.js` is the dc-runtime — a React-based component system. If It is not included in this repo due to size. You can obtain it from the [dc-runtime project](https://github.com/anthropics/dc-runtime)

---

## Data sources

### Live — fetched from real APIs

| Panel                 | Source          | API                                                                         |
| --------------------- | --------------- | --------------------------------------------------------------------------- |
| Live News             | RSS feeds       | BBC, Reuters, Al Jazeera, DW, France24, Bloomberg                           |
| Market Radar          | REST            | CoinGecko (crypto), Frankfurter (forex)                                     |
| Seismic Activity      | REST            | USGS Earthquake Hazards Feed (M4.5+)                                        |
| Flight Radar          | REST            | OpenSky Network (anonymous, no key needed)                                  |
| Cyber Alerts          | RSS feeds       | CISA advisories, NVD CVE feed                                               |
| Live Broadcast        | YouTube scraper | Scrapes `/live` page per channel on load, falls back to hardcoded video IDs |
| Events (map fallback) | RSS             | BBC World (GDELT is the primary source but blocked in UAE by ISP DPI)       |

### Partial — mix of live and static

| Panel          | What's live                                                         | What's hardcoded                                                                            |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Regional Feeds | WORLD NEWS, EUROPE, MIDDLE EAST, MARKETS columns pull from real RSS | UNITED STATES, ASIA-PACIFIC, AFRICA, LATIN AMERICA, ENERGY use static placeholder headlines |
| Live Webcams   | YouTube thumbnails load from real URLs                              | Video IDs are hardcoded and go stale — no scraper yet                                       |

### Hardcoded — mock data, not yet wired

| Panel                   | Notes                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| World Map Events        | 20 static conflict/base/nuclear markers. Intended to come from GDELT once UAE DPI situation is resolved |
| AI Strategic Posture    | Static — 3 mock theatre assessments                                                                     |
| Strategic Risk Overview | Animated gauge with randomly nudged values — no real data source                                        |
| AI Insights             | Rotating set of 4 static assessment strings                                                             |
| Infrastructure Cascade  | Static — cables, pipelines, ports, chokepoints are all mock entries                                     |

---

## Notes

- No API keys required for any currently wired data source
- OpenSky Network has rate limits on anonymous access — flight radar may return empty during high-traffic periods
- GDELT is blocked by UAE ISP — the events endpoint falls back to BBC RSS automatically. Must be available for other countries and might not face GDELT feed issues.
- YouTube video IDs for webcams go stale (this has been handled with scraper) might need manual updates in `webcamData` inside `world.js`

---

## License

MIT
