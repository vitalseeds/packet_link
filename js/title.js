// Pulls the product title (e.g. "NIGELLA - DELFT BLUE") out of the raw
// OCR text from the title crop region. Unlike the SKU, there's no fixed
// pattern to validate against — it's free text — so this just cleans up
// whatever Tesseract read rather than trying to verify it.
export function extractTitle(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  // The crop is one line tall in principle, but Tesseract occasionally
  // splits it across multiple detected lines — join them back together.
  return lines.join(' ').replace(/\s+/g, ' ').trim() || null;
}
