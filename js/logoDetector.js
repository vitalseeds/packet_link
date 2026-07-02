// Finds the Vital Seeds logo in a camera frame using ORB feature matching
// against a reference photo, and returns the homography that maps the
// reference packet's coordinate space onto the live frame.
import { CONFIG } from './config.js';

let orb = null;
let matcher = null;
let refDescriptors = null;
// Reference keypoints, translated into full-packet pixel coordinates (not
// crop-local ones) so the homography we compute later maps the whole
// packet, not just the logo crop.
let refKeypointsPts = [];
let ready = false;

export function isReady() {
  return ready;
}

// Loads the reference packet photo, crops out the logo, and builds ORB
// keypoints/descriptors for it. Returns the reference photo's pixel
// dimensions so the caller can set up packet geometry.
export async function init() {
  await waitForOpenCv();
  const refImg = await loadImage(CONFIG.paths.referencePacketImage);
  const packetW = refImg.naturalWidth;
  const packetH = refImg.naturalHeight;

  const diameter = packetW * CONFIG.logo.diameterPercent;
  const cx = packetW * CONFIG.logo.xPercent;
  const cy = packetH * CONFIG.logo.yPercent;
  const pad = 1.3; // small margin around the circle so ORB sees the full shape
  const cropSize = diameter * pad;
  const cropX = Math.max(0, cx - cropSize / 2);
  const cropY = Math.max(0, cy - cropSize / 2);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropSize;
  cropCanvas.height = cropSize;
  cropCanvas
    .getContext('2d')
    .drawImage(refImg, cropX, cropY, cropSize, cropSize, 0, 0, cropSize, cropSize);

  const cropMat = cv.imread(cropCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(cropMat, gray, cv.COLOR_RGBA2GRAY);

  orb = new cv.ORB(CONFIG.detection.orbFeatures);
  const keypoints = new cv.KeyPointVector();
  refDescriptors = new cv.Mat();
  const emptyMask = new cv.Mat();
  orb.detectAndCompute(gray, emptyMask, keypoints, refDescriptors);

  refKeypointsPts = [];
  for (let i = 0; i < keypoints.size(); i++) {
    const pt = keypoints.get(i).pt;
    refKeypointsPts.push({ x: pt.x + cropX, y: pt.y + cropY });
  }

  matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);

  gray.delete();
  cropMat.delete();
  keypoints.delete();
  emptyMask.delete();

  ready = true;
  return { packetW, packetH };
}

// Attempts to find the logo in a single-channel (grayscale) frame Mat.
// Returns { homography, numGoodMatches } or null if not enough evidence.
// Caller owns the returned homography Mat and must .delete() it.
export function detect(frameGrayMat) {
  if (!ready) return null;

  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const emptyMask = new cv.Mat();
  orb.detectAndCompute(frameGrayMat, emptyMask, keypoints, descriptors);
  emptyMask.delete();

  if (descriptors.rows === 0) {
    keypoints.delete();
    descriptors.delete();
    return null;
  }

  const knnMatches = new cv.DMatchVectorVector();
  matcher.knnMatch(refDescriptors, descriptors, knnMatches, 2);

  const srcPts = [];
  const dstPts = [];
  for (let i = 0; i < knnMatches.size(); i++) {
    const candidates = knnMatches.get(i);
    if (candidates.size() < 2) continue;
    const best = candidates.get(0);
    const second = candidates.get(1);
    // Lowe's ratio test: only keep matches that are clearly better than the
    // next-best alternative, to filter out ambiguous/noisy matches.
    if (best.distance < CONFIG.detection.loweRatio * second.distance) {
      const refPt = refKeypointsPts[best.queryIdx];
      const framePt = keypoints.get(best.trainIdx).pt;
      srcPts.push(refPt.x, refPt.y);
      dstPts.push(framePt.x, framePt.y);
    }
  }

  keypoints.delete();
  descriptors.delete();
  knnMatches.delete();

  const numGoodMatches = srcPts.length / 2;
  if (numGoodMatches < CONFIG.detection.minGoodMatches) {
    return null;
  }

  const srcMat = cv.matFromArray(numGoodMatches, 1, cv.CV_32FC2, srcPts);
  const dstMat = cv.matFromArray(numGoodMatches, 1, cv.CV_32FC2, dstPts);
  const mask = new cv.Mat();
  const homography = cv.findHomography(
    srcMat,
    dstMat,
    cv.RANSAC,
    CONFIG.detection.ransacReprojThreshold,
    mask
  );
  srcMat.delete();
  dstMat.delete();
  mask.delete();

  if (homography.empty()) {
    homography.delete();
    return null;
  }

  return { homography, numGoodMatches };
}

function waitForOpenCv() {
  if (typeof cv !== 'undefined' && cv.Mat) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (typeof cv !== 'undefined' && cv.Mat) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}
