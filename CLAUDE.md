# Claude instructions – Heights Design repo

Read `ARCHITECTURE.md` before changing anything. In short:

- `main` is published on GitHub Pages (`https://heights-contracting.github.io/Design/`); only web-ready files go there.
- Original downloads belong on the `sources` branch, never on `main`.
- New downloads arrive in `library/inbox/`. Process them with `python3 tools/ingest.py library/inbox`, commit the generated library folders and `catalog.json`, then move the originals to `sources`.
- Each project lives in its own kebab-case folder with `index.html`, `project.json`, `materials.json`, `assets/`.
  Projects read textures and skies from `../library/` (listed in `materials.json`); no CDNs, no base64 texture bundles.
- New versions of a live project go to `<slug>/beta/` first; replace the live folder only after the owner approves.
- Add every new project as a card in the root `index.html`.
- Test before pushing: local http server, desktop + 390×844 phone screenshots, PNG and PDF export, no console errors.
- Respect the budgets: ≤ 25 MB per file, first load ≤ 15 MB desktop / ≤ 8 MB phone, site < 1 GB.
- Only CC0 assets (ambientCG, Poly Haven) or Heights' own photos.
- The owner is Fady Gendi. Reply in plain language, and say honestly what is generated and what is real.
