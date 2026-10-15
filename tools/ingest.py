#!/usr/bin/env python3
"""Ingest texture / sky downloads into the shared library.

Usage:
    python3 tools/ingest.py <file-or-folder> [...]

Accepts:
  * ambientCG zips          (e.g. Tiles138_2K-JPG.zip)
  * Poly Haven .blend.zip   (e.g. dark_wood_2k.blend.zip) or loose Poly Haven files
  * HDR skies               (.exr / .hdr, e.g. kiara_1_dawn_4k.exr)

Writes web-ready files to library/surfaces/<category>/<id>/ and library/skies/<id>/,
and rebuilds library/catalog.json. Re-running is safe (existing ids are replaced).
Needs: Pillow, numpy, OpenEXR  (pip install pillow numpy OpenEXR)
"""
import io, json, os, re, sys, tempfile, zipfile
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'library')
MAX = 2048            # web textures are capped at 2K
SKY_SIZES = (2048, 1024)

CATEGORY = [  # (regex on id, category)
    (r'^(Tiles|Porcelain)', 'tiles'),
    (r'^(Granite|Marble|Onyx|Travertine|Rock|Limestone|Sandstone)', 'stone'),
    (r'^(Bricks|StoneBricks)', 'brick'),
    (r'^(Concrete|Plaster|PaintedPlaster)|plaster|concrete', 'plaster-concrete'),
    (r'^(WoodFloor|Wood|Planks|Bark)|wood|plank|veneer|oak|walnut', 'wood'),
    (r'^(Metal|CorrugatedSteel|DiamondPlate|SheetMetal)', 'metal'),
    (r'^(PavingStones|Road|Asphalt)', 'paving'),
    (r'^(Grass|Ground|Gravel|ScatteredLeaves|Moss|Leaf)|gravel|grass', 'ground'),
    (r'^(Fabric|Carpet|Leather)', 'fabric'),
]
SKIP_IN_ID = re.compile(r'(_\d+K-(JPG|PNG))$|(_\d+k)$', re.I)


def category_of(i):
    for rx, c in CATEGORY:
        if re.search(rx, i):
            return c
    return 'other'


def nice_name(i):
    s = i.replace('_', ' ')
    s = re.sub(r'(?<=[a-z])(?=[A-Z0-9])', ' ', s)
    return s[:1].upper() + s[1:]


# ---------- image helpers ----------
def read_exr(path):
    import OpenEXR
    with OpenEXR.File(path) as f:
        ch = f.channels()
        if 'RGB' in ch:
            a = ch['RGB'].pixels
        elif 'RGBA' in ch:
            a = ch['RGBA'].pixels[..., :3]
        else:
            keys = [k for k in ('R', 'G', 'B') if k in ch] or list(ch)[:1]
            a = np.stack([ch[k].pixels for k in keys], -1)
            if a.shape[-1] == 1:
                a = np.repeat(a, 3, -1)
    return np.asarray(a, dtype=np.float32)


def load_any(path, mode='RGB'):
    """Return a PIL image. EXR data maps are treated as linear 0..1 data."""
    if path.lower().endswith('.exr'):
        a = np.clip(read_exr(path), 0, 1)
        im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB')
    else:
        im = Image.open(path)
        if im.mode in ('I;16', 'I;16B', 'I'):
            a = np.asarray(im, dtype=np.float32)
            im = Image.fromarray((a / max(a.max(), 1) * 255).astype(np.uint8))
    return im.convert(mode)


def save_map(src, dst, mode='RGB', q=90):
    im = load_any(src, mode)
    if max(im.size) > MAX:
        im = im.resize((MAX, MAX * im.size[1] // im.size[0]), Image.LANCZOS)
    im.save(dst, 'JPEG', quality=q, optimize=True)
    return im.size


def avg_hex(path):
    im = Image.open(path).convert('RGB').resize((64, 64), Image.BOX)
    r, g, b = np.asarray(im).reshape(-1, 3).mean(0)
    return '#%02x%02x%02x' % (int(r), int(g), int(b))


# ---------- surfaces ----------
ROLE = [  # (regex on file name, role)
    (r'(_Color|_diff|_albedo|_basecolor)', 'color'),
    (r'(_NormalGL|_nor_gl|_normal_gl)', 'normal'),
    (r'(_Roughness|_rough)', 'roughness'),
    (r'(_AmbientOcclusion|_ao)', 'ao'),
    (r'(_Displacement|_disp|_height)', 'displacement'),
    (r'(_Metalness|_metal)', 'metalness'),
    (r'(_Opacity|_alpha)', 'opacity'),
]
MODE = {'color': 'RGB', 'normal': 'RGB'}


def ingest_surface(folder, sid, source):
    files = [os.path.join(dp, f) for dp, _, fs in os.walk(folder) for f in fs]
    found, preview = {}, None
    for p in files:
        n = os.path.basename(p)
        if not re.search(r'\.(jpe?g|png|exr|tiff?)$', n, re.I):
            continue
        for rx, role in ROLE:
            if re.search(rx, n, re.I) and role not in found:
                found[role] = p
                break
        else:
            if source == 'ambientCG' and n.lower() == sid.lower() + '.png':
                preview = p
    if 'color' not in found:
        print('  ! no colour map in', sid, '- skipped')
        return None
    cat = category_of(sid)
    out = os.path.join(LIB, 'surfaces', cat, sid)
    os.makedirs(out, exist_ok=True)
    maps, res = {}, None
    for role, p in found.items():
        size = save_map(p, os.path.join(out, role + '.jpg'), MODE.get(role, 'L'),
                        92 if role == 'normal' else 90)
        maps[role] = role + '.jpg'
        res = res or size
    pv = Image.open(preview).convert('RGB') if preview else load_any(found['color'])
    w, h = pv.size
    s = min(w, h)
    pv = pv.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((256, 256), Image.LANCZOS)
    pv.save(os.path.join(out, 'preview.jpg'), 'JPEG', quality=85)
    url = ('https://ambientcg.com/view?id=' + sid) if source == 'ambientCG' else ('https://polyhaven.com/a/' + sid)
    info = dict(id=sid, name=nice_name(sid), kind='surface', category=cat, source=source,
                licence='CC0', url=url, size=list(res), maps=maps,
                avg=avg_hex(os.path.join(out, 'color.jpg')),
                path=f'library/surfaces/{cat}/{sid}/')
    json.dump(info, open(os.path.join(out, 'info.json'), 'w'), indent=1)
    print('  surface', cat, sid, res, sorted(maps))
    return info


# ---------- skies ----------
def write_hdr(path, rgb):
    h, w, _ = rgb.shape
    rgb = np.maximum(rgb, 0)
    mx = rgb.max(-1)
    e = np.where(mx > 1e-32, np.ceil(np.log2(np.maximum(mx, 1e-32))), -128)
    sc = np.where(mx > 1e-32, 256.0 / np.exp2(e), 0)
    m = np.clip(rgb * sc[..., None], 0, 255).astype(np.uint8)
    ee = np.clip(e + 128, 0, 255).astype(np.uint8)
    data = np.concatenate([m, ee[..., None]], -1)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {h} +X {w}\n'.encode())
        f.write(data.tobytes())


def read_hdr(path):
    import imageio.v3 as iio  # optional fallback for .hdr inputs
    return np.asarray(iio.imread(path), dtype=np.float32)[..., :3]


def ingest_sky(path):
    sid = SKIP_IN_ID.sub('', os.path.splitext(os.path.basename(path))[0])
    a = read_exr(path) if path.lower().endswith('.exr') else read_hdr(path)
    out = os.path.join(LIB, 'skies', sid)
    os.makedirs(out, exist_ok=True)
    files = {}
    for W in SKY_SIZES:
        im = Image.fromarray(a[..., 0]).size  # noqa (shape check)
        r = np.stack([np.asarray(Image.fromarray(a[..., c]).resize((W, W // 2), Image.BOX)) for c in range(3)], -1)
        name = f'{sid}_{W // 1024}k.hdr'
        write_hdr(os.path.join(out, name), r)
        files[f'{W // 1024}k'] = name
    small = np.stack([np.asarray(Image.fromarray(a[..., c]).resize((512, 256), Image.BOX)) for c in range(3)], -1)
    ex = 0.5 / max(np.percentile(small.mean(-1), 60), 1e-4)
    t = small * ex
    t = t / (1 + t)
    Image.fromarray((np.clip(t, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(os.path.join(out, 'preview.jpg'), quality=85)
    info = dict(id=sid, name=nice_name(sid), kind='sky', category='sky', source='Poly Haven', licence='CC0',
                url='https://polyhaven.com/a/' + sid, size=[a.shape[1], a.shape[0]], maps=files,
                path=f'library/skies/{sid}/')
    json.dump(info, open(os.path.join(out, 'info.json'), 'w'), indent=1)
    print('  sky', sid, files)
    return info


# ---------- dispatch ----------
def ingest_path(p):
    n = os.path.basename(p)
    low = n.lower()
    if low.endswith(('.exr', '.hdr')) and '_nor' not in low and '_rough' not in low:
        return ingest_sky(p)
    if low.endswith('.zip'):
        base = re.sub(r'\s*\(\d+\)$', '', n[:-4])
        source = 'Poly Haven' if base.endswith('.blend') or re.search(r'_\d+k$', base) else 'ambientCG'
        sid = SKIP_IN_ID.sub('', base.replace('.blend', ''))
        with tempfile.TemporaryDirectory() as td:
            zipfile.ZipFile(p).extractall(td)
            return ingest_surface(td, sid, source)
    if os.path.isdir(p):
        sid = SKIP_IN_ID.sub('', n)
        return ingest_surface(p, sid, 'Poly Haven' if '_' in sid else 'ambientCG')
    print('  ? skipped', n)


def rebuild_catalog():
    items = []
    for dp, _, fs in os.walk(LIB):
        if 'info.json' in fs:
            items.append(json.load(open(os.path.join(dp, 'info.json'))))
    items.sort(key=lambda d: (d['kind'] != 'surface', d['category'], d['id']))
    json.dump({'items': items}, open(os.path.join(LIB, 'catalog.json'), 'w'), indent=1)
    print('catalog:', len(items), 'items')


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        paths = [os.path.join(arg, f) for f in sorted(os.listdir(arg))] if os.path.isdir(arg) and not any(
            f.lower().endswith(('.jpg', '.png', '.exr')) for f in os.listdir(arg)) else [arg]
        for p in paths:
            if os.path.basename(p).lower() in ('readme.md', '.gitkeep'):
                continue
            ingest_path(p)
    rebuild_catalog()
