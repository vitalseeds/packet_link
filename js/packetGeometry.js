// Straightens a detected packet quadrilateral into an upright image, and
// crops out the region that holds the SKU.
//
// Both functions take CONFIG as a parameter (rather than importing it
// directly) so every file ends up sharing the exact same cache-busted copy
// that main.js loaded — see the comment at the top of js/main.js.

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The detected quad is often slightly tight against the packet's true
// physical edge (a rounded corner simplifying inward, or a few pixels of
// weak-contrast edge not quite making it into the contour). Since the
// straightened canvas's bounds come directly from these corners, that lost
// edge is baked in before any crop even runs — and skuCrop (xPercent: 0)
// has no margin left to absorb it, clipping the first SKU letter. Scaling
// each corner outward from the quad's own centroid gives every crop a
// small buffer against that.
export function expandCorners(corners, marginPercent) {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  const factor = 1 + marginPercent;
  return corners.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  }));
}

// Warps the quadrilateral [topLeft, topRight, bottomRight, bottomLeft] in
// frameMat into an upright rectangular canvas, undoing rotation/perspective.
// The output size is derived from the corners' own edge lengths (not a
// fixed template size), so it works for any packet regardless of how large
// or far away it appears in frame.
export function warpPacketToCanvas(frameMat, corners, CONFIG) {
  const [tl, tr, br, bl] = corners;

  const rawW = Math.max(distance(tl, tr), distance(bl, br));
  const rawH = Math.max(distance(tl, bl), distance(tr, br));

  // Cap the render size — plenty of resolution for OCR without wasting CPU
  // warping/OCR-ing a huge crop when the packet fills a high-res frame.
  const scale = Math.min(1, CONFIG.output.maxDim / Math.max(rawW, rawH));
  const outW = Math.max(1, Math.round(rawW * scale));
  const outH = Math.max(1, Math.round(rawH * scale));

  const srcArr = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
  const dstArr = [0, 0, outW, 0, outW, outH, 0, outH];

  const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcArr);
  const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstArr);
  const transform = cv.getPerspectiveTransform(srcMat, dstMat);

  const warped = new cv.Mat();
  cv.warpPerspective(frameMat, warped, transform, new cv.Size(outW, outH));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  cv.imshow(canvas, warped);

  srcMat.delete();
  dstMat.delete();
  transform.delete();
  warped.delete();
  return canvas;
}

// Crops a region of a straightened packet canvas, given as percentages of
// its width/height (e.g. CONFIG.skuCrop or CONFIG.titleCrop). `scale`
// upscales the crop — useful for small text like the SKU, where OCR
// accuracy benefits from more pixels than the crop naturally has.
export function cropRegion(straightCanvas, rect, scale = 1) {
  const { xPercent, yPercent, wPercent, hPercent } = rect;
  const sx = straightCanvas.width * xPercent;
  const sy = straightCanvas.height * yPercent;
  const sw = straightCanvas.width * wPercent;
  const sh = straightCanvas.height * hPercent;

  const out = document.createElement('canvas');
  out.width = sw * scale;
  out.height = sh * scale;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(straightCanvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

// Contrast/binarization preprocessing for a crop just before OCR — separate
// from cropRegion() above since this needs OpenCV.js rather than plain
// canvas 2D drawing. Grayscale + CLAHE is a safe default contrast boost;
// thresholding is opt-in (see ocrConfig.useThreshold's comment in
// js/config.js) since a global Otsu threshold can damage accuracy on a
// busy/colorful packet background.
export function preprocessForOcr(canvas, ocrConfig) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  if (ocrConfig.useClahe) {
    applyClahe(gray, ocrConfig.claheClipLimit, ocrConfig.claheTileGridSize);
  }

  if (ocrConfig.useThreshold) {
    cv.threshold(gray, gray, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  }

  const out = document.createElement('canvas');
  out.width = gray.cols;
  out.height = gray.rows;
  cv.imshow(out, gray);

  src.delete();
  gray.delete();
  return out;
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
