// Wires the pipeline together:
//   camera frame -> find packet outline -> straighten -> crop SKU -> OCR -> SKU
//
// This file is loaded as js/main.js?v=<build timestamp> (see index.html —
// the placeholder is stamped by the deploy workflow, not hand-maintained).
// Reusing that same query string on every import below means every deploy
// forces a fresh fetch of the *whole* module graph, not just this file —
// a plain `<script src="js/main.js">` (no cache-bust) would let a browser
// keep serving stale cached copies of these modules indefinitely, even
// after index.html itself reloads.
const cacheBust = new URL(import.meta.url).search;
const { CONFIG, VERSION } = await import(`./config.js${cacheBust}`);
const rectDetector = await import(`./rectDetector.js${cacheBust}`);
const geometry = await import(`./packetGeometry.js${cacheBust}`);
const { initOcr, recognizeSkuText, recognizeTitleText } = await import(`./ocr.js${cacheBust}`);
const { extractSku, skuSearchUrl } = await import(`./sku.js${cacheBust}`);
const { extractTitle } = await import(`./title.js${cacheBust}`);

document.getElementById('version').textContent = VERSION;
// Dev convenience: forces a fresh reload of index.html itself (a browser
// can cache the HTML document too, separately from its scripts). Uses the
// current time rather than the build timestamp above, since re-requesting
// the exact same cache-busted URL the page already loaded from wouldn't
// bust anything — this needs its own, always-different value.
document.getElementById('refreshLink').href = `${location.pathname}?t=${Date.now()}`;

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const workCanvas = document.createElement('canvas'); // off-screen scratch space
const statusEl = document.getElementById('status');
const scanBtn = document.getElementById('scanBtn');
const resultPanel = document.getElementById('result');
const resultLink = document.getElementById('resultLink');
const resultSku = document.getElementById('resultSku');
const resultThumb = document.getElementById('resultThumb');
const resultRaw = document.getElementById('resultRaw');
const resultTitleThumb = document.getElementById('resultTitleThumb');
const resultTitleRaw = document.getElementById('resultTitleRaw');

let scanTimer = null;
let busy = false;
let stableCount = 0;
let lastCorners = null;
// Exponential-moving-average corner positions, carried across frames so the
// overlay/warp use a steadied estimate instead of each frame's raw jitter.
let smoothedCorners = null;

// One button does double duty: "Scan" the first time (which
// requests the camera), then "Scan again" from then on (which just
// re-arms scanning against the camera stream already granted). Whether
// the camera's been started is exactly whether video.srcObject is set,
// so that's used instead of tracking separate state.
scanBtn.addEventListener('click', () => {
  if (video.srcObject) {
    resume();
  } else {
    start();
  }
});

async function start() {
  scanBtn.disabled = true;

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
    scanBtn.disabled = false;
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
  // The green outline from the last lock-on stays drawn until the next
  // scanFrame() tick otherwise — visible on top of the live video and
  // easy to mistake for a frozen feed, since nothing else clears it
  // between pauseScan() and the first frame of the new scan.
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  // Some mobile browsers pause a <video> element's decode while its tab
  // is backgrounded (e.g. switching apps to line up the packet); make
  // sure it's actually playing again rather than assuming it still is.
  video.play().catch(() => {});
  scanBtn.disabled = true;
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
    const rawCorners = rectDetector.detect(frameMat, CONFIG);
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

    const expandedCorners = geometry.expandCorners(corners, CONFIG.output.cornerMarginPercent);
    const straightCanvas = geometry.warpPacketToCanvas(frameMat, expandedCorners, CONFIG);
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

  // skuCrop/titleCrop are defined as percentages of the *true* packet, but
  // the straightened canvas is inflated slightly beyond that (see
  // expandCorners in scanFrame) — remap before cropping so they still
  // land in the right place regardless of cornerMarginPercent.
  const skuRect = geometry.remapCropForMargin(CONFIG.skuCrop, CONFIG.output.cornerMarginPercent);
  const titleRect = geometry.remapCropForMargin(CONFIG.titleCrop, CONFIG.output.cornerMarginPercent);
  const skuCanvas = geometry.cropRegion(straightCanvas, skuRect, CONFIG.skuCropUpscale);
  const titleCanvas = geometry.cropRegion(straightCanvas, titleRect);

  const skuOcrCanvas = geometry.preprocessForOcr(skuCanvas, CONFIG.ocr);
  const titleOcrCanvas = geometry.preprocessForOcr(titleCanvas, CONFIG.ocr);

  const skuText = await recognizeSkuText(skuOcrCanvas);
  const titleText = await recognizeTitleText(titleOcrCanvas);

  const sku = extractSku(skuText);
  const title = extractTitle(titleText);

  // Show what OCR actually saw (post-preprocessing), not the raw crop —
  // makes it obvious in the results panel whether CLAHE/thresholding is
  // helping or hurting on a given packet/lighting condition.
  resultThumb.src = skuOcrCanvas.toDataURL();
  resultRaw.textContent = skuText.trim() || '(no text read)';
  resultTitleThumb.src = titleOcrCanvas.toDataURL();
  resultTitleRaw.textContent = titleText.trim() || '(no text read)';
  resultSku.textContent = sku || '—';

  if (!sku) {
    setStatus('Could not read a clear SKU. Try again with better light/focus.');
    resultLink.hidden = true;
    resultLink.removeAttribute('href');
  } else {
    setStatus('Done.');
    resultLink.hidden = false;
    resultLink.href = skuSearchUrl(sku);
    resultLink.textContent = title ? `${title} (${sku})` : `Search (${sku})`;
  }

  resultPanel.hidden = false;
  scanBtn.textContent = 'Scan again';
  scanBtn.disabled = false;
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
