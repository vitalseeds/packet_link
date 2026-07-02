// Tunable numbers for the whole pipeline live here so the rest of the code
// doesn't have magic numbers scattered through it.
//
// The CALIBRATION block describes where the Vital Seeds logo sits on the
// packet template, measured as percentages of the reference photo
// (assets/reference-packet.jpg). Every Vital Seeds packet shares the same
// layout, so one reference photo + these percentages is enough to locate
// the logo — and from the logo, the whole packet — on any packet.
//
// Use assets/calibrate.html against your own reference photo to (re)measure
// these values if you replace the reference image.

// Bumped on every merge to main and tagged on that commit (e.g. `v0.1.0`),
// so the footer on the deployed page tells you which build you're on.
export const VERSION = '0.1.0';

export const CONFIG = {
  paths: {
    referencePacketImage: 'assets/reference-packet.jpg',
  },

  // Logo position/size as a fraction of the reference packet photo's
  // width/height. xPercent/yPercent is the centre of the logo circle.
  // Measured from assets/reference-packet.jpg (714 x 1158) via
  // assets/calibrate.html.
  logo: {
    xPercent: 0.5098,
    yPercent: 0.2231,
    diameterPercent: 0.4724,
  },

  // Where the SKU sits on a straightened packet (top-left origin box, as a
  // fraction of the straightened packet's width/height).
  ocrCrop: { xPercent: 0, yPercent: 0.75, wPercent: 0.25, hPercent: 0.25 },

  // Size (px) to render the straightened packet at. Taller/wider gives the
  // OCR step more pixels to work with, at the cost of a bit more CPU.
  output: { width: 700, aspect: 1.5 }, // height = width * aspect

  detection: {
    orbFeatures: 500,
    // Lowe's ratio test threshold for filtering ambiguous matches.
    loweRatio: 0.75,
    // Minimum "good" keypoint matches before we trust a homography.
    minGoodMatches: 12,
    ransacReprojThreshold: 5,
    // Require this many consecutive frames with a near-identical packet
    // outline before running OCR, so we don't OCR a blurry/jittery frame.
    stableFramesRequired: 3,
    // Max pixel drift allowed between frames to still count as "stable".
    stableDriftPx: 15,
    scanIntervalMs: 350,
    // Even holding the camera still, each frame's ORB matches (and hence
    // the fitted homography) jitter slightly — different real-world points
    // get matched each time. Smoothing the corner positions with an
    // exponential moving average (weight given to the newest frame) turns
    // that jitter into a steady overlay instead of a jumping one.
    cornerSmoothing: 0.35,
  },
};
