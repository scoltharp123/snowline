// POST /api/push   {action:"subscribe", sub, spots, prefs} | {action:"unsubscribe", endpoint} | {action:"test", endpoint}
import { json } from "../lib/shared.mjs";
import { subs, subKey, send, buildAlert, buildBrief, combine } from "../lib/push.mjs";

export default async (req) => {
  if (req.method === "GET") return json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  if (req.method !== "POST") return json({ error: "POST only" }, { status: 405 });
  let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
  const s = subs();
  if (b.action === "subscribe") {
    if (!b.sub?.endpoint || !Array.isArray(b.spots)) return json({ error: "sub and spots required" }, { status: 400 });
    const rec = { sub: b.sub, spots: b.spots.slice(0, 6).map(x => ({ name: String(x.name).slice(0, 80), lat: +x.lat, lon: +x.lon, base: +x.base, top: +x.top })), prefs: { overnight: +b.prefs?.overnight || 4, forecast: +b.prefs?.forecast || 8, brief: ["off","snow","daily"].includes(b.prefs?.brief) ? b.prefs.brief : "snow", units: b.prefs?.units === "met" ? "met" : "imp" },
      rules: (Array.isArray(b.rules) ? b.rules : []).slice(0, 12).map(r => ({ spot: String(r.spot).slice(0, 100), type: r.type === "overnight" ? "overnight" : "forecast", win: ["h24","d3","d5","d10"].includes(r.win) ? r.win : "d3", inches: Math.max(0.5, Math.min(60, +r.inches || 6)), spotObj: r.spotObj ? { name: String(r.spotObj.name).slice(0, 80), lat: +r.spotObj.lat, lon: +r.spotObj.lon, base: +r.spotObj.base, top: +r.spotObj.top } : null })),
      created: Date.now() };
    try { const old = await s.get(subKey(b.sub.endpoint), { type: "json" }); if (old?.watched) rec.watched = old.watched; } catch (e) {}   // don't re-announce storms already sent
    rec.prefs.watch = b.prefs?.watch !== false;
    rec.prefs.health = b.prefs?.health === true;
    await s.setJSON(subKey(b.sub.endpoint), rec);
    return json({ ok: true });
  }
  if (b.action === "unsubscribe") { if (b.endpoint) await s.delete(subKey(b.endpoint)); return json({ ok: true }); }
  if (b.action === "test") {
    const rec = b.endpoint && await s.get(subKey(b.endpoint), { type: "json" });
    if (!rec) return json({ error: "not subscribed" }, { status: 404 });
    const alert = combine(await buildAlert(rec).catch(() => null), await buildBrief(rec, true).catch(() => null));
    const res = await send(rec.sub, alert ? { ...alert, title: "Test · " + alert.title } : { title: "Snowline alerts are on ❄️", body: `You'll hear from us around 6am when ${rec.spots.map(x => x.name.replace(/,\s*[A-Z]{2}$/, "")).slice(0, 3).join(", ")} gets snow.`, url: "/#alerts", tag: "snowline-test" });
    return json({ ok: res === "ok", result: res });
  }
  return json({ error: "unknown action" }, { status: 400 });
};
export const config = { path: "/api/push" };
