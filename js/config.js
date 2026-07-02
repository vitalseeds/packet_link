// Tunable numbers for the whole pipeline live here so the rest of the code
// doesn't have magic numbers scattered through it.

// Bumped on every merge to main and tagged on that commit (e.g. `v0.1.0`),
// so the footer on the deployed page tells you which build you're on.
export const VERSION = '0.5.0';

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
  // Tuned against real straightened-packet photos, twice now: yPercent
  // 0.34/hPercent 0.08 still caught a sliver of the curved "SEEDS" logo
  // text at the top *and* clipped the bottom of the title's own
  // characters — the whole window needed to move down further, not just
  // shrink. May still need further adjustment for a longer title that
  // wraps to two lines.
  titleCrop: { xPercent: 0.05, yPercent: 0.37, wPercent: 0.9, hPercent: 0.11 },

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
    // picks up more background noise.
    cannyLow: 50,
    cannyHigh: 150,
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
    scanIntervalMs: 350,
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
  },

  // Preprocessing applied to the SKU/title crops before OCR (see
  // packetGeometry.js's preprocessForOcr) — separate from detection's
  // useClahe above since these run on a small, already-cropped image.
  ocr: {
    useClahe: true,
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
