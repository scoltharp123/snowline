// Every 6 hours: save Mt. Bachelor's snow plot depths (the feed only keeps the last 24 hours).
import { fetchFeed, logPlot } from "../lib/plot.mjs";
export default async () => { try { const n = await logPlot(await fetchFeed()); console.log("plot hours added", n); } catch (e) { console.log("plot log failed", e.message); } };
export const config = { schedule: "17 */6 * * *" };
