// world.js — WorldMonitor component logic
// All data wiring, map setup, flight radar, and the DCLogic Component class.
// Served as a static file at /static/world.js
//
// Config at the top — the only thing you should need to touch for most setups.

const WM_CONFIG = {
  // API base — change port here if you want to run on something other than 9766
  apiBase: "http://localhost:9766/world/v1",

  // Set to true when running inside Jarvis Electron. When true, the close
  // button sends a WebSocket message to Jarvis (port 8765) instead of just
  // closing the window.
  jarvisMode: false,
  jarvisWsPort: 8765,
};

// Shorthand for API calls throughout the file
async function wmFetch(endpoint) {
  try {
    const r = await fetch(`${WM_CONFIG.apiBase}/${endpoint}`);
    return await r.json();
  } catch (e) {
    console.warn(`[WM] Fetch failed for ${endpoint}:`, e);
    return null;
  }
}

// Relative time helper — turns a timestamp into "12m", "3h", etc.
function wmTimeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - new Date(ts)) / 1000);
  if (s < 60)  return Math.floor(s) + "s";
  const m = s / 60;
  if (m < 60)  return Math.floor(m) + "m";
  const h = m / 60;
  if (h < 24)  return Math.floor(h) + "h";
  return Math.floor(h / 24) + "d";
}

// Close handler — respects jarvisMode config above
function closeMonitor() {
  if (WM_CONFIG.jarvisMode) {
    try {
      const ws = new WebSocket(`ws://localhost:${WM_CONFIG.jarvisWsPort}/ws`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "close_world_monitor_request" }));
        ws.close();
      };
    } catch (e) {
      console.warn("[WM] Could not reach Jarvis WS:", e);
    }
    // Give the WS message a moment to send before closing
    setTimeout(() => window.close(), 300);
  } else {
    window.close();
  }
}

// ── Live Broadcast channels ────────────────────────────────────────────────
// Video IDs here are fallbacks. The server scrapes YouTube on load and
// overwrites these with fresh IDs via /world/v1/streams.

const JV_CHANNELS = [
  { id: "aljazeera", label: "AL JAZEERA", vid: "coYw-eVU0Ks" },
  { id: "dw",        label: "DW",         vid: "84o3MwdMoww" },
  { id: "france24",  label: "FRANCE 24",  vid: "l8PMl7tUDIE" },
  { id: "euronews",  label: "EURONEWS",   vid: "KovDFSNE-DI" },
  { id: "skynews",   label: "SKY NEWS",   vid: "9Auq9mYxFEE" },
  { id: "wion",      label: "WION",       vid: "Iv4cZtqd0Lc" },
  { id: "ndtv",      label: "NDTV",       vid: "g3Hs4nHQFVc" },
  { id: "times_now", label: "TIMES NOW",  vid: "f1dL6DPMDNQ" },
  { id: "republic",  label: "REPUBLIC",   vid: "5ONe0acRwMc" },
  { id: "arabiya",   label: "AL ARABIYA", vid: "bERI0pAHRBI" },
];

// This gets merged with live IDs fetched from the server
let jvStreamIds = {};
JV_CHANNELS.forEach(c => { jvStreamIds[c.id] = c.vid; });

// ── Markets panel ─────────────────────────────────────────────────────────

const MKT_LABELS = {
  btc: "BTC", eth: "ETH",
  usd_aed: "USD/AED", usd_inr: "USD/INR",
  usd_eur: "USD/EUR", usd_gbp: "USD/GBP",
};

async function jvLoadMarkets() {
  const data = await wmFetch("markets");
  const grid = document.getElementById("jv-market-grid");
  if (!data || !grid) return;

  const markets = data.markets || {};
  let html = "";

  for (const [key, m] of Object.entries(markets)) {
    if (typeof m !== "object" || !m || m.price == null) continue;
    const pct   = m.change_pct || 0;
    const dir   = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
    const price = m.price > 1000
      ? m.price.toLocaleString()
      : Number(m.price).toFixed(2);

    html += `
      <div class="mkt-card">
        <div class="mkt-name">${MKT_LABELS[key] || key.toUpperCase()}</div>
        <div class="mkt-price">${price}</div>
        <div class="mkt-chg ${dir}">${arrow} ${Math.abs(pct).toFixed(2)}%</div>
      </div>`;
  }

  grid.innerHTML = html ||
    '<div style="font-size:9px;color:#5c7686;padding:8px">No data available</div>';
}

// ── Seismic panel ─────────────────────────────────────────────────────────

async function jvLoadQuakes() {
  const data  = await wmFetch("quakes");
  const list  = document.getElementById("jv-quake-list");
  const count = document.getElementById("jv-quake-count");
  if (!data || !list) return;

  const quakes = data.quakes || [];
  if (count) count.textContent = `${quakes.length} M4+`;

  const colors = { m7: "#ff4658", m6: "#ff9e3d", m5: "#ffe14d", m4: "#5c7686" };

  list.innerHTML = quakes.slice(0, 10).map(q => {
    const cls = q.magnitude >= 7 ? "m7"
              : q.magnitude >= 6 ? "m6"
              : q.magnitude >= 5 ? "m5" : "m4";
    return `
      <div class="wm-quake-row">
        <span class="wm-quake-mag" style="color:${colors[cls]}">M${q.magnitude}</span>
        <div class="wm-quake-info">
          <div class="wm-quake-place">${q.place}</div>
          <div class="wm-quake-meta">${q.depth_km}km · ${wmTimeAgo(q.time)}</div>
        </div>
      </div>`;
  }).join("") || '<div style="font-size:9px;color:#5c7686;padding:4px 0">No M4+ activity</div>';
}

// ── Wire real RSS into the news pool ──────────────────────────────────────

async function jvWireNews(component) {
  const data = await wmFetch("news");
  if (!data) return;

  const sourceMap = {
    bbc: "BBC", reuters: "REUTERS", aljazeera: "AL JAZEERA",
    cnn: "CNN", dw: "DW", france24: "FRANCE24", bloomberg: "BLOOMBERG",
  };
  const catMap = {
    bbc: "pol", reuters: "pol", aljazeera: "alert",
    cnn: "alert", dw: "pol", france24: "pol", bloomberg: "mkt",
  };

  const all = [];
  for (const [src, articles] of Object.entries(data.sources || {})) {
    for (const a of articles) {
      if (a.title) {
        all.push({
          source: sourceMap[src] || src.toUpperCase(),
          head:   a.title,
          cat:    catMap[src] || "pol",
          ts:     new Date(a.published || Date.now()).getTime(),
          link:   a.link || "",
        });
      }
    }
  }
  all.sort((a, b) => b.ts - a.ts);

  if (component && all.length) {
    component.newsPool = all.slice(0, 30);
    component.setState({ news: all.slice(0, 8).map(n => ({ ...n })) });
  }
}

// ── Wire regional feeds — live, one RSS source per column ──────────────────

async function jvWireRegions(component) {
  const data = await wmFetch("regions");
  if (!data || !component || !data.regions) return;

  const cols = Object.entries(data.regions)
    .map(([name, items]) => ({
      name,
      items: (items || []).slice(0, 3).map(it => [it.src, it.head, it.link || ""]),
    }))
    .filter(c => c.items.length > 0);

  if (cols.length) {
    component.regionsData = cols;
    component.forceUpdate && component.forceUpdate();
  }
}

// ── Strategic assessment — risk gauge, posture, AI insights, military/nuclear
//    intel, all derived server-side from live signals (no LLM, no API key). ──

async function jvWireAssessment(component) {
  const data = await wmFetch("assessment");
  if (!data || !component) return;

  if (Array.isArray(data.posture) && data.posture.length) {
    component.postureData = data.posture;
  }
  if (data.insights && data.insights.assessment) {
    component.assessments  = [data.insights.assessment];
    component._aiConfidence = data.insights.confidence;
    component._aiVectors    = data.insights.vectors;
    component._aiSources    = data.insights.sources;
  }
  if (data.intel) {
    if (data.intel["MILITARY ACTIVITY"]) component.intelPools["MILITARY ACTIVITY"] = data.intel["MILITARY ACTIVITY"];
    if (data.intel["NUCLEAR"])           component.intelPools["NUCLEAR"]           = data.intel["NUCLEAR"];
  }
  component._realRisk = data.risk;
  component.setState({
    risk: data.risk, prevRisk: data.risk, riskTrend: "STABLE",
    aiIdx: 0, liveIntel: component.seedIntel(),
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MAP EVENTS — real markers for the GLOBAL SITUATION map
// Seismic (USGS) + wildfires (NASA) carry real coords; conflict/nuclear are
// geocoded from live news headlines via this gazetteer (works even when GDELT
// is DPI-blocked, since it reads the plain RSS news feeds).
// ══════════════════════════════════════════════════════════════════════════

const WM_GAZETTEER = {
  // place substring → [lat, lon, display region]
  "tehran":[35.70,51.42,"Iran"], "iran":[32.43,53.69,"Iran"],
  "strait of hormuz":[26.57,56.25,"Hormuz"], "hormuz":[26.57,56.25,"Hormuz"],
  "jerusalem":[31.78,35.22,"Israel"], "tel aviv":[32.08,34.78,"Israel"], "israel":[31.40,35.00,"Israel"],
  "gaza":[31.50,34.47,"Gaza"], "rafah":[31.29,34.26,"Gaza"], "khan younis":[31.34,34.30,"Gaza"],
  "west bank":[31.95,35.30,"West Bank"], "ramallah":[31.90,35.20,"West Bank"],
  "lebanon":[33.85,35.86,"Lebanon"], "beirut":[33.89,35.50,"Lebanon"],
  "syria":[34.80,38.99,"Syria"], "damascus":[33.51,36.29,"Syria"],
  "iraq":[33.22,43.68,"Iraq"], "baghdad":[33.31,44.36,"Iraq"],
  "yemen":[15.55,48.52,"Yemen"], "sanaa":[15.37,44.19,"Yemen"], "red sea":[20.28,38.51,"Red Sea"],
  "ukraine":[48.38,31.17,"Ukraine"], "kyiv":[50.45,30.52,"Ukraine"], "kharkiv":[49.99,36.23,"Ukraine"],
  "odesa":[46.48,30.72,"Ukraine"], "donetsk":[48.02,37.80,"Ukraine"],
  "russia":[55.75,37.62,"Russia"], "moscow":[55.75,37.62,"Russia"],
  "sudan":[15.50,32.56,"Sudan"], "khartoum":[15.50,32.56,"Sudan"],
  "ethiopia":[9.15,40.49,"Ethiopia"], "somalia":[5.15,46.20,"Somalia"], "congo":[-4.04,21.76,"DR Congo"],
  "sahel":[15.00,0.00,"Sahel"], "mali":[17.57,-4.00,"Mali"], "niger":[17.61,8.08,"Niger"],
  "taiwan":[23.70,120.96,"Taiwan"], "taipei":[25.03,121.56,"Taiwan"],
  "south china sea":[12.00,114.00,"S. China Sea"], "china":[35.86,104.20,"China"], "beijing":[39.90,116.40,"China"],
  "north korea":[40.34,127.51,"DPRK"], "pyongyang":[39.02,125.75,"DPRK"], "dprk":[40.34,127.51,"DPRK"],
  "south korea":[36.50,127.85,"S. Korea"], "seoul":[37.57,126.98,"S. Korea"],
  "pakistan":[30.38,69.35,"Pakistan"], "islamabad":[33.69,73.06,"Pakistan"], "kashmir":[34.08,74.80,"Kashmir"],
  "india":[22.35,78.67,"India"], "new delhi":[28.61,77.21,"India"], "delhi":[28.61,77.21,"India"],
  "afghanistan":[33.94,67.71,"Afghanistan"], "kabul":[34.56,69.21,"Afghanistan"],
  "egypt":[26.82,30.80,"Egypt"], "cairo":[30.04,31.24,"Egypt"], "suez":[30.02,32.55,"Suez"],
  "libya":[26.34,17.23,"Libya"], "tripoli":[32.89,13.19,"Libya"],
  "saudi":[23.89,45.08,"Saudi Arabia"], "riyadh":[24.71,46.68,"Saudi Arabia"],
  "qatar":[25.35,51.18,"Qatar"], "doha":[25.29,51.53,"Qatar"], "dubai":[25.20,55.27,"UAE"], "uae":[24.0,54.0,"UAE"],
  "turkey":[38.96,35.24,"Turkey"], "ankara":[39.93,32.86,"Turkey"], "istanbul":[41.01,28.98,"Turkey"],
  "washington":[38.90,-77.04,"USA"], "pentagon":[38.87,-77.06,"USA"],
  "london":[51.51,-0.13,"UK"], "paris":[48.86,2.35,"France"], "berlin":[52.52,13.40,"Germany"],
  "venezuela":[6.42,-66.59,"Venezuela"], "haiti":[18.97,-72.29,"Haiti"],
};

const WM_CONFLICT_RE = /\b(war|strike|attack|missile|killed|clash|troops|offensive|shelling|drone|airstrike|invasion|ceasefire|militant|rebel|frontline|casualties|bombard|siege|raid|gunmen|fighting)\b/i;
const WM_NUCLEAR_RE  = /\b(nuclear|uranium|enrichment|iaea|reactor|atomic|warhead|plutonium|centrifuge)\b/i;

async function jvBuildMapEvents(component) {
  if (!component) return;
  const [quakeData, fireData, newsData] = await Promise.all([
    wmFetch("quakes"), wmFetch("fires"), wmFetch("news"),
  ]);

  const now = Date.now();
  const events = [];
  let id = 1;

  // Seismic markers (real coords)
  (quakeData && quakeData.quakes || []).slice(0, 30).forEach(q => {
    if (q.lat == null || q.lon == null) return;
    const cat = q.magnitude >= 6 ? "high" : q.magnitude >= 5 ? "elevated" : "seismic";
    events.push({
      id: id++, name: q.place || "Earthquake", lat: q.lat, lon: q.lon,
      cat, layer: "seismic", region: q.place || "Seismic",
      headline: `M${q.magnitude} earthquake · ${q.depth_km}km deep`,
      ageMin: Math.max(1, Math.round((now - (q.time || now)) / 60000)),
    });
  });

  // Wildfire markers (real coords)
  (fireData && fireData.fires || []).slice(0, 20).forEach(f => {
    if (f.lat == null || f.lon == null) return;
    const ts = f.date ? new Date(f.date).getTime() : now;
    events.push({
      id: id++, name: f.title || "Wildfire", lat: f.lat, lon: f.lon,
      cat: "fire", layer: "wildfire", region: "Wildfire",
      headline: f.title || "Active wildfire",
      ageMin: Math.max(1, Math.round((now - ts) / 60000)) || 120,
    });
  });

  // Conflict / nuclear markers — geocode live headlines against the gazetteer
  const headlines = [];
  for (const arr of Object.values((newsData && newsData.sources) || {}))
    for (const a of (arr || [])) if (a.title) headlines.push(a);

  const seen = new Set();
  headlines.forEach(a => {
    const low    = a.title.toLowerCase();
    const isNuke = WM_NUCLEAR_RE.test(low);
    const isConf = WM_CONFLICT_RE.test(low);
    if (!isNuke && !isConf) return;
    for (const place of Object.keys(WM_GAZETTEER)) {
      if (low.includes(place)) {
        const geo = WM_GAZETTEER[place];
        const key = geo[2] + (isNuke ? "-n" : "-c");
        if (seen.has(key)) break;
        seen.add(key);
        events.push({
          id: id++, name: geo[2], lat: geo[0], lon: geo[1],
          cat: isNuke ? "nuclear" : "high",
          layer: isNuke ? "nuclear" : "conflict",
          region: geo[2], headline: a.title,
          ageMin: Math.max(1, Math.round((now - new Date(a.published || now)) / 60000)) || 30,
          link: a.link || "",
        });
        break;
      }
    }
  });

  // Attach colour / shape / label
  events.forEach(e => {
    const cs = component.catStyle[e.cat] || component.catStyle.seismic;
    e.color = cs[0]; e.shape = cs[1]; e.catLabel = cs[2];
  });

  component.events = events;
  if (component.updateMarkers) component.updateMarkers();
  if (component.forceUpdate)  component.forceUpdate();
}

// ── Wire CISA alerts into the intel pool ─────────────────────────────────

async function jvWireCyber(component) {
  const data = await wmFetch("cyber");
  if (!data || !component) return;

  const items = [];
  for (const [, alerts] of Object.entries(data.sources || {})) {
    for (const a of alerts) {
      if (a.title) items.push([a.title.slice(0, 90), "high"]);
    }
  }
  if (items.length) {
    component.intelPools["CYBER THREATS"] = items.slice(0, 8);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FLIGHT RADAR — OpenSky Network, location-aware
// ══════════════════════════════════════════════════════════════════════════

// Single object holds all flight radar state — easier to reason about
// than scattered globals.
const JV_FLIGHT = {
  bbox:      { lamin: 22.0, lomin: 51.0, lamax: 26.5, lomax: 56.5 },
  region:    "UAE",
  flights:   [],
  selected:  null,
  expanded:  false,
  timer:     null,
  zoomBehav: null,
  svgSel:    null,
  zoomLayer: null,
  proj:      null,
  W: 600, H: 320,
};

// Main region presets shown across the top bar
const JV_FLIGHT_REGIONS = [
  { id: "UAE",          label: "UAE",    lamin: 22.0,  lomin: 51.0,   lamax: 26.5,  lomax: 56.5  },
  { id: "India",        label: "INDIA",  lamin: 8.0,   lomin: 68.0,   lamax: 37.0,  lomax: 97.0  },
  { id: "Saudi Arabia", label: "KSA",    lamin: 16.3,  lomin: 34.5,   lamax: 32.2,  lomax: 55.7  },
  { id: "Pakistan",     label: "PAK",    lamin: 23.5,  lomin: 60.9,   lamax: 37.1,  lomax: 77.3  },
  { id: "Qatar",        label: "QATAR",  lamin: 24.4,  lomin: 50.7,   lamax: 26.2,  lomax: 51.7  },
  { id: "Oman",         label: "OMAN",   lamin: 16.6,  lomin: 51.8,   lamax: 26.4,  lomax: 59.8  },
  { id: "UK",           label: "UK",     lamin: 49.9,  lomin: -8.2,   lamax: 60.9,  lomax: 2.0   },
  { id: "Europe",       label: "EUROPE", lamin: 35.0,  lomin: -10.0,  lamax: 70.0,  lomax: 40.0  },
  { id: "USA",          label: "USA",    lamin: 24.0,  lomin: -125.0, lamax: 49.0,  lomax: -66.0 },
  { id: "Turkey",       label: "TUR",    lamin: 35.8,  lomin: 26.0,   lamax: 42.1,  lomax: 44.8  },
  { id: "Iran",         label: "IRAN",   lamin: 25.0,  lomin: 44.0,   lamax: 39.8,  lomax: 63.3  },
  { id: "Egypt",        label: "EGYPT",  lamin: 22.0,  lomin: 24.7,   lamax: 31.7,  lomax: 37.1  },
  { id: "China",        label: "CHINA",  lamin: 18.0,  lomin: 73.0,   lamax: 53.0,  lomax: 135.0 },
  { id: "Japan",        label: "JAPAN",  lamin: 24.0,  lomin: 122.0,  lamax: 46.0,  lomax: 146.0 },
  { id: "Australia",    label: "AUS",    lamin: -43.6, lomin: 113.3,  lamax: -10.7, lomax: 153.6 },
];

// Sub-regions only shown when their parent is active
const JV_FLIGHT_SUBREGIONS = {
  "Europe": [
    { id: "eu-all",     label: "ALL EUROPE",  lamin: 35.0, lomin: -10.0, lamax: 70.0, lomax: 40.0 },
    { id: "eu-uk-ie",   label: "UK & IRELAND",lamin: 49.9, lomin: -11.0, lamax: 59.0, lomax: 2.0  },
    { id: "eu-france",  label: "FRANCE",      lamin: 41.3, lomin: -5.2,  lamax: 51.1, lomax: 9.6  },
    { id: "eu-germany", label: "GERMANY",     lamin: 47.3, lomin: 5.9,   lamax: 55.1, lomax: 15.0 },
    { id: "eu-iberia",  label: "IBERIA",      lamin: 36.0, lomin: -9.5,  lamax: 43.8, lomax: 3.3  },
    { id: "eu-italy",   label: "ITALY",       lamin: 36.6, lomin: 6.6,   lamax: 47.1, lomax: 18.5 },
    { id: "eu-nordic",  label: "NORDICS",     lamin: 55.0, lomin: 4.0,   lamax: 71.0, lomax: 31.0 },
    { id: "eu-balkan",  label: "BALKANS",     lamin: 38.0, lomin: 13.0,  lamax: 48.0, lomax: 30.0 },
  ],
  "USA": [
    { id: "us-all",  label: "ALL USA",    lamin: 24.0, lomin: -125.0, lamax: 49.0, lomax: -66.0 },
    { id: "us-west", label: "WEST",       lamin: 31.0, lomin: -125.0, lamax: 49.0, lomax: -104.0},
    { id: "us-cent", label: "CENTRAL",    lamin: 25.0, lomin: -104.0, lamax: 49.0, lomax: -90.0 },
    { id: "us-east", label: "EAST",       lamin: 24.0, lomin: -90.0,  lamax: 47.5, lomax: -66.0 },
    { id: "us-ne",   label: "NORTHEAST",  lamin: 38.0, lomin: -80.0,  lamax: 47.5, lomax: -66.0 },
    { id: "us-cal",  label: "CALIFORNIA", lamin: 32.5, lomin: -124.5, lamax: 42.0, lomax: -114.0},
  ],
};

function jvFlightBuildRegionTabs(activeId) {
  const bar = document.getElementById("jv-flight-regions");
  if (!bar) return;
  bar.innerHTML = "";

  JV_FLIGHT_REGIONS.forEach(r => {
    const on  = r.id === activeId;
    const btn = document.createElement("button");
    btn.textContent = r.label;
    btn.className   = "wm-tab-btn sm";
    btn.style.cssText = [
      `border-color:${on ? "#45d6ff" : "rgba(74,200,255,.18)"}`,
      `background:${on ? "#45d6ff" : "transparent"}`,
      `color:${on ? "#06121d" : "#6f93a5"}`,
      `font-weight:${on ? "700" : "400"}`,
    ].join(";");
    btn.addEventListener("click", () => jvFlightSwitchRegion(r.id));
    bar.appendChild(btn);
  });

  jvFlightBuildSubTabs(activeId);
}

function jvFlightBuildSubTabs(parentId) {
  // Create the sub-bar lazily so the DOM doesn't need it in the HTML template
  let sub = document.getElementById("jv-flight-subregions");
  const subs = JV_FLIGHT_SUBREGIONS[parentId];

  if (!sub) {
    const parent = document.getElementById("jv-flight-regions");
    if (!parent) return;
    sub = document.createElement("div");
    sub.id = "jv-flight-subregions";
    sub.className = "wm-flight-sub-bar";
    parent.insertAdjacentElement("afterend", sub);
  }

  if (!subs) {
    sub.style.display = "none";
    sub.innerHTML = "";
    return;
  }

  sub.style.display = "flex";
  sub.innerHTML = "";

  subs.forEach((s, i) => {
    const on  = i === 0;
    const btn = document.createElement("button");
    btn.textContent      = s.label;
    btn.dataset.subid    = s.id;
    btn.className        = "wm-tab-btn sm";
    btn.style.cssText    = [
      `border-color:rgba(255,158,61,.3)`,
      `background:${on ? "rgba(255,158,61,.9)" : "transparent"}`,
      `color:${on ? "#06121d" : "#c89464"}`,
      `font-weight:${on ? "700" : "400"}`,
    ].join(";");

    btn.addEventListener("click", () => {
      JV_FLIGHT.bbox = { lamin: s.lamin, lomin: s.lomin, lamax: s.lamax, lomax: s.lomax };
      sub.querySelectorAll("button").forEach(bb => {
        const active = bb.dataset.subid === s.id;
        bb.style.background = active ? "rgba(255,158,61,.9)" : "transparent";
        bb.style.color      = active ? "#06121d" : "#c89464";
        bb.style.fontWeight = active ? "700" : "400";
      });
      jvFlightLoad(true);
    });

    sub.appendChild(btn);
  });
}

function jvFlightSwitchRegion(id) {
  const r = JV_FLIGHT_REGIONS.find(x => x.id === id);
  if (!r) return;
  JV_FLIGHT.bbox     = { lamin: r.lamin, lomin: r.lomin, lamax: r.lamax, lomax: r.lomax };
  JV_FLIGHT.region   = r.id;
  JV_FLIGHT.selected = null;
  jvFlightSetRegion(r.id);
  jvFlightBuildRegionTabs(r.id);
  jvFlightLoad(true);
}

function jvFlightToggleExpand() {
  JV_FLIGHT.expanded = !JV_FLIGHT.expanded;
  const body = document.getElementById("jv-flight-body");
  const btn  = document.getElementById("jv-flight-expand-btn");
  if (!body) return;

  const h = JV_FLIGHT.expanded ? 400 : 320;
  body.style.height = h + "px";
  body.style.flex   = `0 0 ${h}px`;
  if (btn) btn.textContent = JV_FLIGHT.expanded ? "⊟" : "⤢";

  // Rebuild map at new size once layout settles
  setTimeout(() => jvFlightBuildMap(), 70);
}

function jvFlightZoom(factor) {
  if (JV_FLIGHT.svgSel && JV_FLIGHT.zoomBehav)
    JV_FLIGHT.svgSel.transition().duration(220)
      .call(JV_FLIGHT.zoomBehav.scaleBy, factor);
}

function jvFlightZoomReset() {
  if (JV_FLIGHT.svgSel && JV_FLIGHT.zoomBehav)
    JV_FLIGHT.svgSel.transition().duration(320)
      .call(JV_FLIGHT.zoomBehav.transform, window.d3.zoomIdentity);
}

function jvFlightInit() {
  jvFlightBuildRegionTabs("UAE");

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const match = JV_FLIGHT_REGIONS.find(r =>
          lat >= r.lamin && lat <= r.lamax && lon >= r.lomin && lon <= r.lomax
        );
        const id = match ? match.id : "UAE";
        if (match) {
          JV_FLIGHT.bbox   = { lamin: match.lamin, lomin: match.lomin, lamax: match.lamax, lomax: match.lomax };
          JV_FLIGHT.region = match.id;
        }
        jvFlightBuildRegionTabs(id);
        jvFlightSetRegion(id);
        jvFlightLoad(true);
      },
      () => { jvFlightSetRegion("UAE"); jvFlightLoad(true); },
      { timeout: 5000 }
    );
  } else {
    jvFlightSetRegion("UAE");
    jvFlightLoad(true);
  }

  // Refresh positions every 30s — icons only, no full map rebuild
  JV_FLIGHT.timer = setInterval(() => jvFlightLoad(false), 30000);
}

function jvFlightSetRegion(name) {
  JV_FLIGHT.region = name;
  const el = document.getElementById("jv-flight-region");
  if (el) el.textContent = name.toUpperCase() + " AIRSPACE";
}

function jvFlightLoad(rebuild) {
  const b = JV_FLIGHT.bbox;
  const url = `${WM_CONFIG.apiBase}/flights?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;

  fetch(url)
    .then(r => r.json())
    .then(data => {
      const loading = document.getElementById("jv-flight-loading");
      if (loading) loading.style.display = "none";

      JV_FLIGHT.flights = data.flights || [];
      jvFlightStats();
      jvFlightSetRegion(JV_FLIGHT.region);

      if (rebuild || !JV_FLIGHT.zoomLayer) jvFlightBuildMap();
      else jvFlightUpdateIcons();

      jvFlightDrawTable();
    })
    .catch(e => {
      console.warn("[FLIGHT]", e);
      jvFlightSetRegion(JV_FLIGHT.region);
    });
}

function jvFlightStats() {
  const f   = JV_FLIGHT.flights;
  const cEl = document.getElementById("jv-flight-count");
  const hEl = document.getElementById("jv-flight-highest");
  const sEl = document.getElementById("jv-flight-fastest");

  if (cEl) cEl.textContent = `${f.length} AIRBORNE`;

  const airborne = f.filter(x => !x.on_ground);
  if (airborne.length) {
    const hi = airborne.reduce((a, b) => a.alt_m > b.alt_m ? a : b);
    const fa = airborne.reduce((a, b) => a.spd_kmh > b.spd_kmh ? a : b);
    if (hEl) hEl.textContent = `· HIGHEST ${hi.callsign || hi.icao} ${hi.alt_ft.toLocaleString()}ft`;
    if (sEl) sEl.textContent = `· FASTEST ${fa.callsign || fa.icao} ${fa.spd_kmh}km/h`;
  } else {
    if (hEl) hEl.textContent = "";
    if (sEl) sEl.textContent = "";
  }
}

function jvFlightBuildMap() {
  const d3 = window.d3;
  if (!d3) return;

  const svgEl = document.getElementById("jv-flight-svg");
  const wrap  = document.getElementById("jv-flight-map-wrap");
  if (!svgEl || !wrap) return;

  const rect = wrap.getBoundingClientRect();
  const W    = Math.round(rect.width)  || 600;
  const H    = Math.round(rect.height) || 320;
  JV_FLIGHT.W = W;
  JV_FLIGHT.H = H;

  d3.select(svgEl).selectAll("*").remove();
  svgEl.setAttribute("width",   W);
  svgEl.setAttribute("height",  H);
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Pad the bounding box so it fills the panel without distortion.
  // We work in Mercator radians so the aspect-ratio maths is correct.
  const b   = JV_FLIGHT.bbox;
  const D2R = Math.PI / 180;
  const mercY    = lat => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
  const invMercY = y   => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

  let x0 = b.lomin * D2R, x1 = b.lomax * D2R;
  let y0 = mercY(b.lamin), y1 = mercY(b.lamax);
  let bw = x1 - x0, bh = y1 - y0;
  const panelAR = W / H;
  const boxAR   = bw / bh;

  if (boxAR < panelAR) {
    const add = ((bh * panelAR) - bw) / 2;
    x0 -= add; x1 += add;
  } else {
    const add = ((bw / panelAR) - bh) / 2;
    y0 -= add; y1 += add;
  }

  const padded = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[
      [x0 / D2R, invMercY(y0)], [x1 / D2R, invMercY(y0)],
      [x1 / D2R, invMercY(y1)], [x0 / D2R, invMercY(y1)],
      [x0 / D2R, invMercY(y0)],
    ]]},
  };

  const proj = d3.geoMercator().fitSize([W, H], padded);
  const path = d3.geoPath(proj);
  JV_FLIGHT.proj = proj;

  const svg = d3.select(svgEl);
  svg.append("rect").attr("width", W).attr("height", H).attr("fill", "#04080d");

  const Z = svg.append("g").attr("class", "jv-zoom");
  JV_FLIGHT.zoomLayer = Z;

  Z.append("path")
    .datum(d3.geoGraticule().step([5, 5])())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "rgba(74,200,255,.06)")
    .attr("stroke-width", 0.5);

  if (window._wmCountries) {
    Z.append("g").selectAll("path")
      .data(window._wmCountries.features).join("path")
      .attr("d", path)
      .attr("fill", "#0d1e30")
      .attr("stroke", "rgba(74,200,255,.30)")
      .attr("stroke-width", 0.6);
  }

  // Separate group for flight icons — updated cheaply without rebuilding the map
  Z.append("g").attr("class", "jv-flightlayer");

  // Timestamp label (bottom right, stays fixed outside zoom group)
  svg.append("text")
    .attr("x", W - 6).attr("y", H - 5)
    .attr("text-anchor", "end")
    .attr("font-size", "7px")
    .attr("fill", "rgba(74,200,255,.25)")
    .attr("font-family", "JetBrains Mono, monospace")
    .attr("pointer-events", "none")
    .attr("class", "jv-ts")
    .text("OpenSky · " + new Date().toLocaleTimeString("en-GB"));

  const zoom = d3.zoom()
    .scaleExtent([1, 14])
    .translateExtent([[0, 0], [W, H]])
    .on("zoom", ev => {
      Z.attr("transform", ev.transform);
      jvFlightScaleIcons(ev.transform.k);
    });

  JV_FLIGHT.zoomBehav = zoom;
  JV_FLIGHT.svgSel    = svg;
  svg.call(zoom).on("dblclick.zoom", null);

  svg.on("click", () => {
    if (JV_FLIGHT.selected) {
      JV_FLIGHT.selected = null;
      jvFlightHideCard();
      jvFlightUpdateIcons();
    }
  });

  jvFlightUpdateIcons();
}

// Icons shrink slightly as you zoom in so they don't dominate the view
function jvFlightScaleIcons(k) {
  const Z = JV_FLIGHT.zoomLayer;
  if (!Z) return;
  const grow = (1 + 0.5 * (Math.log(k) / Math.log(14))) / k;
  Z.selectAll(".jv-fnode").attr("transform", function() {
    const x = this.getAttribute("data-x");
    const y = this.getAttribute("data-y");
    return `translate(${x},${y}) scale(${grow})`;
  });
}

function jvFlightUpdateIcons() {
  const d3   = window.d3;
  const Z    = JV_FLIGHT.zoomLayer;
  const proj = JV_FLIGHT.proj;
  if (!Z || !proj) return;

  const layer = Z.select(".jv-flightlayer");
  layer.selectAll("*").remove();

  JV_FLIGHT.flights.forEach(f => {
    const pt = proj([f.lon, f.lat]);
    if (!pt || isNaN(pt[0]) || isNaN(pt[1])) return;

    const selected = JV_FLIGHT.selected && JV_FLIGHT.selected.icao === f.icao;

    const g = layer.append("g")
      .attr("class", "jv-fnode")
      .attr("data-x", pt[0])
      .attr("data-y", pt[1])
      .attr("transform", `translate(${pt[0]},${pt[1]})`)
      .style("cursor", "pointer")
      .on("click", ev => { ev.stopPropagation(); jvFlightSelectFlight(f, true); });

    // Highlight ring for selected flight
    if (selected) {
      g.append("circle").attr("r", 13)
        .attr("fill", "none")
        .attr("stroke", "#45d6ff")
        .attr("stroke-width", 1.5)
        .attr("opacity", 0.85);
    }

    // The plane icon
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", (f.on_ground ? 11 : 15) + "px")
      .attr("fill", f.alt_color || "#3ee08f")
      .attr("transform", `rotate(${f.heading})`)
      .style("filter", `drop-shadow(0 0 3px ${f.alt_color || "#3ee08f"})`)
      .text("✈");

    // Callsign label below the icon
    g.append("text")
      .attr("x", 0).attr("y", 17)
      .attr("text-anchor", "middle")
      .attr("font-size", "8px")
      .attr("fill", "rgba(159,211,230,.8)")
      .attr("font-family", "JetBrains Mono, monospace")
      .text(f.callsign || f.icao);
  });

  // Preserve any active zoom scaling
  const t = JV_FLIGHT.svgSel
    ? window.d3.zoomTransform(JV_FLIGHT.svgSel.node())
    : null;
  if (t && t.k !== 1) jvFlightScaleIcons(t.k);
}

function jvFlightSelectFlight(f, fromMap) {
  if (typeof f === "string") {
    try { f = JSON.parse(f); } catch { return; }
  }
  JV_FLIGHT.selected = f;
  jvFlightShowCard(f);
  jvFlightUpdateIcons();

  // Pan to centre the selected flight without changing the zoom level
  const d3   = window.d3;
  const svg  = JV_FLIGHT.svgSel;
  const proj = JV_FLIGHT.proj;

  if (svg && proj && JV_FLIGHT.zoomBehav) {
    const pt = proj([f.lon, f.lat]);
    if (pt) {
      const t  = d3.zoomTransform(svg.node());
      const k  = t.k;
      const tx = JV_FLIGHT.W / 2 - k * pt[0];
      const ty = JV_FLIGHT.H / 2 - k * pt[1];
      svg.transition().duration(450).call(
        JV_FLIGHT.zoomBehav.transform,
        d3.zoomIdentity.translate(tx, ty).scale(k)
      );
    }
  }
}

function jvFlightShowCard(f) {
  const card = document.getElementById("jv-flight-card");
  if (!card) return;
  card.style.display = "block";

  document.getElementById("jv-fc-callsign").textContent = f.callsign || f.icao;
  document.getElementById("jv-fc-origin").textContent   = "Origin: " + f.origin;
  document.getElementById("jv-fc-alt").textContent      = `ALT  ${f.alt_ft.toLocaleString()} ft  (${f.alt_m.toLocaleString()} m)`;
  document.getElementById("jv-fc-spd").textContent      = `SPD  ${f.spd_kmh} km/h`;
  document.getElementById("jv-fc-hdg").textContent      = `HDG  ${f.heading}°`;

  const statusColors = {
    "CRUISING":   "#3ee08f",
    "CLIMBING":   "#45d6ff",
    "DESCENDING": "#ffe14d",
    "ON GROUND":  "#5c7686",
  };
  const statusEl = document.getElementById("jv-fc-status");
  statusEl.textContent  = f.status;
  statusEl.style.color  = statusColors[f.status] || "#5c7686";
}

function jvFlightHideCard() {
  const card = document.getElementById("jv-flight-card");
  if (card) card.style.display = "none";
}

function jvFlightDrawTable() {
  const tbody = document.getElementById("jv-flight-table");
  if (!tbody) return;

  if (!JV_FLIGHT.flights.length) {
    tbody.innerHTML = '<div style="padding:12px 8px;font-size:9px;color:#3a5a6a;letter-spacing:.1em">No flights detected</div>';
    return;
  }

  tbody.innerHTML = "";

  JV_FLIGHT.flights.slice(0, 40).forEach(f => {
    const sel = JV_FLIGHT.selected && JV_FLIGHT.selected.icao === f.icao;
    const row = document.createElement("div");
    row.className = "wm-flight-table-row";
    if (sel) row.style.background = "rgba(69,214,255,.08)";

    row.innerHTML = `
      <div>
        <div class="wm-flight-row-callsign">${f.callsign || f.icao}</div>
        <div class="wm-flight-row-origin">${f.origin}</div>
      </div>
      <div class="wm-flight-row-alt" style="color:${f.alt_color || "#3ee08f"}">
        ${f.alt_ft.toLocaleString()}
      </div>
      <div class="wm-flight-row-spd">${f.spd_kmh}</div>`;

    row.addEventListener("click", () => jvFlightSelectFlight(f, false));
    tbody.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// COMPONENT — the DCLogic subclass the support.js runtime looks for
// ══════════════════════════════════════════════════════════════════════════

class Component extends DCLogic {

  constructor(props) {
    super(props);
    this.mapRef = React.createRef();

    // Time range definitions
    this.ranges = [
      { id: "1h",  min: 60     },
      { id: "6h",  min: 360    },
      { id: "24h", min: 1440   },
      { id: "48h", min: 2880   },
      { id: "7d",  min: 10080  },
      { id: "All", min: 1e12   },
    ];

    // Category → [colour, shape, label]
    this.catStyle = {
      high:       ["#ff4658", "dot", "HIGH ALERT"],
      elevated:   ["#ff9e3d", "dot", "ELEVATED"],
      seismic:    ["#ffe14d", "dot", "SEISMIC"],
      fire:       ["#ff7a1a", "dot", "WILDFIRE"],
      nuclear:    ["#b48cff", "tri", "NUCLEAR"],
      monitoring: ["#ffe14d", "dot", "MONITORING"],
    };

    // Map events — populated from live data after mount by jvBuildMapEvents()
    // (seismic from USGS, wildfires from NASA EONET, conflict/nuclear geocoded
    // from live news headlines). Starts empty; no more hardcoded pins.
    this.events = [];

    // Real-data layers only. Each event's `layer` must be one of these ids.
    this.layerDefs = [
      { id: "conflict", label: "CONFLICT EVENTS", color: "#ff4658" },
      { id: "seismic",  label: "SEISMIC M4.5+",   color: "#ffe14d" },
      { id: "wildfire", label: "WILDFIRES",       color: "#ff7a1a" },
      { id: "nuclear",  label: "NUCLEAR SIGNALS", color: "#b48cff" },
    ];

    this.legendItems = [
      { label: "Conflict",  color: "#ff4658", radius: "50%" },
      { label: "Elevated",  color: "#ff9e3d", radius: "50%" },
      { label: "Seismic",   color: "#ffe14d", radius: "50%" },
      { label: "Wildfire",  color: "#ff7a1a", radius: "50%" },
      { label: "Nuclear",   color: "#b48cff", radius: "1px" },
    ];

    // Colour per news category
    this.catColor = {
      mkt:   "#45e0c8",
      pol:   "#45d6ff",
      alert: "#ff4658",
      mil:   "#ff9e3d",
      cyber: "#b48cff",
    };

    // Seed news — replaced by real RSS after mount
    this.newsPool = [
      { source: "BLOOMBERG",  head: "Oil jumps 4% as Hormuz transit risk premium spikes",  cat: "mkt",   link: "" },
      { source: "REUTERS",    head: "Security Council calls emergency session on escalation", cat: "pol", link: "" },
      { source: "CNN",        head: "Flights diverted across Gulf airspace amid closures",   cat: "alert", link: "" },
      { source: "AL JAZEERA", head: "Ground operations expand along contested border",       cat: "alert", link: "" },
      { source: "DW",         head: "EU ministers weigh emergency energy measures",          cat: "pol",   link: "" },
      { source: "FRANCE24",   head: "Naval coalition reinforces shipping-lane patrols",      cat: "mil",   link: "" },
      { source: "CNBC",       head: "Defense equities rally; haven flows into gold",         cat: "mkt",   link: "" },
      { source: "SKY",        head: "Cyber incidents reported at two grid operators",        cat: "cyber", link: "" },
    ];

    this.sourceList = ["ALL", "BLOOMBERG", "REUTERS", "CNN", "AL JAZEERA", "DW", "FRANCE24", "SKY"];

    // Intel pools — CYBER THREATS is replaced by CISA feed after mount
    this.intelPools = {
      "MILITARY ACTIVITY": [
        ["CSG repositioning detected — E. Med",         "high"],
        ["UAV swarm intercepted near capital",           "high"],
        ["Armored column movement on highway",           "med"],
        ["Air-defense radar emissions up 40%",           "med"],
        ["Amphibious readiness drill underway",          "low"],
      ],
      "CYBER THREATS": [
        ["DDoS against telecom backbone",                "high"],
        ["Wiper signature seen at utility",              "high"],
        ["Phishing surge targeting logistics",           "med"],
        ["BGP route anomaly — traffic rerouted",         "med"],
        ["Ransomware claim on port operator",            "low"],
      ],
      "NUCLEAR": [
        ["Enrichment cascade activity flagged",          "high"],
        ["IAEA monitoring access restricted",            "high"],
        ["Reactor coolant anomaly reported",             "med"],
        ["Transport convoy under escort observed",       "med"],
        ["Seismic event near test site — review",        "low"],
      ],
    };

    this.sevColor = { high: "#ff4658", med: "#ff9e3d", low: "#ffe14d" };

    // Seed — replaced by /assessment (derived from live headlines) after mount.
    // Keys: mentions = headline mentions, conflict = kinetic hits, seismic = M5+ count.
    this.postureData = [
      { region: "Awaiting data", level: "—", color: "#5c7686", mentions: 0, conflict: 0, seismic: 0, note: "Deriving theatre posture from live headlines…" },
    ];

    // Webcam data — tab key → array of [city, note, isLive, ytId]
    this.webcamData = {
      "IRAN ATTACKS": [
        ["Tehran",    "Azadi Tower",  false, ""],
        ["Jerusalem", "Old City",     false, ""],
        ["Tel Aviv",  "Coastline",    true,  "rdP9cHTsHxk"],
        ["Gaza",      "Border",       false, ""],
        ["Beirut",    "Harbour",      false, ""],
        ["Dubai",     "Marina",       true,  "KTTFAfHE5xk"],
      ],
      "ALL": [
        ["Taipei",    "City cam",     true,  "rdP9cHTsHxk"],
        ["Dubai",     "Marina",       true,  "KTTFAfHE5xk"],
        ["London",    "Thames",       false, "RDZTNorkAEw"],
        ["New York",  "Times Sq",     true,  "WKpOoGHMXSE"],
        ["Tokyo",     "Shibuya",      true,  "UMEpOaCNIlk"],
        ["Singapore", "Port",         false, "oEvN8zMnEo4"],
      ],
      "MIDEAST": [
        ["Dubai",     "Marina",       true,  "KTTFAfHE5xk"],
        ["Abu Dhabi", "Corniche",     false, "8HrBxDVYJLQ"],
        ["Mecca",     "Grand Mosque", true,  "iqxKRMBR60A"],
        ["Istanbul",  "Bosphorus",    false, "1WLq8tSa3Gs"],
      ],
      "EUROPE": [
        ["London",    "Thames",       false, "RDZTNorkAEw"],
        ["Paris",     "Eiffel",       true,  "v9RhpyKdAkE"],
        ["Rome",      "Colosseum",    false, "FsgQExM8zv0"],
        ["Amsterdam", "Canal",        false, "nlMICHFdGUc"],
      ],
      "AMERICAS": [
        ["New York",  "Times Sq",     true,  "WKpOoGHMXSE"],
        ["Las Vegas", "Strip",        true,  "NyHDYtDTwWw"],
        ["Toronto",   "Downtown",     false, "oKQyF3VJkQQ"],
        ["Sao Paulo", "Centro",       false, "bxPWJlJHPaM"],
      ],
      "ASIA": [
        ["Taipei",    "101 Tower",    true,  "rdP9cHTsHxk"],
        ["Tokyo",     "Shibuya",      true,  "UMEpOaCNIlk"],
        ["Singapore", "Port",         false, "oEvN8zMnEo4"],
        ["Hong Kong", "Harbour",      false, "p6JCGSmDCaE"],
      ],
    };

    // Track which webcam tiles have been clicked and are showing the iframe
    this._loadedCams = new Set();

    this.infraStatsData = [
      { label: "CABLES",      val: 18, color: "#45d6ff" },
      { label: "PIPELINES",   val: 88, color: "#ff9e3d" },
      { label: "PORTS",       val: 62, color: "#45e0c8" },
      { label: "CHOKEPOINTS", val: 9,  color: "#ff4658" },
    ];

    this.infraTabList = ["CABLES", "PIPELINES", "PORTS", "CHOKEPOINTS"];

    this.infraData = {
      "CABLES": [
        ["SEA-ME-WE 5",   "Marseille → Singapore", "DEGRADED", "78%", "#ff9e3d"],
        ["FLAG Europe-Asia","UK → Japan",           "AT RISK",  "88%", "#ff4658"],
        ["AAE-1",          "HK → Marseille",        "NOMINAL",  "54%", "#45e0c8"],
        ["2Africa",        "Multi-landing",          "NOMINAL",  "41%", "#45e0c8"],
        ["MAREA",          "Virginia → Bilbao",      "NOMINAL",  "33%", "#45e0c8"],
      ],
      "PIPELINES": [
        ["Nord Stream", "Russia → DE",    "OFFLINE",  "0%",  "#ff4658"],
        ["TurkStream",  "Russia → TR",    "NOMINAL",  "62%", "#45e0c8"],
        ["TANAP",       "Azerbaijan → EU","ELEVATED", "71%", "#ff9e3d"],
        ["Druzhba",     "Russia → CEE",   "REDUCED",  "38%", "#ff9e3d"],
      ],
      "PORTS": [
        ["Rotterdam",   "Netherlands", "NOMINAL",   "64%", "#45e0c8"],
        ["Singapore",   "SGP",         "CONGESTED", "91%", "#ff4658"],
        ["Jebel Ali",   "UAE",         "ELEVATED",  "73%", "#ff9e3d"],
        ["Shanghai",    "China",       "NOMINAL",   "58%", "#45e0c8"],
      ],
      "CHOKEPOINTS": [
        ["Strait of Hormuz", "~21M bbl/day", "AT RISK",   "94%", "#ff4658"],
        ["Bab-el-Mandeb",    "Red Sea",      "ELEVATED",  "76%", "#ff9e3d"],
        ["Suez Canal",       "Egypt",        "MONITORED", "61%", "#ffe14d"],
        ["Malacca",          "SE Asia",      "NOMINAL",   "49%", "#45e0c8"],
      ],
    };

    // Static regional feed seed — WORLD NEWS/EUROPE/MIDDLE EAST get real RSS after mount
    this.regionsData = [
      { name: "WORLD NEWS",       items: [["REUTERS","Markets brace as Gulf tensions deepen",""],["AP","Diplomatic channels reopen amid ceasefire push",""],["BBC","Aid agencies warn of a widening crisis",""]] },
      { name: "UNITED STATES",    items: [["WSJ","White House convenes national-security team",""],["NYT","Pentagon orders carrier to remain on station",""],["POLITICO","Congress briefed behind closed doors",""]] },
      { name: "EUROPE",           items: [["DW","EU triggers energy contingency planning",""],["FT","Brent above $90 on supply fears",""],["GUARDIAN","Allies coordinate a sanctions response",""]] },
      { name: "MIDDLE EAST",      items: [["AL JAZEERA","Strikes reported across multiple fronts",""],["AL ARABIYA","Airspace partly closed to civil aviation",""],["HAARETZ","Home-front command raises alert level",""]] },
      { name: "ASIA-PACIFIC",     items: [["NIKKEI","Shipping insurers hike war-risk premiums",""],["SCMP","Naval drills extend in contested waters",""],["KYODO","Tokyo monitors Strait closures closely",""]] },
      { name: "AFRICA",           items: [["AFP","Clashes intensify near a key port",""],["REUTERS","Fuel shortages spread inland",""],["ENA","Humanitarian access negotiations stall",""]] },
      { name: "LATIN AMERICA",    items: [["EFE","Border mobilization reported overnight",""],["REUTERS","Energy exporters watch crude spike",""],["AP","Regional bloc calls for de-escalation",""]] },
      { name: "ENERGY & RESOURCES",items:[["PLATTS","LNG cargoes reroute around chokepoint",""],["BLOOMBERG","Gold tops record on haven demand",""],["ARGUS","Diesel cracks widen on supply risk",""]]} ,
    ];

    // Rotating AI assessment texts
    this.assessments = [
      "Escalation probability elevated across the Persian Gulf over the next 24–48h; monitor Hormuz transit.",
      "Energy-supply disruption risk rising; haven flows and war-risk premiums confirm market stress.",
      "Cyber activity correlates with kinetic events in two theatres — expect grid and telecom targeting.",
      "Naval repositioning suggests a deterrence posture rather than an imminent strike window.",
    ];

    this.regionOptions = ["GLOBAL", "MIDDLE EAST", "EUROPE", "ASIA-PACIFIC", "AMERICAS", "AFRICA"];

    this.state = {
      now:           Date.now(),
      vw:            typeof window !== "undefined" ? window.innerWidth : 1600,
      activeRange:   "7d",
      activeLayers:  ["conflict","seismic","wildfire","nuclear"],
      activeSource:  "ALL",
      activeWebTab:  "ALL",
      activeIntel:   "MILITARY ACTIVITY",
      activeInfra:   "CABLES",
      activeRegion:  "GLOBAL",
      selectedEvent: null,
      activeChannel: null,
      newsBig:       false,
      webcamBig:     false,
      bcastBig:      false,
      risk:          13,
      riskTrend:     "STABLE",
      prevRisk:      13,
      aiIdx:         0,
      news:          this.seedNews(),
      liveIntel:     this.seedIntel(),
      mapReady:      false,
      mapError:      false,
      muted:         false,
    };
  }

  seedNews() {
    const now = Date.now();
    return this.newsPool.slice(0, 6).map((n, i) => ({ ...n, ts: now - (i * 210000) - 30000 }));
  }

  seedIntel() {
    const now = Date.now();
    const out = [];
    Object.keys(this.intelPools).forEach((ch, ci) => {
      this.intelPools[ch].slice(0, 4).forEach((it, i) => {
        out.push({ channel: ch, text: it[0], sev: it[1], ts: now - ((ci * 4 + i) * 180000) - 20000 });
      });
    });
    return out;
  }

  rel(ts) {
    const s = Math.max(0, (this.state.now - ts) / 1000);
    if (s < 60)  return Math.floor(s) + "s";
    const m = s / 60;
    if (m < 60)  return Math.floor(m) + "m";
    const h = m / 60;
    if (h < 24)  return Math.floor(h) + "h";
    return Math.floor(h / 24) + "d";
  }

  componentDidMount() {
    // Clock tick
    this.t1 = setInterval(() => this.setState({ now: Date.now() }), 1000);
    // News cycle — swap a random item from the pool every 7s
    this.t2 = setInterval(() => this.pushNews(), 7000);
    // Intel stream — push a random intel item every 6s
    this.t3 = setInterval(() => this.pushIntel(), 6000);
    // Risk gauge nudge
    this.t4 = setInterval(() => this.nudgeRisk(), 4500);
    // Rotate AI assessment text
    this.t5 = setInterval(() => this.setState(s => ({ aiIdx: (s.aiIdx + 1) % this.assessments.length })), 9000);

    // Resize handler — rebuild map when the window changes size
    this._onResize = () => {
      this.setState({ vw: window.innerWidth });
      clearTimeout(this._rz);
      this._rz = setTimeout(() => this.buildMap(), 250);
    };
    window.addEventListener("resize", this._onResize);

    // Build the D3 map
    this.setupMap();

    // Fetch live stream IDs and wire all data panels
    this.fetchStreams();
    jvLoadMarkets();
    jvLoadQuakes();
    jvWireNews(this);
    jvWireRegions(this);
    jvWireCyber(this);
    jvWireAssessment(this);   // risk / posture / insights / military+nuclear intel
    jvBuildMapEvents(this);   // real markers on the GLOBAL SITUATION map
    this.fetchWebcams();      // auto-scraped fresh webcam IDs (anti-stale)

    // Refresh every 5 minutes (webcam scrape is server-cached for 30 min)
    this._t6 = setInterval(() => {
      jvLoadMarkets();
      jvLoadQuakes();
      jvWireNews(this);
      jvWireRegions(this);
      jvWireCyber(this);
      jvWireAssessment(this);
      jvBuildMapEvents(this);
      this.fetchWebcams();
    }, 5 * 60 * 1000);

    // Start flight radar
    jvFlightInit();
  }

  async fetchStreams() {
    const data = await wmFetch("streams");
    if (data && data.streams) {
      Object.assign(jvStreamIds, data.streams);
      this.forceUpdate();
    }
  }

  // Pull fresh, auto-scraped webcam IDs from the server so they never go stale.
  async fetchWebcams() {
    const data = await wmFetch("webcams");
    if (data && data.webcams && Object.keys(data.webcams).length) {
      this.webcamData = data.webcams;
      if (!this.webcamData[this.state.activeWebTab]) {
        this.setState({ activeWebTab: Object.keys(this.webcamData)[0] });
      }
      this._loadedCams.clear();
      this.forceUpdate();
    }
  }

  componentWillUnmount() {
    [this.t1, this.t2, this.t3, this.t4, this.t5, this._t6].forEach(clearInterval);
    window.removeEventListener("resize", this._onResize);
    clearInterval(JV_FLIGHT.timer);
  }

  pushNews() {
    if (this.newsPool.length) {
      const pick = this.newsPool[Math.floor(Math.random() * this.newsPool.length)];
      this.setState(s => ({ news: [{ ...pick, ts: Date.now() }, ...s.news].slice(0, 8) }));
    }
  }

  pushIntel() {
    const chs = Object.keys(this.intelPools);
    const ch  = chs[Math.floor(Math.random() * chs.length)];
    const it  = this.intelPools[ch][Math.floor(Math.random() * this.intelPools[ch].length)];
    this.setState(s => ({
      liveIntel: [{ channel: ch, text: it[0], sev: it[1], ts: Date.now() }, ...s.liveIntel].slice(0, 16),
    }));
  }

  nudgeRisk() {
    // Drift gently toward the real risk score from /assessment (set between
    // 5-minute refreshes), with tiny jitter so the gauge feels live.
    this.setState(s => {
      const target = this._realRisk != null ? this._realRisk : s.risk;
      const step   = Math.sign(target - s.risk) * Math.min(2, Math.abs(target - s.risk));
      let r = s.risk + step + Math.round((Math.random() - 0.5) * 2);
      r = Math.max(5, Math.min(95, r));
      const trend = r > s.risk + 1 ? "RISING" : r < s.risk - 1 ? "EASING" : "STABLE";
      return { risk: r, prevRisk: s.risk, riskTrend: trend };
    });
  }

  // Polls a condition until it's true or times out — used to wait for D3/TopoJSON CDN load
  waitFor(fn, timeout = 9000) {
    return new Promise(res => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (fn()) { clearInterval(iv); res(true); }
        else if (Date.now() - t0 > timeout) { clearInterval(iv); res(false); }
      }, 80);
    });
  }

  async setupMap() {
    const ok = await this.waitFor(() => window.d3 && window.topojson);
    if (!ok) { this.setState({ mapError: true }); return; }

    this.d3 = window.d3;
    let world;
    try {
      world = await this.d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    } catch (e) {
      this.setState({ mapError: true });
      return;
    }

    this.countries = window.topojson.feature(world, world.objects.countries);
    window._wmCountries = this.countries; // expose for the flight radar layer
    this.buildMap();
    this.setState({ mapReady: true });
  }

  buildMap() {
    const d3 = this.d3;
    const el = this.mapRef.current;
    if (!d3 || !el || !this.countries) return;

    const w = el.clientWidth  || 800;
    const h = el.clientHeight || 500;
    el.innerHTML = "";

    const proj = d3.geoEquirectangular().fitExtent([[8, 8], [w - 8, h - 8]], { type: "Sphere" });
    const path = d3.geoPath(proj);

    const svg = d3.select(el).append("svg")
      .attr("width", w).attr("height", h)
      .style("display", "block")
      .style("cursor", "grab");

    // Glow filter for event markers
    const defs = svg.append("defs");
    const f    = defs.append("filter").attr("id","wm-glow").attr("x","-80%").attr("y","-80%").attr("width","260%").attr("height","260%");
    f.append("feGaussianBlur").attr("stdDeviation", 2.4).attr("result", "b");
    const me = f.append("feMerge");
    me.append("feMergeNode").attr("in", "b");
    me.append("feMergeNode").attr("in", "SourceGraphic");

    const g = svg.append("g");

    // Globe outline + graticule + country fills
    g.append("path").datum({ type: "Sphere" }).attr("d", path)
      .attr("fill", "#050d15").attr("stroke", "rgba(74,200,255,.14)").attr("stroke-width", 1);
    g.append("path").datum(d3.geoGraticule10()).attr("d", path)
      .attr("fill", "none").attr("stroke", "rgba(74,200,255,.06)").attr("stroke-width", 0.5);
    g.append("g").selectAll("path")
      .data(this.countries.features).join("path")
      .attr("d", path)
      .attr("fill", "#0c1a28")
      .attr("stroke", "rgba(74,200,255,.22)")
      .attr("stroke-width", 0.5)
      .on("mouseover", function() { d3.select(this).attr("fill", "#15324a"); })
      .on("mouseout",  function() { d3.select(this).attr("fill", "#0c1a28"); });

    this.markersG = g.append("g");
    this.svg      = svg;
    this.proj     = proj;

    this.zoomBehav = d3.zoom()
      .scaleExtent([1, 9])
      .on("zoom", ev => g.attr("transform", ev.transform));

    svg.call(this.zoomBehav).on("dblclick.zoom", null);
    svg.on("click", () => this.setState({ selectedEvent: null }));

    this.updateMarkers();
  }

  updateMarkers() {
    const d3 = this.d3;
    if (!this.markersG || !this.proj || !d3) return;

    const rangeMin = (this.ranges.find(r => r.id === this.state.activeRange) || {}).min || 1e12;
    const active   = new Set(this.state.activeLayers);
    const visible  = this.events.filter(e => active.has(e.layer) && e.ageMin <= rangeMin);
    const self     = this;

    this.markersG.selectAll("*").remove();

    visible.forEach(d => {
      const p = this.proj([d.lon, d.lat]);
      if (!p) return;

      const grp = this.markersG.append("g")
        .attr("class", "wm-mk")
        .attr("transform", `translate(${p[0]},${p[1]})`)
        .style("cursor", "pointer")
        .on("click", ev => { ev.stopPropagation(); self.setState({ selectedEvent: d }); });

      if (d.cat === "high") {
        grp.append("circle")
          .attr("class", "wm-pulse-ring")
          .attr("r", 4).attr("fill", d.color).attr("opacity", 0.55);
      }

      if (d.shape === "tri") {
        grp.append("path").attr("d", "M0,-5.5 L4.8,3.8 L-4.8,3.8 Z")
          .attr("fill", d.color).attr("filter", "url(#wm-glow)");
      } else if (d.shape === "sq") {
        grp.append("rect").attr("x", -3.6).attr("y", -3.6).attr("width", 7.2).attr("height", 7.2)
          .attr("fill", d.color).attr("filter", "url(#wm-glow)");
      } else {
        grp.append("circle").attr("r", 3.4)
          .attr("fill", d.color).attr("filter", "url(#wm-glow)");
      }

      // Thin ring outline on all markers
      grp.append("circle").attr("r", 3.4)
        .attr("fill", "none")
        .attr("stroke", "rgba(255,255,255,.55)")
        .attr("stroke-width", 0.4);

      grp.append("title").text(`${d.name} — ${d.catLabel}`);
    });
  }

  setRange(id)     { this.setState({ activeRange: id }, () => this.updateMarkers()); }
  toggleLayer(id)  {
    this.setState(s => {
      const a = new Set(s.activeLayers);
      a.has(id) ? a.delete(id) : a.add(id);
      return { activeLayers: [...a] };
    }, () => this.updateMarkers());
  }
  zoomIn()    { if (this.svg) this.svg.transition().duration(280).call(this.zoomBehav.scaleBy,  1.6); }
  zoomOut()   { if (this.svg) this.svg.transition().duration(280).call(this.zoomBehav.scaleBy, 1/1.6); }
  zoomReset() { if (this.svg) this.svg.transition().duration(420).call(this.zoomBehav.transform, this.d3.zoomIdentity); }

  // ── renderVals — single source of truth for all {{ }} bindings ──────────

  renderVals() {
    const s = this.state;

    // Clock
    const d   = new Date(s.now);
    const pad = n => String(n).padStart(2, "0");
    const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    const MONS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const clock   = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    const dateStr = `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    // Map range tabs
    const rangeTabs = this.ranges.map(r => {
      const on = r.id === s.activeRange;
      return { id: r.id, onClick: () => this.setRange(r.id), bg: on ? "#45d6ff" : "transparent", fg: on ? "#06121d" : "#7fb6cc" };
    });

    // Layer list
    const activeSet = new Set(s.activeLayers);
    const layerList = this.layerDefs.map(l => {
      const on = activeSet.has(l.id);
      return {
        id: l.id, label: l.label, color: l.color, active: on,
        onToggle:   () => this.toggleLayer(l.id),
        boxBg:      on ? "#45d6ff" : "transparent",
        boxBd:      on ? "#45d6ff" : "rgba(74,200,255,.3)",
        labelColor: on ? "#cfe7f1" : "#5c7686",
        check:      on ? "✓" : "",
      };
    });

    // News
    const sourceTabs = this.sourceList.map(x => {
      const on = x === s.activeSource;
      return { id: x, onClick: () => this.setState({ activeSource: x }), bg: on ? "#ff4658" : "transparent", fg: on ? "#fff" : "#6f93a5", bd: on ? "#ff4658" : "rgba(74,200,255,.18)" };
    });

    const newsList = s.news
      .filter(n => s.activeSource === "ALL" || n.source === s.activeSource)
      .map((n, i) => ({
        source:   n.source,
        head:     n.head,
        rel:      this.rel(n.ts),
        catColor: this.catColor[n.cat] || "#45d6ff",
        rowBg:    i === 0 ? "rgba(69,214,255,.05)" : "transparent",
        link:     n.link || "",
      }));

    // Posture
    const postureList = this.postureData.map(p => ({ ...p, bd: "rgba(74,200,255,.14)" }));

    // Risk gauge
    const r = s.risk;
    let riskLevel = "LOW", riskColor = "#3ee08f";
    if      (r >= 70) { riskLevel = "HIGH";    riskColor = "#ff4658"; }
    else if (r >= 45) { riskLevel = "ELEVATED"; riskColor = "#ff9e3d"; }
    else if (r >= 25) { riskLevel = "GUARDED";  riskColor = "#ffe14d"; }
    const riskCirc       = 2 * Math.PI * 52;
    const riskDashOffset = riskCirc * (1 - r / 100);
    const trendMap = { RISING: ["#ff6b78","▲"], EASING: ["#3ee08f","▼"], STABLE: ["#7fb6cc","■"] };
    const tm = trendMap[s.riskTrend] || trendMap.STABLE;

    // Webcam tiles
    const webTabs = Object.keys(this.webcamData).map(x => {
      const on = x === s.activeWebTab;
      return { id: x, onClick: () => this.setState({ activeWebTab: x }, () => this._loadedCams.clear()), bg: on ? "#ff4658" : "transparent", fg: on ? "#fff" : "#6f93a5", bd: on ? "#ff4658" : "rgba(74,200,255,.18)" };
    });

    const webcamTiles = (this.webcamData[s.activeWebTab] || []).map(c => {
      const ytId  = c[3];
      const loaded = !!(ytId && this._loadedCams.has(ytId));
      return {
        city:       c[0],
        note:       c[1],
        live:       c[2],
        status:     c[2] ? "LIVE" : "OFFLINE",
        statusColor:c[2] ? "#3ee08f" : "#5c7686",
        bd:         c[2] ? "rgba(62,224,143,.4)" : "rgba(74,200,255,.12)",
        bg:         c[2] ? "linear-gradient(135deg,#0a2230,#06131d)" : "linear-gradient(135deg,#0a1018,#06101a)",
        thumb:      ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : "",
        iframeSrc:  ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=0&rel=0&modestbranding=1` : "",
        loaded,
        notLoaded:  !loaded,
        onClick:    ytId ? () => { this._loadedCams.add(ytId); this.forceUpdate(); } : () => {},
      };
    });

    // Infra
    const infraStats = this.infraStatsData.map(x => x);
    const infraTabs  = this.infraTabList.map(x => {
      const on = x === s.activeInfra;
      return { id: x, onClick: () => this.setState({ activeInfra: x }), bg: on ? "#45d6ff" : "transparent", fg: on ? "#06121d" : "#6f93a5", bd: on ? "#45d6ff" : "rgba(74,200,255,.18)" };
    });
    const infraList = (this.infraData[s.activeInfra] || []).map(f => ({ name: f[0], sub: f[1], status: f[2], load: f[3], statusColor: f[4] }));

    // Intel
    const intelTabs = Object.keys(this.intelPools).map(x => {
      const on = x === s.activeIntel;
      return { id: x, onClick: () => this.setState({ activeIntel: x }), bg: on ? "#45d6ff" : "transparent", fg: on ? "#06121d" : "#6f93a5", bd: on ? "#45d6ff" : "rgba(74,200,255,.18)" };
    });
    const intelList = s.liveIntel
      .filter(i => i.channel === s.activeIntel)
      .map((i, idx) => ({
        text:     i.text,
        channel:  i.channel,
        rel:      this.rel(i.ts),
        sevColor: this.sevColor[i.sev],
        rowBg:    idx === 0 ? "rgba(69,214,255,.05)" : "transparent",
      }));

    // Regional feeds
    const regionCols = this.regionsData.map((rg, gi) => ({
      name:  rg.name,
      items: rg.items.map((it, ii) => ({
        src:  it[0],
        head: it[1],
        rel:  this.rel(s.now - ((gi * 3 + ii) * 420000) - 60000),
        link: it[2] || "",
      })),
    }));

    // AI metrics — fed by /assessment (with sane fallbacks before it lands)
    const aiConf = this._aiConfidence != null ? this._aiConfidence : 82;
    const aiMetrics = [
      { label: "VECTORS",    val: this._aiVectors != null ? this._aiVectors : 0, color: "#ff9e3d" },
      { label: "CONFIDENCE", val: aiConf + "%",                                  color: "#45e0c8" },
      { label: "SOURCES",    val: this._aiSources != null ? this._aiSources : 0, color: "#45d6ff" },
    ];

    // Live broadcast channels
    const channelTabs = JV_CHANNELS.map(ch => {
      const on = ch.id === s.activeChannel;
      return { label: ch.label, onClick: () => this.setState({ activeChannel: ch.id }), bg: on ? "#ff4658" : "transparent", fg: on ? "#fff" : "#6f93a5", bd: on ? "#ff4658" : "rgba(74,200,255,.18)" };
    });
    const activeChObj  = JV_CHANNELS.find(c => c.id === s.activeChannel);
    const channelVid   = activeChObj ? (jvStreamIds[activeChObj.id] || activeChObj.vid) : null;
    const channelSrc   = channelVid ? `https://www.youtube-nocookie.com/embed/${channelVid}?autoplay=0&rel=0&modestbranding=1` : "";

    // Panel expand toggles
    const newsSpan      = "1/-1";
    const newsMaxH      = s.newsBig   ? "320px" : "212px";
    const newsSizeIcon  = s.newsBig   ? "⊟" : "⤢";
    const webcamSpan    = "1/-1";
    const webcamBig     = s.webcamBig ? "big" : "";  // CSS class toggle
    const webcamSizeIcon= s.webcamBig ? "⊟" : "⤢";
    const bcastSpan     = s.bcastBig  ? "1/-1" : "auto";
    const bcastSizeIcon = s.bcastBig  ? "⊟" : "⤢";

    return {
      // Map
      mapRef: this.mapRef,
      clock, dateStr,
      regionOptions: this.regionOptions, activeRegion: s.activeRegion,
      onRegion: e => this.setState({ activeRegion: e.target.value }),
      alertsCount: this.events.filter(e => e.cat === "high").length,
      eventsCount: this.events.length,
      muted: s.muted, muteIcon: s.muted ? "🔇" : "🔊", toggleMute: () => this.setState(x => ({ muted: !x.muted })),
      rangeTabs, zoomIn: () => this.zoomIn(), zoomOut: () => this.zoomOut(), zoomReset: () => this.zoomReset(),
      layerList, activeLayerCount: s.activeLayers.length, layerTotal: this.layerDefs.length,
      legendItems: this.legendItems, mapLoading: !s.mapReady && !s.mapError, mapError: s.mapError,
      hasSelected: !!s.selectedEvent,
      sel: s.selectedEvent ? {
        ...s.selectedEvent,
        glow:   "rgba(74,200,255,.08)",
        coords: `${s.selectedEvent.lat.toFixed(1)}°, ${s.selectedEvent.lon.toFixed(1)}°`,
        rel:    (() => {
          const m = s.selectedEvent.ageMin;
          if (m < 60)  return m + "M";
          const h = m / 60;
          if (h < 24)  return Math.floor(h) + "H";
          return Math.floor(h / 24) + "D";
        })(),
      } : {},
      closeEvent:   () => this.setState({ selectedEvent: null }),
      closeMonitor: () => closeMonitor(),

      // News
      sourceTabs, newsList,
      newsSpan, newsMaxH, newsSizeIcon, toggleNewsSize: () => this.setState(x => ({ newsBig: !x.newsBig })),

      // Webcams
      webcamSpan, webcamBig, webcamSizeIcon, toggleWebcamSize: () => this.setState(x => ({ webcamBig: !x.webcamBig })),
      webTabs, webcamTiles,

      // Broadcast
      bcastSpan, bcastSizeIcon, toggleBcastSize: () => this.setState(x => ({ bcastBig: !x.bcastBig })),
      channelTabs, hasChannel: !!channelSrc, noChannel: !channelSrc, channelSrc,

      // Posture
      postureList, postureCount: this.postureData.length,

      // Risk
      risk: r, riskLevel, riskColor, riskCirc, riskDashOffset,
      riskTrend: s.riskTrend, riskTrendColor: tm[0], riskTrendIcon: tm[1],
      activeRange: s.activeRange,

      // AI Insights
      assessment: this.assessments[s.aiIdx], aiMetrics, aiConfidence: aiConf,

      // Infra
      infraStats, infraTabs, infraList, infraLinks: 435,

      // Intel
      intelTabs, intelList,

      // Regions
      regionCols,
    };
  }
}
