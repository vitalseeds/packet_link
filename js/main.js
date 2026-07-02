// Wires the pipeline together:
//   camera frame -> find packet outline -> straighten -> crop SKU -> OCR -> SKU
import { CONFIG, VERSION } from './config.js';
import * as rectDetector from './rectDetector.js';
import * as geometry from './packetGeometry.js';
import { initOcr, recognizeText } from './ocr.js';
import { extractSku } from './sku.js';

document.getElementById('version').textContent = VERSION;

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const workCanvas = document.createElement('canvas'); // off-screen scratch space
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const rescanBtn = document.getElementById('rescanBtn');
const resultPanel = document.getElementById('result');
const resultThumb = document.getElementById('resultThumb');
const resultSku = document.getElementById('resultSku');
const resultRaw = document.getElementById('resultRaw');

let scanTimer = null;
let busy = false;
let stableCount = 0;
let lastCorners = null;
// Exponential-moving-average corner positions, carried across frames so the
// overlay/warp use a steadied estimate instead of each frame's raw jitter.
let smoothedCorners = null;

startBtn.addEventListener('click', start);
rescanBtn.addEventListener('click', resume);

async function start() {
  startBtn.disabled = true;

  setStatus('Loading OCR engine…');
  await initOcr();

  setStatus('Requesting camera…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    setStatus(`Camera access failed: ${err.message}`);
    startBtn.disabled = false;
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  overlay.width = w;
  overlay.height = h;
  workCanvas.width = w;
  workCanvas.height = h;

  setStatus('Point the camera at a Vital Seeds packet, on a plain background…');
  scanTimer = setInterval(scanFrame, CONFIG.detection.scanIntervalMs);
}

function resume() {
  resultPanel.hidden = true;
  stableCount = 0;
  lastCorners = null;
  smoothedCorners = null;
  setStatus('Point the camera at a Vital Seeds packet, on a plain background…');
  scanTimer = setInterval(scanFrame, CONFIG.detection.scanIntervalMs);
}

function pauseScan() {
  clearInterval(scanTimer);
  scanTimer = null;
}

function scanFrame() {
  if (busy) return;
  busy = true;

  // Everything below runs every ~350ms while scanning, so any thrown error
  // must not leave `busy` stuck true — that would silently freeze the loop
  // (interval keeps firing, but every call bails out on the guard above)
  // with no visible sign anything went wrong.
  try {
    const ctx = workCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, workCanvas.width, workCanvas.height);

    const frameMat = cv.imread(workCanvas);
    const rawCorners = rectDetector.detect(frameMat);
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    if (!rawCorners) {
      stableCount = 0;
      lastCorners = null;
      smoothedCorners = null;
      frameMat.delete();
      setStatus('Looking for a rectangular packet outline…');
      return;
    }

    const corners = smoothCorners(rawCorners);
    drawOverlayQuad(corners);

    stableCount = cornersAreStable(corners, lastCorners) ? stableCount + 1 : 1;
    lastCorners = corners;

    if (stableCount < CONFIG.detection.stableFramesRequired) {
      frameMat.delete();
      setStatus(
        `Packet outline found — hold steady… (${stableCount}/${CONFIG.detection.stableFramesRequired})`
      );
      return;
    }

    const straightCanvas = geometry.warpPacketToCanvas(frameMat, corners);
    frameMat.delete();

    pauseScan();
    handleStableDetection(straightCanvas);
  } catch (err) {
    console.error(err);
    setStatus(`Scan error: ${err.message}`);
  } finally {
    busy = false;
  }
}

// Blends this frame's raw corners with the running smoothed estimate, so a
// single noisy frame doesn't yank the overlay/warp around — the display
// eases toward each new reading rather than snapping to it.
function smoothCorners(rawCorners) {
  if (!smoothedCorners) {
    smoothedCorners = rawCorners;
    return smoothedCorners;
  }
  const alpha = CONFIG.detection.cornerSmoothing;
  smoothedCorners = rawCorners.map((p, i) => ({
    x: smoothedCorners[i].x + alpha * (p.x - smoothedCorners[i].x),
    y: smoothedCorners[i].y + alpha * (p.y - smoothedCorners[i].y),
  }));
  return smoothedCorners;
}

function cornersAreStable(current, previous) {
  if (!previous) return false;
  const maxDrift = CONFIG.detection.stableDriftPx;
  return current.every(
    (p, i) => Math.hypot(p.x - previous[i].x, p.y - previous[i].y) < maxDrift
  );
}

async function handleStableDetection(straightCanvas) {
  setStatus('Packet locked — reading label…');

  const ocrCanvas = geometry.cropOcrRegion(straightCanvas);
  const text = await recognizeText(ocrCanvas);
  const sku = extractSku(text);

  resultThumb.src = ocrCanvas.toDataURL();
  resultRaw.textContent = text.trim() || '(no text read)';

  if (!sku) {
    setStatus('Could not read a clear SKU. Try again with better light/focus.');
    resultSku.textContent = '—';
  } else {
    setStatus('Done.');
    resultSku.textContent = sku;
  }

  resultPanel.hidden = false;
}

function drawOverlayQuad(corners) {
  overlayCtx.strokeStyle = '#2ecc71';
  overlayCtx.lineWidth = 4;
  overlayCtx.beginPath();
  overlayCtx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    overlayCtx.lineTo(corners[i].x, corners[i].y);
  }
  overlayCtx.closePath();
  overlayCtx.stroke();
}

function setStatus(message) {
  statusEl.textContent = message;
}
