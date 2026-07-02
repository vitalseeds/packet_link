// Tunable numbers for the whole pipeline live here so the rest of the code
// doesn't have magic numbers scattered through it.

// Bumped on every merge to main and tagged on that commit (e.g. `v0.1.0`),
// so the footer on the deployed page tells you which build you're on.
export const VERSION = '0.4.0';

export const CONFIG = {
  // Where the SKU sits on a straightened packet (top-left origin box, as a
  // fraction of the straightened packet's width/height) — fixed by the
  // Vital Seeds packet layout, same for every variety. This box actually
  // contains three lines ("<SKU>", "Packed in <year>", "Batch # <n>"), not
  // just the SKU — see js/sku.js for why that matters.
  skuCrop: { xPercent: 0, yPercent: 0.75, wPercent: 0.25, hPercent: 0.25 },
  // The SKU text is small relative to the packet, which hurts OCR
  // accuracy — this upscales just that crop before recognising it.
  skuCropUpscale: 3,

  // Where the product title (e.g. "NIGELLA - DELFT BLUE") sits — the
  // largest text on the packet, the first horizontal line below the logo,
  // roughly a third of the way down. Rough estimate: measure against a
  // real straightened packet and adjust if it's clipping the title.
  titleCrop: { xPercent: 0.05, yPercent: 0.3, wPercent: 0.9, hPercent: 0.12 },

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
    // gives every existing crop a small buffer against that, without
    // needing to recalibrate skuCrop/titleCrop's hand-tuned percentages.
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
    // grayscale frame before blur/Canny — helps edge detection hold up in
    // weak/uneven contrast (e.g. outdoor light), where a faint true outer
    // edge previously lost out to the packet's own printed inner border
    // (see rectDetector.js's RETR_EXTERNAL comment).
    useClahe: true,
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
