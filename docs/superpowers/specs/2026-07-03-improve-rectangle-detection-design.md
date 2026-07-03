# Improve rectangle detection — design

Addresses [issue #6](https://github.com/vitalseeds/packet_link/issues/6) ("Improve
rectangle detection"), scoped to the low-cost, no-regression improvements.

## Motivation

The issue lists twelve possible improvements to `rectDetector.detect()` and
recommends five low-cost ones. In practice the real-world pain is **false
negatives and instability**, not the false-positive ("locks onto a book")
problem most of the issue's table targets:

- **Misses real packets** — genuine packets fail to lock on.
- **Slow to lock / needs an unrealistically steady hand** — the detected
  outline flickers between candidates, and every flicker resets the
  stability counter (`stableFramesRequired`).
- **Shadows** — held at phone distance, the device casts a shadow that
  partially overlays the packet, breaking the outer edge.
- **Rotated packets** (secondary) — corner ordering breaks past ~45°.

The packet appears in **two states**, both of which must be detected:

- **Closed** (primary case): 92 mm × 128 mm → aspect (long/short) ≈ **1.39**.
- **Opened**, exposed flap: 92 mm × 160 mm → aspect ≈ **1.74**, with a tab at
  the flap that is slightly off-rectangular.

Hard constraint: **low cost, no performance regressions.** This drops the one
moderate-cost recommended item (edge-support scoring, which targets false
positives we don't suffer from) and all the moderate/high-cost optional items.

## Scope

**In scope** (the four cheap levers, mapped to the pains above):

| Change | Cost | Fixes |
|--------|------|-------|
| Morphological **closing** instead of dilation | negligible | shadows, misses |
| **Adaptive-epsilon** reduce-to-4-corners (drop "exactly 4 first try") | very low | misses |
| **Scored** candidate selection (rectangularity + aspect + area) instead of area-alone | very low | slow-to-lock/steadiness, shadows |
| Robust **corner ordering** (left/right partition) | negligible | rotated packets |

Plus the tooling required to validate all of this without regressing:

- An **offline test harness** (`test/`) that runs the real `detect()` against
  committed sample photos and produces a deterministic pass/fail scoreboard.
- A **live debug overlay** (`?debug=1`) that shows per-candidate scores and
  reject reasons on the phone.

**Explicitly out of scope** (deferred issue items): edge-support scoring,
interior-edge density, `RETR_TREE` hierarchy signal, adaptive thresholding,
Hough line detection. Also adjacent but separate: retuning the stability gate
(`stableFramesRequired` / `stableDriftPx`) — a follow-up tuning pass once
detection is steadier, not a code change here.

## Architecture

`js/rectDetector.js` is refactored from one flat loop into named stages
(Approach B). `detect(frameMat, CONFIG, diagnostics?)` **keeps its exact
external contract** — full-frame-space in, `[TL, TR, BR, BL]` or `null` out —
so `main.js`'s happy path is unchanged. The optional third argument is a sink
object `detect()` fills with per-candidate diagnostics; it feeds both the
harness and the live overlay.

### Stage 1 — `preprocess` → edge map

Unchanged from today (downscale → grayscale → optional CLAHE → GaussianBlur →
Canny) **except**: replace `cv.dilate` with
`cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel)`.

Closing (dilate-then-erode) reconnects an edge broken by the phone's shadow
*without* the net-thickening dilation-alone causes — thickening drags corners
inward and merges the packet edge with nearby clutter. Kernel size from
`CONFIG.detection.morphKernelSize`.

### Stage 2 — `extractCandidates` → plain-JS candidate list

`findContours` stays `RETR_EXTERNAL` (its documented anti-inner-border
rationale still holds; `RETR_TREE` was a deferred optional item). For each
contour:

- **`reduceToQuad(contour, CONFIG)`**: take `convexHull`, then sweep the
  `approxPolyDP` epsilon upward from `approxEpsilon` across up to
  `reduceEpsilonSteps` bounded steps until it yields **exactly 4 convex
  points**. Return those 4 corners, or `null` if no epsilon in range gives 4.
  This is the main fix for *misses*: a contour that today approximates to 5–6
  points and is discarded now reduces cleanly to a quad.
- Compute features from the 4 true corners: `area`, `areaFraction`; and via
  `cv.minAreaRect(contour)`: `rectangularity = contourArea / minAreaRectArea`
  and `aspect = longSide / shortSide`.

**minAreaRect is used for scoring features only, never for the warp corners** —
its rotated bounding box would distort an angled (perspective-viewed) packet.
The corners we warp always come from `reduceToQuad`.

All per-contour Mats (hull, approx) are deleted inside this stage. Candidates
leave as pure JS objects `{ corners, area, areaFraction, rectangularity,
aspect }`, so nothing downstream can leak a Mat. (`cv.minAreaRect` returns a
`RotatedRect` value object, not a Mat — no delete needed.)

### Stage 3 — `scoreCandidate(features, CONFIG)` — pure function

Two layers, returning `{ pass, score, rejectReason }`:

- **Hard gates** (reject with a named reason):
  - `areaFraction` within `[minAreaFraction, maxAreaFraction]`
  - `aspect` within `aspectTolerance` of **any** `expectedAspects` entry —
    i.e. close to the closed ratio (~1.39) **or** the opened ratio (~1.74)
  - `rectangularity ≥ rectangularityFloor`
  - convex
- **Score** for survivors:
  `wRect·rectangularity + wAspect·aspectMatch + wArea·areaFraction`
  where `aspectMatch = 1 − min(1, minOver(expectedAspects, |aspect − a|) /
  aspectTolerance)` (distance to the *nearest* expected ratio) and weights come
  from `CONFIG.detection.scoreWeights`.

Matching against two discrete ratios rather than one wide band keeps the gate
tight: a single band spanning 1.39–1.74 would wave through books/A4/tablets
(which cluster ~1.3–1.5). The opened packet's slightly off-rectangular tab is
accommodated by keeping `rectangularityFloor` modest — high enough to reject
ragged shadow-quads, low enough not to reject a real opened packet. The
`convexHull` step in `reduceToQuad` also helps here: the hull of a packet with
a small protruding tab still resolves to ~4 corners.

Keeping a modest `area` weight preserves today's "prefer the big obvious
rectangle" behaviour, while rectangularity and aspect break ties and reject
wrong-shaped big things. Replacing *area-alone* selection is what stops the
frame-to-frame flicker that resets the stability counter — the core of the
*slow-to-lock / steadiness* fix.

Being a pure function of plain numbers, `scoreCandidate` is directly testable
in the harness.

### Stage 4 — select + `orderCorners`

Pick the highest-scoring survivor; run improved `orderCorners` on just that
winner. The new ordering partitions the four points into a left pair and a
right pair by x first (robust well past the ~45° where today's x+y / y−x trick
fails), then assigns TL/BL by y within the left pair and TR/BR via the
diagonal-distance trick within the right pair.

Honest caveat: beyond large rotations the app's *fixed-layout* SKU-crop
assumption (SKU always bottom-left) breaks regardless, so this hardens
moderate rotation rather than enabling upside-down packets.

## Diagnostics structure

`detect()` optionally populates a `diagnostics` object, e.g.:

```js
{
  candidates: [
    { corners, area, areaFraction, rectangularity, aspect,
      pass: false, score: 0, rejectReason: 'aspect' },
    ...
  ],
  winnerIndex: 2,   // or null
}
```

Corners in diagnostics are in the same coordinate space as the returned result
(rescaled back to full frame). Built once, consumed by both the harness and the
live overlay.

## Tooling

### Offline harness — `test/harness.html`, `test/manifest.js`, `test/samples/`

- Static, dependency-free page that loads the **same** OpenCV.js as
  `index.html` and imports the **real** `rectDetector.js` + `config.js` — it
  tests shipping code, not a copy.
- `manifest.js` is a checked-in list of `{ file, expect: 'packet' | 'none',
  note }`. `packet` = should detect; `none` = distractor/empty, should reject.
- For each sample: draw the frame, overlay the detected quad, show **PASS/FAIL**
  vs `expect`, the winner's score breakdown, and every rejected candidate with
  its reject reason. Footer summary: `positives detected X/Y · false
  detections Z`.
- Deterministic per image, so the workflow is: capture baseline scoreboard
  before the change, run after, diff. This is the regression guard.
- Sample photos are **committed** to `test/samples/` for a reproducible
  baseline (accepted trade-off: they are served publicly via GitHub Pages).
  Target ~10–20 frames spanning both states (**closed and opened**) on varied
  backgrounds, with and without the phone shadow, plus a couple of `none`
  distractors (book/tablet, empty surface) whose aspect sits near the packet
  ratios to exercise the gate.
- Detect-or-not drives PASS/FAIL; corner *accuracy* is judged by eye from the
  overlay (no hand-labelled ground-truth corners in this round).

### Live debug overlay — `?debug=1`

- Gated behind a `?debug=1` URL query so normal use is unaffected.
- `main.js` passes a `diagnostics` object into `detect()`; in debug mode it
  draws every candidate (winner green, rejected dim) annotated with score and
  reject reason.
- Reuses the same `diagnostics` structure as the harness.

## Config changes

All additions under `CONFIG.detection`; existing keys unchanged except
`approxEpsilon`, which becomes the *starting* epsilon for the `reduceToQuad`
sweep (its current value/meaning as the base tolerance is preserved).

| Key | Purpose | Starting value |
|-----|---------|----------------|
| `morphKernelSize` | closing kernel side | 3 (try 5 if shadows persist) |
| `expectedAspects` | list of valid long/short ratios | `[1.39, 1.74]` (closed, opened) |
| `aspectTolerance` | allowed deviation from nearest ratio | start ~0.15, tightened only if false positives appear |
| `rectangularityFloor` | reject-below threshold | ~0.8 (modest, to keep opened-flap packets) |
| `reduceEpsilonSteps` | max sweep iterations | small bounded number |
| `scoreWeights` | `{ rect, aspect, area }` | area-favouring to preserve current behaviour, tuned on harness |

### Calibration (during implementation, against the harness)

- `expectedAspects` — known from physical dimensions: `[1.39, 1.74]` (closed
  92×128, opened 92×160). No measurement needed; `aspectTolerance` starts ~0.15
  and tightens only if false positives appear.
- `rectangularityFloor`, `scoreWeights`, `morphKernelSize` — start at safe
  defaults and tune against the harness scoreboard so no positive regresses.
  Verify the opened-packet samples still pass at the chosen `rectangularityFloor`.

## Success criteria

1. On the committed sample set, the harness detects **at least as many**
   `packet` frames as the pre-change baseline (no positive regressions), and
   ideally more (previously-missed 5–6-point contours now caught).
2. No new false detections on `none` samples.
3. Per-frame detection cost is unchanged within noise (closing ≈ dilate;
   scoring adds only arithmetic over the existing candidate set).
4. `detect()`'s external contract is unchanged; `main.js` needs no changes
   beyond the opt-in `?debug=1` overlay wiring.

## Versioning

Per README: bump `VERSION` in `js/config.js` and tag the merge commit on
`main`. This is a minor-feature change (detection rework + tooling).
