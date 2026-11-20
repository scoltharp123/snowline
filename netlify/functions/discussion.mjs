// POST /api/discussion  { key, spot, mode, band, facts } → { headline, body }
// A short local-expert style write-up generated from Snowline's forecast numbers.
// Cached per spot/mode/band for 4 hours so each spot costs at most a few calls a day.
import Anthropic from "@anthropic-ai/sdk";
import { json, store } from "../lib/shared.mjs";

const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"];

const SYSTEM = `You are Snowline's local mountain forecaster, writing a short daily snow forecast for skiers, in the voice of a seasoned local expert (think OpenSnow's Daily Snow), warm, direct and specific.
Rules:
- Use ONLY the numbers in the provided facts. Never invent amounts, dates, places or conditions.
- 110 to 170 words. Plain text, no markdown symbols, no bullet lists, no emoji.
- Output exactly: a headline line (max 9 words), a blank line, then 2 or 3 short paragraphs.
- Lead with what matters most: the next storm or the dry stretch, when to ski, and expected snow quality.
- Mention snow levels or rain only if they matter at this elevation. Mention wind holds only if flagged.
- Tailor to the mode, and keep the vocabulary strictly within it:
  - alpine: powder, groomers, lifts, first chair, aspects, runs. Never mention wax, kick, tracks or track speed.
  - skate: groomed trails, skate lanes, corduroy, glide wax, track speed, crust skating. Never mention lifts, chairs, runs, first chair, kick wax or set tracks.
  - classic: set tracks, kick and glide, kick wax or klister, icing, grooming. Never mention lifts, chairs, runs, first chair, skate lanes or skating.
- Use amounts as given (with units). Use ranges where given. Be honest about uncertainty when confidence is low.
- No safety or avalanche advice beyond "check the avalanche forecast" if avalanche danger is 3 or higher.`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, { status: 405 });
  let body; try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, { status: 400 }); }
  const { spot, mode = "alpine", band = "summit", facts } = body || {};
  if (!spot || !facts || JSON.stringify(facts).length > 6000) return json({ error: "spot and facts required" }, { status: 400 });
  const bucket = Math.floor(Date.now() / (4 * 3600e3));
  const key = `disc-v2-${spot}-${mode}-${band}-${bucket}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const s = store("snowline-cache");
  try { const c = await s.get(key, { type: "json" }); if (c) return json({ ...c, cached: true }); } catch (e) {}
  if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY) return json({ error: "ai-unavailable" }, { status: 503 });
  const client = new Anthropic();
  let text = null, lastErr = null;
  for (const model of MODELS) {
    try {
      const m = await client.messages.create({
        model, max_tokens: 500, system: SYSTEM,
        messages: [{ role: "user", content: `Spot: ${spot}\nMode: ${mode}\nElevation band: ${band}\nFacts (JSON):\n${JSON.stringify(facts)}` }],
      });
      text = (m.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      if (text) break;
    } catch (e) { lastErr = e; }
  }
  if (!text) return json({ error: "ai-failed", detail: String(lastErr?.message || lastErr) }, { status: 502 });
  const [headline, ...rest] = text.split(/\n\s*\n/);
  const out = { headline: headline.replace(/^#+\s*/, "").trim(), body: rest.join("\n\n").trim() || "", at: new Date().toISOString() };
  try { await s.setJSON(key, out); } catch (e) {}
  return json(out);
};
export const config = { path: "/api/discussion" };
