// Automated tests for the pure compliance + crop logic. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChecks, cropRect } from "../lib/core.mjs";

const SPECS = JSON.parse(readFileSync(new URL("../data/countries.json", import.meta.url)));
const US = SPECS["us-passport"];        // square 600x600, head 50-69%, eyes 56-69%
const UK = SPECS["uk-passport"];        // portrait 35x45
const IN = SPECS["india-visa"];         // square, has uploadKB

const statusOf = (checks, id) => (checks.find(c => c.id === id) || {}).status;

/* ---------------- check engine ---------------- */

test("idle state: no scary fails before a photo exists", () => {
  const checks = buildChecks({ geo: null, bg: null, sharp: null, light: null, faceCount: undefined, out: null, spec: US });
  assert.equal(statusOf(checks, "face"), "idle");           // not a red fail at rest
  assert.ok(!checks.some(c => c.status === "fail"), "nothing should fail before a photo");
});

test("head size: pass in band, warn near, fail when far/close", () => {
  const mk = hr => buildChecks({ geo: { headRatio: hr, centerX: .5, eyeFromBottom: .62, roll: 0, eyesOpen: .3, mouthOpen: .02 }, bg: null, sharp: null, light: null, faceCount: 1, out: null, spec: US });
  assert.equal(statusOf(mk(0.60), "head"), "pass");   // inside 50-69%
  assert.equal(statusOf(mk(0.43), "head"), "warn");   // a bit far -> warn (auto-cropped), not fail
  assert.equal(statusOf(mk(0.20), "head"), "fail");   // way too far
  assert.equal(statusOf(mk(0.95), "head"), "fail");   // way too close
});

test("background colour: white passes, coloured fails, dark fails", () => {
  const mk = (L, chroma) => buildChecks({ geo: null, bg: { L, chroma, rough: 2 }, sharp: null, light: null, faceCount: undefined, out: null, spec: US });
  assert.equal(statusOf(mk(95, 2), "bg_color"), "pass");   // bright neutral
  assert.equal(statusOf(mk(95, 25), "bg_color"), "fail");  // strong colour tint
  assert.equal(statusOf(mk(50, 2), "bg_color"), "fail");   // too dark
  assert.equal(statusOf(mk(75, 12), "bg_color"), "warn");  // slight tint
});

test("plain background: smooth passes, curtain/pattern fails", () => {
  const mk = rough => buildChecks({ geo: null, bg: { L: 95, chroma: 2, rough }, sharp: null, light: null, faceCount: undefined, out: null, spec: US });
  assert.equal(statusOf(mk(3), "bg_even"), "pass");   // smooth wall
  assert.equal(statusOf(mk(10), "bg_even"), "warn");  // mild texture
  assert.equal(statusOf(mk(20), "bg_even"), "fail");  // curtain / busy
});

test("brightness: bright passes, dim warns, dark fails", () => {
  const mk = overall => buildChecks({ geo: null, bg: null, sharp: null, light: { sideDiff: .05, overall }, faceCount: undefined, out: null, spec: US });
  assert.equal(statusOf(mk(140), "bright"), "pass");
  assert.equal(statusOf(mk(95), "bright"), "warn");
  assert.equal(statusOf(mk(60), "bright"), "fail");
});

test("file size: gate passes under the cap and fails over it", () => {
  const cap = IN.out.maxKB;
  const under = buildChecks({ geo: null, bg: null, sharp: null, light: null, faceCount: undefined, out: { okDims: true, dims: "600×600", kb: cap - 50 }, spec: IN });
  const over = buildChecks({ geo: null, bg: null, sharp: null, light: null, faceCount: undefined, out: { okDims: true, dims: "600×600", kb: cap + 200 }, spec: IN });
  assert.equal(statusOf(under, "filesize"), "pass");
  assert.equal(statusOf(over, "filesize"), "fail");
});

/* ---------------- crop geometry (the head-cut / chin-cut regressions) ---------------- */

// Build realistic head landmarks from a detected head ratio + eye height.
// Anatomy: eye line sits ~45% down from the crown; hair adds ~12% of head height above the crown.
function headPoints(headRatio, eyeFromBottom, sw, sh) {
  const eyeY = sh * (1 - eyeFromBottom), headH = headRatio * sh;
  return { eyeY, headH, crownY: eyeY - 0.45 * headH, chinY: eyeY + 0.55 * headH, hairTopY: eyeY - 0.57 * headH };
}

test("crop keeps the whole head (hair + chin) in frame, eyes in band", () => {
  for (const spec of [US, UK, IN]) {
    const sw = 1080, sh = 1440;
    for (const hr of [0.38, 0.45, 0.52, 0.60]) {
      const eyeFromBottom = (spec.eyeFromBottom[0] + spec.eyeFromBottom[1]) / 2;
      const g = { headRatio: hr, eyeFromBottom, centerX: 0.5 };
      const { sx, sy, cropW, cropH } = cropRect(g, spec, sw, sh);
      const p = headPoints(hr, eyeFromBottom, sw, sh);
      const top = sy, bottom = sy + cropH;
      const tag = `${spec.docName} hr=${hr}`;

      // The whole head must always stay in frame — never cut hair or chin.
      assert.ok(p.hairTopY >= top - 1, `${tag}: hair cut off top (hair ${p.hairTopY.toFixed(0)} < crop ${top.toFixed(0)})`);
      assert.ok(p.chinY <= bottom + 1, `${tag}: chin cut off bottom (chin ${p.chinY.toFixed(0)} > crop ${bottom.toFixed(0)})`);

      // Eyes should land in the spec band ONLY when a compliant head size is actually
      // achievable (i.e. the head isn't forced oversized by a width-limited crop).
      const headPctInCrop = p.headH / cropH;
      if (headPctInCrop <= spec.headRatio[1] + 0.02) {
        const outEye = (bottom - p.eyeY) / cropH;
        assert.ok(outEye >= spec.eyeFromBottom[0] - 0.05 && outEye <= spec.eyeFromBottom[1] + 0.05,
          `${tag}: eyes at ${(outEye * 100).toFixed(0)}% outside band ${spec.eyeFromBottom}`);
      }
      // crop stays inside the source frame
      assert.ok(sx >= -0.5 && sy >= -0.5 && sx + cropW <= sw + 0.5 && sy + cropH <= sh + 0.5, `${tag}: crop exceeds source`);
    }
  }
});

test("crop output matches the spec aspect ratio", () => {
  for (const spec of [US, UK, IN]) {
    const g = { headRatio: 0.5, eyeFromBottom: 0.6, centerX: 0.5 };
    const { cropW, cropH } = cropRect(g, spec, 1080, 1440);
    const want = spec.out.wPx / spec.out.hPx;
    assert.ok(Math.abs(cropW / cropH - want) < 0.01, `${spec.docName}: aspect ${cropW / cropH} != ${want}`);
  }
});
