// Anonymous usage tallies, so the owner can see WHY people open Snowline: which spots, which cards they actually
// look at, which explanations they open, Home Screen vs browser, new vs returning, time of day.
// No IDs, no IP, no cookies: each visit sends one small beacon of counts when the app is put away, and it's added
// into a per-day total. GET /api/usage?days=14 → the summed totals for the owner's view.
import { json, store } from "../lib/shared.mjs";

const ID = /^[a-zA-Z0-9._-]{1,28}$/, BUCKETS = ["<30s", "30s-2m", "2-5m", "5m+"];
const day = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const clean = (obj, max, keyOk = k => ID.test(k)) => {
  const out = {}; if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj).slice(0, max)) if (keyOk(k) && isFinite(+v) && +v > 0) out[k] = Math.min(+v, 20);
  return out; };
const empty = () => ({ visits: 0, home: 0, returning: 0, spots: {}, modes: {}, cards: {}, opens: {}, tips: {}, dur: {}, hour: {} });

export default async (req) => {
  const st = store("snowline-usage");
  if (req.method === "GET") {
    const n = Math.max(1, Math.min(60, +new URL(req.url).searchParams.get("days") || 14)), tot = empty(), days = [];
    const keys = Array.from({ length: n }, (_, i) => "use-" + day(new Date(Date.now() - i * 864e5)));
    const docs = await Promise.all(keys.map(k => st.get(k, { type: "json" }).catch(() => null)));
    docs.forEach((d, i) => { days.push({ day: keys[i].slice(4), visits: d?.visits || 0 }); if (!d) return;
      for (const f of ["visits", "home", "returning"]) tot[f] += d[f] || 0;
      for (const f of ["spots", "modes", "cards", "opens", "tips", "dur", "hour"]) for (const [k, v] of Object.entries(d[f] || {})) add(tot[f], k, v); });
    return json({ days: days.reverse(), ...tot }, { cache: 60 });
  }
  if (req.method !== "POST") return json({ error: "GET or POST" }, { status: 405 });
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
  if (b?.v !== 1) return json({ error: "v" }, { status: 400 });
  const key = "use-" + day(), d = (await st.get(key, { type: "json" }).catch(() => null)) || empty();
  if (b.first) { d.visits++; if (b.home) d.home++; if (b.ret) d.returning++;
    const h = +b.hour; if (h >= 0 && h < 24) add(d.hour, String(h)); }
  if (BUCKETS.includes(b.dur)) add(d.dur, b.dur);
  // Everything counts once per visit, so the owner view can say "x% of visits".
  for (const k of Object.keys(clean(b.spots, 6, k => k.length <= 60 && !/[<>"]/.test(k)))) add(d.spots, k);
  for (const k of Object.keys(clean(b.modes, 4))) add(d.modes, k);
  for (const f of ["cards", "opens", "tips"]) for (const k of Object.keys(clean(b[f], 40))) add(d[f], k);
  // Keep a day's record small even if something misbehaves.
  for (const f of ["spots", "cards", "opens", "tips"]) if (Object.keys(d[f]).length > 120)
    d[f] = Object.fromEntries(Object.entries(d[f]).sort((a, c) => c[1] - a[1]).slice(0, 100));
  await st.setJSON(key, d);
  return new Response(null, { status: 204 });
};
export const config = { path: "/api/usage" };
