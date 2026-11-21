// POST /api/feedback → "this forecast looks wrong" reports from users (no personal data).
// GET /api/feedback → the latest 60 reports, for the owner's status view.
import { json, store } from "../lib/shared.mjs";

const KINDS = ["more", "less", "rain", "windier", "colder", "warmer", "other"];

export default async (req) => {
  const st = store("snowline-feedback");
  if (req.method === "GET") {
    const { blobs } = await st.list(); const keys = blobs.map(b => b.key).sort().reverse().slice(0, 60);
    const items = (await Promise.all(keys.map(k => st.get(k, { type: "json" }).catch(() => null)))).filter(Boolean);
    return json({ items }, { cache: 30 });
  }
  if (req.method !== "POST") return json({ error: "GET or POST" }, { status: 405 });
  let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
  if (!KINDS.includes(b?.kind)) return json({ error: "kind" }, { status: 400 });
  const num = v => (isFinite(+v) ? Math.round(+v * 10) / 10 : null);
  const item = { at: new Date().toISOString(), spot: String(b.spot || "").slice(0, 90), lat: num(b.lat), lon: num(b.lon), elevFt: num(b.elevFt), mode: String(b.mode || "").slice(0, 10),
    kind: b.kind, note: String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 400), fc: { last24: num(b.fc?.last24), today: num(b.fc?.today), next24: num(b.fc?.next24), tempF: num(b.fc?.tempF) } };
  await st.setJSON(`fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, item);
  return json({ ok: true });
};
export const config = { path: "/api/feedback" };
