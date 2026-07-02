// Thin wrapper around Tesseract.js, scoped to reading the small SKU crop.
let worker = null;

export async function initOcr() {
  worker = await Tesseract.createWorker('eng');
  // SKUs are short alphabetic codes (e.g. "XNiDB") — restricting the
  // character set keeps Tesseract from mistaking noise for digits/symbols.
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  });
}

// canvasOrImage: any source Tesseract.js accepts (HTMLCanvasElement here).
// Returns the raw recognised text.
export async function recognizeText(canvasOrImage) {
  const {
    data: { text },
  } = await worker.recognize(canvasOrImage);
  return text;
}
