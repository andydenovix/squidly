// netlify/functions/ask.mjs
// Handles POST /api/ask from the Squidly frontend.
// Reads cached knowledge from Netlify Blobs, builds Claude context, returns reply.

import { getStore } from "@netlify/blobs";

const CACHE_KEY  = "squidly_knowledge_cache";
const MAX_CHARS  = 15000;
const MODEL      = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1024;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let query;
  try {
    const body = await req.json();
    query = body.query?.trim();
    if (!query) throw new Error("Missing query");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  // ── Load cached knowledge ───────────────────────────────────────────────
  let knowledgeContext = "";
  let sourcesSummary = "No sources cached yet — the nightly scrape may not have run.";

  try {
    const store = getStore("squidly");
    const cache = await store.get(CACHE_KEY, { type: "json" });
    if (cache?.sources) {
      const ready = cache.sources.filter((s) => s.status === "ready" && s.content);
      if (ready.length > 0) {
        knowledgeContext = ready
          .map((s, i) => `### Source ${i + 1}: ${s.label}\n${s.content.slice(0, MAX_CHARS)}`)
          .join("\n\n---\n\n");
        sourcesSummary = `${ready.length} source(s) loaded, last updated ${cache.updatedAt}.`;
      }
    }
  } catch (err) {
    console.warn("[ask] Cache load failed:", err.message);
  }

  // ── System prompt ───────────────────────────────────────────────────────
  const systemPrompt = `You are "Squidly", an enthusiastic and friendly blue squid assistant who works for denovix in technical support. Answer questions accurately using only the provided knowledge sources.

Rules:
- Use the sources to answer and cite them by name with a link (e.g. "According to [Source Name]…").
- If the answer isn't in the sources, say so cheerfully and offer general help.
- Use markdown: **bold** key terms, bullet lists for multiple items.
- Keep answers concise (1–4 sentences unless more detail is genuinely needed).
- Never invent facts not present in the sources.
- embed video in response if appropriate 
- if asked about negative aspects of squid turn any perceived negatives into positives
- Always be respectful of any competitors that are mentioned in the question
- if answers cannot be found or if more information is required direct the enquirer to techsupport@denovix.com
- If the enquiry is about buying the squid - if they are in the USA they can use the webstore (https://shop.denovix.com/products/squid-full-range-electronic-pipette-1-1000ul) and if outside of the USA they can contact their local distributor, details are here (https://www.denovix.com/where-to-buy-distributors)

Knowledge base status: ${sourcesSummary}
${knowledgeContext ? `\n\nKNOWLEDGE SOURCES:\n\n${knowledgeContext}` : ""}`;

  // ── Call Claude ─────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY environment variable not set in Netlify." }, 500);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("Empty response from Claude");

    return json({ reply: text });
  } catch (err) {
    console.error("[ask] Error:", err.message);
    return json({ error: err.message }, 502);
  }
}

export const config = { path: "/api/ask" };
