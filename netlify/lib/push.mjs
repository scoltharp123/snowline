import webpush from "web-push";
import { store, getJSON, nearestStations, awdbData, daysAgo, ymd, newSnowFrom } from "./shared.mjs";

export function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@snowline-forecast.netlify.app", pub, priv);
  return webpush;
}
export const subKey = (endpoint) => "sub-" + Buffer.from(endpoint).toString("base64url").slice(-80);
export const subs = () => store("snowline-push");

export async function send(sub, payload) {
  const wp = vapid();
  try {
    await wp.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" });
    return "ok";
  } catch (e) {
    return e.statusCode === 404 || e.statusCode === 410 ? "gone" : "error:" + (e.statusCode || e.message);
  }
}

// Alerts check snow at the elevation the person picked (base / mid / summit; summit by default).
export function bandSpot(sp, prefs) {
  const b = +sp.base || +sp.top || 5000, t = +sp.top || b, k = prefs?.band || "summit";
  return { ...sp, top: k === "base" ? b : k === "mid" ? Math.round((b + t) / 2) : t };
}
// model snow (inches) from Open-Meteo at the spot's chosen elevation (summit unless bandSpot changed it)
// Returns past 12h, next N days, peak day, 9am temp, and a simple "cold" signal for powder language
export async function modelSnow(spot, days = 10) {
  const elev = Math.round((spot.top || spot.base || 5000) / 3.28084);
  const j = await getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}&elevation=${elev}` +
    `&hourly=snowfall,temperature_2m&past_days=1&forecast_days=${days + 1}&timezone=auto`
  );
  const h = j.hourly;
  const off = j.utc_offset_seconds * 1000;
  const nk = new Date(Date.now() + off).toISOString().slice(0, 13) + ":00";
  const i0 = Math.max(0, h.time.findIndex(t => t >= nk));
  const cm2in = (v) => (v || 0) / 2.54;

  let past12 = 0;
  for (let i = Math.max(0, i0 - 12); i < i0; i++) past12 += cm2in(h.snowfall[i]);

  const byDay = {};
  for (let i = i0; i < h.time.length; i++) {
    const d = h.time[i].slice(0, 10);
    byDay[d] = (byDay[d] || 0) + cm2in(h.snowfall[i]);
  }
  const dayList = Object.entries(byDay).slice(0, days);
  const next = (n) => dayList.slice(0, n).reduce((a, [, v]) => a + v, 0);
  const peak = dayList.reduce((b, [d, v]) => (v > b.v ? { d, v } : b), { d: null, v: 0 });

  const today = h.time[i0].slice(0, 10);
  const i9 = h.time.indexOf(today + "T09:00");
  let todaySnow = 0;
  for (let i = i0; i < h.time.length && h.time[i].startsWith(today); i++) todaySnow += cm2in(h.snowfall[i]);

  // Simple cold signal for powder language (avg of next ~18h temps when available)
  let cold = false;
  if (i9 >= 0) {
    const temps = [];
    for (let i = i9; i < Math.min(i9 + 18, h.temperature_2m.length); i++) {
      if (h.temperature_2m[i] != null) temps.push(h.temperature_2m[i]);
    }
    if (temps.length >= 6) {
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
      cold = avg <= -2; // roughly ≤ 28°F
    }
  }

  return {
    past12,
    next1: next(1),
    next3: next(3),
    next5: next(5),
    next10: next(10),
    peak,
    todaySnow,
    t9: i9 >= 0 ? h.temperature_2m[i9] : null,
    cold,
  };
}

export async function measuredOvernight(spot) {
  try {
    const [st] = await nearestStations(spot.lat, spot.lon, 1, 25);
    if (!st) return null;
    const h = (await awdbData([st.id], ["SNWD"], "HOURLY", daysAgo(2), ymd(Date.now() + 864e5)))[st.id]?.SNWD || [];
    if (h.length < 8) return null;
    return { inches: newSnowFrom(h.slice(-12).map(v => v.value)), station: st.name };
  } catch (e) {
    return null;
  }
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WIN = {
  h24: ["next1", "next 24 hours"],
  d3: ["next3", "next 3 days"],
  d5: ["next5", "next 5 days"],
  d10: ["next10", "next 10 days"],
};

function shortName(name = "") {
  return name.replace(/,\s*[A-Z]{2}$/, "").replace(/\s*\(.*\)$/, "");
}

/**
 * Build powder / snow alerts.
 * Now quality-aware: uses cold signal to prefer "soft powder" language when appropriate.
 */
export async function buildAlert(sub) {
  if (sub.prefs?.powder === false && !(Array.isArray(sub.rules) && sub.rules.length)) return null;

  const rules = Array.isArray(sub.rules) && sub.rules.length
    ? sub.rules
    : [
        { spot: "*favs", type: "overnight", inches: sub.prefs?.overnight ?? 4 },
        { spot: "*favs", type: "forecast", win: "d3", inches: sub.prefs?.forecast ?? 8 },
      ];

  const cache = new Map();
  const hits = [];

  const getM = async (sp) => {
    if (!cache.has(sp.name)) {
      cache.set(sp.name, Promise.all([modelSnow(bandSpot(sp, sub.prefs)).catch(() => null), measuredOvernight(sp)]));
    }
    return cache.get(sp.name);
  };

  for (const rule of rules.slice(0, 12)) {
    const spots =
      rule.spot === "*favs" || rule.spot === "*all"
        ? sub.spots || []
        : rule.spotObj
          ? [rule.spotObj]
          : [];

    for (const sp of spots.slice(0, 6)) {
      const [m, meas] = await getM(sp);
      if (!m) continue;
      const short = shortName(sp.name);

      if (rule.type === "overnight") {
        const v = meas ? meas.inches : m.past12;
        if (v >= rule.inches) {
          const isPowder = m.cold && v >= 3;
          const title = isPowder
            ? `❄️ Soft powder — ${Math.round(v)}" overnight at ${short}`
            : `❄️ ${Math.round(v)}" overnight at ${short}`;
          const line = `${Math.round(v)}" ${meas ? "fell" : "estimated"} overnight at ${short}`;
          hits.push({ v, title, line, powder: isPowder });
        }
      } else {
        const [k, lab] = WIN[rule.win] || WIN.d3;
        const v = m[k];
        if (v >= rule.inches) {
          const pk = m.peak.d ? ` (most on ${DOW[new Date(m.peak.d + "T12:00:00Z").getUTCDay()]})` : "";
          const isPowder = m.cold && v >= 4;
          const title = isPowder
            ? `🌨 Soft powder coming — ${Math.round(v)}" to ${short}`
            : `🌨 ${Math.round(v)}" coming to ${short}`;
          const line = `${Math.round(v)}" forecast at ${short}, ${lab}${pk}`;
          hits.push({ v: v * 0.6, title, line, powder: isPowder });
        }
      }
    }
  }

  if (!hits.length) return null;

  // Prefer powder-flagged hits, then by size
  hits.sort((a, b) => (b.powder === a.powder ? b.v - a.v : b.powder ? 1 : -1));

  const seen = new Set();
  const lines = hits.filter(h => !seen.has(h.line) && seen.add(h.line));
  const top = lines[0];

  return {
    title: top.title,
    body: lines.slice(0, 3).map(h => h.line).join(" · "),
    url: "/#forecast",
    tag: "snowline-daily",
  };
}

// ---- Morning brief ----
const BACH = ["Mt. Bachelor, OR", "Mt. Bachelor Nordic Center, OR"];

async function bachelorGroom(nordic) {
  try {
    const r = await fetch("https://api.mtbachelor.com/api/v1/dor/drupal/trails", {
      headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" },
      signal: AbortSignal.timeout(8000),
    });
    const list = (await r.json()).filter(
      t => t.season === "winter" && t.type === (nordic ? "cross_country_trail" : "alpine_trail")
    );
    const g = list.filter(t => t.groom_status && t.groom_status !== "not_groomed");
    const latest = g.reduce((m, t) => Math.max(m, (t.updated || 0) * 1000), 0);
    return {
      total: list.length,
      groomed: g.length,
      fresh: latest && Date.now() - latest < 14 * 3600e3,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Morning brief — more decision-oriented and cleaner.
 * Prioritizes spots with real snow or fresh grooming.
 */
export async function buildBrief(sub, force) {
  const mode = sub.prefs?.brief || "snow";
  if (mode === "off" && !force) return null;

  const met = sub.prefs?.units === "met";
  const snow = (inch) =>
    met ? `${Math.round(inch * 2.54)} cm` : `${inch < 1 ? inch.toFixed(1) : Math.round(inch)}"`;
  const temp = (c) =>
    c == null ? null : met ? `${Math.round(c)}°C` : `${Math.round((c * 9) / 5 + 32)}°`;

  const lines = [];
  let matters = false;

  for (const sp of (sub.spots || []).slice(0, 4)) {
    const [m, meas] = await Promise.all([
      modelSnow(bandSpot(sp, sub.prefs), 3).catch(() => null),
      measuredOvernight(sp),
    ]);
    if (!m) continue;

    const short = shortName(sp.name);
    const over = meas ? meas.inches : m.past12;
    const parts = [];

    if (over >= 0.5) {
      parts.push(`${snow(over)} overnight`);
      if (over >= 1) matters = true;
    }
    if (m.todaySnow >= 0.5) {
      parts.push(`${snow(m.todaySnow)} more today`);
      if (m.todaySnow >= 2) matters = true;
    } else if (m.next3 >= 2) {
      parts.push(`${snow(m.next3)} in 3 days`);
    }

    // Grooming for Bachelor
    if (BACH.includes(sp.name)) {
      const g = await bachelorGroom(/Nordic/.test(sp.name));
      if (g && g.groomed) {
        const kind = /Nordic/.test(sp.name) ? "trails" : "runs";
        parts.push(`${g.groomed} of ${g.total} ${kind} groomed`);
        if (g.fresh) matters = true;
      }
    }

    if (m.t9 != null) parts.push(`${temp(m.t9)} at 9am up top`);

    // Light quality signal in the brief when cold + meaningful snow
    if (m.cold && (over >= 2 || m.todaySnow >= 2)) {
      parts.push("cold & soft");
    }

    if (parts.length) lines.push(`${short}: ${parts.join(", ")}`);
  }

  if (!lines.length || (mode === "snow" && !matters && !force)) return null;

  return {
    title: "☀️ Snowline morning brief",
    body: lines.join("\n"),
    url: "/#favs",
    tag: "snowline-daily",
  };
}

/**
 * Storm watch — clearer messaging, still once-per-storm.
 */
export async function buildWatch(sub) {
  if (sub.prefs?.watch === false) return null;

  const min = sub.prefs?.watchIn ?? 8;
  const seen = new Set(sub.watched || []);
  const out = [];

  for (const sp of (sub.spots || []).slice(0, 6)) {
    let j;
    try {
      const bs = bandSpot(sp, sub.prefs), elev = Math.round((bs.top || 5000) / 3.28084);
      j = await getJSON(
        `https://api.open-meteo.com/v1/forecast?latitude=${sp.lat}&longitude=${sp.lon}&elevation=${elev}` +
        `&daily=snowfall_sum&forecast_days=7&timezone=auto`
      );
    } catch (e) {
      continue;
    }

    const d = j.daily;
    if (!d?.time) continue;
    const v = d.snowfall_sum.map(x => (x || 0) / 2.54);

    // storms = consecutive days with ≥1"
    const storms = [];
    let cur = null;
    v.forEach((x, k) => {
      if (x >= 1) {
        if (!cur) cur = { s: k, e: k, tot: 0 };
        cur.e = k;
        cur.tot += x;
      } else if (cur) {
        storms.push(cur);
        cur = null;
      }
    });
    if (cur) storms.push(cur);

    const st = storms
      .filter(x => x.s >= 2 && x.s <= 5 && x.tot >= min)
      .sort((a, b) => b.tot - a.tot)[0];
    if (!st) continue;

    const key = `${sp.name}|${d.time[st.s]}`;
    if (seen.has(key)) continue;

    const short = shortName(sp.name);
    const startDow = DOW[new Date(d.time[st.s] + "T12:00:00Z").getUTCDay()];
    const endDow = DOW[new Date(d.time[st.e] + "T12:00:00Z").getUTCDay()];
    const when = st.e > st.s ? `${startDow}–${endDow}` : startDow;

    out.push({
      key,
      v: st.tot,
      spot: sp.name,
      title: `🚨 Storm watch: ~${Math.round(st.tot)}" for ${short} ${when}`,
      line: `${short}: about ${Math.round(st.tot)}" ${when}. Tap to open the forecast.`,
    });
  }

  if (!out.length) return null;
  out.sort((a, b) => b.v - a.v);

  return {
    title: out[0].title,
    body: out.slice(0, 2).map(x => x.line).join("\n"),
    url: `/?s=${encodeURIComponent(out[0].spot)}#share`,
    tag: "snowline-watch",
    keys: out.map(x => x.key),
  };
}

export function combine(alert, brief) {
  if (alert && brief) return { ...alert, body: alert.body + "\n" + brief.body };
  return alert || brief || null;
}
