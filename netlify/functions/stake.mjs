// GET /api/stake → { frames:[{t, src}] } the saved snow stake pictures from the last 24 hours (oldest first)
// GET /api/stake?f=<key> → one picture
import { getStore } from "@netlify/blobs";
import { json } from "../lib/shared.mjs";
export default async (req) => {
  const s = getStore({ name: "snowline-stake" }), f = new URL(req.url).searchParams.get("f");
  if (f) {
    if (!/^img-\d+$/.test(f)) return new Response("bad key", { status: 400 });
    const b = await s.getWithMetadata(f, { type: "arrayBuffer" });
    if (!b) return new Response("gone", { status: 404 });
    return new Response(b.data, { headers: { "content-type": b.metadata?.type || "image/jpeg", "cache-control": "public, max-age=86400, immutable" } });
  }
  const { blobs } = await s.list({ prefix: "img-" });
  const cut = Date.now() - 24 * 3600e3;
  const frames = blobs.map((b) => +b.key.slice(4)).filter((t) => t >= cut).sort((a, b) => a - b).map((t) => ({ t, src: "/api/stake?f=img-" + t }));
  return json({ frames, source: "Mt. Bachelor snow stake camera", page: "https://www.mtbachelor.com/the-mountain/webcams/webcam-modal/#snow-stake" }, { cache: 300 });
};
export const config = { path: "/api/stake" };
