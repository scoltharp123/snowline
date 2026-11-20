// Scheduled every 30 minutes: save Mt. Bachelor's snow stake camera picture, keep the last 30 hours.
import { getStore } from "@netlify/blobs";
const CAM = "https://api.mtbachelor.com/api/v1/cams/mtn/14";
export default async () => {
  const s = getStore({ name: "snowline-stake" });
  try {
    const r = await fetch(CAM + "?t=" + Date.now(), { headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" }, signal: AbortSignal.timeout(20000) });
    const type = r.headers.get("content-type") || "";
    if (r.ok && type.startsWith("image/")) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 5000) await s.set("img-" + Date.now(), buf, { metadata: { type, at: Date.now() } });
    }
  } catch (e) { console.log("stake-capture:", e.message); }
  try { const { blobs } = await s.list({ prefix: "img-" }); const cut = Date.now() - 30 * 3600e3; for (const b of blobs) if (+b.key.slice(4) < cut) await s.delete(b.key); } catch (e) {}
};
export const config = { schedule: "*/30 * * * *" };
