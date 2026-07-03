// Finds the packet by looking for its own outline — the largest roughly
// rectangular contour in the frame — rather than recognising the logo.
// Simpler and calibration-free: no reference photo, no per-packet-template
// measurements, just "find an obvious rectangle".
//
// Takes CONFIG as a parameter (rather than importing it directly) so every
// file ends up sharing the exact same cache-busted copy that main.js
// loaded — see the comment at the top of js/main.js.

// Returns [topLeft, topRight, bottomRight, bottomLeft] in frame pixel space,
// or null if nothing rectangular enough was found.
export function detect(frameMat, CONFIG) {
  // Canny/dilate/findContours all cost roughly linearly in pixel count, but
  // "is there a big rectangle here" doesn't need full sensor resolution —
  // search on a downscaled copy and rescale the result back up, so this
  // function's contract (full-frame-space in, full-frame-space out) is
  // unchanged for every caller.
  const longSide = Math.max(frameMat.rows, frameMat.cols);
  const scale = Math.min(1, CONFIG.detection.detectScaleMaxDim / longSide);
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

  const gray = new cv.Mat();
  cv.cvtColor(workMat, gray, cv.COLOR_RGBA2GRAY);

  // Contrast-limited adaptive histogram equalization: helps a faint true
  // packet edge hold up against weak/uneven contrast (e.g. outdoors),
  // before it has a chance to lose out to the packet's own printed inner
  // border (see the RETR_EXTERNAL comment below).
  if (CONFIG.detection.useClahe) {
    applyClahe(gray, CONFIG.detection.claheClipLimit, CONFIG.detection.claheTileGridSize);
  }

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, CONFIG.detection.cannyLow, CONFIG.detection.cannyHigh);

  // Dilate so broken/anti-aliased edge segments join into closed contours.
  const dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, dilated, kernel);

  // RETR_EXTERNAL only, not RETR_LIST: the packet has a printed decorative
  // border inset slightly from its physical edge, which is itself a
  // rectangle. RETR_LIST would offer that inner border as a candidate
  // alongside the true outer edge — normally harmless since the outer
  // edge is larger and wins, but if the true outer edge doesn't form one
  // clean contour (weak contrast against the background), the reliably
  // strong inner border can end up as the largest valid candidate instead,
  // i.e. locking onto a sub-rectangle of the packet. RETR_EXTERNAL ignores
  // nested contours entirely, so that inner border is never a candidate.
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const frameArea = workMat.rows * workMat.cols;
  let best = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const perimeter = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, CONFIG.detection.approxEpsilon * perimeter, true);

    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      const area = cv.contourArea(approx);
      const areaFraction = area / frameArea;
      if (
        areaFraction > CONFIG.detection.minAreaFraction &&
        areaFraction < CONFIG.detection.maxAreaFraction &&
        area > bestArea
      ) {
        bestArea = area;
        best = orderCorners(matToPoints(approx));
      }
    }

    approx.delete();
    contour.delete();
  }

  gray.delete();
  blurred.delete();
  edges.delete();
  dilated.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  if (workMat !== frameMat) {
    workMat.delete();
    if (best) {
      best = best.map((p) => ({ x: p.x / scale, y: p.y / scale }));
    }
  }

  return best;
}

// OpenCV.js builds have exposed CLAHE under two different names across
// versions (`cv.CLAHE` as a constructor vs. a `cv.createCLAHE` factory) —
// tolerate either rather than assuming one, in-place on `mat`.
function applyClahe(mat, clipLimit, tileGridSize) {
  const tileSize = new cv.Size(tileGridSize, tileGridSize);
  const clahe =
    typeof cv.CLAHE === 'function' ? new cv.CLAHE(clipLimit, tileSize) : cv.createCLAHE(clipLimit, tileSize);
  clahe.apply(mat, mat);
  clahe.delete();
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
