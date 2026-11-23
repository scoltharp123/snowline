// temporary build-time check of Mt. Bachelor feeds (removed after use)
const B = "https://api.mtbachelor.com/api/v1/dor/drupal/";
const names = ["parking", "parking-lots", "lots", "facilities", "activities", "lodges", "operations"];
for (const n of names) { try { const r = await fetch(B + n, { signal: AbortSignal.timeout(8000) }); const t = await r.text(); console.log("PROBE", n, r.status, t.slice(0, r.ok ? 500 : 40).replace(/\s+/g, " ")); } catch (e) { console.log("PROBE", n, "ERR"); } }
try { const t = await (await fetch(B + "trails")).json(); console.log("PROBE trailKeys", Object.keys(t[0] || {}).join(",")); console.log("PROBE trail", JSON.stringify(t[0]).slice(0, 500)); } catch (e) {}
try { const t = await (await fetch(B + "lifts")).json(); console.log("PROBE liftStatuses", [...new Set(t.map(l => l.status))].join(",")); } catch (e) {}
