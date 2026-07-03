// Pulls the SKU code (e.g. "XNiDB") out of the raw OCR text from the SKU
// crop region, which always contains three lines in this fixed order:
// "<SKU>", "Packed in <year>", "Batch # <n>". Real SKUs run from 3 to
// about 7 characters (confirmed against the catalog), not a fixed length.
const SKU_PATTERN = /^[A-Za-z]{3,7}$/;

// Words from the crop's other lines that must never be mistaken for the
// SKU. Matched fuzzily (see nearWordPrefix) rather than literally, because
// OCR routinely mangles them by a letter or two — observed misreads
// include "Pockedin" (Packed in), "Fockedin", and "Baotchb" (Batch #),
// each of which slipped past an exact prefix check at some point.
const FALSE_POSITIVE_WORDS = ['packedin', 'packed', 'pocket', 'picked', 'packet', 'batch'];

export function extractSku(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // The SKU is always the line directly above "Packed in <year>" — anchor
  // on that landmark first. It's far more reliable than scanning every
  // line for something SKU-shaped, since stray text above the real SKU
  // (logo fragments, packet border) can otherwise get picked up instead.
  // Fuzzy-matched so a misread like "Pockedin" still anchors.
  const packedIndex = lines.findIndex((line) =>
    nearWordPrefix(lettersOf(line), 'packedin', 2)
  );
  if (packedIndex > 0) {
    const candidate = lines[packedIndex - 1].replace(/[^A-Za-z]/g, '');
    if (SKU_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  // Fallback for when "Packed" itself wasn't read even approximately:
  // scan for the first line that looks like a plausible SKU and isn't a
  // near-miss of a known word from a neighbouring line.
  for (const line of lines) {
    const lettersOnly = line.replace(/[^A-Za-z]/g, '');
    if (!SKU_PATTERN.test(lettersOnly)) continue;
    if (looksLikeFalsePositive(lettersOnly.toLowerCase())) continue;
    return lettersOnly;
  }
  return null;
}

export function skuSearchUrl(sku) {
  return `https://vitalseeds.co.uk/packet/find/${encodeURIComponent(sku)}`;
}

function lettersOf(line) {
  return line.replace(/[^A-Za-z]/g, '').toLowerCase();
}

function looksLikeFalsePositive(lettersLower) {
  // Distance 1 for the short words, 2 for 8-letter "packedin" — enough to
  // catch one-or-two-letter OCR mangling while staying far from any real
  // 3-7 letter SKU (CbJj, ChPS, LeFL etc. are nowhere near these words).
  return FALSE_POSITIVE_WORDS.some((word) =>
    nearWordPrefix(lettersLower, word, word.length >= 8 ? 2 : 1)
  );
}

// Does `letters` START with something within `maxDist` edits of `word`?
// Compared on a prefix one longer than the word itself, so trailing junk
// ("baotchb" vs "batch") counts against the budget but a long tail (a year
// merged onto "packedin") doesn't drown the match.
function nearWordPrefix(letters, word, maxDist) {
  return editDistance(letters.slice(0, word.length + 1), word) <= maxDist;
}

// Plain Levenshtein distance — inputs here are single short words, so the
// simple O(a*b) table is more than fast enough.
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}
