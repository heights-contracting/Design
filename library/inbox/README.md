# Inbox – upload new downloads here

1. Download from ambientCG (**2K-JPG** zip) or Poly Haven (**2K**, zip or Diffuse + Normal GL + Rough), or HDR skies (**4K .exr/.hdr**).
2. GitHub → this folder → **Add file → Upload files** → drop them in (max 25 MB per file).
3. Tell Claude "new files in the inbox".

Claude then runs `tools/ingest.py`, which adds web-ready versions to `library/surfaces/<category>/<id>/`
or `library/skies/<id>/`, updates the catalogue, and moves your originals to the `sources` branch.

Photos of real samples are welcome too: straight on, even daylight, no flash, sample filling the frame.
