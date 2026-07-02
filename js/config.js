// Tunable numbers for the whole pipeline live here so the rest of the code
// doesn't have magic numbers scattered through it.

// Bumped on every merge to main and tagged on that commit (e.g. `v0.1.0`),
// so the footer on the deployed page tells you which build you're on.
export const VERSION = '0.3.2';

export const CONFIG = {
  // Where the SKU sits on a straightened packet (top-left origin box, as a
  // fraction of the straightened packet's width/height) — fixed by the
  // Vital Seeds packet layout, same for every variety.
  ocrCrop: { xPercent: 0, yPercent: 0.75, wPercent: 0.25, hPercent: 0.25 },

  output: {
    // Cap on the straightened packet's longest side (px). Higher gives OCR
    // more pixels to work with, at the cost of more CPU per frame.
    maxDim: 900,
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
  },
};
