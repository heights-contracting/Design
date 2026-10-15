# Design repo – architecture

One GitHub repo (`heights-contracting/Design`) holds every customer-facing visual project for
Heights Contracting plus the shared material library they all draw from.

## Hosting

| | |
|---|---|
| Published | GitHub Pages, branch `main`, folder `/ (root)` |
| Site root | `https://heights-contracting.github.io/Design/` |
| Project URL | `https://heights-contracting.github.io/Design/<project-slug>/` |
| Library | `https://heights-contracting.github.io/Design/library/` |

Branches:
- **`main`**: everything that is published. Web-ready files only.
- **`sources`**: original downloads (ambientCG zips, Poly Haven zips, 4K EXR skies). Never published, kept for re-processing.
- **`wip/<slug>`** (optional): larger work in progress before it is merged into `main`.

## Layout

```
Design/
├── index.html               login + project home (cards come from the login backend)
├── config.js                URL of the login backend
├── admin/apps-script/       login backend (Google Apps Script) + SETUP.md
├── README.md                short overview
├── ARCHITECTURE.md          this file
├── CLAUDE.md                instructions for Claude sessions working in this repo
├── .nojekyll                serve files as-is (no Jekyll processing)
├── tools/
│   └── ingest.py            turns downloads into library items + catalog.json
├── library/                 shared, reused by every project
│   ├── index.html           visual catalogue
│   ├── catalog.json         generated list of all items
│   ├── labels.json          friendly names shown in dropdowns (id → name)
│   ├── surfaces/<category>/<id>/   color.jpg normal.jpg roughness.jpg [ao displacement metalness] + *_1k.jpg copies, preview.jpg, info.json
│   ├── skies/<id>/          <id>_2k.hdr <id>_1k.hdr preview.jpg info.json
│   ├── brand/               logos
│   └── inbox/               where new downloads are uploaded
└── <project-slug>/          one folder per project, e.g. outdoor-kitchen-island/
    ├── index.html
    ├── project.json         title, description, thumbnail, status
    ├── materials.json       which library items the project uses (slot → library id)
    ├── assets/              project-only files (vendor libs, logo copy, renders, models)
    └── beta/                (optional) next version under test; replaces the parent when approved
```

## Access

- The home page (`/Design/`) asks for a username and password. The check runs in a Google Apps Script web app
  (`admin/apps-script/Code.gs`) that stores the credentials as a salted hash in Script Properties, issues 12-hour signed
  tokens, locks a user for 10 minutes after 5 failed attempts, and stores the list of project cards.
- Project URLs (`/Design/<slug>/`) open directly with no login, so customers can be sent a direct link.
- The repo itself is public. Full privacy would need a private repo (paid GitHub plan) or Cloudflare Pages.
- New project → add its card with **Manage projects** on the home page (or ask Claude).

## Material library rules

- **Ids** are the original asset ids (`Tiles138`, `dark_wood`, `kiara_1_dawn`), so the source page is always findable.
- **Categories**: tiles, stone, brick, plaster-concrete, wood, metal, paving, ground, fabric (+ sky).
- **Map names are fixed**: `color.jpg` (sRGB), `normal.jpg` (OpenGL convention), `roughness.jpg`, `ao.jpg`, `displacement.jpg`, `metalness.jpg` (all linear data, grayscale).
- **Web size cap 2K**, plus `_1k` copies of colour/normal/roughness/metalness for fast live views. Originals go to the `sources` branch.
- `info.json` also records `grain` (`h`/`v`, the direction of wood grain or lines) so viewers can orient timber correctly.
- After adding names to `labels.json`, run `python3 tools/ingest.py --refresh`.
- **Formats**: colour photos JPG q90, normal JPG q92 (converted from EXR/PNG when needed), skies Radiance `.hdr` in 2K and 1K.
- **Licences**: only CC0 (ambientCG, Poly Haven) or Heights' own photos. `info.json` records source, URL and licence.
- `catalog.json` is generated. Never edit it by hand; rerun `tools/ingest.py`.

### Adding library items
1. Upload downloads into `library/inbox/` (GitHub web upload, ≤ 25 MB per file).
2. Run `python3 tools/ingest.py library/inbox` (needs `pillow numpy OpenEXR`).
3. Commit the new `library/surfaces/...`/`library/skies/...` folders and `catalog.json` to `main`.
4. Move the originals out of `inbox/` into the `sources` branch (same file names) and remove them from `main`.

## Project rules

Every project folder must be self-contained, apart from what it reads from `../library/`.

1. **Slug**: kebab-case, describes the space (`outdoor-kitchen-island`, `dressing-room-villa-x`).
2. **No CDNs**: vendor libraries live in `<slug>/assets/vendor/` with exact versions.
3. **Textures and skies come from the library** via relative URLs (`../library/surfaces/stone/Granite004B/color.jpg`)
   and are listed in `materials.json`:
   ```json
   { "slots": {
       "island-top": { "id": "Granite004B", "repeat": [1.2, 1.2], "tint": "#ffffff", "roughness": 0.8 },
       "floor":      { "id": "Travertine001", "repeat": [0.5, 0.5] }
     },
     "skies": { "dusk": "kiara_1_dawn", "day": "rooitou_park" } }
   ```
   Pages are served over http(s), so textures are loaded at runtime. Do not inline them as base64.
4. **`project.json`**: `{ "title", "description", "thumbnail", "status": "live|beta|draft", "updated" }`.
   Add the project's card through **Manage projects** on the home page.
5. **Renderer standard** (3D customer viewers):
   - dark theme
   - Heights logo on every PNG; the caption is optional
   - the PDF holds the image, dimensions, materials and General notes
   - preset views + auto play + free orbit
   - on phones, the panel order is Materials → Scene → Snapshot → Dimensions → Notes
   - the photo-real export renders on demand with a progress bar
   - dimensions are labelled as estimates until confirmed on site
6. **Budgets**: first load ≤ 15 MB on desktop, ≤ 8 MB on phones. No single file over 25 MB. The whole published site stays under 1 GB (GitHub Pages limit).
7. **New versions** of a live project go to `<slug>/beta/` first. Once approved they replace the parent folder and `beta/` is deleted.
8. **Testing before push**: desktop and phone-size (390×844) screenshots, PNG and PDF export, and no console errors.
   Test locally with `python3 -m http.server` from the repo root, then open `http://localhost:8000/<slug>/`.

## Commits

- One logical change per commit, with a message that says what changed for the user.
- Never commit original zips/EXRs to `main`.
- Never push large binaries without checking the file-size limits above.
