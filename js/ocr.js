// Thin wrapper around Tesseract.js. Reused for two different crops (the
// small SKU block and the larger product title), which need different
// character whitelists, so the whitelist is set fresh before each call
// rather than once at init.
let worker = null;

export async function initOcr() {
  worker = await Tesseract.createWorker('eng');
}

// The SKU block is three short lines: "<SKU>" (letters), "Packed in
// <year>" and "Batch # <n>". The whitelist must include digits and '#'
// even though the SKU itself is letters-only: banning them doesn't make
// those landmark lines disappear from the crop, it forces Tesseract to
// reinterpret their digits AS letters ("Batch # 6616" -> "Baotchb"),
// corrupting the very lines js/sku.js anchors on.
export async function recognizeSkuText(canvas) {
  await worker.setParameters({
    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#',
    // PSM 6 = "assume a single uniform block of text". The crop is a
    // small compact block, where the default automatic page segmentation
    // sometimes drops or fragments lines (a real SKU "CbJj" came back as
    // "i Cb" under auto segmentation).
    tessedit_pageseg_mode: '6',
  });
  const {
    data: { text },
  } = await worker.recognize(canvas);
  return text;
}

// Product titles include spaces/hyphens (e.g. "NIGELLA - DELFT BLUE"), so
// no character restriction here — empty whitelist means "allow anything".
export async function recognizeTitleText(canvas) {
  await worker.setParameters({
    tessedit_char_whitelist: '',
    // Parameters persist on the shared worker, so explicitly restore the
    // default automatic segmentation here — otherwise the SKU call's
    // PSM 6 above would silently apply to titles too.
    tessedit_pageseg_mode: '3',
  });
  const {
    data: { text },
  } = await worker.recognize(canvas);
  return text;
}
