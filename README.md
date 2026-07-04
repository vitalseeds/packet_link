# Vital seeds packet link

Use the camera to recognise a vital seeds packet, extract the SKU and provide a link to that product and grow guide etc on the website.

Inspired by sandy who wanted to remind herself about the crops while dispatching orders, but hopefully of at least casual interest to others, such as a minority of regular customers.

In the future could also authenticate and provide additional information from the crop plan or stop database etc for team members.

## How it works

A single, dependency-free (no build step) page that runs entirely in the
browser on a phone:

```
camera frame -> find packet outline (contours) -> straighten (perspective transform) -> crop bottom-left -> OCR -> SKU
```

Rather than recognising the packet by its logo (which needs a calibrated
reference photo per template), this looks for the packet's own edges —
"an obvious rectangle" against its background:

1. **Find the outline** — [OpenCV.js](https://docs.opencv.org/4.x/opencv.js)
   runs Canny edge detection, morphological closing, and `cv.findContours`
   on the frame. Each contour is reduced to a 4-corner quad and scored on
   rectangularity, aspect ratio (matched against the packet's closed 1.39
   and opened 1.74 ratios), and size; the highest-scoring candidate is
   taken to be the packet.
2. **Crop and straighten** — the 4 corners go straight into
   `cv.getPerspectiveTransform` + `cv.warpPerspective` to undo
   rotation/perspective into an upright rectangle, sized from the corners'
   own edge lengths (no fixed template size needed).
3. **OCR** — the SKU always ends up in the same place on the straightened
   image (bottom-left, per the fixed Vital Seeds packet layout), so only
   that small region is cropped and passed to
   [Tesseract.js](https://github.com/naptha/tesseract.js), keeping OCR fast
   and accurate.

No reference photo or per-packet calibration is needed — it works the same
way for any packet, as long as it's on a plain, contrasting background.

Currently the app stops at displaying the recognised SKU — linking it to
the matching product/grow-guide page on vitalseeds.co.uk is a deliberately
separate follow-up step.

An earlier logo-matching (ORB feature matching + homography) approach is
preserved on the `logo-packet-sku` branch.

## Running it

Camera access requires a secure context, so open it via a local server
rather than `file://`, e.g.:

```sh
npx serve .
# or: python3 -m http.server
```

Then visit the printed URL on a phone (or `localhost` in a desktop browser
with a webcam).

## Testing detection changes

Detection is tuned empirically, so there are two tools for it:

- **Offline harness** — `test/harness.html`. Serve the repo
  (`npx serve .`) and open `/test/harness.html`. It runs the real
  `detect()` over a built-in synthetic frame plus every photo listed in
  `test/manifest.js` (files live in `test/samples/`), drawing the detected
  quad and each candidate's score, with a `positives detected X/Y · false
  detections Z` summary. Run it on `main` and on a branch to compare
  detection rates before merging.
- **Pure-logic checks** — `node test/logic-checks.mjs` runs fast
  assertions over the OpenCV-free scoring/ordering functions.
- **Live debug overlay** — open the app with `?debug=1` to see every
  detection candidate (winner green, rejected dim) with its score or reject
  reason drawn over the camera feed.

## Versioning

The deployed page shows a version number in the footer so you can confirm
you're looking at the latest deploy. On every merge to `main`:

1. Bump `VERSION` in `js/config.js`.
2. Tag that merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The footer version and the git tag should always match the latest commit
on `main`.

Separately, `index.html`'s script tag carries a `__BUILD__` placeholder
that the deploy workflow (`.github/workflows/pages.yml`) stamps with the
current Unix timestamp — this is what actually busts the browser's cache
for the JS module graph on every deploy. It's independent of `VERSION`
and needs no manual upkeep.

## Known limitations

- Needs a plain, contrasting background (e.g. a dark surface behind a
  light packet) — a busy or same-colour background can confuse contour
  detection, or make it lock onto the wrong rectangle.
- Assumes the packet is held right-side up relative to the camera (not
  upside down); the corner-ordering logic doesn't otherwise know which
  way is "up".
- Detection is tuned for a limited range of rotation/scale/distance; very
  extreme angles won't produce a clean 4-sided contour.
