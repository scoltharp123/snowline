// GET /api/report?spot=Mt.%20Bachelor%2C%20OR → { resort, grooming }
// Resort reports: best-effort parsing of OnTheSnow pages. Nordic Pulse grooming: link only, never fetched.
import { json, getText } from "../lib/shared.mjs";

const RESORT = {
  "Mt. Bachelor, OR": "oregon/mt-bachelor", "Hoodoo, OR": "oregon/hoodoo-ski-area", "Willamette Pass, OR": "oregon/willamette-pass",
  "Mt. Hood Meadows, OR": "oregon/mt-hood-meadows", "Timberline, OR": "oregon/timberline-lodge", "Mt. Ashland, OR": "oregon/mount-ashland",
  "Crystal Mountain, WA": "washington/crystal-mountain-wa", "Stevens Pass, WA": "washington/stevens-pass-resort", "Mt. Baker, WA": "washington/mt-baker",
  "Sun Valley, ID": "idaho/sun-valley", "Alta, UT": "utah/alta-ski-area", "Snowbird, UT": "utah/snowbird", "Jackson Hole, WY": "wyoming/jackson-hole",
  "Big Sky, MT": "montana/big-sky-resort", "Mammoth Mountain, CA": "california/mammoth-mountain-ski-area", "Palisades Tahoe, CA": "california/palisades-tahoe",
  "Steamboat, CO": "colorado/steamboat", "Vail, CO": "colorado/vail", "Telluride, CO": "colorado/telluride", "Whistler Blackcomb, BC": "british-columbia/whistler-blackcomb",
};
const GROOM = {
  "Meissner Nordic (Bend), OR": "US/OR/Meissner-Sno-Park",
  "Mt. Bachelor Nordic Center, OR": "US/OR/Mt-Bachelor-Nordic-Center",
  "Mt. Bachelor, OR": "US/OR/Mt-Bachelor-Nordic-Center",
};

const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|td|span)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

async function resortReport(slug) {
  const url = `https://www.onthesnow.com/${slug}/skireport`;
  const html = await getText(url);
  const t = text(html).replace(/\n/g, " ");
  const out = { url, source: "OnTheSnow (resort-reported)" };
  let m;
  if ((m = t.match(/snow report for ([A-Z][a-z]{2} \d{1,2}) is an? (\d+)" base depth(?: with (\d+) of (\d+) lifts open)?/))) { out.date = m[1]; out.base = +m[2]; if (m[3]) { out.liftsOpen = +m[3]; out.lifts = +m[4]; } }
  if ((m = t.match(/Summit\s+(\d+)"/))) out.summit = +m[1];
  if (out.base == null && (m = t.match(/Base\s+(\d+)"/))) out.base = +m[1];
  if ((m = t.match(/(\d+)\/(\d+) open/))) { out.runsOpen = +m[1]; out.runs = +m[2]; }
  if ((m = t.match(/Snow Reporter Comments:\s*(.{20,600}?)(?=\s(?:Acres Open|Runs Open|Firsthand|Nordic Open|Terrain Park)|$)/))) out.comment = m[1].trim();
  if ((m = t.match(/Recent Snowfall\s+((?:\d+"\s*){1,8})/))) { const v = m[1].match(/\d+/g).map(Number); out.recent = v; out.new24 = v[v.length - 1]; }
  if ((m = t.match(/Projected (?:re)?opening:?\s*([A-Z][a-z]{2}\.? \d{1,2})/i)) || (m = t.match(/([A-Z][a-z]{2} \d{1,2})\s*Projected Opening/))) out.opening = m[1].replace(".", "");
  if ((m = t.match(/(?:is )?closed for the season/i))) out.status = "Closed";
  else if (/\bClosed\b/.test(t.slice(0, 600)) && !/\bOpen\b/.test(t.slice(0, 300))) out.status = "Closed";
  else if (/Mt\.?[^.]{0,40}\bOpen\b/.test(t.slice(0, 1500))) out.status = "Open";
  return out;
}
export default async (req) => {
  const spot = new URL(req.url).searchParams.get("spot") || "";
  const res = {};
  const jobs = [];
  if (RESORT[spot]) jobs.push(resortReport(RESORT[spot]).then(r => res.resort = r).catch(e => res.resort = { error: String(e.message || e), url: `https://www.onthesnow.com/${RESORT[spot]}/skireport` }));
  // Nordic Pulse: link only (their terms don't allow scraping or redistribution)
  if (GROOM[spot]) res.grooming = { url: `https://nordic-pulse.com/ski-areas/${GROOM[spot]}`, source: "Nordic Pulse" };
  await Promise.all(jobs);
  return json(res, { cache: 1800 });
};
export const config = { path: "/api/report" };
