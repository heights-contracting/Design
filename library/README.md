# Heights material library

Shared surfaces and skies used by every project. Browse it visually at
`https://heights-contracting.github.io/Design/library/`.

```
library/
├── index.html      visual catalogue (reads catalog.json)
├── catalog.json    list of every item – generated, do not edit by hand
├── surfaces/<category>/<id>/
│     color.jpg  normal.jpg  roughness.jpg  [ao.jpg displacement.jpg metalness.jpg]
│     preview.jpg  info.json
├── skies/<id>/     <id>_2k.hdr  <id>_1k.hdr  preview.jpg  info.json
├── brand/          Heights logos
└── inbox/          upload new downloads here
```

- Categories: tiles, stone, brick, plaster-concrete, wood, metal, paving, ground, fabric.
- Ids are the original asset ids (e.g. `Tiles138`, `dark_wood`), so the source page is always findable.
- Web files are capped at 2K. Original zips / 4K EXRs live on the **`sources`** branch (not published).
- Everything here is CC0 (ambientCG, Poly Haven) or Heights' own photos.

To add items: see `inbox/README.md`.
