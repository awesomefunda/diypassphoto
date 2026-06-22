// lib/core.mjs — pure logic shared by the browser app and the test suite.
// No DOM, no canvas, no MediaPipe. Everything here is unit-tested in /test.

export const FLAG_LABELS = {
  no_glasses: "Remove glasses (not permitted)",
  neutral_expression: "Neutral expression — confirm",
  no_head_covering: "No hat / head covering (unless religious)"
};

// The compliance check engine. Given measured inputs (or nulls before a photo
// exists), returns one row per rule: {id,label,status,measured,coach} where
// status is pass|warn|fail|manual|idle.
export function buildChecks({ geo, bg, sharp, light, faceCount, out, spec }) {
  const C = [], push = (id, label, status, measured, coach) => C.push({ id, label, status, measured, coach });
  if (geo !== undefined) push("face", "One face detected", faceCount === undefined ? "idle" : (faceCount === 1 ? "pass" : "fail"), faceCount === undefined ? "—" : (faceCount === 1 ? "1 face" : `${faceCount || 0} faces`), faceCount === 0 ? "No face found — move closer and face the camera." : "Only one person may be in frame.");
  if (geo) {
    const [hmin, hmax] = spec.headRatio, hr = geo.headRatio;
    // We auto-crop to the exact head-size spec on export, so live framing only needs to be
    // "close enough" to stay sharp. Warn (not fail) in a wide band; fail only if too far
    // (cropping would pixellate) or impossibly close.
    let hst, hco;
    if (hr >= hmin && hr <= hmax) { hst = "pass"; hco = ""; }
    else if (hr >= 0.28 && hr <= 0.92) {
      hst = "warn"; hco = hr < hmin
        ? "A bit far — stand back ~4 ft (avoids lens distortion); we crop to the exact size for you."
        : "A bit close — step back ~4 ft to avoid lens distortion; we crop to size.";
    }
    else {
      hst = "fail"; hco = hr < 0.28
        ? "Too far — move closer so the cropped photo stays sharp."
        : "Too close — step back about 4 ft (arm's length distorts your face).";
    }
    push("head", "Head size", hst, `${(hr * 100).toFixed(0)}% · ${Math.round(hmin * 100)}–${Math.round(hmax * 100)}%`, hco);
    push("center", "Centering", Math.abs(geo.centerX - .5) < .06 ? "pass" : "warn", `${(geo.centerX * 100).toFixed(0)}% across`, "Centre your face left-to-right.");
    if (spec.eyeFromBottom) { const [a, b] = spec.eyeFromBottom; push("eyes_pos", "Eye height", geo.eyeFromBottom >= a && geo.eyeFromBottom <= b ? "pass" : "warn", `${(geo.eyeFromBottom * 100).toFixed(0)}% up`, "Raise or lower the camera so your eyes sit in the required band."); }
    push("tilt", "Head level", Math.abs(geo.roll) < 5 ? "pass" : "fail", `${geo.roll.toFixed(1)}°`, "Straighten your head — don't tilt.");
    push("open", "Eyes open", geo.eyesOpen > .18 ? "pass" : "warn", geo.eyesOpen > .18 ? "open" : "narrow", "Open your eyes fully and look at the lens.");
    push("mouth", "Neutral mouth", geo.mouthOpen < .08 ? "pass" : "warn", geo.mouthOpen < .08 ? "closed" : "smiling", "Close your mouth — neutral expression.");
  }
  if (bg) {
    // Accept any light, neutral background (white / off-white / light grey, as the specs allow);
    // fail only if it's coloured (high chroma) or too dark.
    const L = bg.L, ch = bg.chroma;
    let cst, ccoach;
    if (L >= 80 && ch <= 9) { cst = "pass"; ccoach = ""; }
    else if (L >= 70 && ch <= 15) { cst = "warn"; ccoach = ch > 9 ? "Background has a slight colour tint — a whiter/greyer wall is safer." : "Background a little dark — brighten it (face a window)."; }
    else { cst = "fail"; ccoach = ch > 15 ? "Background has colour — use a plain white, off-white or light-grey wall." : "Background too dark — passport backgrounds must be light. Add light or move to a lighter wall."; }
    push("bg_color", "Background colour", cst, `L ${Math.round(L)} · tint ${Math.round(ch)}`, ccoach);
    // Plainness from local contrast: smooth wall/gradient passes; curtains/patterns/objects fail.
    const rg = bg.rough;
    const evst = rg < 7 ? "pass" : (rg < 14 ? "warn" : "fail");
    push("bg_even", "Plain background", evst, evst === "pass" ? "plain" : `texture ${rg.toFixed(0)}`,
      evst === "pass" ? "" : "Use a plain, smooth wall — curtains, patterns or objects behind you get the photo rejected.");
  }
  if (light) {
    push("shadow", "Even lighting", light.sideDiff < .14 ? "pass" : "warn", `${(light.sideDiff * 100).toFixed(0)}% L/R`, "Lighting is uneven — turn toward soft, frontal light.");
    const b = light.overall; // mean face luminance 0-255
    push("bright", "Brightness", b >= 110 ? "pass" : (b >= 85 ? "warn" : "fail"), `${Math.round(b)}/255`,
      b >= 110 ? "" : "Too dark — face a window or put a lamp in front of you (not behind). We never brighten the photo for you.");
  }
  if (sharp != null) push("sharp", "Sharpness", sharp > 120 ? "pass" : sharp > 60 ? "warn" : "fail", `${sharp.toFixed(0)}`, sharp <= 120 ? "Looks soft — hold steady, use the rear camera, lock focus on your face." : "");
  if (out) {
    push("dims", "Pixel size", out.okDims ? "pass" : out.dims ? "warn" : "idle", out.dims || "—", "Auto-sized to spec on export.");
    if (spec.out.maxKB) push("filesize", "File size", out.kb == null ? "idle" : (out.kb <= spec.out.maxKB ? "pass" : "fail"), out.kb == null ? `≤ ${spec.out.maxKB} KB` : `${out.kb} KB · ≤${spec.out.maxKB}`, "Compressed to fit on export.");
  }
  for (const f of (spec.flags || [])) push("flag_" + f, FLAG_LABELS[f] || f, "manual", "confirm", "DIYPassPhoto can't reliably judge this — check it yourself.");
  return C;
}

// Compute the export crop rectangle from the detected face geometry. This is the
// code path behind the head-cut / chin-cut bugs, so it is heavily unit-tested.
//  g    : geometry {headRatio, eyeFromBottom, centerX} or null
//  spec : country spec {headRatio:[min,max], eyeFromBottom?:[min,max], out:{wPx,hPx}}
//  sw,sh: source frame size in px
// Returns {sx,sy,cropW,cropH} in source pixels.
export function cropRect(g, spec, sw, sh) {
  const aspect = spec.out.wPx / spec.out.hPx;
  const mid = (spec.headRatio[0] + spec.headRatio[1]) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let cropH, cropW, cx, cy;
  let eyeY = null, hairTop = null, chinY = null, e = 0.5;
  if (g) {
    // The face mesh detects the skull, not the hair on top, so zoom out a little
    // (HEADROOM) to leave room for hair above the crown and clearance below the chin.
    const HEADROOM = 1.14;
    cropH = (g.headRatio * sh) / mid * HEADROOM; cropW = cropH * aspect; cx = g.centerX * sw;
    e = spec.eyeFromBottom ? (spec.eyeFromBottom[0] + spec.eyeFromBottom[1]) / 2 : 0.58;
    eyeY = sh * (1 - g.eyeFromBottom);
    const headH = g.headRatio * sh;
    hairTop = eyeY - 0.57 * headH;   // crown (~0.45 above eye) + hair allowance (~0.12)
    chinY = eyeY + 0.55 * headH;     // chin below the eye line
  } else { cropH = Math.min(sh, sw / aspect); cropW = cropH * aspect; cx = sw / 2; }
  // Cap the crop to the source frame (keeps output aspect; avoids sampling past the edges).
  if (cropW > sw) { cropW = sw; cropH = cropW / aspect; }
  if (cropH > sh) { cropH = sh; cropW = cropH * aspect; }
  if (g) {
    // Eye-line target, then nudge so the whole head (hair + chin) is guaranteed in frame —
    // critical when a square crop is width-limited from a portrait source.
    let sy0 = (eyeY + cropH * (e - 0.5)) - cropH / 2;
    if (chinY - hairTop <= cropH) {                 // head fits: keep it fully inside
      sy0 = Math.min(sy0, hairTop - 0.04 * cropH);  // ≥4% margin above the hair
      sy0 = Math.max(sy0, chinY + 0.02 * cropH - cropH); // chin inside
    } else {                                        // head bigger than the crop: centre it
      sy0 = (hairTop + chinY) / 2 - cropH / 2;
    }
    cy = sy0 + cropH / 2;
  } else cy = sh / 2;
  const sx = clamp(cx - cropW / 2, 0, sw - cropW), sy = clamp(cy - cropH / 2, 0, sh - cropH);
  return { sx, sy, cropW, cropH };
}
