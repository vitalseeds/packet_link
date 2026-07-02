// Pulls the SKU code (e.g. "XNiDB") out of the raw OCR text from the SKU
// crop region. Real Vital Seeds SKUs are short, letters-only, mixed-case
// codes and are always the first line of text in that crop.
const SKU_PATTERN = /^[A-Za-z]{3,8}$/;

// Words that occasionally get OCR'd off a neighbouring line ("Packed in
// 2026", "Batch #") and happen to satisfy SKU_PATTERN on their own —
// never real SKUs, so treat a match on one of these as a sign the crop
// slipped onto the wrong line and keep looking rather than accept it.
const FALSE_POSITIVE_WORDS = new Set(['pocket', 'packed', 'picked', 'packet', 'fockedin']);

export function extractSku(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lettersOnly = line.replace(/[^A-Za-z]/g, '');
    if (!SKU_PATTERN.test(lettersOnly)) continue;
    if (FALSE_POSITIVE_WORDS.has(lettersOnly.toLowerCase())) continue;
    return lettersOnly;
  }
  return null;
}

export function skuSearchUrl(sku) {
  return `https://vitalseeds.co.uk/search?s=${encodeURIComponent(sku)}`;
}
