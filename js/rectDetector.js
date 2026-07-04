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

  if (workMat !== frameMat) workMat.delete();

  const rescale = scale < 1 ? (p) => ({ x: p.x / scale, y: p.y / scale }) : (p) => p;
  if (diagnostics) {
    diagnostics.candidates = scored.map((c) => ({ ...c, corners: c.corners.map(rescale) }));
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
