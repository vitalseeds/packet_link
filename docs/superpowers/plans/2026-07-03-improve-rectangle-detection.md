# Improve Rectangle Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make packet detection catch more real packets and stay locked more steadily — via morphological closing, adaptive-epsilon corner reduction, and scored candidate selection — with an offline harness + debug overlay to prove no regression.

**Architecture:** Refactor `js/rectDetector.js` from one flat loop into named stages (preprocess → extract candidates → score → select). `detect()` keeps its exact contract and gains an optional `diagnostics` sink that feeds both a browser test harness and a `?debug=1` live overlay. Pure logic (`scoreCandidate`, `orderCorners`) is unit-tested under Node; the OpenCV pipeline is validated in the browser harness against committed sample photos.

**Tech Stack:** Vanilla ES modules, OpenCV.js 4.x (global `cv`, loaded from CDN), Tesseract.js (unchanged), Node 25 built-in test tooling (`node:assert`) for pure-logic checks. No bundler, no runtime dependencies.

## Global Constraints

- **No build step / no runtime dependencies** — the deployed site stays plain static files served from the repo root.
- **`detect()` external contract is unchanged** — signature `detect(frameMat, CONFIG, diagnostics?)`, returns `[TL, TR, BR, BL]` in full-frame pixel space or `null`. The third arg is optional; `main.js`'s normal path passes nothing.
- **`RETR_EXTERNAL` is kept** (its documented anti-inner-border rationale still holds; `RETR_TREE` is out of scope).
- **`minAreaRect` is used for scoring features only, never for warp corners** — true corners always come from `reduceToQuad`.
- **Two valid packet aspect ratios:** closed 92×128 → **1.39**, opened (flap exposed) 92×160 → **1.74**, opened tab slightly off-rectangular. A candidate must match one (within tolerance).
- **All OpenCV Mats must be `.delete()`d** — the codebase is scrupulous about this; keep it so.
- **Commit messages omit the `Co-Authored-By` trailer** (project preference).
- **Out of scope:** edge-support scoring, interior-edge density, adaptive thresholding, Hough lines, `RETR_TREE`, and retuning the stability gate (`stableFramesRequired` / `stableDriftPx`).
- **Versioning:** bump `VERSION` in `js/config.js` in the final task; git tagging is done by the maintainer at merge time (per README).

---

### Task 1: Project ESM marker, config keys, and Node logic-check scaffold

**Files:**
- Create: `package.json`
- Modify: `js/config.js` (add keys inside `CONFIG.detection`)
- Create: `test/logic-checks.mjs`

**Interfaces:**
- Produces: `CONFIG.detection.{morphKernelSize, expectedAspects, aspectTolerance, rectangularityFloor, reduceEpsilonSteps, scoreWeights}` consumed by Tasks 2, 5, 6, 7. `test/logic-checks.mjs` is the Node assertion harness grown by Tasks 2–3.

- [ ] **Step 1: Create `package.json`** (marks the repo as ES modules so Node can import `js/*.js`; adds no dependencies and no build)

```json
{
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Add the new detection config keys**

In `js/config.js`, inside the `detection: { ... }` object, immediately after the `useClahe`/`claheClipLimit`/`claheTileGridSize` block (the last keys before `detection`'s closing `},`), add:

```js
    // Morphological-closing kernel side length (px, on the downscaled edge
    // map). Closing = dilate-then-erode: reconnects an outer edge broken by
    // the phone's own shadow without the net-thickening plain dilation causes
    // (thickening drags corners inward and merges the edge with clutter).
    morphKernelSize: 3,
    // The packet's valid long/short aspect ratios: closed (92x128 -> 1.39)
    // and opened with the flap exposed (92x160 -> 1.74). A candidate must sit
    // within aspectTolerance of one of these to count as a packet — matching
    // two discrete ratios keeps the gate far tighter than one wide band,
    // which would wave through books/A4/tablets (~1.3-1.5).
    expectedAspects: [1.39, 1.74],
    // How far a candidate's aspect may sit from the NEAREST expectedAspects
    // entry and still pass / still score. Wide enough to absorb perspective
    // foreshortening; tighten only if false positives appear.
    aspectTolerance: 0.15,
    // Reject a candidate whose quad fills less than this fraction of its own
    // minAreaRect (contourArea / minAreaRectArea). Rejects ragged shadow-quads
    // while staying low enough to keep an opened packet's slightly
    // off-rectangular tab.
    rectangularityFloor: 0.8,
    // reduceToQuad sweeps approxPolyDP's epsilon upward from approxEpsilon
    // across this many steps, trying to land on exactly 4 corners before
    // giving up — so a wobbly outline that approximates to 5-6 points still
    // resolves to a quad instead of being discarded.
    reduceEpsilonSteps: 6,
    // Weights blending a candidate's score (see scoreCandidate). Area kept as
    // a modest factor so the big obvious rectangle is still preferred, with
    // rectangularity/aspect breaking ties and rejecting wrong-shaped big
    // things. Replacing area-alone selection is what stops the frame-to-frame
    // flicker that resets the stability counter.
    scoreWeights: { rect: 0.5, aspect: 0.3, area: 0.2 },
```

- [ ] **Step 3: Write the config assertions**

Create `test/logic-checks.mjs`:

```js
// Dependency-free Node checks for the pure (OpenCV-free) detection logic.
// Run with:  node test/logic-checks.mjs
// Exits non-zero on the first failed assertion.
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';

// --- Task 1: config keys present with expected starting values ---
const d = CONFIG.detection;
assert.equal(d.morphKernelSize, 3);
assert.deepEqual(d.expectedAspects, [1.39, 1.74]);
assert.equal(d.aspectTolerance, 0.15);
assert.equal(d.rectangularityFloor, 0.8);
assert.equal(d.reduceEpsilonSteps, 6);
assert.deepEqual(d.scoreWeights, { rect: 0.5, aspect: 0.3, area: 0.2 });

console.log('logic checks passed');
```

- [ ] **Step 4: Run the checks to verify they pass**

Run: `node test/logic-checks.mjs`
Expected: prints `logic checks passed`, exit code 0.

Also confirm the module parses as ESM:
Run: `node --check js/config.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json js/config.js test/logic-checks.mjs
git commit -m "Add detection config keys and Node logic-check scaffold"
```

---

### Task 2: `scoreCandidate` (pure, TDD)

**Files:**
- Modify: `js/rectDetector.js` (add exports `scoreCandidate`, `nearestAspectDistance`)
- Modify: `test/logic-checks.mjs` (add scoreCandidate assertions)

**Interfaces:**
- Consumes: `CONFIG.detection.*` from Task 1.
- Produces: `scoreCandidate(features, CONFIG) -> { pass: boolean, score: number, rejectReason: string|null }`, where `features = { corners, area, areaFraction, rectangularity, aspect, convex }`. Consumed by Task 7's selection loop. `rejectReason` is one of `'notConvex' | 'tooSmall' | 'tooLarge' | 'aspect' | 'rectangularity' | null`.

- [ ] **Step 1: Write the failing tests**

Append to `test/logic-checks.mjs`, before the final `console.log`:

```js
// --- Task 2: scoreCandidate ---
import { scoreCandidate } from '../js/rectDetector.js';

const goodClosed = {
  corners: [], area: 100, areaFraction: 0.4,
  rectangularity: 0.98, aspect: 1.39, convex: true,
};
{
  const r = scoreCandidate(goodClosed, CONFIG);
  assert.equal(r.pass, true, 'closed packet should pass');
  assert.ok(r.score > 0, 'passing candidate should score > 0');
  assert.equal(r.rejectReason, null);
}
// Opened packet (aspect 1.74) also passes via the second expected ratio.
assert.equal(scoreCandidate({ ...goodClosed, aspect: 1.74 }, CONFIG).pass, true);
// aspect 1.5 is nearer 1.39 (dist 0.11) than 1.74 (0.24); 0.11 <= 0.15 -> passes.
assert.equal(scoreCandidate({ ...goodClosed, aspect: 1.5 }, CONFIG).pass, true);
// Hard-gate rejections, each with its reason:
assert.equal(scoreCandidate({ ...goodClosed, aspect: 1.0 }, CONFIG).rejectReason, 'aspect');
assert.equal(scoreCandidate({ ...goodClosed, rectangularity: 0.5 }, CONFIG).rejectReason, 'rectangularity');
assert.equal(scoreCandidate({ ...goodClosed, areaFraction: 0.01 }, CONFIG).rejectReason, 'tooSmall');
assert.equal(scoreCandidate({ ...goodClosed, areaFraction: 0.99 }, CONFIG).rejectReason, 'tooLarge');
assert.equal(scoreCandidate({ ...goodClosed, convex: false }, CONFIG).rejectReason, 'notConvex');
// A higher-rectangularity candidate outscores a lower one, all else equal.
assert.ok(
  scoreCandidate(goodClosed, CONFIG).score >
  scoreCandidate({ ...goodClosed, rectangularity: 0.85 }, CONFIG).score
);
```

Note: the `import { scoreCandidate }` line can also be merged into a single import at the top of the file alongside later imports — kept inline here so this task is self-contained.

- [ ] **Step 2: Run to verify it fails**

Run: `node test/logic-checks.mjs`
Expected: FAIL — `SyntaxError` / `The requested module '../js/rectDetector.js' does not provide an export named 'scoreCandidate'`.

- [ ] **Step 3: Implement `scoreCandidate`**

In `js/rectDetector.js`, add these exported functions (place them above the existing `matToPoints` helper):

```js
// Pure scoring of one candidate's features against CONFIG — no OpenCV, so it
// is unit-testable on its own (see test/logic-checks.mjs). Returns whether the
// candidate clears the hard gates, a 0..1 score for ranking the survivors, and
// a reject reason for diagnostics.
export function scoreCandidate(f, CONFIG) {
  const d = CONFIG.detection;
  if (!f.convex) return { pass: false, score: 0, rejectReason: 'notConvex' };
  if (f.areaFraction < d.minAreaFraction) return { pass: false, score: 0, rejectReason: 'tooSmall' };
  if (f.areaFraction > d.maxAreaFraction) return { pass: false, score: 0, rejectReason: 'tooLarge' };

  const aspectDist = nearestAspectDistance(f.aspect, d.expectedAspects);
  if (aspectDist > d.aspectTolerance) return { pass: false, score: 0, rejectReason: 'aspect' };
  if (f.rectangularity < d.rectangularityFloor) return { pass: false, score: 0, rejectReason: 'rectangularity' };

  const aspectMatch = 1 - Math.min(1, aspectDist / d.aspectTolerance);
  const w = d.scoreWeights;
  const score = w.rect * f.rectangularity + w.aspect * aspectMatch + w.area * f.areaFraction;
  return { pass: true, score, rejectReason: null };
}

// Distance from `aspect` to the nearest of the expected ratios.
export function nearestAspectDistance(aspect, expected) {
  return Math.min(...expected.map((a) => Math.abs(aspect - a)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node test/logic-checks.mjs`
Expected: prints `logic checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/rectDetector.js test/logic-checks.mjs
git commit -m "Add pure scoreCandidate scoring with hard gates"
```

---

### Task 3: Robust `orderCorners` (pure, TDD)

**Files:**
- Modify: `js/rectDetector.js` (replace existing `orderCorners`, add `export`)
- Modify: `test/logic-checks.mjs` (add orderCorners assertions)

**Interfaces:**
- Produces: `orderCorners(pts) -> [TL, TR, BR, BL]` (each `{x, y}`), robust for rotations up to ~45°. Consumed by `detect()` (Tasks 6–7).

- [ ] **Step 1: Write the failing tests**

Append to `test/logic-checks.mjs`, before the final `console.log`:

```js
// --- Task 3: orderCorners ---
import { orderCorners } from '../js/rectDetector.js';

// Axis-aligned rectangle handed in scrambled -> canonical TL,TR,BR,BL.
{
  const tl = { x: 0, y: 0 }, tr = { x: 10, y: 0 }, br = { x: 10, y: 14 }, bl = { x: 0, y: 14 };
  assert.deepEqual(orderCorners([br, tl, bl, tr]), [tl, tr, br, bl]);
}
// Rotated quad (integer coords) still resolves correctly.
// Input scrambled; expected order is TL,TR,BR,BL.
assert.deepEqual(
  orderCorners([{ x: 9, y: 16 }, { x: 3, y: 0 }, { x: 0, y: 11 }, { x: 12, y: 5 }]),
  [{ x: 3, y: 0 }, { x: 12, y: 5 }, { x: 9, y: 16 }, { x: 0, y: 11 }]
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/logic-checks.mjs`
Expected: FAIL — either `does not provide an export named 'orderCorners'` (it is currently a non-exported internal), or an `AssertionError` from the old x+y / y−x ordering.

- [ ] **Step 3: Replace `orderCorners`**

In `js/rectDetector.js`, replace the entire existing `orderCorners` function (the one with the `bySum`/`byDiff` sort) with:

```js
// Orders 4 corners as [TL, TR, BR, BL], robust to rotation up to ~45° (well
// past the point where an x+y / y-x sort flips corners). Partition the points
// into a left pair and a right pair by x first; within the left pair the
// smaller-y point is TL and the larger-y is BL; the right pair's TR/BR are
// disambiguated by distance from TL (BR is the farther one). Assumes the
// packet is roughly upright — beyond ~45° the app's fixed-layout SKU crop
// breaks regardless, so this is not meant to handle sideways/upside-down.
export function orderCorners(pts) {
  const byX = [...pts].sort((a, b) => a.x - b.x);
  const left = byX.slice(0, 2);
  const right = byX.slice(2);
  const [tl, bl] = left[0].y < left[1].y ? [left[0], left[1]] : [left[1], left[0]];
  const dTo = (p) => Math.hypot(p.x - tl.x, p.y - tl.y);
  const [tr, br] = dTo(right[0]) < dTo(right[1]) ? [right[0], right[1]] : [right[1], right[0]];
  return [tl, tr, br, bl];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node test/logic-checks.mjs`
Expected: prints `logic checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/rectDetector.js test/logic-checks.mjs
git commit -m "Make orderCorners robust to rotation via left/right partition"
```

---

### Task 4: Browser harness scaffold with synthetic smoke sample

**Files:**
- Create: `test/harness.html`
- Create: `test/manifest.js`
- Create: `test/samples/.gitkeep`

**Interfaces:**
- Consumes: `detect(frameMat, CONFIG, diagnostics?)` (current implementation) and `CONFIG` from `js/`.
- Produces: `test/manifest.js` exporting `SAMPLES` (array of `{ file, expect, note }`), consumed by Task 8.

- [ ] **Step 1: Create the empty sample manifest**

Create `test/manifest.js`:

```js
// Sample frames for the detection harness. Drop image files into test/samples/
// and list them here. `expect` is 'packet' (should detect) or 'none' (should
// reject). Capture ~10-20 frames spanning BOTH states — closed (92x128) and
// opened (92x160) — on varied backgrounds, with and without the phone's own
// shadow across the packet, plus a couple of 'none' distractors (a book or
// tablet, an empty surface) whose aspect sits near the packet ratios.
export const SAMPLES = [
  // { file: 'closed-plain-01.jpg', expect: 'packet', note: 'dark surface, no shadow' },
  // { file: 'opened-shadow-01.jpg', expect: 'packet', note: 'phone shadow across top' },
  // { file: 'book-distractor-01.jpg', expect: 'none', note: 'paperback, no packet' },
];
```

- [ ] **Step 2: Keep the samples directory in git**

Create `test/samples/.gitkeep` (empty file) so the directory exists before any photos are added:

```bash
mkdir -p test/samples && touch test/samples/.gitkeep
```

- [ ] **Step 3: Create the harness page (smoke sample only for now)**

Create `test/harness.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Packet detection harness</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; background: #111; color: #eee; }
    h1 { font-size: 1.2rem; }
    #summary { font-size: 1.1rem; font-weight: bold; margin: 0.5rem 0 1rem; }
    .grid { display: flex; flex-wrap: wrap; gap: 1rem; }
    .card { border: 1px solid #333; padding: 0.5rem; border-radius: 6px; max-width: 320px; }
    .card canvas { max-width: 300px; height: auto; display: block; background: #000; }
    .pass { color: #2ecc71; } .fail { color: #e74c3c; }
    .scores { font-size: 0.8rem; white-space: pre-wrap; color: #aaa; }
  </style>
</head>
<body>
  <h1>Packet detection harness</h1>
  <p id="status">Loading OpenCV…</p>
  <div id="summary"></div>
  <div id="grid" class="grid"></div>

  <script>
    // OpenCV.js signals readiness through Module.onRuntimeInitialized; wrap it
    // in a promise the module script below can await.
    window.cvReady = new Promise((resolve) => {
      window.Module = { onRuntimeInitialized: () => resolve() };
    });
  </script>
  <script async src="https://docs.opencv.org/4.x/opencv.js"></script>

  <script type="module">
    await window.cvReady;
    const { CONFIG } = await import('../js/config.js');
    const { detect } = await import('../js/rectDetector.js');

    const grid = document.getElementById('grid');
    const statusEl = document.getElementById('status');
    const summaryEl = document.getElementById('summary');

    // Draw the detected quad (green) over a frame on a display canvas.
    function drawResult(srcCanvas, corners) {
      const c = document.createElement('canvas');
      c.width = srcCanvas.width; c.height = srcCanvas.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(srcCanvas, 0, 0);
      if (corners) {
        ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath(); ctx.stroke();
      }
      return c;
    }

    function renderCard(title, srcCanvas, corners, diagnostics, passed) {
      const card = document.createElement('div');
      card.className = 'card';
      const h = document.createElement('div');
      h.innerHTML = `<strong>${title}</strong> — ` +
        `<span class="${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'}</span>`;
      card.appendChild(h);
      card.appendChild(drawResult(srcCanvas, corners));
      const scores = document.createElement('div');
      scores.className = 'scores';
      scores.textContent = (diagnostics.candidates || [])
        .map((c, i) => {
          const tag = i === diagnostics.winnerIndex ? '* ' : '  ';
          const s = c.score !== undefined ? c.score.toFixed(3) : '-';
          const reason = c.rejectReason ? ` (${c.rejectReason})` : '';
          return `${tag}score ${s} aspect ${c.aspect.toFixed(2)} rect ${c.rectangularity.toFixed(2)}${reason}`;
        })
        .join('\n');
      card.appendChild(scores);
      grid.appendChild(card);
    }

    // Run detect() over one RGBA source canvas; returns { corners, diagnostics }.
    function runDetect(srcCanvas) {
      const mat = cv.imread(srcCanvas);
      const diagnostics = {};
      const corners = detect(mat, CONFIG, diagnostics);
      mat.delete();
      return { corners, diagnostics };
    }

    // Synthetic smoke frame: a light rounded rectangle (~1.39 aspect) on a dark
    // background. Deterministic, needs no captured photo — exercises the whole
    // OpenCV pipeline so this harness is useful before real samples exist.
    function makeSyntheticFrame() {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 420;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#e8e4d8';
      ctx.fillRect(40, 40, 220, 306); // 220x306 -> aspect 1.39 (the closed-packet ratio)
      return c;
    }

    statusEl.textContent = 'Running…';

    // Smoke test first.
    const smoke = makeSyntheticFrame();
    const smokeRes = runDetect(smoke);
    renderCard('synthetic smoke', smoke, smokeRes.corners, smokeRes.diagnostics, !!smokeRes.corners);

    summaryEl.textContent = `smoke: ${smokeRes.corners ? 'detected' : 'MISSED'}`;
    statusEl.textContent = 'Done.';
  </script>
</body>
</html>
```

Note: the synthetic rectangle is 220×306 (aspect ≈ 1.39, the closed-packet ratio), so it clears the aspect gate once scoring lands (Task 7), and it is detected by the current area-based code now. At this task's point in the sequence `detect()` is still the pre-refactor version that ignores the third `diagnostics` arg, so the scores line will be blank until Task 6/7 — that's expected; the smoke PASS still verifies the pipeline.

- [ ] **Step 4: Verify the harness loads and the smoke sample detects**

Run a static server from the repo root:
```bash
npx serve . -l 3000
```
Open `http://localhost:3000/test/harness.html` in a desktop browser.
Expected: the page shows one card titled "synthetic smoke" with a green quad drawn around the light rectangle and a green **PASS**; summary reads `smoke: detected`. (No console errors.)

- [ ] **Step 5: Commit**

```bash
git add test/harness.html test/manifest.js test/samples/.gitkeep
git commit -m "Add detection harness scaffold with synthetic smoke sample"
```

---

### Task 5: Morphological closing in preprocessing

**Files:**
- Modify: `js/rectDetector.js` (inside `detect`, the dilation step)

**Interfaces:** unchanged (`detect` contract identical).

- [ ] **Step 1: Replace dilation with closing**

In `js/rectDetector.js`, find the current dilation block inside `detect`:

```js
  // Dilate so broken/anti-aliased edge segments join into closed contours.
  const dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, dilated, kernel);
```

Replace it with morphological closing (dilate-then-erode), sized from config:

```js
  // Morphological closing (dilate-then-erode) so broken/anti-aliased edge
  // segments — including an outer edge cut by the phone's own shadow — rejoin
  // into closed contours, WITHOUT the net-thickening that plain dilation
  // causes (which drags corners inward and merges the edge with clutter).
  const closed = new cv.Mat();
  const kernel = cv.Mat.ones(CONFIG.detection.morphKernelSize, CONFIG.detection.morphKernelSize, cv.CV_8U);
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
```

Then update the two downstream references from `dilated` to `closed`:
- The `cv.findContours(dilated, ...)` call becomes `cv.findContours(closed, ...)`.
- The cleanup `dilated.delete();` becomes `closed.delete();`.

- [ ] **Step 2: Verify syntax**

Run: `node --check js/rectDetector.js`
Expected: no output, exit 0.

- [ ] **Step 3: Verify the smoke sample still detects**

Serve and reload `http://localhost:3000/test/harness.html`.
Expected: "synthetic smoke" card still shows green **PASS**, `smoke: detected`. No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/rectDetector.js
git commit -m "Use morphological closing to reconnect shadow-broken edges"
```

---

### Task 6: Refactor `detect` into preprocess / extractCandidates / reduceToQuad

**Files:**
- Modify: `js/rectDetector.js` (restructure; behaviour preserved — still selects the largest in-range candidate)

**Interfaces:**
- Produces (internal): `preprocess(workMat, CONFIG) -> edgeMat`; `extractCandidates(edgeMat, frameArea, CONFIG) -> Array<{ corners, area, areaFraction, rectangularity, aspect, convex }>` (corners in downscaled/work space); `reduceToQuad(contour, CONFIG) -> [{x,y}*4] | null`; `polygonArea(pts) -> number`. All consumed by `detect`; `extractCandidates` output shape is consumed by Task 7's scoring.

This task rewrites the file into named stages while keeping behaviour identical (largest in-range area wins). `scoreCandidate`/`nearestAspectDistance` (Task 2) and `orderCorners` (Task 3) are retained unchanged.

- [ ] **Step 1: Rewrite `js/rectDetector.js`**

Replace the whole file with:

```js
// Finds the packet by its own outline — a rectangular contour scored on shape,
// not by matching the logo. Calibration-free: no reference photo, no per-packet
// template. See docs/superpowers/specs/2026-07-03-improve-rectangle-detection-design.md.
//
// Takes CONFIG as a parameter (rather than importing it) so every file shares
// the exact same cache-busted copy main.js loaded — see js/main.js.

// Returns [topLeft, topRight, bottomRight, bottomLeft] in frame pixel space, or
// null if nothing rectangular enough was found. `diagnostics` (optional) is
// filled with { candidates, winnerIndex } for the harness / debug overlay.
export function detect(frameMat, CONFIG, diagnostics) {
  const d = CONFIG.detection;

  // Search on a downscaled copy — "is there a big rectangle here" doesn't need
  // full sensor resolution — then rescale corners back so the contract
  // (full-frame in, full-frame out) is unchanged.
  const longSide = Math.max(frameMat.rows, frameMat.cols);
  const scale = Math.min(1, d.detectScaleMaxDim / longSide);
  let workMat = frameMat;
  if (scale < 1) {
    workMat = new cv.Mat();
    cv.resize(
      frameMat,
      workMat,
      new cv.Size(Math.round(frameMat.cols * scale), Math.round(frameMat.rows * scale)),
      0,
      0,
      cv.INTER_AREA
    );
  }

  const edges = preprocess(workMat, CONFIG);
  const frameArea = workMat.rows * workMat.cols;
  const candidates = extractCandidates(edges, frameArea, CONFIG);
  edges.delete();

  // INTERIM selection (behaviour-preserving): largest in-range area wins.
  // Task 7 replaces this block with scoreCandidate-based selection.
  let best = null;
  let bestArea = 0;
  let winnerIndex = null;
  candidates.forEach((c, i) => {
    if (
      c.areaFraction > d.minAreaFraction &&
      c.areaFraction < d.maxAreaFraction &&
      c.area > bestArea
    ) {
      bestArea = c.area;
      best = c;
      winnerIndex = i;
    }
  });

  if (workMat !== frameMat) workMat.delete();

  const rescale = scale < 1 ? (p) => ({ x: p.x / scale, y: p.y / scale }) : (p) => p;
  if (diagnostics) {
    diagnostics.candidates = candidates.map((c) => ({ ...c, corners: c.corners.map(rescale) }));
    diagnostics.winnerIndex = winnerIndex;
  }
  return best ? orderCorners(best.corners.map(rescale)) : null;
}

// Grayscale -> optional CLAHE -> blur -> Canny -> morphological close. Returns
// the closed edge Mat; the caller owns and deletes it.
function preprocess(workMat, CONFIG) {
  const d = CONFIG.detection;
  const gray = new cv.Mat();
  cv.cvtColor(workMat, gray, cv.COLOR_RGBA2GRAY);

  if (d.useClahe) {
    applyClahe(gray, d.claheClipLimit, d.claheTileGridSize);
  }

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, d.cannyLow, d.cannyHigh);

  // Closing (dilate-then-erode) reconnects edges broken by the phone's own
  // shadow without the net-thickening plain dilation causes.
  const closed = new cv.Mat();
  const kernel = cv.Mat.ones(d.morphKernelSize, d.morphKernelSize, cv.CV_8U);
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

  gray.delete();
  blurred.delete();
  edges.delete();
  kernel.delete();
  return closed;
}

// Builds a plain-JS feature object for every external contour that reduces to
// a convex quad. Corners are the TRUE quad from reduceToQuad; rectangularity
// and aspect come from minAreaRect (used for scoring ONLY, never as warp
// corners — a rotated bounding box would distort an angled packet).
//
// RETR_EXTERNAL (not RETR_LIST/RETR_TREE): the packet has a printed decorative
// inner border that is itself a rectangle. RETR_EXTERNAL ignores nested
// contours so that inner border is never a candidate.
function extractCandidates(edges, frameArea, CONFIG) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const candidates = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const corners = reduceToQuad(contour, CONFIG);
    if (corners) {
      const area = polygonArea(corners);
      const rr = cv.minAreaRect(contour);
      const rectArea = rr.size.width * rr.size.height;
      const longSide = Math.max(rr.size.width, rr.size.height);
      const shortSide = Math.min(rr.size.width, rr.size.height);
      candidates.push({
        corners,
        area,
        areaFraction: area / frameArea,
        rectangularity: rectArea > 0 ? area / rectArea : 0,
        aspect: shortSide > 0 ? longSide / shortSide : 0,
        // reduceToQuad only returns convex quads, so this is always true; kept
        // explicit so scoreCandidate stays a self-contained pure function.
        convex: true,
      });
    }
    contour.delete();
  }

  contours.delete();
  hierarchy.delete();
  return candidates;
}

// Reduces a contour to exactly 4 convex corner points, tolerating outlines that
// approxPolyDP renders as 5-6 points at the base epsilon by sweeping epsilon
// upward. Returns [{x,y}*4] or null. This is the source of the WARP corners.
function reduceToQuad(contour, CONFIG) {
  const d = CONFIG.detection;
  const hull = new cv.Mat();
  cv.convexHull(contour, hull, false, true);
  const perimeter = cv.arcLength(hull, true);

  let result = null;
  const approx = new cv.Mat();
  for (let step = 0; step < d.reduceEpsilonSteps; step++) {
    const epsilon = d.approxEpsilon * perimeter * (1 + step * 0.5);
    cv.approxPolyDP(hull, approx, epsilon, true);
    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      result = matToPoints(approx);
      break;
    }
  }
  approx.delete();
  hull.delete();
  return result;
}

// Shoelace polygon area of ordered/unordered simple-quad points (absolute).
function polygonArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

// Pure scoring of one candidate's features against CONFIG — no OpenCV, so it
// is unit-testable on its own (see test/logic-checks.mjs). Returns whether the
// candidate clears the hard gates, a 0..1 score for ranking the survivors, and
// a reject reason for diagnostics.
export function scoreCandidate(f, CONFIG) {
  const d = CONFIG.detection;
  if (!f.convex) return { pass: false, score: 0, rejectReason: 'notConvex' };
  if (f.areaFraction < d.minAreaFraction) return { pass: false, score: 0, rejectReason: 'tooSmall' };
  if (f.areaFraction > d.maxAreaFraction) return { pass: false, score: 0, rejectReason: 'tooLarge' };

  const aspectDist = nearestAspectDistance(f.aspect, d.expectedAspects);
  if (aspectDist > d.aspectTolerance) return { pass: false, score: 0, rejectReason: 'aspect' };
  if (f.rectangularity < d.rectangularityFloor) return { pass: false, score: 0, rejectReason: 'rectangularity' };

  const aspectMatch = 1 - Math.min(1, aspectDist / d.aspectTolerance);
  const w = d.scoreWeights;
  const score = w.rect * f.rectangularity + w.aspect * aspectMatch + w.area * f.areaFraction;
  return { pass: true, score, rejectReason: null };
}

// Distance from `aspect` to the nearest of the expected ratios.
export function nearestAspectDistance(aspect, expected) {
  return Math.min(...expected.map((a) => Math.abs(aspect - a)));
}

function matToPoints(mat) {
  const pts = [];
  for (let i = 0; i < mat.rows; i++) {
    pts.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  }
  return pts;
}

// Orders 4 corners as [TL, TR, BR, BL], robust to rotation up to ~45° (well
// past the point where an x+y / y-x sort flips corners). Partition the points
// into a left pair and a right pair by x first; within the left pair the
// smaller-y point is TL and the larger-y is BL; the right pair's TR/BR are
// disambiguated by distance from TL (BR is the farther one). Assumes the
// packet is roughly upright — beyond ~45° the app's fixed-layout SKU crop
// breaks regardless, so this is not meant to handle sideways/upside-down.
export function orderCorners(pts) {
  const byX = [...pts].sort((a, b) => a.x - b.x);
  const left = byX.slice(0, 2);
  const right = byX.slice(2);
  const [tl, bl] = left[0].y < left[1].y ? [left[0], left[1]] : [left[1], left[0]];
  const dTo = (p) => Math.hypot(p.x - tl.x, p.y - tl.y);
  const [tr, br] = dTo(right[0]) < dTo(right[1]) ? [right[0], right[1]] : [right[1], right[0]];
  return [tl, tr, br, bl];
}

// OpenCV.js builds expose CLAHE under two names across versions — tolerate
// either, in-place on `mat`.
function applyClahe(mat, clipLimit, tileGridSize) {
  const tileSize = new cv.Size(tileGridSize, tileGridSize);
  const clahe =
    typeof cv.CLAHE === 'function' ? new cv.CLAHE(clipLimit, tileSize) : cv.createCLAHE(clipLimit, tileSize);
  clahe.apply(mat, mat);
  clahe.delete();
}
```

- [ ] **Step 2: Verify the pure-logic checks still pass**

Run: `node test/logic-checks.mjs`
Expected: `logic checks passed` (scoreCandidate/orderCorners/nearestAspectDistance exports unchanged).

Run: `node --check js/rectDetector.js`
Expected: no output, exit 0.

- [ ] **Step 3: Verify the smoke sample still detects**

Reload `http://localhost:3000/test/harness.html`.
Expected: "synthetic smoke" card shows green **PASS**, `smoke: detected`, and the scores line now lists the candidate's `aspect`/`rect` values. No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/rectDetector.js
git commit -m "Refactor detect() into preprocess/extractCandidates/reduceToQuad"
```

---

### Task 7: Score-based selection and diagnostics

**Files:**
- Modify: `js/rectDetector.js` (replace the interim selection block in `detect`)

**Interfaces:**
- Consumes: `scoreCandidate` (Task 2), the candidate shape from `extractCandidates` (Task 6).
- Produces: `detect` now selects the highest-scoring passing candidate; `diagnostics.candidates[i]` gains `{ pass, score, rejectReason }`.

- [ ] **Step 1: Replace the interim selection block**

In `js/rectDetector.js`, inside `detect`, replace the interim block (from the `// INTERIM selection` comment through the `});` that closes `candidates.forEach`) with score-based selection:

```js
  // Score every candidate; the highest-scoring one that clears the hard gates
  // wins. Replacing largest-area selection is what keeps the SAME candidate
  // chosen frame to frame (less flicker -> faster, steadier lock-on).
  let best = null;
  let bestScore = -Infinity;
  let winnerIndex = null;
  const scored = candidates.map((c, i) => {
    const s = scoreCandidate(c, CONFIG);
    if (s.pass && s.score > bestScore) {
      bestScore = s.score;
      best = c;
      winnerIndex = i;
    }
    return { ...c, ...s };
  });
```

Then update the diagnostics assignment near the end of `detect` to use `scored` (which carries the score/pass/rejectReason) instead of the raw `candidates`:

Replace:
```js
  if (diagnostics) {
    diagnostics.candidates = candidates.map((c) => ({ ...c, corners: c.corners.map(rescale) }));
    diagnostics.winnerIndex = winnerIndex;
  }
```
with:
```js
  if (diagnostics) {
    diagnostics.candidates = scored.map((c) => ({ ...c, corners: c.corners.map(rescale) }));
    diagnostics.winnerIndex = winnerIndex;
  }
```

- [ ] **Step 2: Verify logic + syntax**

Run: `node test/logic-checks.mjs` → `logic checks passed`.
Run: `node --check js/rectDetector.js` → exit 0.

- [ ] **Step 3: Verify the smoke sample detects under scoring**

Reload `http://localhost:3000/test/harness.html`.
Expected: "synthetic smoke" still green **PASS**; the winning candidate line is prefixed with `*` and shows a numeric `score`; any rejected candidates show a `(reason)`. No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/rectDetector.js
git commit -m "Select packet by shape score instead of area alone"
```

---

### Task 8: Image scoreboard in the harness

**Files:**
- Modify: `test/harness.html` (iterate `SAMPLES`, tally pass/fail)

**Interfaces:**
- Consumes: `SAMPLES` from `test/manifest.js`; `detect` diagnostics.

- [ ] **Step 1: Add manifest iteration and summary**

In `test/harness.html`, in the module `<script>`, add the manifest import at the top (next to the other imports):

```js
    const { SAMPLES } = await import('./manifest.js');
```

Then replace the smoke-only tail (from `// Smoke test first.` through the end of the script) with:

```js
    // Load an image file from test/samples/ onto an RGBA canvas.
    async function loadSample(file) {
      const img = new Image();
      img.src = `samples/${file}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c;
    }

    let positivesTotal = 0, positivesDetected = 0, falseDetections = 0;

    // Smoke test first (counts as a positive).
    const smoke = makeSyntheticFrame();
    const smokeRes = runDetect(smoke);
    positivesTotal++;
    if (smokeRes.corners) positivesDetected++;
    renderCard('synthetic smoke', smoke, smokeRes.corners, smokeRes.diagnostics, !!smokeRes.corners);

    // Then every manifest sample.
    for (const s of SAMPLES) {
      let srcCanvas;
      try {
        srcCanvas = await loadSample(s.file);
      } catch (err) {
        renderCard(`${s.file} (load error)`, makeSyntheticFrame(), null, {}, false);
        continue;
      }
      const res = runDetect(srcCanvas);
      const detected = !!res.corners;
      let passed;
      if (s.expect === 'packet') {
        positivesTotal++;
        if (detected) positivesDetected++;
        passed = detected;
      } else {
        if (detected) falseDetections++;
        passed = !detected;
      }
      renderCard(`${s.file} — ${s.note || s.expect}`, srcCanvas, res.corners, res.diagnostics, passed);
    }

    summaryEl.textContent =
      `positives detected ${positivesDetected}/${positivesTotal} · false detections ${falseDetections}`;
    statusEl.textContent = 'Done.';
```

- [ ] **Step 2: Verify the scoreboard renders**

Reload `http://localhost:3000/test/harness.html`.
Expected: with an empty `SAMPLES`, one card (synthetic smoke, PASS) and summary `positives detected 1/1 · false detections 0`. No console errors. (Once you add photos to `test/samples/` and entries to `manifest.js`, each renders a card and the tally updates.)

- [ ] **Step 3: Commit**

```bash
git add test/harness.html
git commit -m "Add image scoreboard to detection harness"
```

- [ ] **Step 4 (maintainer, manual): capture and commit sample photos**

This step needs real photos and is done by the maintainer, not the agent:
1. Capture ~10–20 frames per Task 4's manifest guidance (closed + opened, plain + phone-shadow backgrounds, a couple of `none` distractors) and copy them into `test/samples/`.
2. List each in `test/manifest.js` with its `expect` and `note`.
3. **Target:** the scoreboard should read `positives detected Y/Y` (every real-packet sample detected) with `false detections 0`.
4. If a `packet` sample is missed or a `none` sample is detected, tune `CONFIG.detection` (`aspectTolerance`, `rectangularityFloor`, `scoreWeights`, `morphKernelSize`) and reload until the scoreboard is clean. For a direct A/B against the old detector, temporarily restore `main`'s versions of just the detector files and reload the harness (it imports only `detect`/`CONFIG`, so it still runs): `git checkout main -- js/rectDetector.js js/config.js`, note the numbers, then restore the branch versions with `git checkout HEAD -- js/rectDetector.js js/config.js`.
5. Commit the samples and manifest:
```bash
git add test/samples/ test/manifest.js
git commit -m "Add detection harness sample frames"
```

---

### Task 9: Live `?debug=1` overlay

**Files:**
- Modify: `js/main.js` (parse `?debug=1`, pass diagnostics, draw candidates)

**Interfaces:**
- Consumes: `detect`'s `diagnostics` output.

- [ ] **Step 1: Add a debug flag near the top of `js/main.js`**

After the DOM element lookups (just before `let scanTimer = null;`), add:

```js
// ?debug=1 turns on an overlay of every detection candidate with its score /
// reject reason — for tuning on a real phone. Off (and zero-cost) otherwise.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
```

- [ ] **Step 2: Pass a diagnostics sink into `detect` and draw it**

In `scanFrame`, change the detect call:

```js
    const frameMat = cv.imread(workCanvas);
    const rawCorners = rectDetector.detect(frameMat, CONFIG);
```
to:
```js
    const frameMat = cv.imread(workCanvas);
    const diagnostics = DEBUG ? {} : undefined;
    const rawCorners = rectDetector.detect(frameMat, CONFIG, diagnostics);
```

Then, immediately after the existing `overlayCtx.clearRect(0, 0, overlay.width, overlay.height);` line in `scanFrame`, add:

```js
    if (DEBUG && diagnostics) drawDebugCandidates(diagnostics);
```

- [ ] **Step 3: Add the debug-draw helper**

Add this function next to `drawOverlayQuad` in `js/main.js`:

```js
// Draws every candidate the detector considered: winner in green, rejected in
// dim red, each annotated with its score or reject reason. Only called under
// ?debug=1.
function drawDebugCandidates(diagnostics) {
  const cands = diagnostics.candidates || [];
  cands.forEach((c, i) => {
    const isWinner = i === diagnostics.winnerIndex;
    overlayCtx.strokeStyle = isWinner ? '#2ecc71' : 'rgba(231,76,60,0.6)';
    overlayCtx.lineWidth = isWinner ? 4 : 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(c.corners[0].x, c.corners[0].y);
    for (let k = 1; k < c.corners.length; k++) overlayCtx.lineTo(c.corners[k].x, c.corners[k].y);
    overlayCtx.closePath();
    overlayCtx.stroke();

    const label = c.rejectReason ? c.rejectReason : `score ${(c.score ?? 0).toFixed(2)}`;
    overlayCtx.fillStyle = isWinner ? '#2ecc71' : 'rgba(231,76,60,0.9)';
    overlayCtx.font = '16px sans-serif';
    overlayCtx.fillText(label, c.corners[0].x + 4, c.corners[0].y + 16);
  });
}
```

- [ ] **Step 4: Verify normal and debug modes**

Run: `node --check js/main.js` → exit 0.

Serve and open `http://localhost:3000/` (normal) — behaviour unchanged; clicking Scan works as before (grant camera). Then open `http://localhost:3000/?debug=1` — after granting the camera and pointing at a rectangle, candidate outlines with score/reason labels appear. (Camera-dependent; verify on a webcam/phone.)

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "Add ?debug=1 overlay of detection candidates"
```

---

### Task 10: Documentation and version bump

**Files:**
- Modify: `README.md`
- Modify: `js/config.js` (`VERSION`)

- [ ] **Step 1: Document the harness, debug mode, and new detection behaviour**

In `README.md`, in the "How it works" list, update step 1 ("Find the outline") to reflect scored selection, and add a new subsection after "Running it":

```markdown
## Testing detection changes

Detection is tuned empirically, so there are two tools for it:

- **Offline harness** — `test/harness.html`. Serve the repo
  (`npx serve .`) and open `/test/harness.html`. It runs the real
  `detect()` over a built-in synthetic frame plus every photo listed in
  `test/manifest.js` (files live in `test/samples/`), drawing the detected
  quad and each candidate's score, with a `positives detected X/Y · false
  detections Z` summary. Run it on `main` and on a branch to compare
  detection rates before merging.
- **Pure-logic checks** — `node test/logic-checks.mjs` runs fast
  assertions over the OpenCV-free scoring/ordering functions.
- **Live debug overlay** — open the app with `?debug=1` to see every
  detection candidate (winner green, rejected dim) with its score or reject
  reason drawn over the camera feed.
```

Also update the first detection bullet under "How it works" from the "largest contour that simplifies … to a convex 4-sided shape" wording to:

```markdown
1. **Find the outline** — [OpenCV.js](https://docs.opencv.org/4.x/opencv.js)
   runs Canny edge detection, morphological closing, and `cv.findContours`
   on the frame. Each contour is reduced to a 4-corner quad and scored on
   rectangularity, aspect ratio (matched against the packet's closed 1.39
   and opened 1.74 ratios), and size; the highest-scoring candidate is
   taken to be the packet.
```

- [ ] **Step 2: Bump `VERSION`**

In `js/config.js`, change:
```js
export const VERSION = '0.5.5';
```
to:
```js
export const VERSION = '0.6.0';
```

- [ ] **Step 3: Verify**

Run: `node test/logic-checks.mjs` → `logic checks passed` (VERSION change is harmless).
Run: `node --check js/config.js` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md js/config.js
git commit -m "Document detection harness/debug tooling and bump to v0.6.0"
```

(The maintainer tags `v0.6.0` on the merge commit to `main`, per the README's versioning note.)

---

## Notes for the executor

- **Verification split:** pure-logic tasks (2, 3) have automated Node red/green; OpenCV-pipeline tasks (4–9) are verified in a browser via `test/harness.html` (and, for Task 9, a camera). A headless agent should run every `node ...` step and confirm no console errors when it can drive a browser; where it cannot, it should hand the browser/camera verification to the maintainer rather than claim success.
- **Sample photos (Task 8 Step 4) are a maintainer step** — the agent cannot capture them. The harness is fully functional with just the synthetic smoke sample until then.
- **Mat discipline:** if you add any OpenCV call, delete every Mat you create. The refactored `preprocess`/`extractCandidates`/`reduceToQuad` already do; keep it that way.
