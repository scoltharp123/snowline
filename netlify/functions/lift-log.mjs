// Every 30 minutes during Mt. Bachelor's operating day (7am–5:30pm Pacific): log lift status + summit wind.
import { logLifts } from "../lib/lifts.mjs";
export default async () => { try { console.log("lift-log", await logLifts()); } catch (e) { console.log("lift-log failed", String(e.message || e)); } };
export const config = { schedule: "*/30 15-23,0-1 * * *" };
