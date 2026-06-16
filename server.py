"""
WorldMonitor — server.py
Standalone FastAPI server. All dependencies resovled.

Usage:
    python server.py                    # starts server only, open browser manually
    python server.py --mode browser     # starts server + opens Chrome automatically
    python server.py --mode electron    # starts server + launches Electron window

Port: 9766 
"""

import argparse
import asyncio
import re
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import feedparser
from fastapi import FastAPI
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


# ── Paths ─────────────────────────────────────────────────────────────────

BASE_DIR    = Path(__file__).resolve().parent
STATIC_DIR  = BASE_DIR / "static"


# ── Config —> you can edit this section as needed anyport──────────────────────────────────

PORT = int(os.environ.get("WM_PORT", 9766))

# External API endpoints for data panels -->
APIS = {
    "coingecko":  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true",
    "frankfurter":"https://api.frankfurter.app/latest?from=USD&to=INR,EUR,GBP",
    "gdelt":      "https://api.gdeltproject.org/api/v2/doc/doc?query=conflict&mode=artlist&maxrecords=20&format=json",
    "usgs_quakes":"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
    "nasa_fires": "https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=20",
}

# RSS feeds for the news panels -> find your own regional feeds and add blocks here and index
NEWS_FEEDS = {
    "bbc":       "http://feeds.bbci.co.uk/news/world/rss.xml",
    "reuters":   "https://feeds.reuters.com/reuters/worldNews",
    "aljazeera": "https://www.aljazeera.com/xml/rss/all.xml",
    "dw":        "https://rss.dw.com/rdf/rss-en-world",
    "france24":  "https://www.france24.com/en/rss",
    "bloomberg": "https://feeds.bloomberg.com/markets/news.rss",
}

# Cyber alert feeds
CYBER_FEEDS = {
    "cisa": "https://www.cisa.gov/news.xml",
    "nvd":  "https://nvd.nist.gov/feeds/xml/cve/misc/nvd-rss.xml",
}

# YouTube channel handles for live stream -> live api token id changes are not handled in js code
BROADCAST_CHANNELS = {
    "aljazeera": "aljazeeraenglish",
    "dw":        "dwnews",
    "france24":  "france24english",
    "euronews":  "euronews",
    "skynews":   "skynews",
    "wion":      "wionews",
    "ndtv":      "ndtv",
    "times_now": "timesnownews",
    "republic":  "republictv",
    "arabiya":   "alarabiya",
}

# Regional news feeds — one source per column in the REGIONAL FEEDS panel.
# Dead feeds degrade gracefully (the column just renders empty / falls back).
REGIONAL_FEEDS = {
    "WORLD NEWS":    "http://feeds.bbci.co.uk/news/world/rss.xml",
    "UNITED STATES": "https://feeds.npr.org/1001/rss.xml",
    "EUROPE":        "https://rss.dw.com/rdf/rss-en-world",
    "MIDDLE EAST":   "https://www.aljazeera.com/xml/rss/all.xml",
    "ASIA-PACIFIC":  "https://www.scmp.com/rss/91/feed",
    "AFRICA":        "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf",
    "LATIN AMERICA": "https://en.mercopress.com/rss",
    "ENERGY":        "https://oilprice.com/rss/main",
}

# Short display tag per region column (fallback when the feed title is long)
REGIONAL_TAGS = {
    "WORLD NEWS": "BBC", "UNITED STATES": "NPR", "EUROPE": "DW",
    "MIDDLE EAST": "AL JAZEERA", "ASIA-PACIFIC": "SCMP", "AFRICA": "ALLAFRICA",
    "LATIN AMERICA": "MERCOPRESS", "ENERGY": "OILPRICE",
}

# Live webcams — scraped fresh from YouTube's live-filtered search so the IDs
# never go stale. Each entry: (city, note, search query). The query should be
# specific enough to surface a permanent 24/7 live cam.
WEBCAM_QUERIES = {
    "ALL": [
        ("New York",  "Times Sq",  "Times Square live cam"),
        ("Dubai",     "Marina",    "Dubai live cam"),
        ("London",    "Thames",    "London live street cam"),
        ("Tokyo",     "Shibuya",   "Shibuya crossing live cam"),
        ("Paris",     "Eiffel",    "Paris Eiffel Tower live cam"),
        ("Venice",    "Canal",     "Venice live cam"),
    ],
    "MIDEAST": [
        ("Dubai",     "Marina",    "Dubai live cam"),
        ("Abu Dhabi", "Corniche",  "Abu Dhabi live cam"),
        ("Mecca",     "Haram",     "Makkah live"),
        ("Istanbul",  "Bosphorus", "Istanbul live cam"),
    ],
    "EUROPE": [
        ("London",    "Thames",    "London live street cam"),
        ("Paris",     "Eiffel",    "Paris Eiffel Tower live cam"),
        ("Rome",      "Centre",    "Rome live cam"),
        ("Venice",    "Canal",     "Venice live cam"),
    ],
    "AMERICAS": [
        ("New York",  "Times Sq",  "Times Square live cam"),
        ("Las Vegas", "Strip",     "Las Vegas strip live cam"),
        ("Miami",     "Beach",     "Miami Beach live cam"),
        ("New Orleans","Bourbon St","Bourbon Street live cam"),
    ],
    "ASIA": [
        ("Tokyo",     "Shibuya",   "Shibuya crossing live cam"),
        ("Taipei",    "City",      "Taipei live cam"),
        ("Seoul",     "City",      "Seoul live cam"),
        ("Hong Kong", "Harbour",   "Hong Kong live cam"),
    ],
}

WEBCAM_TTL  = 1800  # seconds — re-scrape webcam IDs at most every 30 min
_WEBCAM_CACHE = {"ts": 0.0, "data": None}

# Keyword buckets used by /assessment to derive intel/risk from live headlines.
CONFLICT_KW = ("war", "strike", "attack", "missile", "killed", "clash", "troops",
               "offensive", "shelling", "drone", "airstrike", "invasion", "ceasefire",
               "militant", "rebel", "frontline", "casualties", "bombard")
MILITARY_KW = ("military", "navy", "naval", "army", "warship", "carrier", "fighter jet",
               "deploy", "missile", "defense", "defence", "troops", "air force",
               "submarine", "warplane", "drill", "exercise")
NUCLEAR_KW  = ("nuclear", "uranium", "enrichment", "iaea", "reactor", "atomic",
               "warhead", "plutonium", "centrifuge")
CYBER_KW    = ("cyber", "hack", "ransomware", "breach", "ddos", "malware", "phishing",
               "data leak", "exploit", "zero-day")


# Setup - Load fast api

app = FastAPI(title="WorldMonitor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── Helper functions ───────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    """Remove HTML tags and strip whitespace."""
    if not text:
        return ""
    return re.sub(r"<[^>]+>", "", text).strip()


async def _fetch_rss(url: str, limit: int = 10) -> list[dict]:
    """Fetch and parse an RSS feed. Returns [] on any error."""
    try:
        async with httpx.AsyncClient(
            timeout=5,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 WorldMonitor/1.0"},
        ) as client:
            r    = await client.get(url)
            feed = feedparser.parse(r.text)
            out  = []
            for entry in feed.entries[:limit]:
                out.append({
                    "title":     _strip_html(getattr(entry, "title", "")),
                    "summary":   _strip_html(getattr(entry, "summary", getattr(entry, "description", "")))[:200],
                    "link":      getattr(entry, "link", ""),
                    "published": getattr(entry, "published", getattr(entry, "updated", "")),
                    "source":    getattr(feed.feed, "title", ""),
                })
            return out
    except Exception as e:
        print(f"[WM] RSS error {url}: {e}")
        return []


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/world/v1/status")
async def world_status():
    return {
        "status": "ok",
        "port":   PORT,
        "endpoints": [
            "/world/v1/news", "/world/v1/markets", "/world/v1/events",
            "/world/v1/quakes", "/world/v1/cyber", "/world/v1/fires",
            "/world/v1/flights", "/world/v1/streams", "/world/v1/regions",
            "/world/v1/assessment", "/world/v1/webcams/validate",
        ],
    }


@app.get("/world/v1/news")
async def world_news(limit: int = 10):
    """Parallel RSS fetch from all configured news sources."""
    tasks   = {name: _fetch_rss(url, limit) for name, url in NEWS_FEEDS.items()}
    results = {}
    for name, coro in tasks.items():
        results[name] = await coro
    return JSONResponse({"sources": results, "count": len(NEWS_FEEDS)})


@app.get("/world/v1/markets")
async def world_markets():
    """Crypto prices from CoinGecko + forex from Frankfurter."""
    results = {}

    # Crypto
    try:
        async with httpx.AsyncClient(
            timeout=6,
            headers={"User-Agent": "Mozilla/5.0 WorldMonitor/1.0"},
        ) as client:
            r = await client.get(APIS["coingecko"])
            if r.status_code == 200:
                data = r.json()
                for coin, key in [("bitcoin", "btc"), ("ethereum", "eth")]:
                    if coin in data:
                        results[key] = {
                            "symbol":     key.upper(),
                            "price":      data[coin]["usd"],
                            "change_pct": round(data[coin].get("usd_24h_change", 0), 2),
                            "currency":   "USD",
                        }
    except Exception as e:
        print(f"[WM] CoinGecko error: {e}")

    # UAE dirham is pegged and no need to fetch
    results["usd_aed"] = {
        "symbol": "USD/AED", "price": 3.6725, "change_pct": 0, "currency": "AED",
    }

    # Forex
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            r = await client.get(APIS["frankfurter"])
            if r.status_code == 200:
                rates = r.json().get("rates", {})
                for currency, key in [("INR", "usd_inr"), ("EUR", "usd_eur"), ("GBP", "usd_gbp")]:
                    if currency in rates:
                        results[key] = {
                            "symbol":     f"USD/{currency}",
                            "price":      round(rates[currency], 4),
                            "change_pct": 0,
                            "currency":   currency,
                        }
    except Exception as e:
        print(f"[WM] Frankfurter error: {e}")

    return JSONResponse({"markets": results})


@app.get("/world/v1/events")
async def world_events(limit: int = 20):
    """GDELT conflict events — falls back to BBC RSS if GDELT is unavailable."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(APIS["gdelt"])
            if r.status_code == 200 and len(r.text) > 10:
                articles = r.json().get("articles", [])
                if articles:
                    return JSONResponse({
                        "events": [{
                            "title":   a.get("title", ""),
                            "url":     a.get("url", ""),
                            "source":  a.get("domain", ""),
                            "date":    a.get("seendate", ""),
                            "country": a.get("sourcecountry", ""),
                            "tone":    a.get("tone", 0),
                        } for a in articles[:limit]],
                        "count":  len(articles[:limit]),
                        "source": "gdelt",
                    })
    except Exception as e:
        print(f"[WM] GDELT failed: {e}")

    # Fallback to BBC
    items = await _fetch_rss(NEWS_FEEDS["bbc"], limit)
    return JSONResponse({
        "events": [{ "title": i["title"], "url": i["link"], "source": "bbc", "date": i["published"], "country": "", "tone": 0 } for i in items],
        "count":  len(items),
        "source": "rss_fallback",
    })


@app.get("/world/v1/quakes")
async def world_quakes(min_magnitude: float = 4.0):
    """USGS earthquake feed — M4.5+ past 24h."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r    = await client.get(APIS["usgs_quakes"])
            data = r.json()
            quakes = []
            for f in data.get("features", []):
                props  = f["properties"]
                coords = f["geometry"]["coordinates"]
                if props.get("mag", 0) >= min_magnitude:
                    quakes.append({
                        "magnitude": props.get("mag"),
                        "place":     props.get("place", ""),
                        "time":      props.get("time"),
                        "depth_km":  round(coords[2], 1),
                        "lat":       coords[1],
                        "lon":       coords[0],
                        "url":       props.get("url", ""),
                    })
            quakes.sort(key=lambda x: x["magnitude"], reverse=True)
            return JSONResponse({"quakes": quakes, "count": len(quakes)})
    except Exception as e:
        print(f"[WM] USGS error: {e}")
        return JSONResponse({"quakes": [], "error": str(e)})


@app.get("/world/v1/cyber")
async def world_cyber(limit: int = 10):
    """CISA + NVD advisory feeds."""
    results = {}
    for name, url in CYBER_FEEDS.items():
        results[name] = await _fetch_rss(url, limit)
    return JSONResponse({"sources": results})


@app.get("/world/v1/fires")
async def world_fires():
    """NASA EONET active wildfire events."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r    = await client.get(APIS["nasa_fires"])
            data = r.json()
            fires = []
            for e in data.get("events", []):
                geo    = e.get("geometry", [])
                last   = geo[-1] if geo else {}
                coords = last.get("coordinates", [None, None])
                fires.append({
                    "title": e.get("title", ""),
                    "date":  last.get("date", ""),
                    "lat":   coords[1],
                    "lon":   coords[0],
                })
            return JSONResponse({"fires": fires, "count": len(fires)})
    except Exception as e:
        print(f"[WM] Fires error: {e}")
        return JSONResponse({"fires": [], "error": str(e)})


@app.get("/world/v1/flights")
async def world_flights(
    lamin: float = 22.0,
    lomin: float = 51.0,
    lamax: float = 26.5,
    lomax: float = 56.5,
    country: str = "",
):
    """
    Live flight data from OpenSky Network for a bounding box.
    Default bbox = UAE. Pass country= to use a named preset.
    No API key required for anonymous access (rate-limited).
    """
    COUNTRY_BOXES = {
        "uae":           (22.0,  51.0,  26.5,  56.5),
        "india":         ( 8.0,  68.0,  37.0,  97.0),
        "usa":           (24.0,-125.0,  49.0, -66.0),
        "uk":            (49.9,  -8.2,  60.9,   2.0),
        "germany":       (47.3,   5.9,  55.0,  15.0),
        "france":        (41.3,  -5.2,  51.1,   9.6),
        "australia":    (-43.6, 113.3, -10.7, 153.6),
        "japan":         (24.0, 122.0,  46.0, 146.0),
        "china":         (18.0,  73.0,  53.0, 135.0),
        "pakistan":      (23.5,  60.9,  37.1,  77.3),
        "saudi arabia":  (16.3,  34.5,  32.2,  55.7),
        "qatar":         (24.4,  50.7,  26.2,  51.7),
        "iran":          (25.0,  44.0,  39.8,  63.3),
        "turkey":        (35.8,  26.0,  42.1,  44.8),
        "egypt":         (22.0,  24.7,  31.7,  37.1),
        "oman":          (16.6,  51.8,  26.4,  59.8),
    }

    if country:
        key = country.lower().strip()
        box = COUNTRY_BOXES.get(key)
        if not box:
            # fuzzy match
            for k, v in COUNTRY_BOXES.items():
                if key in k or k in key:
                    box = v
                    break
        if box:
            lamin, lomin, lamax, lomax = box

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://opensky-network.org/api/states/all",
                params={"lamin": lamin, "lomin": lomin, "lamax": lamax, "lomax": lomax},
            )
            if r.status_code != 200:
                return JSONResponse({"flights": [], "count": 0, "error": f"OpenSky returned {r.status_code}"})

            states  = r.json().get("states", []) or []
            flights = []

            for f in states:
                if f[5] is None or f[6] is None:
                    continue  # skip entries with no position

                alt_m   = f[7]  or 0
                spd_ms  = f[9]  or 0
                heading = f[10] or 0
                on_gnd  = f[8]  or False
                v_rate  = f[11] or 0

                if on_gnd:          status = "ON GROUND"
                elif v_rate > 1.0:  status = "CLIMBING"
                elif v_rate < -1.0: status = "DESCENDING"
                else:               status = "CRUISING"

                # Colour by altitude bucket
                if alt_m > 8000:    alt_color = "#3ee08f"
                elif alt_m > 3000:  alt_color = "#ffe14d"
                else:               alt_color = "#ff9e3d"

                flights.append({
                    "icao":      f[0] or "",
                    "callsign":  (f[1] or "").strip() or (f[0] or "").strip(),
                    "origin":    f[2] or "?",
                    "lon":       round(f[5], 4),
                    "lat":       round(f[6], 4),
                    "alt_m":     round(alt_m),
                    "alt_ft":    round(alt_m * 3.281),
                    "spd_ms":    round(spd_ms, 1),
                    "spd_kmh":   round(spd_ms * 3.6),
                    "heading":   round(heading),
                    "status":    status,
                    "on_ground": on_gnd,
                    "alt_color": alt_color,
                })

            flights.sort(key=lambda x: x["alt_m"], reverse=True)
            return JSONResponse({
                "flights": flights,
                "count":   len(flights),
                "bbox":    {"lamin": lamin, "lomin": lomin, "lamax": lamax, "lomax": lomax},
            })

    except Exception as e:
        print(f"[WM] Flights error: {e}")
        return JSONResponse({"flights": [], "count": 0, "error": str(e)})


@app.get("/world/v1/streams")
async def world_streams():
    """
    Scrape YouTube /live pages for each channel to find the current video ID.
    Falls back to nothing — the frontend uses hardcoded IDs as fallback.
    """
    async def get_live_id(name: str, handle: str) -> tuple[str, str | None]:
        url = f"https://www.youtube.com/@{handle}/live"
        try:
            async with httpx.AsyncClient(
                timeout=8,
                headers={
                    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                follow_redirects=True,
            ) as client:
                r    = await client.get(url)
                html = r.text
                ids  = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', html)
                live = '"isLive":true' in html or '"isLiveContent":true' in html
                if ids and live:
                    return name, ids[0]
        except Exception as e:
            print(f"[WM] Stream detect error {handle}: {e}")
        return name, None

    results = await asyncio.gather(
        *[get_live_id(name, handle) for name, handle in BROADCAST_CHANNELS.items()]
    )
    streams = {name: vid for name, vid in results if vid}
    print(f"[WM] Live streams found: {len(streams)}/{len(BROADCAST_CHANNELS)}")
    return JSONResponse({"streams": streams, "found": len(streams)})


@app.get("/world/v1/regions")
async def world_regions(limit: int = 4):
    """One regional RSS feed per column for the REGIONAL FEEDS panel."""
    out = {}
    for name, url in REGIONAL_FEEDS.items():
        items = await _fetch_rss(url, limit)
        tag   = REGIONAL_TAGS.get(name, name)
        out[name] = [{
            "src":       (i["source"][:14] if i["source"] else tag) or tag,
            "head":      i["title"],
            "link":      i["link"],
            "published": i["published"],
        } for i in items]
    return JSONResponse({"regions": out})


async def _validate_yt(client: httpx.AsyncClient, vid: str) -> bool:
    """Return True if a YouTube video ID still resolves (via oEmbed)."""
    if not vid:
        return False
    try:
        r = await client.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"},
        )
        return r.status_code == 200
    except Exception:
        return False


async def _scrape_search_live_ids(client: httpx.AsyncClient, query: str, n: int = 6) -> list[str]:
    """
    Return up to `n` candidate video IDs from YouTube's LIVE-filtered search for
    a query. sp=EgJAAQ%3D%3D restricts results to live streams, so these are
    current live cams — this is what keeps webcam IDs fresh. Order preserved.
    """
    try:
        r = await client.get(
            "https://www.youtube.com/results",
            params={"search_query": query, "sp": "EgJAAQ=="},
        )
        seen, out = set(), []
        for vid in re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', r.text):
            if vid not in seen:
                seen.add(vid)
                out.append(vid)
            if len(out) >= n:
                break
        return out
    except Exception as e:
        print(f"[WM] webcam search error '{query}': {e}")
        return []


async def _first_embeddable(client: httpx.AsyncClient, candidates: list[str]) -> str | None:
    """First candidate ID that resolves via oEmbed (i.e. is embeddable)."""
    for vid in candidates:
        if await _validate_yt(client, vid):
            return vid
    return None


@app.get("/world/v1/webcams")
async def world_webcams(force: int = 0):
    """
    Auto-refreshing webcam IDs. Scrapes YouTube live search for each configured
    city so the IDs never go stale. Cached for WEBCAM_TTL seconds. Returns the
    same shape the frontend's webcamData uses: {tab: [[city, note, live, id]]}.
    """
    now = time.time()
    if not force and _WEBCAM_CACHE["data"] and (now - _WEBCAM_CACHE["ts"]) < WEBCAM_TTL:
        return JSONResponse({"webcams": _WEBCAM_CACHE["data"], "cached": True})

    # Flatten to a unique set of queries so duplicate cities are scraped once.
    flat = [(tab, city, note, q)
            for tab, items in WEBCAM_QUERIES.items()
            for (city, note, q) in items]
    uniq = list({q for (_, _, _, q) in flat})

    headers = {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(timeout=10, headers=headers, follow_redirects=True) as client:
        candidates = await asyncio.gather(*[_scrape_search_live_ids(client, q) for q in uniq])
        # Pick the first embeddable candidate per query so every tile is playable.
        picked = await asyncio.gather(*[_first_embeddable(client, c) for c in candidates])
    id_by_query = dict(zip(uniq, picked))
    scraped = picked

    out: dict[str, list] = {}
    for tab, city, note, q in flat:
        vid = id_by_query.get(q)
        out.setdefault(tab, []).append([city, note, bool(vid), vid or ""])

    _WEBCAM_CACHE["data"] = out
    _WEBCAM_CACHE["ts"]   = now
    found = sum(1 for v in scraped if v)
    print(f"[WM] Webcams refreshed: {found}/{len(uniq)} live IDs found")
    return JSONResponse({"webcams": out, "cached": False, "found": found})


@app.get("/world/v1/webcams/validate")
async def world_webcams_validate(ids: str = ""):
    """
    Given comma-separated YouTube IDs, return {id: bool} availability (oEmbed).
    Lets the frontend drop dead webcam tiles instead of rendering a broken
    iframe / 'Video unavailable'.
    """
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    if not id_list:
        return JSONResponse({"valid": {}})
    async with httpx.AsyncClient(timeout=6, follow_redirects=True) as client:
        results = await asyncio.gather(*[_validate_yt(client, v) for v in id_list])
    return JSONResponse({"valid": dict(zip(id_list, results))})


async def _collect_headlines(per_feed: int = 12) -> list[str]:
    """Flat list of recent headlines from the main news + cyber feeds."""
    feeds = list(NEWS_FEEDS.values()) + list(CYBER_FEEDS.values())
    results = await asyncio.gather(*[_fetch_rss(u, per_feed) for u in feeds])
    titles = []
    for items in results:
        for i in items:
            if i.get("title"):
                titles.append(i["title"])
    return titles


def _kw_hits(titles: list[str], keywords) -> list[str]:
    """Headlines that mention any of the given keywords (case-insensitive)."""
    out = []
    for t in titles:
        low = t.lower()
        if any(k in low for k in keywords):
            out.append(t)
    return out


@app.get("/world/v1/assessment")
async def world_assessment():
    """
    Derive the 'AI' panels (risk gauge, strategic posture, insights, military /
    nuclear intel) from real live signals — quake severity + conflict-news volume
    + fires. Deterministic, no LLM, no API key.
    """
    # ── Gather live signals in parallel ──────────────────────────────────────
    async def _quakes():
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                data = (await c.get(APIS["usgs_quakes"])).json()
                return [f["properties"].get("mag", 0) for f in data.get("features", [])]
        except Exception:
            return []

    async def _fires_count():
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                data = (await c.get(APIS["nasa_fires"])).json()
                return len(data.get("events", []))
        except Exception:
            return 0

    mags, fires, titles = await asyncio.gather(_quakes(), _fires_count(), _collect_headlines())

    conflict = _kw_hits(titles, CONFLICT_KW)
    military = _kw_hits(titles, MILITARY_KW)
    nuclear  = _kw_hits(titles, NUCLEAR_KW)
    cyber    = _kw_hits(titles, CYBER_KW)

    m6 = sum(1 for m in mags if m and m >= 6)
    m5 = sum(1 for m in mags if m and 5 <= m < 6)

    # ── Risk score (0–100) ───────────────────────────────────────────────────
    raw = m6 * 12 + m5 * 5 + len(conflict) * 2 + len(nuclear) * 4 + fires * 0.4
    risk = max(5, min(95, round(raw)))
    if   risk >= 70: level, color = "HIGH",     "#ff4658"
    elif risk >= 45: level, color = "ELEVATED", "#ff9e3d"
    elif risk >= 25: level, color = "GUARDED",  "#ffe14d"
    else:            level, color = "LOW",      "#3ee08f"

    # ── Strategic posture: top theatres by live headline mentions ─────────────
    THEATRES = {
        "Persian Gulf":    ("iran", "hormuz", "gulf", "tehran", "strait", "uae", "saudi", "qatar"),
        "Eastern Europe":  ("ukraine", "kyiv", "russia", "moscow", "kharkiv", "donbas"),
        "Middle East":     ("gaza", "israel", "lebanon", "syria", "beirut", "jerusalem", "hamas"),
        "South China Sea": ("taiwan", "china", "beijing", "philippine", "scarborough", "pla"),
        "Korean Peninsula":("korea", "pyongyang", "seoul", "dprk"),
        "South Asia":      ("india", "pakistan", "kashmir", "delhi", "islamabad"),
        "Africa":          ("sudan", "sahel", "congo", "ethiopia", "somalia", "khartoum"),
    }
    scored = []
    for region, kws in THEATRES.items():
        hits = [t for t in titles if any(k in t.lower() for k in kws)]
        if hits:
            scored.append((region, len(hits), hits[0]))
    scored.sort(key=lambda x: x[1], reverse=True)

    def _theatre_level(n):
        if n >= 6: return "CRIT", "#ff4658"
        if n >= 3: return "HIGH", "#ff9e3d"
        return "ELEV", "#ffe14d"

    posture = []
    for region, n, sample in scored[:3]:
        lv, lc = _theatre_level(n)
        posture.append({
            "region": region, "level": lv, "color": lc,
            "mentions": n, "conflict": sum(1 for h in [sample] if h), "seismic": m6 + m5,
            "note": sample[:110],
        })
    if not posture:
        posture = [{"region": "Global", "level": "LOW", "color": "#3ee08f",
                    "mentions": len(titles), "conflict": len(conflict), "seismic": m6 + m5,
                    "note": "No dominant theatre in current headline cycle."}]

    # ── AI insight assessment text (templated from real numbers) ──────────────
    if len(conflict) >= 6:
        assessment = (f"Elevated conflict-signal density: {len(conflict)} kinetic headlines "
                      f"across {len(scored)} theatres in the current cycle.")
    elif nuclear:
        assessment = (f"Nuclear-related reporting active ({len(nuclear)} items); "
                      f"monitor enrichment / IAEA developments.")
    elif m6:
        assessment = (f"Seismic activity dominant: {m6} M6+ event(s) in the last 24h — "
                      f"infrastructure and aftershock risk.")
    else:
        assessment = (f"Baseline posture. {len(titles)} headlines scanned; "
                      f"no single escalation vector dominates.")

    insights = {
        "assessment": assessment,
        "vectors":    len(scored),
        "confidence": min(95, 55 + len(titles) // 6),
        "sources":    len(NEWS_FEEDS) + len(CYBER_FEEDS),
    }

    # ── Live intel pools derived from headlines ───────────────────────────────
    def _pool(hits, sev_high=4):
        out = []
        for i, t in enumerate(hits[:8]):
            sev = "high" if i < 2 else ("med" if i < 5 else "low")
            out.append([t[:90], sev])
        return out

    intel = {
        "MILITARY ACTIVITY": _pool(military) or [["No military-tagged headlines in cycle", "low"]],
        "CYBER THREATS":     _pool(cyber)    or [["No cyber-tagged headlines in cycle", "low"]],
        "NUCLEAR":           _pool(nuclear)  or [["No nuclear-tagged headlines in cycle", "low"]],
    }

    return JSONResponse({
        "risk":     risk,
        "level":    level,
        "color":    color,
        "posture":  posture,
        "insights": insights,
        "intel":    intel,
        "signals":  {"m6": m6, "m5": m5, "fires": fires,
                     "conflict": len(conflict), "headlines": len(titles)},
    })


from fastapi.responses import HTMLResponse


@app.get("/")
async def serve_app():
    html     = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    world_js = (STATIC_DIR / "world.js").read_text(encoding="utf-8")
    html = html.replace(
        '<script type="text/x-dc" data-dc-script id="wm-component-script"></script>',
        f'<script type="text/x-dc" data-dc-script>\n{world_js}\n</script>',
    )
    return HTMLResponse(content=html)


# Serves CSS, support.js and other static assets
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── Entry point ────────────────────────────────────────────────────────────

def _open_browser():
    """Wait for the server to be ready then open Chrome."""
    time.sleep(1.5)
    url = f"http://localhost:{PORT}"
    print(f"[WM] Opening browser at {url}")
    if sys.platform == "win32":
        subprocess.Popen(["start", url], shell=True)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", url])
    else:
        subprocess.Popen(["xdg-open", url])


def _open_electron():
    """Wait for the server to be ready then launch Electron via npm start."""
    time.sleep(1.5)
    print("[WM] Launching Electron...")
    # Electron's main.js is in the same directory as this file.
    # It reads WM_PORT from env so it knows where to connect.
    env = os.environ.copy()
    env["WM_PORT"] = str(PORT)
    env["WM_ELECTRON_ONLY"] = "1"  # tells main.js not to spawn Python again
    subprocess.Popen(
        ["npx", "electron", "."],
        cwd=str(BASE_DIR),
        env=env,
        shell=(sys.platform == "win32"),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WorldMonitor server")
    parser.add_argument(
        "--mode",
        choices=["browser", "electron"],
        default=None,
        help="browser = auto-open Chrome, electron = launch Electron window",
    )
    args = parser.parse_args()

    print(f"[WM] Starting WorldMonitor on http://localhost:{PORT}")
    if args.mode == "browser":
        threading.Thread(target=_open_browser, daemon=True).start()
    elif args.mode == "electron":
        threading.Thread(target=_open_electron, daemon=True).start()
    else:
        print(f"[WM] Open http://localhost:{PORT} in your browser")

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
