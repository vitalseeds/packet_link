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
  const gray = new cv.Mat();
  cv.cvtColor(frameMat, gray, cv.COLOR_RGBA2GRAY);

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

  const frameArea = frameMat.rows * frameMat.cols;
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

  return best;
}

function matToPoints(mat) {
  const pts = [];
  for (let i = 0; i < mat.rows; i++) {
    pts.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  }
  return pts;
}

// Standard "order points" trick: the top-left corner has the smallest
// x+y, the bottom-right the largest; the top-right has the smallest
// y-x, the bottom-left the largest. Assumes the packet is held roughly
// upright (not upside down) relative to the camera.
function orderCorners(pts) {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]]; // TL, TR, BR, BL
}
