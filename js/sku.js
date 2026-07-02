// Pulls the SKU code (e.g. "XNiDB") out of the raw OCR text from the SKU
// crop region. Real Vital Seeds SKUs are short, letters-only, mixed-case
// codes and are always the first line of text in that crop.
const SKU_PATTERN = /^[A-Za-z]{3,8}$/;

export function extractSku(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lettersOnly = line.replace(/[^A-Za-z]/g, '');
    if (SKU_PATTERN.test(lettersOnly)) {
      return lettersOnly;
    }
  }
  return null;
}
