// Scheduled: every morning ~5:45am Pacific (13:45 UTC) send powder alerts
import { subs, send, buildAlert } from "../lib/push.mjs";

export default async () => {
  const s = subs(); const { blobs } = await s.list();
  let sent = 0, gone = 0;
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: "json" }); if (!rec) continue;
    const alert = await buildAlert(rec).catch(() => null); if (!alert) continue;
    const r = await send(rec.sub, alert);
    if (r === "ok") sent++; else if (r === "gone") { await s.delete(b.key); gone++; }
  }
  console.log(`push-cron: ${blobs.length} subs, ${sent} sent, ${gone} removed`);
};
export const config = { schedule: "45 13 * * *" };
