// Tunable numbers for the whole pipeline live here so the rest of the code
// doesn't have magic numbers scattered through it.

// Bumped on every merge to main and tagged on that commit (e.g. `v0.1.0`),
// so the footer on the deployed page tells you which build you're on.
export const VERSION = '0.6.0';

export const CONFIG = {
  // Where the SKU sits on a straightened packet (top-left origin box, as a
  // fraction of the straightened packet's width/height) — fixed by the
  // Vital Seeds packet layout, same for every variety. This box actually
  // contains three lines ("<SKU>", "Packed in <year>", "Batch # <n>"), not
  // just the SKU — see js/sku.js for why that matters. wPercent 0.25 was
  // clipping the tail of "Packed in <year>"/"Batch # <n>" even after
  // remapCropForMargin corrected for the corner margin — that text block
  // is just wider than 25% of the packet's width in reality. Widened to
  // give it room; may still need further adjustment.
  skuCrop: { xPercent: 0, yPercent: 0.75, wPercent: 0.32, hPercent: 0.25 },
  // The SKU text is small relative to the packet, which hurts OCR
  // accuracy — this upscales just that crop before recognising it.
  skuCropUpscale: 3,

  // Where the product title (e.g. "NIGELLA - DELFT BLUE") sits — the
  // largest text on the packet, the first horizontal line below the logo.
  // Tuned against real straightened-packet photos, several times now:
  // starting the crop higher than 0.37 caught the tail of the curved
  // "SEEDS" logo text above, and a height of 0.11 half-clipped the second
  // line of a two-line title (e.g. "LETTUCE - FLASHY LIGHTNING
  // BUTTER-OAK"), garbling its OCR. Tall enough for two full lines now —
  // for single-line titles the extra height can catch the smaller
  // latin-name line below instead, which extractTitle (js/title.js)
  // filters back out by its mixed case.
  titleCrop: { xPercent: 0.05, yPercent: 0.37, wPercent: 0.9, hPercent: 0.16 },

  output: {
    // Cap on the straightened packet's longest side (px). Higher gives OCR
    // more pixels to work with, at the cost of more CPU per frame.
    maxDim: 1100,
    // The detected quad is often slightly tight against the packet's true
    // physical edge (a rounded corner simplifying inward, or a few pixels
    // of weak-contrast edge not quite making it into the contour) — with
    // no fix, that lost edge is exactly where skuCrop (xPercent: 0) has no
    // margin to spare, and the first SKU letter gets clipped. Growing the
    // quad outward from its own centroid by this fraction before warping
    // gives every crop a small buffer against that. skuCrop/titleCrop are
    // still defined as percentages of the *true* packet, not the margin-
    // inflated canvas — see geometry.remapCropForMargin, which every crop
    // must be passed through before cropRegion() to correct for this.
    cornerMarginPercent: 0.03,
  },

  detection: {
    // Canny edge detection thresholds — lower catches fainter edges but
    // picks up more background noise. 50/150 needed a strongly
    // contrasting background before the packet's outline registered at
    // all; lowered so a subtler packet-vs-background boundary still
    // produces a contour. The extra noise contours this lets through are
    // cheap to reject (they rarely form large convex quads, and detection
    // runs on a downscaled frame anyway) — but if lock-on gets jittery
    // again, raise these before suspecting anything else.
    cannyLow: 30,
    cannyHigh: 90,
    // approxPolyDP simplification tolerance, as a fraction of the
    // contour's perimeter. Larger = more forgiving of a slightly wobbly
    // outline still counting as a straight-edged quadrilateral.
    approxEpsilon: 0.02,
    // A candidate rectangle's area must be within this fraction of the
    // whole frame's area to count as "the packet" — filters out both
    // background noise (too small) and a rectangle that's actually the
    // frame edge itself (too large).
    minAreaFraction: 0.1,
    maxAreaFraction: 0.95,
    // Require this many consecutive frames with a near-identical packet
    // outline before running OCR, so we don't OCR a blurry/jittery frame.
    stableFramesRequired: 3,
    // Max pixel drift allowed between frames to still count as "stable".
    stableDriftPx: 15,
    // Detection runs on a downscaled frame (detectScaleMaxDim below), so
    // each tick is cheap — a faster tick means the required run of stable
    // frames accumulates sooner (3 frames ≈ 750ms at 250ms vs ~1s at
    // 350ms), which is most of the perceived "sluggish to lock on" time.
    scanIntervalMs: 250,
    // Even holding the camera still, the detected outline jitters a
    // little frame to frame. Smoothing the corner positions with an
    // exponential moving average (weight given to the newest frame) turns
    // that jitter into a steady overlay instead of a jumping one.
    cornerSmoothing: 0.35,
    // The search loop runs every scanIntervalMs on the full camera-sensor
    // resolution, which is far more pixels than "is there a big rectangle
    // here" needs — Canny/dilate/findContours all cost roughly linearly in
    // pixel count. Detection runs on a frame downscaled to this longest-
    // side cap instead (corners are rescaled back to full-frame space
    // before being returned), leaving the final warp/OCR untouched at full
    // resolution.
    detectScaleMaxDim: 700,
    // CLAHE (contrast-limited adaptive histogram equalization) run on the
    // grayscale frame before blur/Canny — the idea was to help a faint
    // true outer edge hold up in weak/uneven contrast (e.g. outdoor
    // light). In practice it amplified background texture/noise (mat
    // weave, wood grain, reflections) into enough spurious edges that the
    // largest-valid-quad candidate flickered between frames, making
    // detection far more sensitive to hand tremor than before. Off by
    // default until a version of this proves net-positive; the plumbing
    // stays so it can be re-tried (e.g. with a lower clip limit).
    useClahe: false,
    claheClipLimit: 2.0,
    claheTileGridSize: 8,
    // Morphological-closing kernel side length (px, on the downscaled edge
    // map). Closing = dilate-then-erode: reconnects a packet border broken by
    // shadow / low contrast into one closed contour, without the net-thickening
    // plain dilation causes. Kept at 3: a 5-kernel was tried to bridge the
    // larger gaps on busy/blurred frames but made recall WORSE — it merged the
    // clean packets' borders into surrounding texture, losing contours that
    // worked at 3. Bigger gaps need adaptive threshold / Hough (out of scope),
    // not a bigger kernel.
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
    // Sanity floor on how much of its own minAreaRect a candidate's quad fills
    // (contourArea / minAreaRectArea) — only excludes grossly non-rectangular
    // shapes (L/triangle-like). Rectangularity is primarily a SCORE signal
    // (see scoreWeights), not a hard gate: a high floor here double-penalised
    // it and was rejecting real but slightly-ragged packets (blur, an opened
    // flap). Accept/reject confidence is enforced by minScore below instead.
    rectangularityFloor: 0.5,
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
    // Absolute confidence floor: the best-scoring candidate must reach this or
    // the frame is treated as "no packet". This is the real accept/reject
    // knob (rectangularityFloor is now just a sanity gate). Tuned so a
    // near-square/low-aspect distractor like a tablet (~0.52) is rejected
    // while genuine packets (lowest observed ~0.58) pass — raise it to reject
    // more borderline objects, lower it to catch weaker packets.
    minScore: 0.55,
  },

  // Preprocessing applied to the SKU/title crops before OCR (see
  // packetGeometry.js's preprocessForOcr) — separate from detection's
  // useClahe above since these run on a small, already-cropped image.
  ocr: {
    // Same story as detection.useClahe: intended to help legibility, but
    // the likely explanation for a real SKU read as "Cbjj" gaining two
    // extra letters ("CbjjTo") with nothing visibly extra in the crop
    // thumbnail is CLAHE turning faint background paper grain or a table
    // divider line into sharp, stroke-like local contrast that Tesseract
    // then confidently misreads as characters. Off by default until a
    // version of this proves net-positive.
    useClahe: false,
    claheClipLimit: 2.0,
    claheTileGridSize: 8,
    // Off by default: Tesseract already does its own internal
    // binarization tuned for its recognition models, so a global Otsu
    // threshold on top is often redundant — and risks merging text into a
    // busy/colorful packet illustration or inverting unevenly. Left here
    // as an opt-in if real-world testing shows it helps.
    useThreshold: false,
  },
};
