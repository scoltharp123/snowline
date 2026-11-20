// GET /api/report?spot=... → links to the official resort and grooming reports.
// No third-party pages are fetched or parsed: Snowline links out instead.
import { json } from "../lib/shared.mjs";

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

export default async (req) => {
  const spot = new URL(req.url).searchParams.get("spot") || "";
  const res = {};
  if (RESORT[spot]) res.resort = { url: `https://www.onthesnow.com/${RESORT[spot]}/skireport`, source: "OnTheSnow" };
  if (GROOM[spot]) res.grooming = { url: `https://nordic-pulse.com/ski-areas/${GROOM[spot]}`, source: "Nordic Pulse" };
  return json(res, { cache: 86400 });
};
export const config = { path: "/api/report" };
