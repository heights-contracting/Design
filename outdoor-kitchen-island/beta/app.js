/* Heights Contracting – 3D space renderer (outdoor kitchen & island), beta.
 * Live view: three.js r186 raster (AgX tone mapping, bloom).
 * Photo export: progressive path tracing in the browser (three-gpu-pathtracer) with a progress bar.
 * Materials come from the shared library (../../library/) as listed in materials.json. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), loader = $('loader');
const loaderTxt = t => { const sp = loader.querySelector('span'); if (sp) sp.innerHTML = t; };
function fail(msg) { loaderTxt(msg); loader.classList.remove('done'); loader.hidden = false; }
window.addEventListener('error', e => { if (!loader.classList.contains('done')) fail('Something went wrong while loading<br><small style="letter-spacing:0;text-transform:none;opacity:.7">' + String(e.message || '').slice(0, 140) + '</small>'); });

const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const DPR = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 2.5);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('hcIsland.' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('hcIsland.' + k, JSON.stringify(v)); } catch (e) { } }
};

let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
catch (e) { stage.insertAdjacentHTML('afterbegin', '<p class="fail">The 3D view needs WebGL, which this browser has turned off.</p>'); loader.hidden = true; throw e; }
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
stage.insertBefore(renderer.domElement, stage.firstChild);
const CAN_POST = !!renderer.capabilities.isWebGL2;
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

/* ---------- configuration + library catalogue ---------- */
const CFG = await fetch('materials.json').then(r => r.json());
const LIB = CFG.library;
const CATALOG = await fetch(LIB + 'catalog.json').then(r => r.json()).then(d => d.items);
const ITEM = Object.fromEntries(CATALOG.map(i => [i.id, i]));

/* ---------- loading helpers with progress ---------- */
let pending = 0, loaded = 0;
function progress() { if (!loader.classList.contains('done')) loaderTxt('Preparing the scene… ' + Math.round(loaded / Math.max(1, pending) * 100) + '%'); }
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(url, srgb) {
  const key = url + (srgb ? '|s' : '');
  if (texCache.has(key)) return texCache.get(key);
  pending++; progress();
  const p = new Promise(res => texLoader.load(url, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    loaded++; progress(); res(t);
  }, undefined, () => { loaded++; progress(); console.warn('missing texture', url); res(null); }));
  texCache.set(key, p); return p;
}
const hdrCache = new Map();
function loadHDR(id) {
  if (hdrCache.has(id)) return hdrCache.get(id);
  const it = ITEM[id];
  const url = LIB + it.path.replace(/^library\//, '') + it.maps[MOBILE ? '1k' : '2k'];
  pending++; progress();
  const p = new HDRLoader().setDataType(THREE.FloatType).loadAsync(url).then(t => { loaded++; progress(); return t; });
  hdrCache.set(id, p); return p;
}
/* equirect half-float texture with optional desaturation (keeps the purple dusk cast out of the lighting) */
function hdrTex(src, sat) {
  const img = src.image, w = img.width, h = img.height, d = img.data, n = w * h, st = Math.round(d.length / n);
  const out = new Uint16Array(n * 4), tf = THREE.DataUtils.toHalfFloat, one = tf(1);
  for (let i = 0; i < n; i++) {
    const r = d[i * st], g = d[i * st + 1], b = d[i * st + 2], l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[i * 4] = tf(l + (r - l) * sat); out[i * 4 + 1] = tf(l + (g - l) * sat); out[i * 4 + 2] = tf(l + (b - l) * sat); out[i * 4 + 3] = one;
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = src.flipY; t.needsUpdate = true;
  return t;
}

const seedState = { s: 11 };
const srand = s => { seedState.s = s; };
const rnd = () => { seedState.s = (seedState.s * 16807) % 2147483647; return (seedState.s - 1) / 2147483646; };
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- scene, cameras, controls ---------- */
const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(45, 1, 0.08, 260);
const ORTHO_HALF = 5;
const ortho = new THREE.OrthographicCamera(-ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 300);
let cam = persp;
const controls = new OrbitControls(persp, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.8; controls.maxDistance = 26; controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.495; controls.minZoom = 0.25; controls.maxZoom = 9;

const root = new THREE.Group(); scene.add(root);
const decals = [];               // baked contact shadows: live view only (the photo renderer computes real ones)
const ns = v => new THREE.Vector2(v, v);
function shadow(m, c, r) { m.castShadow = c !== false; m.receiveShadow = r !== false; return m; }
const std = o => new THREE.MeshStandardMaterial(o);

/* world-space UVs in metres: textures repeat every `size` metres via texture.repeat */
function worldUV(g, cx, cy, cz) {
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i) + cx, y = P.getY(i) + cy, z = P.getZ(i) + cz, ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i));
    let u, v; if (ax > 0.5) { u = z; v = y; } else if (ay > 0.5) { u = x; v = z; } else { u = x; v = y; }
    U.setXY(i, u, v);
  }
}
function tbox(cx, cy, cz, w, h, d, m, parent) {
  const g = new THREE.BoxGeometry(w, h, d); worldUV(g, cx, cy, cz);
  const me = new THREE.Mesh(g, m); me.position.set(cx, cy, cz); (parent || root).add(me); return shadow(me);
}
function box(x0, y0, z0, w, h, d, m, parent) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x0 + w / 2, y0 + h / 2, z0 + d / 2); (parent || root).add(me); return shadow(me); }
function cbox(cx, cy, cz, w, h, d, m, parent) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(cx, cy, cz); (parent || root).add(me); return shadow(me); }
function cyl(x, y, z, r1, r2, h, m, seg, parent) { const me = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 24), m); me.position.set(x, y, z); (parent || root).add(me); return shadow(me); }

/* ---------- materials (slot materials get their textures from the library) ---------- */
const M = {
  walls: std({ color: 0xffffff, roughness: 1 }),
  feature: std({ color: 0xffffff, roughness: 1 }),
  floor: std({ color: 0xffffff, roughness: 1 }),
  top: std({ color: 0xffffff, roughness: 1 }),
  clad: std({ color: 0xffffff, roughness: 1 }),
  steel: std({ color: 0xdfe2e5, metalness: 1, roughness: 1 }),
  ground: std({ color: 0xffffff, roughness: 1 }),
  frame: std({ color: 0xffffff, roughness: 1 }),
  cab: std({ color: 0xffffff, roughness: 1 }),
  steelD: std({ color: 0x2b2d30, metalness: 0.85, roughness: 0.5 }),
  black: std({ color: 0x0b0b0c, metalness: 0.6, roughness: 0.32 }),
  blackM: std({ color: 0x111112, metalness: 0.2, roughness: 0.7 }),
  pot: std({ color: 0x2b2a28, roughness: 0.38, metalness: 0.1 }),
  soil: std({ color: 0x1a140f, roughness: 1 }),
  bowl: std({ color: 0xece6da, roughness: 0.28 }),
  lime: std({ color: 0x9ac22c, roughness: 0.45 }),
  hedgeCore: std({ color: 0x0b1507, roughness: 1 }),
  cane: std({ color: 0x3c4526, roughness: 0.7 })
};
Object.keys(M).forEach(k => { M[k].name = k; });
const TX = {};
const LOCAL = 'assets/tex/';
await Promise.all([
  ['leaf', 'leaf.png', true], ['frond', 'frond.png', true], ['trunk', 'trunk.jpg', true],
  ['pvc_mottle', 'pvc_mottle.jpg', false], ['pvc_normal', 'pvc_normal.jpg', false]
].map(([k, f, s]) => loadTex(LOCAL + f, s).then(t => { TX[k] = t; })));

const pvcMat = new THREE.MeshPhysicalMaterial({ color: 0xe6e2b0, roughness: 1.0, roughnessMap: TX.pvc_mottle, normalMap: TX.pvc_normal, normalScale: ns(0.55), clearcoat: 0.12, clearcoatRoughness: 0.5, side: THREE.DoubleSide });
pvcMat.name = 'pvc';
const leafMat = std({ map: TX.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, vertexColors: true }); leafMat.name = 'leaf';
const frondMats = [0xbfcfae, 0xa6bd92, 0x92aa7c].map((c, i) => { const m = std({ map: TX.frond, color: c, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5 }); m.name = 'frond' + i; return m; });
function emissive(name, col, k) { const m = std({ color: 0x000000, roughness: 1, emissive: col, emissiveIntensity: k }); m.name = name; return m; }
const LED = emissive('LED', 0xffa860, 6), LENS = emissive('LENS', 0xffe2c0, 14);

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight(0x7f90b8, 0x241f19, 0.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0x9fb2ff, 0.4); sun.position.set(-7, 10, 9); sun.target.position.set(2.5, 0, 3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
scene.add(sun); scene.add(sun.target);

const TH = Math.atan(0.30 / 6.0), ROOF_Y = 3.0;
const roofY = z => ROOF_Y - z * Math.sin(TH);
function spot(col, I, dist, ang, pen, x, y, z, tx, ty, tz) {
  const s = new THREE.SpotLight(col, I, dist, ang, pen, 2); s.position.set(x, y, z); s.target.position.set(tx, ty, tz); scene.add(s); scene.add(s.target); return s;
}
const Ldown = [], Lwash = [], Lup = [], Lglow = [];
const DOWN = [[1.4, 1.2], [3.6, 1.2], [1.4, 3.0], [3.6, 3.0], [1.6, 4.8], [3.4, 4.8]];
DOWN.forEach(p => Ldown.push(spot(0xffd2a0, 1, 9, 0.8, 0.75, p[0], roofY(p[1]) - 0.045, p[1], p[0], 0, p[1])));
[0.9, 1.9, 3.1, 4.1].forEach(x => Lwash.push(spot(0xffb877, 1, 3.6, 0.95, 1.0, x, 2.28, 0.14, x, 0.7, 0.0)));
[[0.08, -1], [4.92, 1]].forEach(s => [2.1, 3.3, 4.3].forEach(z => Lup.push(spot(0xffc58a, 1, 3.0, 0.55, 0.85, s[0], 0.08, z, s[0] + s[1] * 0.9, 1.4, z))));
const glowL = new THREE.PointLight(0xffb56e, 1, 3.4, 2); glowL.position.set(2.7, 0.12, 4.85); scene.add(glowL); Lglow.push(glowL);

/* ---------- soft contact shadows baked as decals (live view only) ---------- */
function aoDecal(x0, z0, x1, z1, m, str, yy) {
  const ppm = 48, w = Math.ceil((x1 - x0 + 2 * m) * ppm), d = Math.ceil((z1 - z0 + 2 * m) * ppm);
  const c = document.createElement('canvas'); c.width = w; c.height = d; const g = c.getContext('2d'), im = g.createImageData(w, d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = i / ppm - m, z = j / ppm - m;
    const dx = Math.max(0, Math.max(-x, x - (x1 - x0))), dz = Math.max(0, Math.max(-z, z - (z1 - z0)));
    let a = 1 - Math.sqrt(dx * dx + dz * dz) / m; a = a < 0 ? 0 : a * a * (3 - 2 * a);
    const k = (j * w + i) * 4; im.data[k + 3] = Math.round(255 * str * a);
  }
  g.putImageData(im, 0, 0);
  const me = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 2 * m, z1 - z0 + 2 * m), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  me.rotation.x = -Math.PI / 2; me.position.set((x0 + x1) / 2, yy || 0.006, (z0 + z1) / 2); root.add(me); decals.push(me); return me;
}

/* ===================== SPACE: outdoor kitchen & island ===================== */
const cover = new THREE.Group(); scene.add(cover);
const roofG = new THREE.Group(); scene.add(roofG);
roofG.position.set(0, ROOF_Y, 0); roofG.rotation.x = TH;
cover.position.copy(roofG.position); cover.rotation.copy(roofG.rotation);
const lightMeshes = [];
const uvScale = (g, su, sv) => { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * su, U.getY(i) * sv); };

/* timber boxes: UV u runs along the member, v across (metres); a second UV set swaps them for textures whose grain runs vertically */
const grainMeshes = { frame: [], cab: [] };
function woodBox(cx, cy, cz, w, h, d, axis, parent, slot) {
  slot = slot || 'frame';
  const g = new THREE.BoxGeometry(w, h, d), P = g.attributes.position, N = g.attributes.normal;
  const A = new Float32Array(P.count * 2), B = new Float32Array(P.count * 2), ou = rnd() * 3, ov = rnd() * 3;
  for (let i = 0; i < P.count; i++) {
    const p = [P.getX(i), P.getY(i), P.getZ(i)], n = [Math.abs(N.getX(i)), Math.abs(N.getY(i)), Math.abs(N.getZ(i))];
    const na = n[0] > 0.5 ? 0 : (n[1] > 0.5 ? 1 : 2); let u, v;
    if (na === axis) { const o2 = [0, 1, 2].filter(a => a !== na); u = p[o2[0]]; v = p[o2[1]]; }
    else { u = p[axis]; v = p[3 - na - axis]; }
    A[i * 2] = u + ou; A[i * 2 + 1] = v + ov; B[i * 2] = v + ov; B[i * 2 + 1] = u + ou;
  }
  const uvA = new THREE.BufferAttribute(A, 2), uvB = new THREE.BufferAttribute(B, 2);
  g.setAttribute('uv', uvA);
  const me = new THREE.Mesh(g, M[slot]); me.userData.uvA = uvA; me.userData.uvB = uvB; grainMeshes[slot].push(me);
  me.position.set(cx, cy, cz); (parent || root).add(me); return shadow(me);
}

function slabWithHole(x0, z0, w, d, hx, hz, hw, hd, y, t, mat) {
  tbox(x0 + (hx - x0) / 2, y + t / 2, z0 + d / 2, hx - x0, t, d, mat);
  tbox((hx + hw + x0 + w) / 2, y + t / 2, z0 + d / 2, x0 + w - (hx + hw), t, d, mat);
  tbox(hx + hw / 2, y + t / 2, (z0 + hz) / 2, hw, t, hz - z0, mat);
  tbox(hx + hw / 2, y + t / 2, (hz + hd + z0 + d) / 2, hw, t, z0 + d - (hz + hd), mat);
  const bt = 0.012, bh = 0.2;
  cbox(hx + hw / 2, y - bh / 2 + 0.004, hz, hw, bh, bt, M.steel); cbox(hx + hw / 2, y - bh / 2 + 0.004, hz + hd, hw, bh, bt, M.steel);
  cbox(hx, y - bh / 2 + 0.004, hz + hd / 2, bt, bh, hd, M.steel); cbox(hx + hw, y - bh / 2 + 0.004, hz + hd / 2, bt, bh, hd, M.steel);
  cbox(hx + hw / 2, y - bh, hz + hd / 2, hw, 0.01, hd, M.steel);
  cyl(hx + hw / 2, y - bh + 0.007, hz + hd / 2, 0.03, 0.03, 0.006, M.black, 18);
}
function faucet(x, y, z, dir) {
  const pts = [[0, 0, 0], [0, 0.2, 0], [0, 0.34, 0.02 * dir], [0, 0.42, 0.1 * dir], [0, 0.4, 0.2 * dir], [0, 0.3, 0.24 * dir]].map(p => new THREE.Vector3(...p));
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.0125, 14, false), M.black); m.position.set(x, y, z); shadow(m); root.add(m);
  cyl(x, y + 0.012, z, 0.026, 0.03, 0.024, M.black, 18);
  cbox(x + 0.05, y + 0.05, z, 0.012, 0.09, 0.014, M.black);
}
function bar(x, y, z, len, r, mat, axisX) { const m = cyl(x, y, z, r, r, len, mat, 14); if (axisX) m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2; return m; }
function handle(cx, cy, z, len, vertical) {
  const m = cyl(cx, cy, z + 0.03, 0.009, 0.009, len, M.steel, 12); if (!vertical) m.rotation.z = Math.PI / 2;
  [-1, 1].forEach(s => { const p = cyl(vertical ? cx : cx + s * (len / 2 - 0.03), vertical ? cy + s * (len / 2 - 0.03) : cy, z + 0.014, 0.007, 0.007, 0.03, M.steel, 10); p.rotation.x = Math.PI / 2; });
}
function door(x0, w, y0, h, z, hMode) {
  woodBox(x0 + w / 2, y0 + h / 2, z + 0.011, w - 0.008, h - 0.008, 0.022, 1, root, 'cab');
  if (hMode === 'h') handle(x0 + w / 2, y0 + h - 0.06, z + 0.022, Math.min(0.5, w - 0.1), false);
  if (hMode === 'v') handle(x0 + w - 0.05, y0 + h / 2, z + 0.022, 0.28, true);
}
function fridge(x0, w, y0, h, z) {
  cbox(x0 + w / 2, y0 + h / 2, z - 0.01, w + 0.01, h + 0.01, 0.03, M.black);
  tbox(x0 + w / 2, y0 + h / 2, z + 0.012, w - 0.014, h - 0.014, 0.025, M.steel);
  cbox(x0 + w / 2, y0 + h - 0.075, z + 0.014, w - 0.014, 0.003, 0.026, M.steelD);
  cbox(x0 + w / 2, y0 + 0.025, z + 0.014, w - 0.14, 0.012, 0.026, M.black);
  handle(x0 + w / 2, y0 + h - 0.12, z + 0.026, w * 0.7, false);
}

const IX = 1.3, IZ = 3.3, IW = 2.8, ID = 1.2, RZ = 0.04, RD = 0.65;
function buildIsland() {
  srand(11);
  const gG = new THREE.PlaneGeometry(240, 240); uvScale(gG, 240, 240);
  const ground = new THREE.Mesh(gG, M.ground); ground.rotation.x = -Math.PI / 2; ground.position.set(2.5, -0.04, 3); ground.receiveShadow = true; root.add(ground);
  const fG = new THREE.PlaneGeometry(5, 6); uvScale(fG, 5, 6);
  const floor = new THREE.Mesh(fG, M.floor); floor.rotation.x = -Math.PI / 2; floor.position.set(2.5, 0, 3); floor.receiveShadow = true; root.add(floor);

  // back wall, feature panel, LED strips
  tbox(2.5, 1.7, -0.1, 6.8, 3.4, 0.2, M.walls);
  tbox(2.5, 1.62, 0.02, 4.4, 1.4, 0.04, M.feature);
  cbox(2.5, 2.335, 0.03, 4.4, 0.03, 0.05, LED);
  cbox(2.5, 0.925, 0.03, 4.4, 0.014, 0.05, LED);
  box(0.28, 0.92, -0.02, 0.02, 1.42, 0.08, M.steelD); box(4.7, 0.92, -0.02, 0.02, 1.42, 0.08, M.steelD);

  // planter walls with stone coping, hedge cores
  tbox(-0.125, 0.35, 3, 0.25, 0.7, 6, M.walls); tbox(5.125, 0.35, 3, 0.25, 0.7, 6, M.walls);
  tbox(-0.13, 0.72, 3, 0.31, 0.04, 6.04, M.top); tbox(5.13, 0.72, 3, 0.31, 0.04, 6.04, M.top);
  tbox(-0.55, 0.35, 3, 0.6, 0.7, 6, M.walls); tbox(5.55, 0.35, 3, 0.6, 0.7, 6, M.walls);
  tbox(-0.55, 0.73, 3, 0.66, 0.04, 6.04, M.top); tbox(5.55, 0.73, 3, 0.66, 0.04, 6.04, M.top);
  cbox(-0.55, 0.9, 3, 0.4, 0.35, 5.8, M.hedgeCore); cbox(5.55, 0.9, 3, 0.4, 0.35, 5.8, M.hedgeCore);

  // back run
  tbox(2.5, 0.05, RZ + RD / 2 - 0.02, 4.4, 0.1, RD - 0.04, M.blackM);
  woodBox(2.5, 0.5, RZ + RD / 2, 4.4, 0.78, RD, 0, root, 'cab');
  slabWithHole(0.26, RZ, 4.48, RD + 0.07, 0.84, 0.17, 0.5, 0.4, 0.88, 0.045, M.top);
  door(0.3, 0.45, 0.12, 0.74, RZ + RD, 'v');
  fridge(0.75, 0.7, 0.12, 0.74, RZ + RD);
  door(1.45, 0.6, 0.12, 0.36, RZ + RD, 'h'); door(1.45, 0.6, 0.5, 0.36, RZ + RD, 'h');
  fridge(2.05, 0.7, 0.12, 0.74, RZ + RD);
  door(2.75, 0.45, 0.12, 0.74, RZ + RD, 'v');
  // BBQ unit
  box(3.2, 0.12, RZ + RD - 0.01, 1.1, 0.74, 0.03, M.steel);
  cbox(3.75, 0.5, RZ + RD + 0.022, 0.006, 0.7, 0.012, M.black);
  handle(3.5, 0.78, RZ + RD + 0.016, 0.3, false); handle(4.0, 0.78, RZ + RD + 0.016, 0.3, false);
  door(4.3, 0.4, 0.12, 0.74, RZ + RD, 'v');
  tbox(3.75, 1.0, 0.36, 1.04, 0.2, 0.56, M.steel);
  cbox(3.75, 1.115, 0.66, 1.04, 0.03, 0.04, M.steelD);
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.56, 0); sh.lineTo(0.56, 0.12); sh.quadraticCurveTo(0.56, 0.31, 0.3, 0.31); sh.lineTo(0.0, 0.31); sh.lineTo(0, 0);
  const hg = new THREE.ExtrudeGeometry(sh, { depth: 1.04, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 16 });
  hg.translate(0, 0, -0.52); hg.rotateY(-Math.PI / 2);
  const hood = new THREE.Mesh(hg, M.steel); hood.position.set(3.75, 1.1, 0.1); shadow(hood); root.add(hood);
  bar(3.75, 1.28, 0.7, 0.72, 0.011, M.steel, true);
  [-1, 1].forEach(s => { const p = cyl(3.75 + s * 0.33, 1.26, 0.675, 0.008, 0.008, 0.05, M.steel, 10); p.rotation.x = Math.PI / 2; });
  for (let i = 0; i < 4; i++) {
    const kx = 3.42 + i * 0.22;
    cyl(kx, 1.02, 0.655, 0.027, 0.027, 0.035, M.black, 22).rotation.x = Math.PI / 2;
    cyl(kx, 1.02, 0.642, 0.032, 0.032, 0.01, M.steel, 22).rotation.x = Math.PI / 2;
  }
  cbox(3.75, 1.2, 0.665, 0.12, 0.04, 0.012, M.black);
  faucet(1.09, 0.925, 0.2, 1);

  // island
  tbox(IX + IW / 2, 0.05, IZ + ID / 2, IW - 0.1, 0.1, ID - 0.08, M.blackM);
  woodBox(IX + IW / 2, 0.49, IZ + ID / 2, IW - 0.28, 0.78, ID - 0.02, 0, root, 'cab');
  tbox(IX + 0.07, 0.45, IZ + ID / 2, 0.14, 0.9, ID, M.clad); tbox(IX + IW - 0.07, 0.45, IZ + ID / 2, 0.14, 0.9, ID, M.clad);
  slabWithHole(IX - 0.05, IZ - 0.05, IW + 0.1, ID + 0.1, 3.5, 3.42, 0.5, 0.38, 0.885, 0.045, M.top);
  fridge(1.69, 0.76, 0.12, 0.74, IZ + ID); fridge(2.92, 0.79, 0.12, 0.74, IZ + ID);
  door(1.44, 0.25, 0.12, 0.74, IZ + ID, 'v'); door(2.45, 0.47, 0.12, 0.74, IZ + ID, 'v'); door(3.71, 0.25, 0.12, 0.74, IZ + ID, 'v');
  cbox(IX + IW / 2, 0.835, IZ + ID, IW - 0.35, 0.012, 0.04, LED);
  cbox(IX + IW / 2, 0.835, IZ, IW - 0.35, 0.012, 0.04, LED);
  faucet(3.97, 0.93, 3.48, 1);
  const bp = [[0, 0], [0.05, 0], [0.09, 0.012], [0.125, 0.05], [0.13, 0.065], [0.122, 0.066], [0.085, 0.03], [0, 0.02]].map(p => new THREE.Vector2(p[0], p[1]));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(bp, 32), M.bowl); bowl.position.set(1.75, 0.93, 3.78); shadow(bowl); root.add(bowl);
  for (let l = 0; l < 7; l++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), M.lime); s.scale.set(1, 0.92, 1.08);
    s.position.set(1.75 + (rnd() - 0.5) * 0.12, 0.975 + (l > 3 ? 0.04 : 0), 3.78 + (rnd() - 0.5) * 0.12); s.castShadow = true; root.add(s);
  }

  // pergola frame (posts in world space, beams/rafters in the tilted roof group)
  const postX = [0.12, 4.88], postZ = [0.12, 5.88];
  postX.forEach(px => postZ.forEach(pz => {
    const top = ROOF_Y - pz * Math.sin(TH) - 0.22 * Math.cos(TH);
    woodBox(px, 0.12 + (top - 0.12) / 2, pz, 0.15, top - 0.12, 0.15, 1);
    tbox(px, 0.06, pz, 0.24, 0.12, 0.24, M.walls);
    cbox(px, 0.125, pz, 0.2, 0.008, 0.2, M.steelD);
    [-1, 1].forEach(s => {
      cbox(px + s * 0.081, top - 0.17, pz, 0.008, 0.3, 0.12, M.steelD); cbox(px, top - 0.17, pz + s * 0.081, 0.12, 0.3, 0.008, M.steelD);
      [-0.1, -0.04].forEach(dy => [-0.04, 0.04].forEach(dz => { cyl(px + s * 0.088, top - 0.17 + (dy + 0.07), pz + dz, 0.009, 0.009, 0.01, M.steel, 10).rotation.z = Math.PI / 2; }));
    });
  }));
  postX.forEach(px => woodBox(px, -0.11, 3.0, 0.10, 0.22, 6.3, 2, roofG));
  postZ.forEach(pz => woodBox(2.5, -0.11, pz, 4.66, 0.22, 0.10, 0, roofG));
  for (let r = 0; r < 11; r++) { const rz = 0.12 + r * (5.76 / 10); woodBox(2.5, 0.09, rz, 5.2, 0.18, 0.08, 0, roofG); }
  function brace(ax, ay, az, bx, by, bz) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), L = a.distanceTo(b);
    const m = woodBox(0, 0, 0, L, 0.07, 0.07, 0, roofG); m.position.copy(a.clone().add(b).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
  }
  postX.forEach((px, i) => postZ.forEach((pz, j) => {
    const sx = i ? -1 : 1, sz = j ? -1 : 1;
    brace(px, -0.22 - 0.75, pz, px, -0.22, pz + sz * 0.75);
    brace(px, -0.22 - 0.75, pz, px + sx * 0.75, -0.22, pz);
  }));

  // PVC sheet over the rafters, slightly sagging between them
  const SW = 5.5, SD = 6.5, sg = new THREE.PlaneGeometry(SW, SD, 44, 150); sg.rotateX(-Math.PI / 2);
  const P = sg.attributes.position, U = sg.attributes.uv, sp = 5.76 / 10;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i) + 2.5, z = P.getZ(i) + 3.0;
    const f = ((z - 0.12) % sp + sp) % sp / sp;
    const sag = 0.014 * Math.pow(Math.sin(Math.PI * f), 2) * (z > 0.05 && z < 5.95 ? 1 : 0);
    P.setY(i, 0.186 - sag + 0.002 * Math.sin(x * 3.1 + z * 1.7));
    U.setXY(i, x / 0.14, z / 0.14);
  }
  sg.computeVertexNormals();
  const sheet = new THREE.Mesh(sg, pvcMat); sheet.position.set(2.5, 0, 3.0); sheet.castShadow = true; sheet.receiveShadow = true; cover.add(sheet);
  for (let sx = 0.9; sx < 5.0; sx += 1.4) { const sm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.003, 6.4), pvcMat); sm.position.set(sx, 0.189, 3.0); cover.add(sm); }
  [[2.5, 0.17, -0.25, 5.5, 'x'], [2.5, 0.17, 6.25, 5.5, 'x'], [-0.25, 0.17, 3.0, 6.5, 'z'], [5.25, 0.17, 3.0, 6.5, 'z']].forEach(e => {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, e[3], 10), pvcMat); h.position.set(e[0], e[1] + 0.015, e[2]);
    if (e[4] === 'x') h.rotation.z = Math.PI / 2; else h.rotation.x = Math.PI / 2; h.castShadow = true; cover.add(h);
  });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.045, 0.025), M.steel); trim.position.set(2.5, 0.16, 6.26); trim.castShadow = true; cover.add(trim);

  // downlights
  DOWN.forEach(p => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 24), M.black); body.position.set(p[0], -0.018, p[1]); roofG.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.004, 24), LENS); lens.position.set(p[0], -0.038, p[1]); roofG.add(lens); lightMeshes.push(lens);
  });

  // contact shadows (live view)
  aoDecal(IX, IZ, IX + IW, IZ + ID, 0.35, 0.55);
  aoDecal(0.3, RZ, 4.7, RZ + RD, 0.4, 0.55);
  aoDecal(0, 0, 0, 6.0, 0.28, 0.5); aoDecal(5.0, 0, 5.0, 6.0, 0.28, 0.5);
  aoDecal(0, 0, 5.0, 0, 0.25, 0.5);
  postX.forEach(px => postZ.forEach(pz => aoDecal(px - 0.1, pz - 0.1, px + 0.1, pz + 0.1, 0.18, 0.5)));

  buildFoliage();
}

/* ---------- foliage ---------- */
function frondGeo(L, segs, a0, k, wd) {
  const pos = [], uv = [], idx = []; let x = 0, y = 0; const ds = L / segs;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs, a = a0 - k * s; if (i > 0) { x += Math.cos(a) * ds; y += Math.sin(a) * ds; }
    const w = wd * 0.5;
    pos.push(x, y - 0.22 * w, -w, x, y, 0, x, y - 0.22 * w, w); uv.push(s, 0, s, 0.5, s, 1);
    if (i < segs) { const a3 = i * 3, b3 = (i + 1) * 3; idx.push(a3, b3, a3 + 1, a3 + 1, b3, b3 + 1, a3 + 1, b3 + 1, a3 + 2, a3 + 2, b3 + 1, b3 + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function addFronds(group, count, L, y, x, z, elevMin, elevMax) {
  for (let i = 0; i < count; i++) {
    const a0 = lerp(elevMin, elevMax, rnd()), len = L * (0.8 + 0.4 * rnd());
    const m = new THREE.Mesh(frondGeo(len, 10, a0, 1.5 + rnd() * 1.2, len * 0.42), frondMats[Math.floor(rnd() * 3)]); m.position.set(x, y, z);
    m.rotation.order = 'YXZ'; m.rotation.y = (i / count) * Math.PI * 2 + rnd() * 0.5; m.rotation.x = (rnd() - 0.5) * 0.5;
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
}
const trunkMat = (() => { const t = TX.trunk.clone(); t.repeat.set(2, 7); t.needsUpdate = true; const m = std({ map: t, roughness: 0.85 }); m.name = 'trunk'; return m; })();
function palm(x, z, h, L, fronds, lean) {
  const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g);
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, h, 16), trunkMat); tr.position.y = h / 2; tr.rotation.z = lean || 0; tr.position.x = -Math.sin(lean || 0) * h / 2; shadow(tr); g.add(tr);
  addFronds(g, fronds, L, h, -Math.sin(lean || 0) * h, 0, 0.15, 1.25);
  addFronds(g, Math.round(fronds * 0.4), L * 0.8, h, -Math.sin(lean || 0) * h, 0, 1.0, 1.5);
}
function pottedPlant(x, z, scale) {
  const pp = [[0, 0], [0.15, 0], [0.2, 0.04], [0.235, 0.5], [0.215, 0.54], [0.2, 0.52], [0.0, 0.5]].map(p => new THREE.Vector2(p[0] * scale, p[1] * scale));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(pp, 28), M.pot); pot.position.set(x, 0, z); shadow(pot); root.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.2 * scale, 20), M.soil); soil.rotation.x = -Math.PI / 2; soil.position.set(x, 0.49 * scale, z); root.add(soil);
  const g = new THREE.Group(); g.position.set(x, 0.5 * scale, z); root.add(g);
  for (let i = 0; i < 4; i++) {
    const ch = (0.7 + rnd() * 0.6) * scale, ox = (rnd() - 0.5) * 0.18 * scale, oz = (rnd() - 0.5) * 0.18 * scale;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.009 * scale, 0.013 * scale, ch, 8), M.cane); c.position.set(ox, ch / 2, oz); g.add(c);
    addFronds(g, 7, 0.75 * scale, ch, ox, oz, 0.5, 1.3);
  }
}
/* hedge: one merged mesh of leaf cards with per-leaf colour (works for both the live view and the photo renderer) */
function makeHedge(xa, xb, za, zb, ya, yb, count) {
  const pos = new Float32Array(count * 12), nor = new Float32Array(count * 12), uv = new Float32Array(count * 8), col = new Float32Array(count * 12), idx = new Uint32Array(count * 6);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const corners = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]], cuv = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (let i = 0; i < count; i++) {
    let x = lerp(xa, xb, rnd()), y = lerp(ya, yb, rnd()), z = lerp(za, zb, rnd());
    if (rnd() < 0.7) { const f = Math.floor(rnd() * 5); if (f === 0) x = xa + rnd() * 0.06; else if (f === 1) x = xb - rnd() * 0.06; else if (f === 2) y = yb - rnd() * 0.08; else if (f === 3) z = za + rnd() * 0.06; else z = zb - rnd() * 0.06; }
    p.set(x, y, z); e.set((rnd() - 0.5) * 3.0, rnd() * 6.28, (rnd() - 0.5) * 3.0); q.setFromEuler(e);
    const k = 0.075 + rnd() * 0.06; s.set(k, k * 2, 1); m4.compose(p, q, s);
    const vv = 0.55 + rnd() * 0.45; c.setRGB(vv * (0.8 + rnd() * 0.25), vv, vv * (0.65 + rnd() * 0.3));
    n.set(0, 0, 1).applyQuaternion(q);
    for (let j = 0; j < 4; j++) {
      v.set(corners[j][0], corners[j][1], 0).applyMatrix4(m4); const o = (i * 4 + j);
      pos.set([v.x, v.y, v.z], o * 3); nor.set([n.x, n.y, n.z], o * 3); uv.set(cuv[j], o * 2); col.set([c.r, c.g, c.b], o * 3);
    }
    const b = i * 4; idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  const me = new THREE.Mesh(g, leafMat); me.receiveShadow = true; me.castShadow = true; root.add(me); return me;
}
function buildFoliage() {
  srand(33);
  makeHedge(-0.82, -0.28, 0.05, 5.95, 0.74, 1.40, MOBILE ? 4200 : 8200);
  makeHedge(5.28, 5.82, 0.05, 5.95, 0.74, 1.40, MOBILE ? 4200 : 8200);
  pottedPlant(0.62, 1.05, 1.15); pottedPlant(4.38, 1.1, 1.15);
  pottedPlant(0.46, 5.5, 1.0); pottedPlant(4.54, 5.5, 1.0);
  [[-1.55, 1.0, 3.9, 0.12], [-1.35, 2.7, 3.4, -0.08], [-1.6, 4.4, 4.2, 0.1], [6.55, 1.4, 3.6, -0.1], [6.45, 3.6, 4.2, 0.08], [6.6, 5.2, 3.5, -0.06]].forEach(p => palm(p[0], p[1], p[2], 2.0 + rnd() * 0.4, 13, p[3]));
}
buildIsland();

/* ---------- material slots: library textures on the shared materials ---------- */
const SLOT = {};
const sizeFor = id => (CFG.sizes && CFG.sizes[id]) || (ITEM[id] && CFG.categorySize[ITEM[id].category]) || 1.5;
function itemName(id) { if (id.startsWith('local:')) { for (const s of CFG.slots) for (const x of (s.extra || [])) if (x.id === id) return x.name; return id; } return ITEM[id] ? ITEM[id].name : id; }
async function libMaps(id) {
  if (id === 'local:brushed') {
    const [r, n] = await Promise.all([loadTex(LOCAL + 'steel_rough.jpg', false), loadTex(LOCAL + 'steel_normal.jpg', false)]);
    return { roughness: r, normal: n, size: 1.0, metal: true, local: true };
  }
  const it = ITEM[id]; const base = LIB + it.path.replace(/^library\//, ''); const m = it.maps1k || it.maps;
  const roles = ['color', 'normal', 'roughness', 'metalness'].filter(r => m[r]);
  const tex = await Promise.all(roles.map(r => loadTex(base + m[r], r === 'color')));
  const out = { size: sizeFor(id), metal: it.category === 'metal', grain: it.grain };
  roles.forEach((r, i) => { out[r] = tex[i]; });
  return out;
}
function slotTex(t, size) { if (!t) return null; const c = t.clone(); c.repeat.set(1 / size, 1 / size); c.needsUpdate = true; return c; }
async function setSlot(key, id, tint) {
  const s = SLOT[key]; s.id = id; if (tint) s.tint = tint;
  const mp = await libMaps(id);
  if (s.id !== id) return;
  const mat = M[key];
  ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(k => { if (mat[k]) mat[k].dispose(); });
  mat.map = slotTex(mp.color, mp.size); mat.normalMap = slotTex(mp.normal, mp.size); mat.roughnessMap = slotTex(mp.roughness, mp.size); mat.metalnessMap = slotTex(mp.metalness, mp.size);
  mat.normalScale.set(1, 1); mat.roughness = 1;
  mat.metalness = mp.metal ? 1 : 0;
  if (mp.local) { mat.color.set(0xdfe2e5); mat.color.multiply(new THREE.Color(s.tint)); mat.normalScale.set(0.4, 0.4); }
  else mat.color.set(s.tint);
  if (grainMeshes[key]) grainMeshes[key].forEach(me => { me.geometry.setAttribute('uv', mp.grain === 'v' ? me.userData.uvB : me.userData.uvA); });
  mat.needsUpdate = true;
  const th = $('th-' + key); if (th) th.src = id.startsWith('local:') ? 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' : LIB + ITEM[id].path.replace(/^library\//, '') + 'preview.jpg';
  if (th) th.style.background = id === 'local:brushed' ? 'linear-gradient(135deg,#9a9ea3,#e8eaec 50%,#8d9196)' : '';
  saveState(); touch();
}

/* ---------- time of day ---------- */
const TOD = {
  morning: { sky: 'morning', bg: 0.8, env: 0.7, sat: 0.8, bsat: 1, sun: 2.6, sunCol: 0xffd6ae, sunPos: [10, 5.5, 7], exposure: -0.3, lights: false, bloom: 0.12, fog: 0xc0b8ad, photoExp: 0.45 },
  day: { sky: 'day', bg: 1.0, env: 1.0, sat: 1, bsat: 1, sun: 3.4, sunCol: 0xfff2e0, sunPos: [-4.5, 12, 6], exposure: -0.2, lights: false, bloom: 0.06, fog: 0xa9b4a2, photoExp: 0.5 },
  evening: { sky: 'evening', bg: 0.55, env: 0.2, sat: 0.35, bsat: 0.85, sun: 0.12, sunCol: 0x9fb2ff, sunPos: [-7, 10, 9], exposure: 0.25, lights: true, bloom: 0.3, fog: 0x1c1a24, photoExp: 0.15 },
  night: { sky: 'night', bg: 0.05, env: 0.04, sat: 0.3, bsat: 0.6, sun: 0.02, sunCol: 0x8fa0d0, sunPos: [-7, 10, 9], exposure: 0.1, lights: true, bloom: 0.4, fog: 0x08080c, photoExp: 0.1 }
};
const LIGHT = { down: 12, wash: 8, up: 3, glow: 0.35, led: 5, lens: 14 };   // candela-style intensities (physical units)
let tod = 'evening', lightsOn = true;
const skyTex = {};
async function skyFor(key) {
  const T = TOD[key], id = CFG.skies[T.sky].id, k = id + '|' + T.sat + '|' + T.bsat;
  if (!skyTex[k]) { const raw = await loadHDR(id); skyTex[k] = { bg: hdrTex(raw, T.bsat), env: hdrTex(raw, T.sat) }; }
  return skyTex[k];
}
async function applyTime() {
  const T = TOD[tod], S = await skyFor(tod);
  scene.environment = S.env; scene.environmentIntensity = T.env;
  scene.background = cam === ortho ? new THREE.Color(T.sky === 'day' || T.sky === 'morning' ? 0xc9d5e1 : 0x07090e) : S.bg;
  scene.backgroundIntensity = T.bg;
  sun.intensity = T.sun; sun.color.set(T.sunCol); sun.position.set(...T.sunPos);
  hemi.intensity = 0;
  const on = lightsOn;
  Ldown.forEach(l => { l.intensity = on ? LIGHT.down : 0; });
  Lwash.forEach(l => { l.intensity = on ? LIGHT.wash : 0; });
  Lup.forEach(l => { l.intensity = on ? LIGHT.up : 0; });
  Lglow.forEach(l => { l.intensity = on ? LIGHT.glow : 0; });
  LED.emissiveIntensity = on ? LIGHT.led : 0; LENS.emissiveIntensity = on ? LIGHT.lens : 0;
  renderer.toneMappingExposure = Math.pow(2, T.exposure);
  if (bloomPass) bloomPass.strength = T.bloom;
  scene.fog = new THREE.Fog(T.fog, 18, 95);
  ['morning', 'day', 'evening', 'night'].forEach(k => press('tod-' + k, k === tod));
  press('tLights', lightsOn);
  touch();
}
function setTod(k, keepLights) { tod = k; if (!keepLights) lightsOn = TOD[k].lights; saveState(); return applyTime(); }

/* ---------- live post-processing ---------- */
let HQ = !MOBILE && CAN_POST, USE_POST = false, composer = null, renderPass = null, bloomPass = null;
function buildPost() {
  if (!CAN_POST) return false;
  try {
    const w = stage.clientWidth || 800, h = stage.clientHeight || 500;
    const rt = new THREE.WebGLRenderTarget(w * DPR, h * DPR, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(w * DPR, h * DPR);
    renderPass = new RenderPass(scene, cam); composer.addPass(renderPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.45, 0.85); composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return true;
  } catch (e) { console.warn('post-processing unavailable', e); composer = null; return false; }
}
function setGraphics(hq) {
  HQ = hq && CAN_POST; USE_POST = HQ && (composer || buildPost());
  renderer.setPixelRatio(USE_POST ? DPR : Math.min(DPR, 1.5));
  const SM = HQ ? (MOBILE ? 2048 : 4096) : 1024; sun.shadow.mapSize.set(SM, SM); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  press('gHQ', HQ); press('gStd', !HQ);
  resize(); applyTime();
}

/* ---------- views and UI ---------- */
const CENTER = [2.5, 1.6, 3.0];
const VIEWS = [
  { n: 'Overview', type: 'persp', pos: [-6.2, 4.6, 11.4], tg: [2.5, 1.0, 2.9], cover: true },
  { n: 'Centre', type: 'fp', cover: true },
  { n: 'Front', type: 'ortho', pos: [2.5, 1.7, 40], tg: [2.5, 1.7, 3], fit: [7.4, 3.9], cover: true },
  { n: 'Back', type: 'ortho', pos: [2.5, 1.7, -40], tg: [2.5, 1.7, 3], fit: [7.4, 3.9], cover: true },
  { n: 'Left', type: 'ortho', pos: [-40, 1.7, 3], tg: [2.5, 1.7, 3], fit: [7.2, 3.9], cover: true },
  { n: 'Right', type: 'ortho', pos: [45, 1.7, 3], tg: [2.5, 1.7, 3], fit: [7.2, 3.9], cover: true },
  { n: 'Top (plan)', type: 'ortho', pos: [2.5, 40, 3.2], tg: [2.5, 0, 3], fit: [7.4, 7.4], cover: false },
  { n: 'Iso', type: 'persp', pos: [9.4, 6.2, 10.6], tg: [2.5, 1.0, 2.9], cover: true },
  { n: 'Kitchen', type: 'persp', pos: [2.5, 1.55, 9.6], tg: [2.5, 1.05, 2.2], cover: true },
  { n: 'Island', type: 'persp', pos: [4.1, 1.5, 7.5], tg: [2.6, 0.85, 3.7], cover: true }
];
const LABELS = [
  ['5.00 m', 2.5, 0.03, 6.2], ['6.00 m', 5.35, 0.03, 3.0],
  ['Back run 4.40 × 0.65 m', 2.5, 1.0, 0.4], ['Island 2.80 × 1.20 m', 2.7, 0.98, 3.9],
  ['Counter 0.92 m', 4.55, 0.5, 0.7], ['Clear height 2.49 – 2.78 m', 5.0, 2.6, 4.6], ['Fall 5% to front', 2.5, 3.05, 5.6]
];
const chipsEl = $('chips'), chipEls = []; let activeView = 0;
const fp = { on: false, yaw: 0, pitch: -0.03, fov: 65 };
let tw = null;
const labelHost = $('labels');
const labels = LABELS.map(d => { const el = document.createElement('div'); el.className = 'dim'; el.textContent = d[0]; el.style.display = 'none'; labelHost.appendChild(el); return { el, p: new THREE.Vector3(d[1], d[2], d[3]), t: d[0] }; });
let showDims = false;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => e.classList.remove('show'), 2600); }
function press(id, on) { const e = $(id); if (e) e.setAttribute('aria-pressed', on ? 'true' : 'false'); }
const isOn = id => $(id).getAttribute('aria-pressed') === 'true';
function setCover(on) { cover.visible = on; press('tCover', on); }
function setCam(c) {
  cam = c; controls.object = c; controls.enabled = true; if (renderPass) renderPass.camera = c;
  $('bProj').textContent = (c === ortho) ? 'Orthographic' : 'Perspective';
  $('hint').textContent = 'drag to orbit · wheel to zoom · right-drag to pan';
  applyTime();
}
function fitOrtho(w, h) { const a = ortho.right / ortho.top; return Math.min(ORTHO_HALF / (h / 2), ORTHO_HALF * a / (w / 2)) * 0.94; }
function applyFP() {
  persp.position.set(...CENTER); persp.fov = fp.fov; persp.updateProjectionMatrix();
  const cp = Math.cos(fp.pitch);
  persp.lookAt(CENTER[0] + Math.sin(fp.yaw) * cp, CENTER[1] + Math.sin(fp.pitch), CENTER[2] - Math.cos(fp.yaw) * cp);
}
function enterFP() { fp.on = true; setCam(persp); controls.enabled = false; tw = null; applyFP(); $('hint').textContent = 'drag to look around · wheel to zoom'; }
function leaveFP() {
  if (!fp.on) return; fp.on = false; persp.fov = 45; persp.updateProjectionMatrix();
  const d = new THREE.Vector3(); persp.getWorldDirection(d); controls.target.copy(persp.position).add(d.multiplyScalar(3)); controls.enabled = true;
}
function goTo(i, instant) {
  const v = VIEWS[i]; activeView = i;
  chipEls.forEach((c, j) => c.classList.toggle('on', j === i));
  setCover(v.cover); stopAuto();
  if (v.type === 'fp') { enterFP(); touch(); return; }
  leaveFP();
  const tgtCam = v.type === 'ortho' ? ortho : persp;
  const p1 = new THREE.Vector3().fromArray(v.pos), t1 = new THREE.Vector3().fromArray(v.tg);
  const z1 = v.type === 'ortho' ? fitOrtho(v.fit[0], v.fit[1]) : 1;
  if (tgtCam !== cam || instant) {
    setCam(tgtCam); cam.position.copy(p1); controls.target.copy(t1);
    if (tgtCam === ortho) { ortho.zoom = z1; ortho.updateProjectionMatrix(); }
    controls.update(); tw = null;
  } else tw = { p0: cam.position.clone(), t0: controls.target.clone(), z0: cam.zoom, p1, t1, z1, s: performance.now(), d: 850 };
  touch();
}
VIEWS.forEach((v, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'b'; b.textContent = v.n; b.addEventListener('click', () => goTo(i, false)); chipsEl.appendChild(b); chipEls.push(b); });

$('bProj').addEventListener('click', () => {
  if (fp.on) { toast('Leave the centre view first'); return; }
  const t = controls.target.clone(), off = cam.position.clone().sub(t), tanH = Math.tan(persp.fov * Math.PI / 360);
  if (cam === persp) {
    const half = off.length() * tanH; ortho.position.copy(t).add(off.clone().setLength(60));
    ortho.zoom = Math.max(0.25, Math.min(9, ORTHO_HALF / half)); ortho.updateProjectionMatrix(); setCam(ortho);
  } else {
    const halfO = ORTHO_HALF / ortho.zoom, dist = Math.max(1, Math.min(24, halfO / tanH));
    persp.position.copy(t).add(off.setLength(dist)); setCam(persp);
  }
  controls.target.copy(t); controls.update();
});

const hold = { z: 0, r: 0 };
function holdBtn(id, key, val) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); hold[key] = val; pauseAuto(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { if (hold[key] === val) { hold[key] = 0; resumeAutoSoon(); } }));
}
holdBtn('bZin', 'z', 1); holdBtn('bZout', 'z', -1); holdBtn('bRl', 'r', -1); holdBtn('bRr', 'r', 1);
function zoomBy(f, dt) {
  const k = Math.pow(1.9, f * dt);
  if (fp.on) { fp.fov = Math.max(28, Math.min(95, fp.fov / k)); applyFP(); }
  else if (cam === ortho) { ortho.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, ortho.zoom * k)); ortho.updateProjectionMatrix(); }
  else { const t = controls.target, o = cam.position.clone().sub(t); const L = Math.max(controls.minDistance, Math.min(controls.maxDistance, o.length() / k)); cam.position.copy(t).add(o.setLength(L)); }
}
function spinBy(rad) {
  if (fp.on) { fp.yaw += rad; applyFP(); }
  else { const o = cam.position.clone().sub(controls.target); o.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rad); cam.position.copy(controls.target).add(o); }
}
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { if (!fp.on) return; drag = { x: e.clientX, y: e.clientY }; pauseAuto(); renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', e => { if (!fp.on || !drag) return; const k = 0.0045 * (fp.fov / 65); fp.yaw -= (e.clientX - drag.x) * k; fp.pitch = Math.max(-1.1, Math.min(1.1, fp.pitch + (e.clientY - drag.y) * k)); drag.x = e.clientX; drag.y = e.clientY; applyFP(); });
['pointerup', 'pointercancel'].forEach(ev => renderer.domElement.addEventListener(ev, () => { if (drag) { drag = null; resumeAutoSoon(); } }));
renderer.domElement.addEventListener('wheel', e => { if (!fp.on) return; e.preventDefault(); fp.fov = Math.max(28, Math.min(95, fp.fov + e.deltaY * 0.04)); applyFP(); }, { passive: false });
controls.addEventListener('start', pauseAuto); controls.addEventListener('end', resumeAutoSoon);
controls.addEventListener('change', () => touch());

const auto = { on: false, paused: false, dir: 1, timer: null };
const degPerSec = () => 6 * (+$('autoSpeed').value);
function setAutoUI() {
  press('bAuto', auto.on); $('autoTxt').textContent = auto.on ? 'Pause' : 'Auto play';
  $('icoPlay').innerHTML = auto.on ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path d="M7 4l13 8-13 8z"/>';
}
function startAuto() {
  if (!fp.on && $('autoMode').value === 'center') goTo(VIEWS.findIndex(v => v.type === 'fp'), true);
  if ($('autoMode').value === 'orbit' && fp.on) goTo(0, true);
  auto.on = true; auto.paused = false; setAutoUI();
}
function stopAuto() { auto.on = false; auto.paused = false; clearTimeout(auto.timer); setAutoUI(); }
function pauseAuto() { if (!auto.on) return; auto.paused = true; clearTimeout(auto.timer); }
function resumeAutoSoon() { if (!auto.on) return; clearTimeout(auto.timer); auto.timer = setTimeout(() => { auto.paused = false; }, 2500); }
$('bAuto').addEventListener('click', () => { if (auto.on) stopAuto(); else startAuto(); });
$('bDir').addEventListener('click', () => { auto.dir *= -1; $('bDir').style.transform = auto.dir < 0 ? 'scaleX(-1)' : 'none'; });
$('autoMode').addEventListener('change', () => { if (auto.on) { stopAuto(); startAuto(); } });

function toggle(id, fn) { $(id).addEventListener('click', () => { const on = !isOn(id); press(id, on); fn(on); touch(); }); }
toggle('tCover', on => { cover.visible = on; });
toggle('tXray', on => { pvcMat.transparent = on; pvcMat.opacity = on ? 0.28 : 1; pvcMat.depthWrite = !on; pvcMat.needsUpdate = true; });
toggle('tLights', on => { lightsOn = on; applyTime(); });
toggle('tDims', on => { showDims = on; labels.forEach(l => { l.el.style.display = on ? 'block' : 'none'; }); });
['morning', 'day', 'evening', 'night'].forEach(k => $('tod-' + k).addEventListener('click', () => setTod(k)));
$('gHQ').addEventListener('click', () => setGraphics(true));
$('gStd').addEventListener('click', () => setGraphics(false));
if (!CAN_POST) { $('gHQ').disabled = true; $('gHQ').title = 'Not supported on this device'; }

/* PVC colour */
const PVC = CFG.pvc;
const pvcSel = $('pvcSel');
PVC.forEach((p, i) => { const o = document.createElement('option'); o.value = p.color; o.textContent = p.name; pvcSel.appendChild(o); });
{ const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'Custom colour…'; pvcSel.appendChild(o); }
function setPvc(c) {
  pvcMat.color.set(c); $('pvcChip').style.background = c; $('pvcCustom').value = c;
  const m = PVC.find(p => p.color.toLowerCase() === c.toLowerCase()); pvcSel.value = m ? m.color : 'custom'; saveState(); touch();
}
pvcSel.addEventListener('change', () => { if (pvcSel.value === 'custom') $('pvcCustom').click(); else setPvc(pvcSel.value); });
$('pvcCustom').addEventListener('input', e => setPvc(e.target.value));
function pvcName() { const c = '#' + pvcMat.color.getHexString(); const m = PVC.find(p => p.color.toLowerCase() === c); return (m ? m.name : 'Custom') + ' (' + c.toUpperCase() + ')'; }

/* material dropdowns, grouped by library category */
const CAT_NAMES = { tiles: 'Tiles', stone: 'Stone', brick: 'Brick & stone walls', 'plaster-concrete': 'Plaster & concrete', wood: 'Wood', metal: 'Metal', paving: 'Paving', ground: 'Ground', fabric: 'Fabric' };
const rows = $('matRows');
CFG.slots.forEach(sd => {
  SLOT[sd.key] = { id: sd.default, tint: sd.tint || '#ffffff', def: sd };
  const r = document.createElement('div'); r.className = 'mrow';
  r.innerHTML = '<label for="sel-' + sd.key + '">' + sd.label + '</label><img id="th-' + sd.key + '" alt=""><select id="sel-' + sd.key + '"></select><input type="color" id="tint-' + sd.key + '" aria-label="' + sd.label + ' tint" title="Tint">';
  rows.appendChild(r);
  const sel = r.querySelector('select');
  if (sd.extra) sd.extra.forEach(x => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; sel.appendChild(o); });
  sd.cats.forEach(c => {
    const items = CATALOG.filter(i => i.kind === 'surface' && i.category === c); if (!items.length) return;
    const g = document.createElement('optgroup'); g.label = CAT_NAMES[c] || c;
    items.forEach(i => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.name; g.appendChild(o); });
    sel.appendChild(g);
  });
  sel.addEventListener('change', () => setSlot(sd.key, sel.value));
  r.querySelector('input').addEventListener('input', e => { SLOT[sd.key].tint = e.target.value; setSlot(sd.key, SLOT[sd.key].id); });
});

/* remembered choices (per viewer) */
function saveState() { if (!stateReady) return; store.set('state', { tod, lightsOn, pvc: '#' + pvcMat.color.getHexString(), slots: Object.fromEntries(Object.entries(SLOT).map(([k, s]) => [k, { id: s.id, tint: s.tint }])) }); }
let stateReady = false;

/* ---------- capture helpers (logo, caption) ---------- */
const logoImg = new Image(); logoImg.src = $('logo').src;
function stamp() { const d = new Date(), p = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function renderFrame() {
  if (!fp.on) controls.update();
  if (USE_POST) composer.render(); else renderer.render(scene, cam);
}
function sizeAll(W, H, pr) {
  renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
  if (composer) { composer.setPixelRatio(1); composer.setSize(Math.round(W * pr), Math.round(H * pr)); }
}
function outSize(target) {
  const W0 = stage.clientWidth, H0 = stage.clientHeight, asp = W0 / H0;
  let W = asp >= 1 ? target : Math.round(target * asp), H = asp >= 1 ? Math.round(target / asp) : target;
  const mx = Math.min(renderer.capabilities.maxTextureSize || 4096, 8192), budget = MOBILE ? 6e6 : 16e6;
  const k = Math.min(1, mx / Math.max(W, H), Math.sqrt(budget / (W * H)));
  if (k < 1) { W = Math.floor(W * k); H = Math.floor(H * k); }
  return { W, H, W0, H0 };
}
function matSummary() {
  return [['PVC cover', pvcName()]].concat(CFG.slots.map(sd => [sd.label, itemName(SLOT[sd.key].id) + (SLOT[sd.key].tint.toLowerCase() !== (sd.tint || '#ffffff').toLowerCase() ? ' (tinted ' + SLOT[sd.key].tint.toUpperCase() + ')' : '')]));
}
function decorate(src, W, H, o) {
  const out = document.createElement('canvas'); out.width = W; out.height = H; const g = out.getContext('2d');
  g.drawImage(src, 0, 0, W, H);
  if (showDims) {
    g.font = '500 ' + Math.round(H * 0.017) + 'px "IBM Plex Mono",monospace'; g.textBaseline = 'middle';
    labels.forEach(l => {
      const v = l.p.clone().project(cam); if (v.z > 1 || v.z < -1) return;
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H, pw = g.measureText(l.t).width + H * 0.02, ph = H * 0.03;
      g.fillStyle = 'rgba(0,0,0,.78)'; g.fillRect(x - pw / 2, y - ph / 2, pw, ph); g.strokeStyle = '#3a3a3a'; g.strokeRect(x - pw / 2, y - ph / 2, pw, ph);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(l.t, x, y + 1);
    });
  }
  if (o.logo !== false) {
    const gt = g.createLinearGradient(0, 0, 0, H * 0.2); gt.addColorStop(0, 'rgba(0,0,0,.55)'); gt.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gt; g.fillRect(0, 0, W, H * 0.2);
    const lh = H * 0.075, lw = logoImg.naturalWidth ? lh * logoImg.naturalWidth / logoImg.naturalHeight : lh * 1.9, m = H * 0.035;
    if (logoImg.naturalWidth) g.drawImage(logoImg, m, m, lw, lh);
  }
  if (o.caption) {
    const m = H * 0.035, gb = g.createLinearGradient(0, H * 0.84, 0, H); gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(0,0,0,.65)'); g.fillStyle = gb; g.fillRect(0, H * 0.84, W, H * 0.16);
    const narrow = W < H * 1.3, fs = Math.round(narrow ? W * 0.026 : H * 0.019);
    const f1 = 'OUTDOOR KITCHEN & ISLAND · ' + VIEWS[activeView].n.toUpperCase();
    const f2 = itemName(SLOT.frame.id) + ' frame · PVC ' + pvcName().replace(/ \(.*/, '') + ' · ' + itemName(SLOT.top.id) + ' tops · ' + stamp();
    const f3 = 'Concept visual, dimensions estimated';
    g.font = '500 ' + fs + 'px "IBM Plex Mono",monospace'; g.fillStyle = 'rgba(255,255,255,.9)'; g.textBaseline = 'alphabetic';
    if (narrow) { g.textAlign = 'left'; g.fillText(f1, m, H - m - fs * 2.6); g.fillText(f2, m, H - m - fs * 1.3); g.font = '400 ' + Math.round(fs * 0.85) + 'px "IBM Plex Mono",monospace'; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(f3, m, H - m); }
    else { g.textAlign = 'left'; g.fillText(f1, m, H - m); g.textAlign = 'right'; g.fillText(f2, W - m, H - m); g.font = '400 ' + Math.round(fs * 0.8) + 'px "IBM Plex Mono",monospace'; g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(f3, W - m, H - m - fs * 1.5); }
  }
  return out;
}
/* quick raster capture of the live view */
function captureRaster(target, o) {
  const { W, H, W0, H0 } = outSize(target), pr0 = renderer.getPixelRatio();
  sizeAll(W, H, 1); renderFrame();
  const out = decorate(renderer.domElement, W, H, o);
  sizeAll(W0, H0, pr0); touch();
  return { canvas: out, W, H };
}
function download(canvas, name) {
  return new Promise(res => canvas.toBlob(b => {
    const a = document.createElement('a'), url = URL.createObjectURL(b);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); res();
  }, 'image/png'));
}
const fileBase = () => 'Heights_Island_' + VIEWS[activeView].n.replace(/[^A-Za-z0-9]+/g, '') + '_' + stamp();
function quickPng() { const r = captureRaster(+$('capScale').value, { logo: true, caption: $('capBrand').checked }); download(r.canvas, fileBase() + '.png').then(() => toast('Saved ' + r.W + ' × ' + r.H + ' PNG')); }

/* ---------- photo-real render (progressive path tracing) ---------- */
let busy = false, PTmod = null;
const ph = { el: $('photo'), bar: $('phBar'), txt: $('phTxt'), eta: $('phEta'), prev: $('phPrev'), cancel: false, finish: false };
$('phCancel').addEventListener('click', () => { ph.cancel = true; });
$('phStop').addEventListener('click', () => { ph.finish = true; });
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
async function renderPhoto(opts) {
  if (busy) return null; busy = true; ph.cancel = ph.finish = false;
  const target = opts.size || +$('capScale').value, spp = Math.max(8, Math.round((opts.samples || +$('ptQuality').value) * (MOBILE ? 0.5 : 1)));
  ph.el.hidden = false; ph.bar.style.width = '0%'; ph.txt.textContent = 'Preparing the scene…'; ph.eta.textContent = '';
  stopAuto(); controls.enabled = false;
  const { W, H, W0, H0 } = outSize(MOBILE ? Math.min(target, 1600) : target), pr0 = renderer.getPixelRatio();
  ph.prev.width = Math.min(960, W); ph.prev.height = Math.round(ph.prev.width * H / W);
  const pg = ph.prev.getContext('2d'); pg.fillStyle = '#000'; pg.fillRect(0, 0, ph.prev.width, ph.prev.height);
  let pt = null, result = null;
  const hidden = decals.filter(d => d.visible); hidden.forEach(d => { d.visible = false; });
  const fog = scene.fog; scene.fog = null;
  const exp0 = renderer.toneMappingExposure; renderer.toneMappingExposure = exp0 * Math.pow(2, TOD[tod].photoExp || 0);  // covered areas read darker in a real light simulation
  const em = [LED.emissiveIntensity, LENS.emissiveIntensity]; LED.emissiveIntensity *= 0.4; LENS.emissiveIntensity *= 0.35;
  try {
    await nextFrame();
    if (!PTmod) PTmod = await import('three-gpu-pathtracer');
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    pt = new PTmod.WebGLPathTracer(renderer);
    pt.renderDelay = 0; pt.fadeDuration = 0; pt.minSamples = 0; pt.dynamicLowRes = false; pt.rasterizeScene = false;
    pt.renderScale = 1; pt.bounces = 6; pt.transmissiveBounces = 4; pt.filterGlossyFactor = 0.5;
    pt.tiles.set(MOBILE ? 3 : 2, MOBILE ? 3 : 2);
    pt.textureSize.set(1024, 1024);
    ph.txt.textContent = 'Building the light model…'; await nextFrame(); await nextFrame();
    pt.setScene(scene, cam);
    const t0 = performance.now(); let lastPrev = 0;
    while (pt.samples < spp && !ph.cancel && !ph.finish) {
      pt.renderSample();
      const now = performance.now();
      if (now - lastPrev > 400 || pt.samples >= spp) {
        lastPrev = now; pg.drawImage(renderer.domElement, 0, 0, ph.prev.width, ph.prev.height);
        const done = pt.samples / spp, el = (now - t0) / 1000, rem = done > 0.02 ? el * (1 - done) / done : 0;
        ph.bar.style.width = (done * 100).toFixed(1) + '%';
        ph.txt.textContent = 'Rendering photo… ' + Math.floor(done * 100) + '% · ' + Math.floor(pt.samples) + ' / ' + spp + ' passes';
        ph.eta.textContent = done > 0.02 ? 'about ' + (rem > 90 ? Math.round(rem / 60) + ' min' : Math.max(1, Math.round(rem)) + ' s') + ' left' : '';
      }
      await nextFrame();
    }
    if (!ph.cancel) {
      ph.txt.textContent = 'Cleaning up the image…'; ph.eta.textContent = ''; await nextFrame();
      const color = grab(W, H, () => { const q = new FullScreenQuad(pt._quad.material); pt._quad.material.map = pt.target.texture; renderer.setRenderTarget(null); q.render(renderer); });
      let clean = null;
      try { clean = await aiDenoise(color, W, H); } catch (e) { console.warn('AI denoiser unavailable', e); }
      if (!clean) {   // fallback: edge-aware smoothing on the GPU
        const dn = new PTmod.DenoiseMaterial({ map: pt.target.texture, sigma: 2.2, kSigma: 1.0, threshold: pt.samples < 200 ? 0.08 : 0.04 });
        clean = grab(W, H, () => { const q = new FullScreenQuad(dn); renderer.setRenderTarget(null); q.render(renderer); q.dispose(); });
        dn.dispose();
      }
      result = decorate(clean, W, H, opts);
      ph.bar.style.width = '100%'; ph.txt.textContent = 'Done · ' + Math.floor(pt.samples) + ' passes';
    }
  } catch (e) {
    console.error(e); toast('The photo renderer is not supported on this device. Saving the live view instead.');
    renderer.setPixelRatio(pr0); sizeAll(W0, H0, pr0);
    result = captureRaster(target, opts).canvas;
  } finally {
    if (pt) pt.dispose();
    hidden.forEach(d => { d.visible = true; }); scene.fog = fog; LED.emissiveIntensity = em[0]; LENS.emissiveIntensity = em[1]; renderer.toneMappingExposure = exp0;
    sizeAll(W0, H0, pr0); controls.enabled = !fp.on; busy = false; ph.el.hidden = true; touch();
  }
  return result ? { canvas: result, W: result.width, H: result.height } : null;
}

/* draw something with the renderer and copy the pixels into a 2D canvas (same task, so the buffer is still valid) */
function grab(W, H, draw) {
  draw(); const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(renderer.domElement, 0, 0, W, H); return c;
}
/* albedo and normal guide images for the AI denoiser: same camera, flat colours / surface directions, no lighting */
const NORMAL_VS = 'varying vec3 vN; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const NORMAL_FS = 'uniform sampler2D map; uniform float useMap; uniform float alphaTest; varying vec3 vN; varying vec2 vUv; void main(){ if (useMap > 0.5 && texture2D(map, vUv).a < alphaTest) discard; vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }';
function auxPass(kind, W, H) {
  const swaps = [], made = new Map();
  scene.traverseVisible(o => {
    if (!o.isMesh || decals.includes(o)) return;
    const m = o.material; let r = made.get(m);
    if (!r) {
      if (kind === 'albedo') {
        r = new THREE.MeshBasicMaterial({ color: m.emissive && m.emissiveIntensity > 0 && m.color.getHex() === 0 ? m.emissive : m.color, map: m.map || null, alphaTest: m.alphaTest, side: m.side, vertexColors: m.vertexColors, transparent: false, toneMapped: false });
      } else {
        r = new THREE.ShaderMaterial({ vertexShader: NORMAL_VS, fragmentShader: NORMAL_FS, side: m.side, uniforms: { map: { value: m.map || null }, useMap: { value: m.map && m.alphaTest > 0 ? 1 : 0 }, alphaTest: { value: m.alphaTest || 0 } } });
      }
      made.set(m, r);
    }
    swaps.push([o, m]); o.material = r;
  });
  const bg = scene.background, tm = renderer.toneMapping, sh = renderer.shadowMap.enabled;
  if (kind === 'normal') scene.background = new THREE.Color(0.5, 0.5, 0.5);
  renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false;
  const c = grab(W, H, () => { renderer.setRenderTarget(null); renderer.render(scene, cam); });
  swaps.forEach(([o, m]) => { o.material = m; }); made.forEach(r => r.dispose());
  scene.background = bg; renderer.toneMapping = tm; renderer.shadowMap.enabled = sh;
  return c;
}
let unetP = null;
async function aiDenoise(colorCanvas, W, H) {
  if (!navigator.gpu) return null;
  const { initUNetFromURL } = await import('oidn-web');
  if (!unetP) unetP = initUNetFromURL('assets/oidn/rt_ldr_alb_nrm.tza', undefined, { aux: true });
  const unet = await unetP;
  const albedo = auxPass('albedo', W, H), normal = auxPass('normal', W, H);
  const data = c => c.getContext('2d').getImageData(0, 0, W, H);
  const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
  og.drawImage(colorCanvas, 0, 0);
  return await new Promise((res, rej) => {
    let n = 0;
    unet.tileExecute({
      color: data(colorCanvas), albedo: data(albedo), normal: data(normal),
      progress(_, tileData, tile) { og.putImageData(tileData, tile.x, tile.y); n++; ph.txt.textContent = 'Cleaning up the image… ' + n; },
      done() { res(out); },
      error(e) { rej(e); }
    });
  });
}
async function photoPng() {
  const r = await renderPhoto({ logo: true, caption: $('capBrand').checked });
  if (r) { await download(r.canvas, fileBase() + '_photo.png'); toast('Saved ' + r.W + ' × ' + r.H + ' photo'); }
}

/* ---------- PDF summary: photo, materials, dimensions and general notes on A4 ---------- */
async function exportPdf() {
  if (!window.jspdf) { toast('The PDF tool did not load.'); return; }
  const cap = await renderPhoto({ logo: false, caption: false, size: MOBILE ? 1600 : 2400 });
  if (!cap) return;
  try {
    const img = cap.canvas.toDataURL('image/jpeg', 0.92);
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' }), PW = 210, PH = 297, Mg = 14; let y;
    const lc = document.createElement('canvas'); lc.width = logoImg.naturalWidth || 380; lc.height = logoImg.naturalHeight || 200; lc.getContext('2d').drawImage(logoImg, 0, 0, lc.width, lc.height);
    const logoURL = lc.toDataURL('image/png'), lh = 13, lw = lh * lc.width / lc.height;
    const header = () => {
      doc.setFillColor(0, 0, 0); doc.rect(0, 0, PW, 26, 'F'); doc.addImage(logoURL, 'PNG', Mg, 6.5, lw, lh);
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('OUTDOOR KITCHEN & ISLAND', PW - Mg, 12.5, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(190, 190, 190); doc.text('Concept visual  |  ' + stamp(), PW - Mg, 18, { align: 'right' });
    };
    const h2 = t => { if (y > PH - 40) { doc.addPage(); header(); y = 36; } doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(t.toUpperCase(), Mg, y); doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(Mg, y + 1.8, PW - Mg, y + 1.8); y += 8; };
    const rowsOut = (list, colW) => list.forEach(r => {
      const lines = doc.splitTextToSize(r[1], PW - 2 * Mg - colW); if (y + lines.length * 4.6 > PH - 18) { doc.addPage(); header(); y = 36; }
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0); doc.text(r[0], Mg, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50); doc.text(lines, Mg + colW, y);
      y += lines.length * 4.6 + 1.6; doc.setDrawColor(220); doc.setLineWidth(0.15); doc.line(Mg, y - 3.4, PW - Mg, y - 3.4);
    });
    header(); y = 36;
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('Outdoor Kitchen & Island', Mg, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(95, 95, 95);
    doc.text('View: ' + VIEWS[activeView].n + '  |  ' + tod[0].toUpperCase() + tod.slice(1) + (lightsOn ? ', lights on' : '') + '  |  Heights Contracting', Mg, y); y += 6;
    const bw = PW - 2 * Mg, bh = 128, ar = cap.W / cap.H; let iw = bw, ih = bw / ar; if (ih > bh) { ih = bh; iw = bh * ar; }
    doc.setFillColor(8, 8, 8); doc.rect(Mg, y, bw, ih, 'F'); doc.addImage(img, 'JPEG', Mg + (bw - iw) / 2, y, iw, ih); y += ih + 9;
    h2('Selected materials'); doc.setFontSize(9); rowsOut(matSummary(), 42); y += 4;
    h2('Estimated dimensions'); doc.setFontSize(9);
    rowsOut([].slice.call(document.querySelectorAll('.tbl table tr')).map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim().replace(/m²/g, 'sq m')]), 42); y += 5;
    h2('General notes'); doc.setFontSize(9);
    [].slice.call(document.querySelectorAll('#notesList li')).forEach((li, i) => {
      const lines = doc.splitTextToSize(li.textContent.trim(), PW - 2 * Mg - 8); if (y + lines.length * 4.6 > PH - 18) { doc.addPage(); header(); y = 36; }
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0); doc.text((i + 1) + '.', Mg, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50); doc.text(lines, Mg + 8, y); y += lines.length * 4.6 + 2.4;
    });
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(Mg, PH - 12, PW - Mg, PH - 12); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120); doc.text('Heights Contracting', Mg, PH - 7.5); doc.text('Page ' + p + ' of ' + n, PW - Mg, PH - 7.5, { align: 'right' }); }
    doc.save('Heights_Outdoor_Kitchen_' + VIEWS[activeView].n.replace(/[^A-Za-z0-9]+/g, '') + '_' + stamp() + '.pdf');
    toast('PDF saved');
  } catch (e) { console.error(e); toast('Could not create the PDF'); }
}
$('bSnap').addEventListener('click', photoPng); $('bPhoto').addEventListener('click', photoPng);
$('bPhotoPdf').addEventListener('click', exportPdf); $('bPdf').addEventListener('click', exportPdf);
$('bSnap2').addEventListener('click', quickPng);

/* ---------- loop ---------- */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h || busy) return;
  sizeAll(w, h, renderer.getPixelRatio()); const a = w / h;
  persp.aspect = a; persp.updateProjectionMatrix();
  Object.assign(ortho, { left: -ORTHO_HALF * a, right: ORTHO_HALF * a, top: ORTHO_HALF, bottom: -ORTHO_HALF }); ortho.updateProjectionMatrix();
  touch();
}
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);
function updateLabels() {
  const w = stage.clientWidth, h = stage.clientHeight;
  labels.forEach(l => {
    const v = l.p.clone().project(cam);
    if (v.z > 1 || v.z < -1) { l.el.style.visibility = 'hidden'; return; }
    l.el.style.visibility = 'visible'; l.el.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w) + 'px,' + ((-v.y * 0.5 + 0.5) * h) + 'px) translate(-50%,-50%)';
  });
}
/* render on demand: only when something changed (saves battery; damping/tweens keep it awake) */
let dirty = 3, last = performance.now(), first = true;
function touch() { dirty = Math.max(dirty, 2); }
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!busy) {
    if (tw) {
      const k = Math.min(1, (now - tw.s) / tw.d), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cam.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (cam === ortho) { cam.zoom = tw.z0 + (tw.z1 - tw.z0) * e; cam.updateProjectionMatrix(); }
      if (k >= 1) tw = null; dirty = 2;
    }
    if (hold.z) { zoomBy(hold.z, dt); dirty = 2; }
    if (hold.r) { spinBy(hold.r * dt * 1.1); dirty = 2; }
    if (auto.on && !auto.paused) { spinBy(auto.dir * degPerSec() * Math.PI / 180 * dt); dirty = 2; }
    if (!fp.on && controls.update()) dirty = 2;
    if (dirty > 0) { renderFrame(); dirty--; if (showDims) updateLabels(); }
    if (first) { first = false; loader.classList.add('done'); }
  }
  requestAnimationFrame(frame);
}

/* ---------- start ---------- */
const saved = store.get('state') || {};
if (saved.tod && TOD[saved.tod]) tod = saved.tod;
lightsOn = typeof saved.lightsOn === 'boolean' ? saved.lightsOn : TOD[tod].lights;
await Promise.all(CFG.slots.map(sd => {
  const sv = saved.slots && saved.slots[sd.key];
  const id = sv && (ITEM[sv.id] || sv.id.startsWith('local:')) ? sv.id : sd.default;
  const tint = (sv && sv.tint) || sd.tint || '#ffffff';
  $('sel-' + sd.key).value = id; $('tint-' + sd.key).value = tint;
  return setSlot(sd.key, id, tint);
}));
setPvc(saved.pvc || PVC[0].color);
await skyFor(tod);
stateReady = true;
setGraphics(HQ);
resize(); goTo(0, true);
requestAnimationFrame(frame);
window.__hc = { scene, touch, goTo, setTod, setSlot, renderPhoto, exportPdf, quickPng, setGraphics, SLOT, TOD, LIGHT, applyTime, get cam() { return cam; }, setLights(o) { lightsOn = o; applyTime(); } };
