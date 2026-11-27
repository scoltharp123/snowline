// Scheduled: every evening ~8pm Pacific (04:05 UTC) send the night-before call, only where 4"+ falls by morning.
import { subs, send, buildEve } from "../lib/push.mjs";

export default async () => {
  const s = subs(); const { blobs } = await s.list();
  let sent = 0, gone = 0;
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: "json" }); if (!rec?.sub) continue;
    const m = await buildEve(rec).catch(() => null); if (!m) continue;
    const r = await send(rec.sub, m);
    if (r === "ok") { sent++; rec.eveSent = m.dayKey; await s.setJSON(b.key, rec); }
    else if (r === "gone") { await s.delete(b.key); gone++; }
  }
  console.log(`eve-cron: ${blobs.length} subs, ${sent} sent, ${gone} removed`);
};
export const config = { schedule: "5 4 * * *" };
