# Vital seeds packet link

Use the camera to recognise a vital seeds packet, extract the SKU and provide a link to that product and grow guide etc on the website.

Inspired by sandy who wanted to remind herself about the crops while dispatching orders, but hopefully of at least casual interest to others, such as a minority of regular customers.

In the future could also authenticate and provide additional information from the crop plan or stop database etc for team members.

## How it works

A single, dependency-free (no build step) page that runs entirely in the
browser on a phone:

```
camera frame -> find logo (ORB) -> straighten packet (homography) -> crop bottom-left -> OCR -> SKU
```

Every Vital Seeds packet shares the same template, so the pipeline only
needs to recognise the logo (a small, distinctive image) rather than the
whole packet:

1. **Find the logo** — [OpenCV.js](https://docs.opencv.org/4.x/opencv.js)
   ORB feature matching locates the logo in the camera frame and, via
   `cv.findHomography`, computes the transform from the reference photo's
   coordinate space to the live frame.
2. **Infer the packet** — since the logo's position on the packet template
   is fixed, that same homography also tells us where the packet's four
   corners are in the live frame.
3. **Crop and straighten** — `cv.getPerspectiveTransform` +
   `cv.warpPerspective` turn the (possibly rotated/skewed) packet outline
   into an upright rectangle.
4. **OCR** — the SKU always ends up in the same place on the straightened
   image (bottom-left), so only that small region is cropped and passed to
   [Tesseract.js](https://github.com/naptha/tesseract.js), keeping OCR fast
   and accurate.

Currently the app stops at displaying the recognised SKU — linking it to
the matching product/grow-guide page on vitalseeds.co.uk is a deliberately
separate follow-up step.

## Running it

Camera access requires a secure context, so open it via a local server
rather than `file://`, e.g.:

```sh
npx serve .
# or: python3 -m http.server
```

Then visit the printed URL on a phone (or `localhost` in a desktop browser
with a webcam).

### One-time setup: reference photo

Before the logo detector works, add a reference photo of a packet — see
[`assets/README.md`](assets/README.md) for what's needed and how to
calibrate the logo's position on it.

## Versioning

The deployed page shows a version number in the footer so you can confirm
you're looking at the latest deploy. On every merge to `main`:

1. Bump `VERSION` in `js/config.js`.
2. Tag that merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The footer version and the git tag should always match the latest commit
on `main`.

## Known limitations

- If the logo is covered (thumb, another packet, etc.) detection fails
  outright — there's no fallback packet-outline detector yet.
- Detection is tuned for a limited range of rotation/scale/distance; very
  extreme angles or very small/blurry logos won't match.
