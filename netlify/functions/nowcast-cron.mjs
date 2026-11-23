// Every 15 minutes: if snow is about to start (in roughly 15–75 minutes) at one of someone's favorites, send a heads-up.
// At most one per spot every 10 hours, and only between 6am and 9:30pm Pacific.
import { subs, send } from "../lib/push.mjs";
import { nowcastFor, clock } from "../lib/nowcast.mjs";

const short = (n) => String(n || "").replace(/,\s*[A-Z]{2}$/, "").replace(/ \(.*\)$/, "");
export default async () => {
  const hr = +new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false }).format(new Date()).replace(":", ".");
  if (hr < 6 || hr > 21.3) return;
  const s = subs(); const { blobs } = await s.list(); const cache = new Map(); let sent = 0;
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: "json" }).catch(() => null); if (!rec || rec.prefs?.nowcast === false) continue;
    rec.nc ||= {}; let hit = null;
    for (const sp of (rec.spots || []).slice(0, 4)) {
      if (Date.now() - (rec.nc[sp.name] || 0) < 10 * 3600e3) continue;
      const k = sp.name + "|" + (rec.prefs?.band || "summit");
      if (!cache.has(k)) cache.set(k, nowcastFor(sp, rec.prefs).catch(() => null));
      const n = await cache.get(k);
      if (n?.state === "soon" && n.totIn >= 0.5) { const mins = Math.round((n.startMs - Date.now()) / 60e3); if (mins >= 10 && mins <= 75 && (!hit || n.totIn > hit.n.totIn)) hit = { sp, n, mins }; }
    }
    if (!hit) continue;
    const { sp, n, mins } = hit, amt = n.totIn >= 1 ? `About ${Math.round(n.totIn)}″` : "A little snow";
    const r = await send(rec.sub, { title: `❄️ Snow starts at ${short(sp.name)} in about ${Math.max(10, Math.round(mins / 5) * 5)} min`,
      body: `${amt}${n.endMs ? ` by ${clock(n.endMs, n.off)}` : " in the next few hours"}${n.peakRate >= 0.4 ? `, heaviest around ${clock(n.peakMs, n.off)}` : ""}.`,
      url: `/?s=${encodeURIComponent(sp.name)}`, tag: "snowline-nowcast" });
    if (r === "ok") { sent++; rec.nc[sp.name] = Date.now(); await s.setJSON(b.key, rec); } else if (r === "gone") await s.delete(b.key);
  }
  if (sent) console.log("nowcast-cron sent", sent);
};
export const config = { schedule: "*/15 * * * *" };
