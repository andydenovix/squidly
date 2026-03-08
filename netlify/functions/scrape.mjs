// netlify/functions/scrape.mjs
// Runs nightly at 2am UTC (configured in netlify.toml)
// Fetches all sources from sources.json and caches extracted text in Netlify Blobs.

import { getStore } from "@netlify/blobs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const CACHE_KEY = "squidly_knowledge_cache";
const MAX_CHARS = 15000;

async function getSources() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, "../../sources.json"),
    resolve(__dirname, "../../../sources.json"),
    resolve(process.cwd(), "sources.json"),
    "/var/task/sources.json",
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      console.log(`[scrape] Loaded sources.json from ${p}`);
      return JSON.parse(raw);
    } catch {
      // try next
    }
  }
  throw new Error("sources.json not found in any expected location");
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

async function scrapeSource(source) {
  const { label, url, type } = source;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Squidly-Bot/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let text = "";

    if (type === "gdoc") {
      text = await res.text();
    } else if (type === "pdf") {
      text = `[PDF source: ${label}]\nURL: ${url}\nNote: PDF content — please refer users to download the document directly for detailed information.`;
    } else {
      const html = await res.text();
      text = stripHtml(html);
    }

    text = text.trim();
    if (!text || text.length < 30) throw new Error("Could not extract meaningful text");

    return {
      label, url, type,
      status: "ready",
      content: text.slice(0, MAX_CHARS),
      scrapedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[scrape] Failed: ${label} — ${err.message}`);
    return {
      label, url, type,
      status: "error",
      error: err.message,
      scrapedAt: new Date().toISOString(),
    };
  }
}

export default async function handler() {
  console.log("[scrape] Starting…");

  let sources;
  try {
    sources = await getSources();
  } catch (err) {
    console.error("[scrape] Could not load sources.json:", err.message);
    return new Response(JSON.stringify({ ok: false, error: "Could not load sources.json" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await Promise.allSettled(sources.map(scrapeSource));
  const scraped = results.map((r) =>
    r.status === "fulfilled" ? r.value : { status: "error", error: r.reason?.message }
  );

  const ready = scraped.filter((s) => s.status === "ready").length;
  console.log(`[scrape] Done. ${ready}/${sources.length} ready.`);

  const store = getStore("squidly");
  await store.setJSON(CACHE_KEY, {
    sources: scraped,
    updatedAt: new Date().toISOString(),
  });

  return new Response(
    JSON.stringify({ ok: true, ready, total: sources.length, sources: scraped.map(s => ({ label: s.label, status: s.status, error: s.error })) }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
