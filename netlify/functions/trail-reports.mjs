// Skier trail reports: quick check-ins with an optional photo.
// GET  /api/trail-reports?spot=..          → recent reports (last 7 days)
// POST /api/trail-reports?spot=..          → {rating, surface, groomed, mode, note, name, photo(dataURL jpeg)} → {id, token}
// DELETE /api/trail-reports?spot=..        → {id, token} (only the device that posted it)
// GET  /api/trail-reports/photo?id=..      → jpeg
import { json, store } from "../lib/shared.mjs";
import crypto from "node:crypto";

const R = () => store("snowline-reports");
const SURFACES = ["powder", "packed", "firm", "icy", "soft", "crusty", "slush"];
const GROOMED = ["yes", "no", "unsure"], MODES = ["alpine", "skate", "classic"];
const keyFor = (spot) => "spot-" + crypto.createHash("sha1").update(spot).digest("hex").slice(0, 24);
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const clean = (s, n) => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

export default async (req, context) => {
  const u = new URL(req.url);
  if (u.pathname.endsWith("/photo")) {
    const id = u.searchParams.get("id") || "";
    if (!/^[a-f0-9]{24}$/.test(id)) return new Response("not found", { status: 404 });
    const b = await R().get("photo-" + id, { type: "arrayBuffer" });
    if (!b) return new Response("not found", { status: 404 });
    return new Response(b, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=604800, immutable" } });
  }
  const spot = clean(u.searchParams.get("spot"), 100);
  if (!spot) return json({ error: "spot required" }, { status: 400 });
  const key = keyFor(spot);
  const list = (await R().get(key, { type: "json" })) || [];

  if (req.method === "GET") {
    const fresh = list.filter(r => Date.now() - r.t < 7 * 864e5).map(({ tokenHash, ...r }) => r);
    return new Response(JSON.stringify({ reports: fresh }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
    const rating = Math.round(+b.rating);
    if (!(rating >= 1 && rating <= 5) || !SURFACES.includes(b.surface) || !GROOMED.includes(b.groomed) || !MODES.includes(b.mode)) return json({ error: "invalid report" }, { status: 400 });
    // light rate limit per IP per day
    const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "anon";
    const rl = `rl-${sha(ip).slice(0, 16)}-${new Date().toISOString().slice(0, 10)}`;
    const used = (await R().get(rl, { type: "json" })) || 0;
    if (used >= 12) return json({ error: "Too many reports today. Try again tomorrow." }, { status: 429 });
    await R().setJSON(rl, used + 1);
    const id = crypto.randomBytes(12).toString("hex"), token = crypto.randomBytes(16).toString("hex");
    let photo = false;
    if (typeof b.photo === "string" && b.photo.startsWith("data:image/jpeg;base64,")) {
      const buf = Buffer.from(b.photo.slice(23), "base64");
      if (buf.length > 0 && buf.length <= 600 * 1024) { await R().set("photo-" + id, buf); photo = true; }
    }
    const rec = { id, t: Date.now(), rating, surface: b.surface, groomed: b.groomed, mode: b.mode, note: clean(b.note, 280), name: clean(b.name, 30), photo, tokenHash: sha(token) };
    const next = [rec, ...list.filter(r => Date.now() - r.t < 14 * 864e5)].slice(0, 80);
    await R().setJSON(key, next);
    const { tokenHash, ...pub } = rec;
    return json({ ok: true, report: pub, token });
  }
  if (req.method === "DELETE") {
    let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
    const r = list.find(x => x.id === b.id);
    if (!r || r.tokenHash !== sha(b.token)) return json({ error: "not allowed" }, { status: 403 });
    await R().setJSON(key, list.filter(x => x.id !== b.id));
    if (r.photo) await R().delete("photo-" + r.id);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, { status: 405 });
};
export const config = { path: ["/api/trail-reports", "/api/trail-reports/photo"] };
