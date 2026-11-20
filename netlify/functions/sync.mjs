// Device sync with no accounts.
// POST /api/sync {data}                 → {code, t}               (create)
// PUT  /api/sync {code, data}           → {ok, t}                 (the code itself is the secret: 8 chars, ~10^12 combos)
// GET  /api/sync?code=XXXX-XXXX         → {data, t}
import { json, store } from "../lib/shared.mjs";
import crypto from "node:crypto";

const S = () => store("snowline-sync");
const ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => { const b = crypto.randomBytes(8); let s = ""; for (let i = 0; i < 8; i++) s += ALPH[b[i] % ALPH.length]; return s.slice(0, 4) + "-" + s.slice(4); };
const norm = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
const ok = (data) => data && typeof data === "object" && JSON.stringify(data).length <= 200_000;

export default async (req) => {
  if (req.method === "GET") {
    const code = norm(new URL(req.url).searchParams.get("code"));
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return json({ error: "bad code" }, { status: 400 });
    const rec = await S().get("c-" + code, { type: "json" });
    if (!rec) return json({ error: "Code not found" }, { status: 404 });
    return new Response(JSON.stringify({ data: rec.data, t: rec.t }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
  if (!ok(b.data)) return json({ error: "bad data" }, { status: 400 });
  if (req.method === "POST") {
    let code; for (let i = 0; i < 5; i++) { code = newCode(); if (!(await S().get("c-" + code))) break; }
    const t = Date.now();
    await S().setJSON("c-" + code, { data: b.data, t });
    return json({ code, t });
  }
  if (req.method === "PUT") {
    const code = norm(b.code); const rec = await S().get("c-" + code, { type: "json" });
    if (!rec) return json({ error: "Code not found" }, { status: 404 });
    const t = Date.now(); await S().setJSON("c-" + code, { ...rec, data: b.data, t });
    return json({ ok: true, t });
  }
  return json({ error: "method not allowed" }, { status: 405 });
};
export const config = { path: "/api/sync" };
