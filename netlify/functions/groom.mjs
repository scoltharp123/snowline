// GET /api/groom?spot=<name> → grooming and trail status published by the area itself.
// Mt. Bachelor (alpine and Nordic): its own public mountain-report feed (the same one its website and webcams use).
// Other Nordic areas: links only. Nordic Pulse's terms forbid collecting its data, so Snowline never fetches it.
import { mergeBachelorLog } from "../lib/resort.mjs";
import { json } from "../lib/shared.mjs";

const BACH = "https://api.mtbachelor.com/api/v1/dor/drupal";
const LINKS = {
  "Meissner Nordic (Bend), OR": [["Meissner grooming report", "https://nordic-pulse.com/ski-areas/US/OR/Meissner-Sno-Park"], ["Meissner Nordic", "https://meissnernordic.org/"]],
  "Elk Lake Resort (Nordic), OR": [["Elk Lake grooming report", "https://nordic-pulse.com/ski-areas/US/OR/Elk-Lake-Resort"], ["Elk Lake Resort", "https://elklakeresort.com/"]],
  "Methow Valley Trails, WA": [["Methow grooming report", "https://nordic-pulse.com/ski-areas/US/WA/Methow-Trails"], ["Methow Trails", "https://www.methowtrails.org/"]],
  "Birkie Trail (Cable, WI)": [["Birkie grooming report", "https://nordic-pulse.com/ski-areas/US/WI/American-Birkebeiner"], ["Birkie trail report", "https://www.birkie.com/trail-maps-conditions/winter/"]],
  "Mt. Spokane, WA": [["Mt. Spokane Nordic grooming", "https://nordic-pulse.com/ski-areas/US/WA/Mount-Spokane"]],
};
const BACH_SPOTS = ["Mt. Bachelor, OR", "Mt. Bachelor Nordic Center, OR"];
const pretty = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
async function get(u) { const r = await fetch(u, { headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" }, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }

export default async (req) => {
  const spot = new URL(req.url).searchParams.get("spot") || "";
  if (!BACH_SPOTS.includes(spot)) return json({ spot, links: LINKS[spot] || [] }, { cache: 3600 });
  try {
    const [trails, reports, liftsRaw] = await Promise.all([get(BACH + "/trails"), get(BACH + "/snow-reports?sort=date&direction=desc").catch(() => []), get(BACH + "/lifts").catch(() => [])]);
    const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const lifts = (Array.isArray(liftsRaw) ? liftsRaw : []).filter((l) => l.season === "winter" && l.type !== "carpet")
      .sort((a, b) => (a.weight || 0) - (b.weight || 0))
      .map((l) => ({ name: l.name, status: l.status, hours: clean(l.hours), wait: clean(l.wait_time) || null, area: pretty(String(l.sector?.name || "").toLowerCase()), updated: l.updated ? l.updated * 1000 : null }));
    const sum = (list) => {
      const winter = list.filter((t) => t.season === "winter" && t.include !== false);
      const open = winter.filter((t) => t.status === "open"), groomed = winter.filter((t) => t.groom_status && t.groom_status !== "not_groomed");
      const latest = groomed.reduce((m, t) => Math.max(m, t.updated || 0), 0);
      const kinds = {}; groomed.forEach((t) => { kinds[pretty(t.groom_status)] = (kinds[pretty(t.groom_status)] || 0) + 1; });
      const km = groomed.reduce((a, t) => a + (+t.properties?.length || 0), 0);
      return { total: winter.length, open: open.length, groomed: groomed.length, kinds, latest: latest ? latest * 1000 : null, groomedLength: km || null,
        trails: groomed.sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 40).map((t) => ({ name: t.name, groom: pretty(t.groom_status), status: t.status, updated: t.updated ? t.updated * 1000 : null })) };
    };
    const nordic = sum(trails.filter((t) => t.type === "cross_country_trail"));
    const alpine = sum(trails.filter((t) => t.type === "alpine_trail"));
    const r = Array.isArray(reports) ? reports[0] : null;
    try { await mergeBachelorLog(reports); } catch (e) {}   // keep the report history for grading
    const report = r ? { date: r.date, overnight: r.overnight_amount, h24: r.computed?.["24_hour"], h48: r.computed?.["48_hour"], d7: r.computed?.["7_day"], season: r.computed?.total, base: r.base_depth, unit: r.unit_of_measurement || "in",
      text: String(r.report || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 700) } : null;
    return json({ spot, source: "Mt. Bachelor", link: spot.includes("Nordic") ? "https://www.mtbachelor.com/nordic/conditions-grooming-report/" : "https://www.mtbachelor.com/the-mountain/lift-trail-report/", lifts, nordic, alpine, report, at: Date.now() }, { cache: 600 });
  } catch (e) {
    return json({ spot, error: String(e.message || e), link: "https://www.mtbachelor.com/nordic/conditions-grooming-report/" }, { cache: 120 });
  }
};
export const config = { path: "/api/groom" };
