// netlify/functions/scrape.mjs
// Scrapes Squid pipette knowledge sources nightly at 2am UTC.
// Trigger manually: https://your-site.netlify.app/.netlify/functions/scrape

import { getStore } from "@netlify/blobs";

const CACHE_KEY = "squidly_knowledge_cache";
const MAX_CHARS = 12000;

// ── Sources ───────────────────────────────────────────────────────────────────
const SOURCES = [
  {
    label: "Squid Pipette Product Page",
    url: "https://www.denovix.com/products/squid/",
    type: "url",
  },
  {
    label: "TN-249 Performance Validation of Squid Pipette",
    url: "https://www.denovix.com/tn-249-performance-validation-of-squid-pipette",
    type: "url",
  },
  {
    label: "Squid Resources",
    url: "https://www.denovix.com/squid-resources",
    type: "url",
  },
  {
    label: "Squid Pipette User Guide",
    url: "https://docs.google.com/document/d/1OwbSK-ZIeO99K7Gd-m-VXzvoB_s0gjuQarQAV6WkyYI/export?format=txt",
    type: "gdoc",
  },
  {
    label: "Squid Pipette Specifications",
    url: "https://www.denovix.com/squid-specifications/",
    type: "url",
  },
  {
    label: "Squid Pipette Shop Page",
    url: "https://shop.denovix.com/products/squid-full-range-electronic-pipette-1-1000ul",
    type: "url",
  },
  {
    label: "DeNovix Special Offers",
    url: "https://www.denovix.com/special-offers/",
    type: "url",
  },
];

// ── HTML → text ───────────────────────────────────────────────────────────────
function extractVideoUrls(html) {
  const videos = [];
  const ytRe = /src=["'][^"']*(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})[^"']*/gi;
  const vimRe = /src=["'][^"']*vimeo\.com\/(?:video\/)?([0-9]+)[^"']*/gi;
  const ytLinkRe = /href=["']https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})[^"']*/gi;
  let m;
  while ((m = ytRe.exec(html))    !== null) videos.push(`https://www.youtube.com/watch?v=${m[1]}`);
  while ((m = vimRe.exec(html))   !== null) videos.push(`https://vimeo.com/${m[1]}`);
  while ((m = ytLinkRe.exec(html)) !== null) videos.push(`https://www.youtube.com/watch?v=${m[1]}`);
  return [...new Set(videos)];
}

function stripHtml(html) {
  const videoUrls = extractVideoUrls(html);
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8[01]7;/g, "'")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
  if (videoUrls.length > 0) {
    text += "\n\nVIDEOS ON THIS PAGE:\n" + videoUrls.map(u => `- ${u}`).join("\n");
  }
  return text;
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s*[|\-–]\s*DeNovix.*$/i, "").trim();
}

// ── Scrape a single source ─────────────────────────────────────────────────────
async function scrapeSource(source) {
  const { label, url, type } = source;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Squidly-Bot/1.0 (DeNovix Knowledge Assistant)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let text = "";
    if (type === "pdf") {
      text = `[PDF Document: ${label}]\nURL: ${url}\nThis is a PDF — direct users to download it at the link above for full content.`;
    } else {
      const html = await res.text();
      const title = extractTitle(html) || label;
      text = stripHtml(html);
      if (!text || text.length < 80) throw new Error("Insufficient content extracted");
    }

    return {
      label,
      url,
      type,
      status: "ready",
      content: text.slice(0, MAX_CHARS),
      scrapedAt: new Date().toISOString(),
    };
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

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler() {
  console.log(`[scrape] Starting scrape of ${SOURCES.length} Squid pipette sources…`);

  const results = await Promise.allSettled(SOURCES.map(scrapeSource));
  const scraped = results.map(r =>
    r.status === "fulfilled" ? r.value : { status: "error", error: r.reason?.message }
  );

  const ready = scraped.filter(s => s.status === "ready").length;
  const errors = scraped.filter(s => s.status === "error").length;
  console.log(`[scrape] Done. ${ready}/${SOURCES.length} ready, ${errors} errors.`);

  const store = getStore("squidly");
  await store.setJSON(CACHE_KEY, {
    sources: scraped,
    updatedAt: new Date().toISOString(),
    stats: { ready, errors, total: SOURCES.length },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      ready,
      errors,
      total: SOURCES.length,
      sources: scraped.map(s => ({
        label: s.label,
        url: s.url,
        status: s.status,
        error: s.error,
        chars: s.content?.length,
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
