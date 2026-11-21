// Scheduled each morning: run the health check and notify devices with "App health notices" on,
// only when something starts failing or recovers (no daily nagging).
import { store } from "../lib/shared.mjs";
import { subs, send } from "../lib/push.mjs";
import { runHealth } from "../lib/health.mjs";

export default async () => {
  const s = store("snowline-cache"), r = await runHealth(); let prev = null;
  try { prev = await s.get("health-last", { type: "json" }); } catch (e) {}
  try { await s.setJSON("health-last", r); } catch (e) {}
  const bad = r.results.filter(x => !x.ok).map(x => x.name), was = (prev?.results || []).filter(x => !x.ok).map(x => x.name);
  console.log(`health: ${r.results.length - bad.length}/${r.results.length} ok${bad.length ? " · failing: " + bad.join(", ") : ""}`);
  if (bad.join("|") === was.join("|")) return;
  const fixed = was.filter(n => !bad.includes(n));
  const msg = bad.length ? { title: `⚠️ Snowline: ${bad.length} data source${bad.length > 1 ? "s" : ""} failing`, body: r.results.filter(x => !x.ok).map(x => `${x.name}: ${x.error}`).join("\n").slice(0, 300) }
    : { title: "✅ Snowline: all data sources working again", body: fixed.join(", ") };
  const st = subs(); const { blobs } = await st.list();
  for (const b of blobs) { const rec = await st.get(b.key, { type: "json" }); if (rec?.prefs?.health) await send(rec.sub, { ...msg, url: "/#status", tag: "snowline-health" }).catch(() => {}); }
};
export const config = { schedule: "5 15 * * *" };
