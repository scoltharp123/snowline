// Builds public/skiareas.json: a small search index of the world's named ski areas (alpine and Nordic)
// from OpenSkiMap, which is built from OpenStreetMap (© OpenStreetMap contributors, ODbL).
// Runs during the Netlify build. To keep builds quick it reuses the copy already on the site
// unless that copy is more than REFRESH_DAYS old. If anything fails, the build still succeeds and
// search falls back to the town/peak search.
import { writeFileSync, existsSync } from "node:fs";

const OUT = new URL("../public/skiareas.json", import.meta.url);
const SITE = "https://snowline-forecast.netlify.app/skiareas.json";
const SOURCES = ["https://tiles.openskimap.org/geojson/ski_areas.geojson", "https://tiles.skimap.org/geojson/ski_areas.geojson"];
const REFRESH_DAYS = 30;
const SKIP = new Set(["abandoned", "disused", "proposed", "planned", "construction"]);

const write = (o) => { writeFileSync(OUT, JSON.stringify(o)); console.log(`skiareas.json: ${o.rows.length} ski areas (built ${o.built})`); };

async function previous() {
  try { const r = await fetch(SITE, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.rows) && j.rows.length ? j : null; } catch { return null; }
}

function center(g) {
  if (!g) return null;
  if (g.type === "Point") return g.coordinates;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(p => p[0]) : [];
  let best = null, bestN = -1; for (const r of rings) if (r && r.length > bestN) { best = r; bestN = r.length; }
  if (!best) return null;
  let x = 0, y = 0; for (const [a, b] of best) { x += a; y += b; } return [x / best.length, y / best.length];
}

function slim(f) {
  const p = f.properties || {}; const name = (p.name || "").trim();
  if (!name || SKIP.has(p.status)) return null;
  const acts = p.activities || []; const kind = (acts.includes("downhill") ? "a" : "") + (acts.includes("nordic") ? "n" : "");
  if (!kind) return null;
  const c = center(f.geometry); if (!c) return null;
  const pl = (p.places && p.places[0]) || p.location || null, en = pl?.localized?.en || {};
  const cc = pl?.iso3166_1Alpha2 || "";
  const sub = pl?.iso3166_2 && /^(US|CA)-/.test(pl.iso3166_2) ? pl.iso3166_2.slice(3) : "";
  const st = p.statistics || {};
  const lo = st.minElevation ?? st.runs?.minElevation ?? st.lifts?.minElevation, hi = st.maxElevation ?? st.runs?.maxElevation ?? st.lifts?.maxElevation;
  const r1 = v => Math.round(v * 1e4) / 1e4, el = v => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);
  return [name, r1(c[1]), r1(c[0]), kind, cc, sub || en.region || "", en.locality || "", el(lo), el(hi)];
}

async function build() {
  for (const url of SOURCES) {
    try {
      console.log("Downloading", url);
      const r = await fetch(url, { signal: AbortSignal.timeout(240000) }); if (!r.ok) { console.log("  ", r.status); continue; }
      const j = JSON.parse(await r.text());
      const seen = new Set(), rows = [];
      for (const f of j.features || []) { const s = slim(f); if (!s) continue; const k = s[0] + s[1].toFixed(2) + s[2].toFixed(2); if (seen.has(k)) continue; seen.add(k); rows.push(s); }
      if (rows.length > 500) return { built: new Date().toISOString(), source: "OpenSkiMap.org, © OpenStreetMap contributors (ODbL)", cols: ["name","lat","lon","kind","country","region","locality","minEl","maxEl"], rows };
    } catch (e) { console.log("  failed:", e.message); }
  }
  return null;
}

const prev = await previous();
const fresh = prev && Date.now() - Date.parse(prev.built) < REFRESH_DAYS * 864e5;
if (fresh && !process.env.SKIAREAS_REBUILD) write(prev);
else { const b = await build(); if (b) write(b); else if (prev) write(prev); else if (!existsSync(OUT)) write({ built: new Date(0).toISOString(), rows: [] }); }
