// Turns a logo homography into a straightened, upright image of the whole
// packet, using the fact that every Vital Seeds packet shares the same
// template (so the packet's corners, relative to the logo, are fixed).
import { CONFIG } from './config.js';

let packetW = 0;
let packetH = 0;

// Must be called once with the reference packet photo's pixel dimensions
// (see logoDetector.init()) before projectPacketCorners()/warp are used.
export function setReferenceSize(width, height) {
  packetW = width;
  packetH = height;
}

// Projects the reference packet's 4 corners through the homography to find
// where the packet lands in the live camera frame.
// Returns [topLeft, topRight, bottomRight, bottomLeft] in frame pixel space.
export function projectPacketCorners(homography) {
  const refCorners = [0, 0, packetW, 0, packetW, packetH, 0, packetH];
  const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, refCorners);
  const dstMat = new cv.Mat();
  cv.perspectiveTransform(srcMat, dstMat, homography);

  const corners = [];
  for (let i = 0; i < 4; i++) {
    corners.push({ x: dstMat.data32F[i * 2], y: dstMat.data32F[i * 2 + 1] });
  }

  srcMat.delete();
  dstMat.delete();
  return corners;
}

// Warps the quadrilateral in frameMat described by frameCorners into an
// upright rectangular canvas, undoing rotation/perspective.
export function warpPacketToCanvas(frameMat, frameCorners) {
  const outW = CONFIG.output.width;
  const outH = Math.round(outW * CONFIG.output.aspect);

  const srcArr = [];
  frameCorners.forEach((p) => srcArr.push(p.x, p.y));
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

// Crops the region of a straightened packet canvas that holds the SKU text.
export function cropOcrRegion(straightCanvas) {
  const { xPercent, yPercent, wPercent, hPercent } = CONFIG.ocrCrop;
  const sx = straightCanvas.width * xPercent;
  const sy = straightCanvas.height * yPercent;
  const sw = straightCanvas.width * wPercent;
  const sh = straightCanvas.height * hPercent;

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d').drawImage(straightCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}
