// Wires the pipeline together:
//   camera frame -> find logo -> straighten packet -> crop SKU -> OCR -> SKU
import { CONFIG } from './config.js';
import * as logoDetector from './logoDetector.js';
import * as geometry from './packetGeometry.js';
import { initOcr, recognizeText } from './ocr.js';
import { extractSku } from './sku.js';

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

startBtn.addEventListener('click', start);
rescanBtn.addEventListener('click', resume);

async function start() {
  startBtn.disabled = true;

  setStatus('Loading reference logo…');
  try {
    const { packetW, packetH } = await logoDetector.init();
    geometry.setReferenceSize(packetW, packetH);
  } catch (err) {
    setStatus(
      `Could not load ${CONFIG.paths.referencePacketImage} (${err.message}). See assets/README.md.`
    );
    startBtn.disabled = false;
    return;
  }

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

  setStatus('Point the camera at a Vital Seeds packet…');
  scanTimer = setInterval(scanFrame, CONFIG.detection.scanIntervalMs);
}

function resume() {
  resultPanel.hidden = true;
  stableCount = 0;
  lastCorners = null;
  setStatus('Point the camera at a Vital Seeds packet…');
  scanTimer = setInterval(scanFrame, CONFIG.detection.scanIntervalMs);
}

function pauseScan() {
  clearInterval(scanTimer);
  scanTimer = null;
}

function scanFrame() {
  if (busy) return;
  busy = true;

  const ctx = workCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, workCanvas.width, workCanvas.height);

  const frameMat = cv.imread(workCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(frameMat, gray, cv.COLOR_RGBA2GRAY);

  const match = logoDetector.detect(gray);
  gray.delete();
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!match) {
    stableCount = 0;
    lastCorners = null;
    frameMat.delete();
    busy = false;
    return;
  }

  const corners = geometry.projectPacketCorners(match.homography);
  match.homography.delete();
  drawOverlayQuad(corners);

  stableCount = cornersAreStable(corners, lastCorners) ? stableCount + 1 : 1;
  lastCorners = corners;

  if (stableCount < CONFIG.detection.stableFramesRequired) {
    frameMat.delete();
    busy = false;
    return;
  }

  const straightCanvas = geometry.warpPacketToCanvas(frameMat, corners);
  frameMat.delete();
  busy = false;

  pauseScan();
  handleStableDetection(straightCanvas);
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
