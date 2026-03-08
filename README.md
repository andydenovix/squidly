# Squidly 🦑

A friendly AI assistant powered by Claude that answers questions from your own knowledge sources.
Built to deploy on Netlify with zero backend maintenance.

---

## How it works

- You define knowledge sources in `sources.json` (Google Docs, Google Drive PDFs, public URLs)
- Every night at 2am UTC, Netlify automatically fetches and caches all your sources
- Visitors ask questions on your site — Squidly answers using your cached knowledge
- Your Anthropic API key lives securely in Netlify's environment variables, never exposed to visitors

---

## One-time setup (~30 minutes)

### Step 1 — Get an Anthropic API key

1. Go to https://console.anthropic.com
2. Sign up / log in
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-…`) — you'll need it in Step 4

---

### Step 2 — Put the project on GitHub

1. Go to https://github.com/new and create a new **public** repository (e.g. `squidly`)
2. Upload all these files maintaining the folder structure:
   ```
   index.html
   sources.json
   netlify.toml
   netlify/functions/ask.js
   netlify/functions/scrape.js
   README.md
   ```
   You can drag and drop files directly in the GitHub web interface.

---

### Step 3 — Deploy to Netlify

1. Go to https://app.netlify.com and sign up with your GitHub account
2. Click **Add new site** → **Import an existing project** → **GitHub**
3. Select your `squidly` repository
4. Leave all build settings as default and click **Deploy site**
5. Netlify will give you a URL like `https://cheerful-squid-abc123.netlify.app`

---

### Step 4 — Add your API key to Netlify

1. In Netlify, go to your site → **Site configuration** → **Environment variables**
2. Click **Add a variable**
3. Key: `ANTHROPIC_API_KEY`
4. Value: paste your key from Step 1
5. Click **Save**
6. Go to **Deploys** and click **Trigger deploy** → **Deploy site** to apply

---

### Step 5 — Enable Netlify Blobs (for caching)

1. In Netlify, go to your site → **Blobs** (in the left sidebar)
2. It should be enabled by default — if not, click **Enable Blobs**

---

### Step 6 — Run the first scrape

The nightly scrape runs automatically at 2am UTC, but you'll want to run it manually the first time:

1. In Netlify, go to **Functions** → find `scrape`
2. You can trigger it manually, OR just wait for the nightly run

Alternatively, visit: `https://your-site.netlify.app/.netlify/functions/scrape`

---

### Step 7 — Add to your WordPress site

In any WordPress page, add a **Custom HTML** block and paste:

```html
<iframe 
  src="https://your-site.netlify.app" 
  width="100%" 
  height="750" 
  frameborder="0" 
  style="border-radius:16px; border:none;">
</iframe>
```

Replace `your-site.netlify.app` with your actual Netlify URL.

---

## Updating your knowledge sources

Edit `sources.json` in GitHub. The file looks like this:

```json
[
  {
    "label": "Company FAQ",
    "url": "https://docs.google.com/document/d/YOUR_DOC_ID/export?format=txt",
    "type": "gdoc"
  },
  {
    "label": "Product Manual",
    "url": "https://drive.google.com/uc?export=download&id=YOUR_FILE_ID",
    "type": "pdf"
  },
  {
    "label": "About page",
    "url": "https://yourwebsite.com/about",
    "type": "url"
  }
]
```

### Getting URLs for Google Docs

1. Open your Google Doc
2. Click **Share** → set to **Anyone with the link can view**
3. Copy the doc ID from the URL: `https://docs.google.com/document/d/`**`THIS_PART`**`/edit`
4. Your source URL is: `https://docs.google.com/document/d/YOUR_DOC_ID/export?format=txt`

### Getting URLs for Google Drive PDFs

1. Upload your PDF to Google Drive
2. Right-click → **Share** → set to **Anyone with the link can view**
3. Click **Share** again and copy the link — it looks like: `https://drive.google.com/file/d/`**`FILE_ID`**`/view`
4. Your source URL is: `https://drive.google.com/uc?export=download&id=YOUR_FILE_ID`

### After editing sources.json

Changes are picked up automatically at the next nightly scrape (2am UTC).
To apply immediately: Netlify → **Deploys** → **Trigger deploy**.

---

## Costs

Anthropic charges per token. Rough estimates:
- Each conversation: ~$0.01–0.03
- 100 conversations/month: ~$1–3

You can set spend limits at https://console.anthropic.com/settings/limits

---

## Troubleshooting

**Squidly says "no sources loaded"**
→ The scrape hasn't run yet. Trigger it manually (see Step 6).

**Google Doc returns empty content**
→ Make sure sharing is set to "Anyone with the link" not just specific people.

**PDF says "could not extract text"**
→ The PDF may be image-based (scanned). Try copying text from it in a PDF reader first to check.

**iframe not showing on WordPress**
→ Some WordPress themes block iframes. Try the **WPCode** plugin to inject the iframe HTML directly.
