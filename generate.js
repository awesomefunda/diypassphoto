// generate.js — single source of truth (data/countries.json) -> site assets.
// Run:  node generate.js
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "countries.json"), "utf8"));
const slugs = Object.keys(data);
const SITE = "https://www.diypassphoto.com";
const BRAND = "DIYPassPhoto";
const TAGLINE = "Snap it. Verify it. Pass it.";

/* escape all non-ASCII as \uXXXX so countries.js is pure ASCII — no encoding issues */
function asciiSafe(str) {
  return str.replace(/[^\x00-\x7F]/g, ch => {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFFFF) return "\\u" + cp.toString(16).padStart(4,"0");
    const hi = 0xD800 + ((cp - 0x10000) >> 10);
    const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
    return "\\u" + hi.toString(16) + "\\u" + lo.toString(16);
  });
}

/* 1) Browser registry --------------------------------------------------- */
fs.writeFileSync(
  path.join(ROOT, "countries.js"),
  "// AUTO-GENERATED from data/countries.json by generate.js — do not edit by hand.\n" +
  "window.COUNTRY_SPECS = " + asciiSafe(JSON.stringify(data, null, 2)) + ";\n"
);

/* helpers --------------------------------------------------------------- */
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const bgName = t => t[0] >= 250 ? "White" : (t[0] >= 235 ? "Off-white" : "Light grey");
const headPct = h => `${Math.round(h[0]*100)}–${Math.round(h[1]*100)}%`;

const TOOL = `
    <div class="studio">
      <div class="camcol">
        <div class="docbar"><label for="country">Document type</label><select class="docsel" id="country" aria-label="Document type"></select></div>
        <div class="framewrap" id="framewrap">
        <span class="cropmark tl"></span><span class="cropmark tr"></span><span class="cropmark bl"></span><span class="cropmark br"></span>
        <div class="viewfinder">
          <video id="video" autoplay playsinline muted style="display:none"></video>
          <canvas class="feed" id="feed" style="display:none"></canvas>
          <canvas class="hud" id="hud"></canvas>
          <div class="vf-msg" id="vfMsg"></div>
          <div class="vf-empty" id="vfEmpty">
            <button class="vf-startbtn" id="vfStart" aria-label="Start camera" title="Start camera">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </button>
            <span class="big">Tap to start the camera</span>
            Rear camera is sharper — ask someone to take it for you.
            <label class="vf-uploadlink" for="upload">or check a photo you already have</label>
            <input type="file" id="upload" accept="image/*"/>
          </div>
          <div class="vf-shutter" id="vfShutter">
            <button class="vf-btn" id="vfFlip" aria-label="Flip camera" title="Flip camera">⟲</button>
            <button class="vf-shot" id="vfCapture" aria-label="Capture photo" disabled></button>
            <button class="vf-btn" id="vfClose" aria-label="Close camera" title="Close camera">✕</button>
          </div>
        </div>
        </div>
      </div>
      <div>
        <div class="panel" id="gatesPanel">
          <div class="phead"><span class="ttl">Compliance check</span></div>
          <div class="gates" id="gates"></div>
          <div class="score"><span class="verdict hold" id="verdict">Waiting for a photo…</span><span class="mono" id="scoreNum" style="color:var(--mist)"></span></div>
        </div>
        <div class="hint" id="status">Tip: face a window for soft, even light. Overhead lights cause the shadows that get photos rejected.</div>
      </div>
    </div>

    <div class="result" id="result">
      <img id="resultImg" alt="Your formatted photo preview"/>
      <div>
        <div class="rmeta" id="rmeta"></div>
        <div class="controls" style="margin-top:14px">
          <button class="btn go" id="share">Save / Share</button>
          <button class="btn" id="download">Download</button>
          <button class="btn" id="downloadUpload" style="display:none">Download for upload</button>
          <button class="btn" id="report">Download report</button>
          <button class="btn" id="sheet">4×6 sheet</button>
          <button class="btn" id="retake">Retake</button>
        </div>
        <div class="disclaimer">Measured against the published spec — not a guarantee of acceptance. Confirm any “?” items yourself. No AI edits applied.</div>
      </div>
    </div>`;

function countryNav(current){
  return slugs.map(s => {
    const c = data[s];
    const active = s === current ? ' style="border-color:var(--go-line)"' : "";
    return `<a class="ccard" href="${s}.html"${active}><span class="fl">${c.flag}</span><span class="cinfo"><span class="cn">${esc(c.label)}</span><span class="cs">${esc(c.country)}</span></span><span class="go-arrow">→</span></a>`;
  }).join("\n        ");
}
function footerCountries(){
  return slugs.slice(0,6).map(s => `      <a href="${s}.html">${esc(data[s].label)}</a>`).join("\n");
}

/* 2) Per-country pages -------------------------------------------------- */
const cdir = path.join(ROOT, "c");
fs.mkdirSync(cdir, { recursive: true });

for (const slug of slugs){
  const c = data[slug];
  const url = `${SITE}/c/${slug}.html`;
  const faqLd = {
    "@context":"https://schema.org","@type":"FAQPage",
    "mainEntity": c.faq.map(f => ({ "@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a} }))
  };
  const crumbLd = {
    "@context":"https://schema.org","@type":"BreadcrumbList",
    "itemListElement":[
      {"@type":"ListItem","position":1,"name":"DIYPassPhoto","item":SITE+"/"},
      {"@type":"ListItem","position":2,"name":c.label+" photo checker","item":url}
    ]
  };
  const appLd = {
    "@context":"https://schema.org","@type":"WebApplication","name":`DIYPassPhoto — ${c.label} photo checker`,
    "applicationCategory":"PhotographyApplication","operatingSystem":"Web",
    "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"url":url,"description":c.seo.desc
  };
  const fileKB = c.out.maxKB ? `≤ ${c.out.maxKB} KB` : "No strict limit";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="google-site-verification" content="n2v7NmYRlID2x2gxkc62s_XNZjDP45ZBI1xCRPhwQdw"/>
<link rel="manifest" href="/manifest.webmanifest"/>
<meta name="theme-color" content="#0B130E"/>
<link rel="icon" href="/icon.svg" type="image/svg+xml"/>
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png"/>
<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="DIYPassPhoto"/>
<meta name="mobile-web-app-capable" content="yes"/>
<title>${esc(c.seo.title)}</title>
<meta name="description" content="${esc(c.seo.desc)}"/>
<meta name="keywords" content="${esc(c.seo.keywords)}"/>
<link rel="canonical" href="${url}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(c.seo.title)}"/>
<meta property="og:description" content="${esc(c.seo.desc)}"/>
<meta property="og:url" content="${url}"/>
<meta property="og:image" content="${SITE}/og-image.png"/>
<meta property="og:site_name" content="DIYPassPhoto"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(c.seo.title)}"/>
<meta name="twitter:description" content="${esc(c.seo.desc)}"/>
<meta name="twitter:image" content="${SITE}/og-image.png"/>
<meta name="robots" content="index,follow"/>
<link rel="stylesheet" href="../styles.css?v=19"/>
<script type="application/ld+json">${JSON.stringify(appLd)}</script>
<script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"DIYPassPhoto","url":"${SITE}/"}</script>
</head>
<body>
<header class="bar"><div class="wrap">
  <a class="brand" href="../"><span class="mark"></span>DIYPassPhoto</a>
  <nav class="navlinks"><a href="../#how">How it works</a><a href="../#checks">What we check</a><a href="../#countries">Countries</a><a href="../blog/">Guides</a></nav>
</div></header>

<main class="wrap">
  <div class="crumb"><a href="../">DIYPassPhoto</a> / ${esc(c.country)} / ${esc(c.docName)}</div>

  <section class="hero" id="tool">
    <div class="emblem"><span class="flag">${c.flag}</span></div>
    <h1>${esc(c.seo.h1)}</h1>
    <p class="lede">Snap it from your phone, get the green light, download your photo and a compliance report. Checked against the official ${esc(c.country)} spec before you submit — nothing uploaded.</p>
${slug.startsWith("us-") || slug === "dv-lottery" ? `
    <div class="notice2026">
      <b>US 2026 rule:</b> The State Department now rejects AI-edited, background-swapped, or digitally enhanced photos. DIYPassPhoto never alters your photo — it measures and coaches only.
      <a href="https://travel.state.gov/content/travel/en/passports/requirements/photos.html" target="_blank" rel="noopener noreferrer">Official source ↗</a>
    </div>` : ""}
${slug.startsWith("india-") ? `
    <div class="notice2026 noticeindia">
      <b>India needs two files:</b> a <b>print copy</b> (2×2 in) and an <b>upload copy under 300 KB</b> for the online form. DIYPassPhoto gives you both — and can shrink a photo you already have under the KB limit, without editing your face.
      <a href="../blog/india-passport-visa-photo-size-kb.html">India photo size guide (KB) →</a>
    </div>` : ""}
${TOOL}
    <p class="official"><a href="${c.officialUrl}" target="_blank" rel="noopener noreferrer">Official ${esc(c.country)} photo requirements ↗</a></p>
  </section>

  <section class="block" id="reqs">
    <h2 class="sec">${esc(c.label)} photo requirements</h2>
    <p class="sec-sub">${esc(c.seo.intro)}</p>
    <ul class="reqlist">
      ${c.reqs.map(r => `<li>${esc(r)}</li>`).join("\n      ")}
    </ul>

    <h3 class="sec" style="margin-top:36px">Common rejection reasons</h3>
    <ul class="rejlist">
      ${c.rejections.map(r => `<li>${esc(r)}</li>`).join("\n      ")}
    </ul>

    <h3 class="sec" style="margin-top:36px">Frequently asked questions</h3>
    <div class="faqlist">
      ${c.faq.map(f => `<div class="faqitem"><h4>${esc(f.q)}</h4><p>${esc(f.a)}</p></div>`).join("\n      ")}
    </div>
  </section>

  <section class="block" id="countries">
    <span class="eyebrow">Other countries</span>
    <h2 class="sec">Need a different document?</h2>
    <div class="countries">
        ${countryNav(slug)}
    </div>
  </section>
</main>

<footer><div class="wrap">
  <div class="cols">
    <div><a class="brand" href="../" style="margin-bottom:10px"><span class="mark"></span>DIYPassPhoto</a><p style="max-width:34ch">Passport &amp; visa photos from your phone — verified before you submit. Free, open-source, nothing uploaded.</p></div>
    <div><h4>Countries</h4>
${footerCountries()}
    </div>
    <div><h4>Guides</h4>
      <a href="../blog/ai-passport-photo-tools-non-compliant-2026.html">AI tools &amp; 2026 rule</a>
      <a href="../blog/india-passport-visa-photo-size-kb.html">India photo size (KB)</a>
      <a href="../blog/us-passport-photo-at-home.html">US photo at home</a>
      <a href="../blog/dv-lottery-photo-requirements.html">DV Lottery rules</a>
      <a href="../blog/white-wall-gray-background-fix.html">Fix grey backgrounds</a>
    </div>
  </div>
  <div class="legal">Not affiliated with any government. DIYPassPhoto measures published specifications and cannot guarantee acceptance — always confirm current rules with the issuing authority. Snap it. Verify it. Pass it.</div>
</div></footer>

<script>window.GF_START="${slug}";</script>
<script src="../countries.js?v=19"></script>
<script type="module" src="../app.js?v=19"></script>
<script>if("serviceWorker" in navigator){addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));}</script>
</body>
</html>`;
  fs.writeFileSync(path.join(cdir, `${slug}.html`), html);
}

/* 3) Standalone single-file pages (inlined CSS+JS) — phone/offline/preview */
const sdir = path.join(ROOT, "standalone");
fs.mkdirSync(sdir, { recursive: true });
const CSS = fs.readFileSync(path.join(ROOT,"styles.css"),"utf8");
const REG = fs.readFileSync(path.join(ROOT,"countries.js"),"utf8");
const APP = fs.readFileSync(path.join(ROOT,"app.js"),"utf8");
function inline(html){
  return html
    .replace(/<link rel="stylesheet" href="(\.\.\/)?styles\.css(\?[^"]*)?"\/>/, "<style>\n"+CSS+"\n</style>")
    .replace(/<script src="(\.\.\/)?countries\.js(\?[^"]*)?"><\/script>/, "<script>\n"+REG+"\n</script>")
    .replace(/<script type="module" src="(\.\.\/)?app\.js(\?[^"]*)?"><\/script>/, '<script type="module">\n'+APP+"\n</script>");
}
for (const slug of slugs){
  fs.writeFileSync(path.join(sdir, `${slug}.html`), inline(fs.readFileSync(path.join(cdir, `${slug}.html`),"utf8")));
}
fs.writeFileSync(path.join(sdir, "index.html"), inline(fs.readFileSync(path.join(ROOT,"index.html"),"utf8")));

/* 4) Sitemap ------------------------------------------------------------ */
const today = new Date().toISOString().slice(0,10);
const blogs = ["ai-passport-photo-tools-non-compliant-2026","india-passport-visa-photo-size-kb","us-passport-photo-at-home","dv-lottery-photo-requirements","white-wall-gray-background-fix"];
const urls = [
  `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  `  <url><loc>${SITE}/blog/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
  ...slugs.map(s => `  <url><loc>${SITE}/c/${s}.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`),
  ...blogs.map(b => `  <url><loc>${SITE}/blog/${b}.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`)
];
fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);

console.log(`Generated countries.js, ${slugs.length} country pages, ${slugs.length+1} standalone pages, and sitemap.xml (${slugs.length+1+blogs.length} URLs).`);
