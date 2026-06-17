# GreenFrame — Directory Submission Guide

## Ready-to-paste copy

**Name:** GreenFrame
**URL:** https://greenframe.photo
**Tagline (≤160 chars):** Take a passport or visa photo that passes — guided live by your camera, checked free, never uploaded.
**Short description (~50 words):** GreenFrame turns your phone camera into a live passport-photo guide. It measures every government requirement — head size, background, lighting, framing — in real time and turns the frame green only when your photo is compliant. Fully in-browser, open-source, and your photo never leaves your device.
**Long description (~150 words):** Most passport-photo tools make you take a blind shot and upload it to find out if it failed. GreenFrame flips that: open your camera, pick your document (US passport, DV Lottery / visa, UK, Schengen, India, Canada, Australia, China), and the viewfinder shows live compliance gates that turn green as you get head size, centering, tilt, eyes, background and lighting right. Capture unlocks only when every requirement passes. It then crops to the exact pixel size and compresses to the file-size limit (e.g. 240 KB for DV Lottery). Everything runs locally in your browser — no server, no upload, no signup, no cost. Crucially, GreenFrame measures and coaches rather than editing, so it stays compliant with the 2026 US rule banning AI-altered photos. Open-source under MIT.
**Categories / Tags:** Photography, Travel, Productivity (or Development for dev directories)
**Pricing:** Free
**Logo:** https://greenframe.photo/logo-512.png  *(create a 512×512 square logo — the dashed-frame mark)*

---

## Priority order

1. **Show HN** — no wait, dev-heavy audience that loves "in your browser, no upload, open-source".
   - URL: https://news.ycombinator.com/submit
   - Title: `Show HN: GreenFrame – take a passport photo that passes, free and in your browser`
   - First comment: why you built it (the Walgreens / DV-rejection story is the hook), the privacy
     architecture, and that it never edits the photo (2026 rule). Post a weekday morning US Eastern.

2. **AlternativeTo** — create account + verify email **today** (7-day cooldown). After 7 days, add
   GreenFrame as an alternative to **PhotoAiD**, **Passport Photo Online**, and **Visafoto**. This
   captures "PhotoAiD alternative / free / private" searches.

3. **Uneed.best** — https://www.uneed.best/submit-a-tool — paste URL, let it auto-scrape, fix the
   category to Photography/Productivity, join the free waiting line.

4. **Peerlist** — https://peerlist.io/tools/submit — quick.

5. **Product Hunt** — https://www.producthunt.com/posts/new — schedule Tue/Wed. Prep: 3–5 screenshots
   (the green HUD is your hero shot), a maker comment, and a few people to upvote.

6. **Reddit (organic, not a directory)** — r/dvlottery, r/immigration, r/Passports. Lead with "I made
   a free tool that checks your photo before you submit, runs entirely in your browser, nothing
   uploaded" — link the relevant blog guide, not just the homepage. These communities are your
   richest, most-motivated audience.

## Skip
- Paid directories (TAAFT $49, Toolify $99, Futurepedia $247+).
- AI-only directories (dang.ai, aitoolsdirectory.com) — GreenFrame isn't an "AI tool" in their sense.

## Google Search Console (do first, when live)
1. Add property (URL prefix, match canonical — non-www `https://greenframe.photo`).
2. Verify (HTML tag in `<head>` is easiest).
3. Sitemaps → submit `sitemap.xml` → confirm Success.
4. URL Inspection → request indexing for homepage + the 3 blog URLs, one at a time (~60s each).
