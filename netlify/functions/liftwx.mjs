// GET /api/liftwx → what Snowline has learned about each Mt. Bachelor lift's wind holds so far this season.
import { json, store } from "../lib/shared.mjs";
import { liftStats } from "../lib/lifts.mjs";
export default async () => {
  const s = store("snowline-cache");
  try { const c = await s.get("liftwx-v1", { type: "json" }); if (c && Date.now() - c.at < 3 * 3600e3) return json(c, { cache: 1800 }); } catch (e) {}
  const out = { at: Date.now(), ...(await liftStats()) };
  try { await s.setJSON("liftwx-v1", out); } catch (e) {}
  return json(out, { cache: 1800 });
};
export const config = { path: "/api/liftwx" };
