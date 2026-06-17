# GreenFrame

**The passport photo checker that tells you when it's right.** Point your camera; the frame turns
green when your passport/visa photo meets the spec. Live guidance + spec-accurate compliance checks
for 10 countries, fully client-side, free, open-source. Your photo never leaves your device, and it
**never edits the photo** — so it stays compliant with the 2026 US no-alteration rule.

---

## Files

```
data/countries.json     ← SINGLE SOURCE OF TRUTH (specs + per-country SEO copy)
generate.js             ← build: JSON -> countries.js + c/*.html + sitemap.xml
countries.js            ← generated browser registry (window.COUNTRY_SPECS)
styles.css              ← shared design system
app.js                  ← shared logic: live HUD, check engine, export, print sheet (ES module)
index.html              ← home (bespoke)
c/<slug>.html           ← 10 generated, separately-indexable country pages
blog/*.html             ← 3 SEO guides
sitemap.xml, robots.txt
DIRECTORY_SUBMISSIONS.md ← launch copy
```

## Run it

```bash
npm run dev      # builds, then serves at http://localhost:3000 (Node, via npx serve)
# or:
npm run build    # just (re)generate countries.js, c/*, standalone/*, sitemap.xml
npm run serve    # serve the current folder
```
Camera + the MediaPipe face model need **https or localhost** (browsers block getUserMedia and
ES-module imports on `file://`). The design renders anywhere; the live geometry needs a server/host.
Upload-mode background/sharpness/lighting checks work regardless. Deploy: push to a static host
(Vercel auto-detects; `vercel.json` included).

## Rebuild after editing data

```bash
npm run build
```
Regenerates `countries.js`, every `c/*.html`, the phone-friendly `standalone/*.html`, and `sitemap.xml`.

---

## Architecture

Three decoupled layers:

1. **`data/countries.json`** — one record per country: output pixels, head ratio, eye band, background
   target + tolerance, special `flags`, **and** SEO fields (`seo`, `reqs`, `rejections`, `faq`). This
   is the asset — the app and every page are projections of it.
2. **`app.js` check engine** — `buildChecks()` returns `{id,label,status,measured,coach}` per rule
   (`pass|warn|fail|manual|idle`). Deterministic checks (dimensions, file size, background ΔE,
   sharpness, lighting) are pure Canvas/JS; geometry (head ratio, eye line, tilt, eyes, mouth) comes
   from MediaPipe Face Landmarker; un-judgeable rules (glasses, "is it you") return `manual`.
3. **`app.js` HUD + export** — `getUserMedia` → per-frame detect → live gates + green frame → capture
   unlocks on all-pass → crop to spec → binary-search JPEG to the size cap → download or 4×6 print sheet.

### Per-country SEO pages
`generate.js` emits `/c/<slug>.html` for each country with a **unique title, meta description,
keywords, canonical, OG tags**, plus `WebApplication` + `BreadcrumbList` + `FAQPage` JSON-LD. Each
page embeds the live tool pre-set to that country (`window.GF_START`), a spec strip, a requirements
checklist, country-specific rejection reasons, an FAQ, and static interlinks to every other country
(real `<a>` links, good for crawl + SEO). All 14 URLs are in `sitemap.xml`.

### Add a country
Add one entry to `data/countries.json` (copy an existing block, fill specs + SEO), run
`node generate.js`. It appears in the dropdown, the home grid, the footer, a new indexable page, and
the sitemap — no code changes.

> Next step worth taking: split `countries.json` into a published npm package so others can depend on
> the spec registry directly.

---

## Design

Distinctive on purpose — not a default template. Spruce-ink + emerald signal + cool optical white;
**Bricolage Grotesque** display, **Inter** body, **Spline Sans Mono** for the live measurement
readouts. Signature = the **green frame** + **crop-mark corner** motif (the marks you frame a photo
to). One bold move (the frame going green); everything else kept quiet. Reduced-motion respected.

## Port to Next.js (your stack)

- `index.html`/`c/*` → routes; the studio is a `"use client"` component (needs camera + Canvas).
- `data/countries.json` → typed `lib/countries.ts`; check engine → pure `lib/checks.ts` (unit-testable);
  HUD → `useCamera()` hook. The per-country pages become `app/c/[slug]/page.tsx` generated from the
  same JSON via `generateStaticParams` (your `generate.js` logic moves into the framework).
- MediaPipe: `npm i @mediapipe/tasks-vision`. No DB needed (no server state).

MIT.
