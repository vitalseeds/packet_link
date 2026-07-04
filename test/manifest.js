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
// Sample files are named <SKU>_<description>.jpg (or <SKU>.jpg); expectSku
// comes from the filename and expectTitle is the title as printed on the
// packet. A blank expectTitle skips the title check but still runs the SKU
// check. The two *_notpacket files are 'none' distractors.
export const SAMPLES = [
  { file: 'CeTU.jpg', expect: 'packet', note: 'CeTU', expectSku: 'CeTU', expectTitle: 'CELERY - TALL UTAH' },
  { file: 'ChRs.jpg', expect: 'packet', note: 'ChRs', expectSku: 'ChRs', expectTitle: 'CHICORY - RADICCHIO ROSA \'JOLANDA\'' },
  { file: 'ChRs_blur.jpg', expect: 'packet', note: 'ChRs (blurred)', expectSku: 'ChRs', expectTitle: 'CHICORY - RADICCHIO ROSA \'JOLANDA\'' },
  { file: 'KRDe.jpg', expect: 'packet', note: 'KRDe', expectSku: 'KRDe', expectTitle: 'KOHLRABI - PURPLE DELICACY' },
  { file: 'LeFB.jpg', expect: 'packet', note: 'LeFB', expectSku: 'LeFB', expectTitle: 'LETTUCE - FLASHY BUTTER OAK' },
  { file: 'MSWR.jpg', expect: 'packet', note: 'MSWR', expectSku: 'MSWR', expectTitle: 'WILD ROCKET' },
  { file: 'OnSg.jpg', expect: 'packet', note: 'OnSg', expectSku: 'OnSg', expectTitle: 'ONION - STUTTGART (10G)' },
  { file: 'PHHW.jpg', expect: 'packet', note: 'PHHW', expectSku: 'PHHW', expectTitle: 'CHILLI - HUNGARIAN HOT WAX' },
  { file: 'XLuP_sideways.jpg', expect: 'packet', note: 'XLuP (sideways)', expectSku: 'XLuP', expectTitle: 'LUPIN - "THE PAGES"' },
  { file: 'XPCaTS_blur.jpg', expect: 'packet', note: 'XPCaTS (blurred)', expectSku: 'XPCaTS', expectTitle: 'CALIFORNIA POPPY - THAI SILK APPLEBLOSSOM CHIFFON' },
  { file: 'XScBK.jpg', expect: 'packet', note: 'XScBK', expectSku: 'XScBK', expectTitle: 'SCABIOUS - BLACK KNIGHT' },
  { file: 'XSPJi.jpg', expect: 'packet', note: 'XSPJi', expectSku: 'XSPJi', expectTitle: 'SWEET PEA - JILLY' },
  { file: 'ZAsg_thumb.jpg', expect: 'packet', note: 'ZAsg (thumb in frame)', expectSku: 'ZAsg', expectTitle: 'ASHWAGANDHA' },
  { file: 'ZCo.jpg', expect: 'packet', note: 'ZCo', expectSku: 'ZCo', expectTitle: 'CORIANDER - FILTRO (25G)' },
  { file: 'ZMot_hand.jpg', expect: 'packet', note: 'ZMot (held in hand)', expectSku: 'ZMot', expectTitle: 'MOTHERWORT' },
  { file: 'flyer_notpacket.jpg', expect: 'none', note: 'flyer, not a packet' },
  { file: 'tablet_notpacket.jpg', expect: 'none', note: 'tablet, not a packet' },
];
