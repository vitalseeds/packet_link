// Pulls the SKU code (e.g. "XNiDB") out of the raw OCR text from the SKU
// crop region, which always contains three lines in this fixed order:
// "<SKU>", "Packed in <year>", "Batch # <n>".
const SKU_PATTERN = /^[A-Za-z]{3,8}$/;

// Words that occasionally get OCR'd off a neighbouring line and happen to
// satisfy SKU_PATTERN on their own — never real SKUs.
const FALSE_POSITIVE_WORDS = new Set(['pocket', 'packed', 'picked', 'packet', 'fockedin']);

export function extractSku(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // The SKU is always the line directly above "Packed in <year>" — anchor
  // on that landmark first. It's far more reliable than scanning every
  // line for something SKU-shaped, since stray text above the real SKU
  // (logo fragments, packet border) can otherwise get picked up instead.
  const packedIndex = lines.findIndex((line) => /^packed\b/i.test(line));
  if (packedIndex > 0) {
    const candidate = lines[packedIndex - 1].replace(/[^A-Za-z]/g, '');
    if (candidate.length >= 2 && candidate.length <= 10) {
      return candidate;
    }
  }

  // Fallback for when "Packed" itself wasn't read correctly: scan for the
  // first line that looks like a plausible SKU and isn't a known
  // false-positive word from a neighbouring line.
  for (const line of lines) {
    const lettersOnly = line.replace(/[^A-Za-z]/g, '');
    if (!SKU_PATTERN.test(lettersOnly)) continue;
    if (FALSE_POSITIVE_WORDS.has(lettersOnly.toLowerCase())) continue;
    return lettersOnly;
  }
  return null;
}

export function skuSearchUrl(sku) {
  return `https://vitalseeds.co.uk/search/${encodeURIComponent(sku)}`;
}
