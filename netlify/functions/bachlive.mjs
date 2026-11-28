// GET /api/bachlive → Mt. Bachelor's own live lift-top weather (the same feed as its "Live 24 Hour Weather" page).
// Cached at the edge for 5 minutes so every Snowline user shares one call. ?raw=1 shows the feed's first readings.
import { json } from "../lib/shared.mjs";

const URL_ = "https://api.mtbachelor.com/api/v1/dor/24-hour-weather";
const ORDER = [["summit", "Summit"], ["northwest", "Northwest"], ["pine", "Pine Marten"], ["cloud", "Cloudchaser"], ["sunrise", "Sunrise"], ["village", "West Village"], ["snowplot", "Snow plot"]];
// Bachelor's feed writes local Pacific clock time but labels it "Z". Read it as Pacific.
function pacific(ts) {
  const m = String(ts || "").match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if (!m) return null;
  const asUtc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(asUtc)).map(x => [x.type, x.value]));
  const off = Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - asUtc;     // Pacific minus UTC (−8 h or −7 h)
  const t = asUtc - off;
  return t > Date.now() + 15 * 60e3 ? asUtc : t;                                        // if that lands in the future, trust the "Z"
}
const num = v => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const pick = (o, re, no) => { for (const [k, v] of Object.entries(o || {})) if (re.test(k) && !(no && no.test(k)) && num(v) != null) return { k, v: num(v) }; return null; };

function reading(r) {
  if (!r || typeof r !== "object") return null;
  const t = pick(r, /temp/i, /dew|chill|feel|min|max|low|high/i);
  const w = pick(r, /wind/i, /gust|max|dir|chill|deg/i);
  const g = pick(r, /gust|wind.*max|max.*wind/i, /dir/i);
  const dp = pick(r, /depth/i);
  const d = pick(r, /dir|deg/i);
  const at = pacific(Object.entries(r).find(([k, v]) => /time|date|stamp|updated/i.test(k) && v)?.[1]);
  let T = t?.v; if (T != null && !/(^|_)c$|cel/i.test(t.k)) T = (T - 32) * 5 / 9;    // app works in °C; feed is °F
  const kmh = x => x == null ? null : x * 1.609;                                      // app works in km/h; feed is mph
  const ok = x => x != null && x >= 0 ? x : null;                                     // dead sensors report negatives
  let W = ok(w?.v ?? null), G = ok(g?.v ?? null); if (!W && !G) W = G = null;             // all-zero = no wind sensor
  return { tC: T ?? null, w: kmh(W), g: G && G > (W || 0) ? kmh(G) : null, dir: W ? ok(d?.v ?? null) : null, depthIn: ok(dp?.v ?? null), at };
}

export default async (req) => {
  const raw = new URL(req.url).searchParams.has("raw");
  try {
    const r = await fetch(URL_, { headers: { "User-Agent": "Mozilla/5.0 Snowline", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (raw) return json({ keys: Object.keys(j || {}), sample: Object.fromEntries(Object.entries(j || {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 2) : v])) }, { cache: 60 });
    const lifts = [], seen = new Set();
    for (const [key, v] of Object.entries(j || {})) {
      if (/^current$/i.test(key)) continue;
      const first = Array.isArray(v) ? v[0] : v, lab = String(first?.name || first?.location || first?.station || key);
      const hit = ORDER.findIndex(([re]) => new RegExp(re, "i").test(lab) || new RegExp(re, "i").test(key));
      const name = hit >= 0 ? ORDER[hit][1] : lab.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      if (seen.has(name)) continue; const x = reading(first); if (!x || x.tC == null || !x.at || Date.now() - x.at > 3 * 3600e3) continue;   // skip stale or broken stations
      seen.add(name); lifts.push({ name, rank: hit < 0 ? 99 : hit, ...x });
    }
    lifts.sort((a, b) => a.rank - b.rank);
    return json({ lifts, at: Date.now(), link: "https://www.mtbachelor.com/the-mountain/live-24-hour-weather/" }, { cache: 300 });
  } catch (e) {
    return json({ lifts: [], error: String(e.message || e) }, { cache: 120 });
  }
};
export const config = { path: "/api/bachlive" };
