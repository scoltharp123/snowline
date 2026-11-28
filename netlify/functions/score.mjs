// POST /api/score → saves Snowline's own forecast for a SNOTEL station so it can be graded later.
// Body: { station:"815:OR:SNTL", issued:"YYYY-MM-DD", fc:[["YYYY-MM-DD", snowIn, waterIn], ...] }
// The first forecast saved for each station and day is kept (that's the "morning forecast" we grade).
// /api/verify reads these and compares them with what the station measured.
import { json, store } from "../lib/shared.mjs";

const KEEP_DAYS = 200;
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, { status: 405 });
  let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
  const station = String(b?.station || ""), issued = b?.issued, fc = b?.fc;
  if (!(/^\d{2,6}:[A-Z]{2}:SNTL$/.test(station) || station === "resort:bachelor2") || !isDate(issued) || !Array.isArray(fc) || !fc.length || fc.length > 7) return json({ error: "bad request" }, { status: 400 });
  // only today's forecast (allowing for time zones)
  const ms = Date.parse(issued + "T12:00:00Z"); if (!isFinite(ms) || Math.abs(Date.now() - ms) > 36 * 3600e3) return json({ error: "stale" }, { status: 400 });
  const day = {};
  for (const r of fc) {
    if (!Array.isArray(r) || !isDate(r[0]) || r[0] <= issued) continue;
    const s = +r[1], w = +r[2]; if (!isFinite(s) || !isFinite(w) || s < 0 || s > 80 || w < 0 || w > 8) continue;
    day[r[0]] = [Math.round(s * 10) / 10, Math.round(w * 100) / 100];
  }
  if (!Object.keys(day).length) return json({ error: "nothing to save" }, { status: 400 });
  const st = store("snowline-score"), key = `fc-${station}`;
  let all = {}; try { all = (await st.get(key, { type: "json" })) || {}; } catch (e) {}
  if (all[issued]) return json({ ok: true, kept: "earlier" });
  all[issued] = day;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(all)) if (k < cutoff) delete all[k];
  try { await st.setJSON(key, all); } catch (e) { return json({ error: "save failed" }, { status: 500 }); }
  return json({ ok: true, saved: Object.keys(day).length });
};
export const config = { path: "/api/score" };
