# Reference photo

The logo detector needs one photo, `reference-packet.jpg`, placed in this
folder, to know what the Vital Seeds logo looks like and where it sits on
the packet template.

Requirements for the photo:

- A single Vital Seeds packet, front face only (no folded top flap).
- Shot straight-on (not at an angle), filling the frame, cropped tightly to
  the packet's physical edges.
- Well lit, in focus, minimal glare on the logo.

It doesn't matter which variety the photo is of — every Vital Seeds packet
uses the same logo and layout.

## Calibrating the logo position

`js/config.js` needs to know roughly where the logo sits on the reference
photo (as a percentage of the photo's width/height) and how big it is.
Open `assets/calibrate.html` directly in a browser, load your
`reference-packet.jpg`, click the centre of the logo circle and then its
edge, and copy the printed values into the `logo` block in `js/config.js`.

Re-run this whenever you replace the reference photo.
