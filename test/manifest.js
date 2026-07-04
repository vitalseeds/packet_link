// Sample frames for the detection harness. Drop image files into test/samples/
// and list them here. `expect` is 'packet' (should detect) or 'none' (should
// reject). Capture ~10-20 frames spanning BOTH states — closed (92x128) and
// opened (92x160) — on varied backgrounds, with and without the phone's own
// shadow across the packet, plus a couple of 'none' distractors (a book or
// tablet, an empty surface) whose aspect sits near the packet ratios.
//
// Optional `expectSku` / `expectTitle` fields (on 'packet' samples) turn on
// end-to-end checking: the harness runs the FULL pipeline (detect -> warp ->
// crop -> OCR -> extractSku/extractTitle) and reports SKU/title accuracy, not
// just whether the packet was found. `expectSku` is the letters-only code
// (e.g. 'CbJj'); `expectTitle` is the product title as printed (e.g.
// 'NIGELLA - DELFT BLUE'). Leave them off to check detection only.
export const SAMPLES = [
  // { file: 'closed-plain-01.jpg', expect: 'packet', note: 'dark surface',
  //   expectSku: 'CbJj', expectTitle: 'NIGELLA - DELFT BLUE' },
  // { file: 'opened-shadow-01.jpg', expect: 'packet', note: 'phone shadow across top' },
  // { file: 'book-distractor-01.jpg', expect: 'none', note: 'paperback, no packet' },
];
