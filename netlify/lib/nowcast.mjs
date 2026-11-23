// Snow countdown: Open-Meteo's 15-minute forecast (high-resolution HRRR in the US) says when snow starts, how hard it
// comes down and when it lets up. Used by the "snow starts soon" push and mirrored in the app's live strip.
import { getJSON } from "./shared.mjs";
import { bandSpot } from "./push.mjs";

export function analyze(m, off, now = Date.now()) {
  if (!m?.time?.length) return null;
  const S = m.time.map((t, i) => ({ ms: Date.parse(t + ":00Z") - off * 1000, sn: m.snowfall?.[i] || 0, p: m.precipitation?.[i] || 0, T: m.temperature_2m?.[i] }));
  const snowy = (s) => s && (s.sn >= 0.05 || (s.p >= 0.1 && s.T != null && s.T <= 0.5));
  const wet = (s) => s && s.p >= 0.1 && !snowy(s);
  let k0 = S.findIndex((s) => s.ms > now) - 1; if (k0 < 0) k0 = 0;
  const inch = (cm) => cm / 2.54, rate = (s) => inch(s.sn) * 4; // in/hr
  const endFrom = (j) => { let k = j; while (k < S.length && (snowy(S[k]) || snowy(S[k + 1]))) k++; return k; };
  const pack = (a, b) => { const sl = S.slice(a, b), pk = sl.reduce((x, s) => (rate(s) > rate(x) ? s : x), sl[0]);
    return { endMs: b < S.length ? S[b].ms : null, totIn: inch(sl.reduce((x, s) => x + s.sn, 0)), peakMs: pk?.ms, peakRate: pk ? rate(pk) : 0 }; };
  if (snowy(S[k0]) || (snowy(S[k0 - 1]) && snowy(S[k0 + 1]))) return { state: "now", ...pack(k0, endFrom(k0)) };
  for (let j = k0 + 1; j < S.length && S[j].ms - now <= 6 * 3600e3; j++) {
    if (snowy(S[j])) return { state: "soon", startMs: S[j].ms, ...pack(j, endFrom(j)) };
    if (wet(S[j])) { let k = j; while (k < S.length && !snowy(S[k]) && S[k].ms - now <= 6 * 3600e3) k++; return { state: "rain", startMs: S[j].ms, snowMs: k < S.length && snowy(S[k]) ? S[k].ms : null }; }
  }
  return { state: "dry" };
}

export async function nowcastFor(sp, prefs) {
  const bs = bandSpot(sp, prefs), el = Math.round((bs.top || 5000) / 3.28084);
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${sp.lat}&longitude=${sp.lon}&elevation=${el}&minutely_15=snowfall,precipitation,temperature_2m&past_minutely_15=2&forecast_minutely_15=28&timezone=auto`, { timeout: 9000 });
  return { ...analyze(j.minutely_15, j.utc_offset_seconds || 0), off: j.utc_offset_seconds || 0 };
}

export const clock = (ms, off) => { const d = new Date(ms + off * 1000); let h = d.getUTCHours(), m = d.getUTCMinutes(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`; };
