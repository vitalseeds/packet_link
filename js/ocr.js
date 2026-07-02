// Thin wrapper around Tesseract.js. Reused for two different crops (the
// small SKU block and the larger product title), which need different
// character whitelists, so the whitelist is set fresh before each call
// rather than once at init.
let worker = null;

export async function initOcr() {
  worker = await Tesseract.createWorker('eng');
}

// The SKU block is short, alphabetic codes (e.g. "XNiDB") plus "Packed in
// <year>"/"Batch # <n>" — restricting to letters keeps Tesseract from
// mistaking noise for stray digits/symbols.
export async function recognizeSkuText(canvas) {
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  });
  const {
    data: { text },
  } = await worker.recognize(canvas);
  return text;
}

// Product titles include spaces/hyphens (e.g. "NIGELLA - DELFT BLUE"), so
// no character restriction here — empty whitelist means "allow anything".
export async function recognizeTitleText(canvas) {
  await worker.setParameters({ tessedit_char_whitelist: '' });
  const {
    data: { text },
  } = await worker.recognize(canvas);
  return text;
}
