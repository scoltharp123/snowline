// temporary: reads only the response headers of a page (whether it may be shown in a frame); removed after use
export default async () => {
  const r = await fetch("https://nordic-pulse.com/ski-areas/US/OR/Meissner-Sno-Park", { method: "HEAD", headers: { "User-Agent": "Snowline (snowline-forecast.netlify.app)" } });
  const h = {}; for (const k of ["x-frame-options", "content-security-policy", "status"]) h[k] = r.headers.get(k); h.status = r.status;
  return new Response(JSON.stringify(h), { headers: { "content-type": "application/json" } });
};
export const config = { path: "/api/probe" };
