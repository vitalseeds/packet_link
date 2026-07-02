// Pulls the product title (e.g. "NIGELLA - DELFT BLUE") out of the raw
// OCR text from the title crop region. Unlike the SKU, there's no fixed
// pattern to validate against — it's free text — so this cleans up
// whatever Tesseract read rather than trying to verify it.
export function extractTitle(rawText) {
  const lines = rawText
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);
  if (lines.length === 0) return null;

  // The crop is tall enough for a two-line title, which means on a
  // single-line title it can instead catch the latin-name line below
  // (e.g. "Cichorium intybus") — smaller, italic, and mixed-case, where
  // real titles are printed in all caps. Keep only the caps-looking
  // lines; if OCR mangled the case badly enough that nothing qualifies,
  // fall back to everything rather than returning nothing.
  const titleLines = lines.filter(isMostlyUppercase);
  const kept = titleLines.length > 0 ? titleLines : lines;

  return kept.join(' ').replace(/\s+/g, ' ').trim() || null;
}

// Strips characters that don't appear in real titles (stray "|" and
// similar artifacts OCR invents at the crop's edges), keeping the
// punctuation that does (hyphens, apostrophes, ampersands, commas).
function cleanLine(line) {
  return line
    .replace(/[^A-Za-z0-9\s\-'&,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMostlyUppercase(line) {
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  const uppers = letters.replace(/[^A-Z]/g, '');
  return uppers.length / letters.length >= 0.6;
}
