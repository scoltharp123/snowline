// Scheduled twice each morning: save Mt. Bachelor's published snow report (24-hour and overnight snowfall)
// so Snowline's forecasts can be graded against what the resort actually reported. /api/groom also saves it whenever it fetches it.
import { mergeBachelorLog } from "../lib/resort.mjs";
const URL_ = "https://api.mtbachelor.com/api/v1/dor/drupal/snow-reports?sort=date&direction=desc";
export default async () => {
  try { const r = await fetch(URL_, { headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error("HTTP " + r.status); console.log("resort-log", await mergeBachelorLog(await r.json())); }
  catch (e) { console.log("resort-log failed", String(e.message || e)); }
};
export const config = { schedule: "30 14,18 * * *" };
