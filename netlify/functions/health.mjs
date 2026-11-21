// GET /api/health → the latest health check of Snowline's data sources (re-run at most every 10 minutes).
import { json, store } from "../lib/shared.mjs";
import { runHealth } from "../lib/health.mjs";

export default async () => {
  const s = store("snowline-cache");
  try { const last = await s.get("health-last", { type: "json" }); if (last && Date.now() - Date.parse(last.at) < 10 * 60e3) return json(last, { cache: 60 }); } catch (e) {}
  const r = await runHealth(); try { await s.setJSON("health-last", r); } catch (e) {} return json(r, { cache: 60 });
};
export const config = { path: "/api/health" };
