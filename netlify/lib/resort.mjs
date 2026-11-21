// Mt. Bachelor's published snow reports, saved day by day for grading (blob "snowline-score", key resort-bachelor).
import { store } from "./shared.mjs";
const KEEP_DAYS = 240;
export async function mergeBachelorLog(list) {
  if (!Array.isArray(list) || !list.length) return { added: 0 };
  const st = store("snowline-score"); let log = {}; try { log = (await st.get("resort-bachelor", { type: "json" })) || {}; } catch (e) {}
  let added = 0, changed = false;
  for (const x of list.slice(0, 60)) {
    const d = String(x.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const h24 = +(x.computed?.["24_hour"] ?? NaN), ov = +(x.overnight_amount ?? NaN), base = +(x.base_depth ?? NaN);
    if (!isFinite(h24) && !isFinite(ov)) continue;
    const v = { h24: isFinite(h24) ? h24 : null, overnight: isFinite(ov) ? ov : null, base: isFinite(base) ? base : null };
    if (!log[d]) added++;
    if (JSON.stringify(log[d]) !== JSON.stringify(v)) { log[d] = v; changed = true; }
  }
  if (!changed) return { added: 0, days: Object.keys(log).length };
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(log)) if (k < cutoff) delete log[k];
  await st.setJSON("resort-bachelor", log);
  return { added, days: Object.keys(log).length };
}
