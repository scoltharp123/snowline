// temporary: checks which Mt. Bachelor feeds exist (removed after use)
export default async () => {
  const B = "https://api.mtbachelor.com/api/v1/dor/drupal/";
  const names = ["parking", "parking-lots", "parkinglots", "lots", "facilities", "activities", "lodges", "operations", "status", "conditions-report", "weather"];
  const out = {};
  await Promise.all(names.map(async n => { try { const r = await fetch(B + n, { signal: AbortSignal.timeout(8000) }); const t = await r.text(); out[n] = [r.status, t.slice(0, r.ok ? 700 : 60)]; } catch (e) { out[n] = ["ERR", String(e)]; } }));
  try { const t = await (await fetch(B + "trails")).json(); out.trailKeys = Object.keys(t[0] || {}); out.trailSample = JSON.stringify(t[0]).slice(0, 600); } catch (e) { out.trails = String(e); }
  try { const t = await (await fetch(B + "lifts")).json(); out.liftStatuses = [...new Set(t.map(l => l.status))]; out.liftSample = JSON.stringify(t.find(l => /summit/i.test(l.name))).slice(0, 700); } catch (e) {}
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
};
export const config = { path: "/api/probe" };
