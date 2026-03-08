// netlify/functions/scrape.js
// Runs nightly at 2am UTC (configured in netlify.toml)
// Fetches all sources defined in sources.json and caches the extracted text
// in Netlify Blobs so the ask function can use it without refetching each time.

import { getStore } from "@netlify/blobs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sources from "../../sources.json" assert { type: "json" };

const CACHE_KEY = "squidly_knowledge_cache";
const MAX_CHARS_PER_SOURCE = 15000;

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Squidly-Bot/1.0 (knowledge scraper)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function extractTextFromHtml(html) {
  // Simple tag stripper — good enough for most pages
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

async function extractTextFromPdf(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n\n";
  }
  return text.replace(/\s{3,}/g, "\n\n").trim();
}

async function scrapeSource(source) {
  const { label, url, type } = source;

  try {
    if (type === "gdoc") {
      // Google Docs export as plain text
      const res = await fetchUrl(url);
      const text = await res.text();
      return {
        label,
        url,
        type,
        status: "ready",
        content: text.slice(0, MAX_CHARS_PER_SOURCE),
        scrapedAt: new Date().toISOString(),
      };
    }

    if (type === "pdf") {
      // Google Drive PDF or any direct PDF URL
      const res = await fetchUrl(url);
      const buffer = await res.arrayBuffer();
      const text = await extractTextFromPdf(buffer);
      if (!text || text.length < 20)
        throw new Error("Could not extract text (may be image-based PDF)");
      return {
        label,
        url,
        type,
        status: "ready",
        content: text.slice(0, MAX_CHARS_PER_SOURCE),
        scrapedAt: new Date().toISOString(),
      };
    }

    if (type === "url") {
      const res = await fetchUrl(url);
      const html = await res.text();
      const text = await extractTextFromHtml(html);
      if (!text || text.length < 50)
        throw new Error("Could not extract meaningful text from page");
      return {
        label,
        url,
        type,
        status: "ready",
        content: text.slice(0, MAX_CHARS_PER_SOURCE),
        scrapedAt: new Date().toISOString(),
      };
    }

    throw new Error(`Unknown source type: ${type}`);
  } catch (err) {
    console.error(`[scrape] Failed: ${label} — ${err.message}`);
    return {
      label,
      url,
      type,
      status: "error",
      error: err.message,
      scrapedAt: new Date().toISOString(),
    };
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler() {
  console.log(`[scrape] Starting scrape of ${sources.length} sources…`);

  const results = await Promise.allSettled(sources.map(scrapeSource));
  const scraped = results.map((r) =>
    r.status === "fulfilled" ? r.value : { status: "error", error: r.reason?.message }
  );

  const ready = scraped.filter((s) => s.status === "ready").length;
  console.log(`[scrape] Done. ${ready}/${sources.length} sources ready.`);

  // Store in Netlify Blobs
  const store = getStore("squidly");
  await store.setJSON(CACHE_KEY, {
    sources: scraped,
    updatedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true, ready, total: sources.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
