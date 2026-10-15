/**
 * Heights Design – login backend (Google Apps Script web app).
 *
 * Holds the home-page username/password (salted + hashed, never in the website code),
 * issues short-lived signed tokens, and stores the list of project cards.
 *
 * Setup: see admin/apps-script/SETUP.md
 * Deploy as: Web app · Execute as: Me · Who has access: Anyone
 */

var INITIAL_USER = 'fady';
var INITIAL_PASSWORD = 'fady1234';   // only used the very first time; change it from the website
var TOKEN_HOURS = 12;
var MAX_FAILS = 5;                   // failed logins per user before a 10-minute lock
var HASH_ROUNDS = 3000;

var INITIAL_PROJECTS = [
  { title: 'Outdoor Kitchen & Island', description: 'Pergola, island and back run, interactive 3D', url: 'outdoor-kitchen-island/' },
  { title: 'Outdoor Kitchen & Island (beta)', description: 'Next version: photo-real export and material dropdowns', url: 'outdoor-kitchen-island/beta/' }
];

var PROPS = PropertiesService.getScriptProperties();

function doGet() {
  return out_({ ok: true, service: 'heights-design-auth' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    init_();
    switch (req.action) {
      case 'login':              return out_(login_(req));
      case 'projects':           verify_(req.token); return out_({ ok: true, projects: getProjects_(), user: credUser_() });
      case 'saveProjects':       verify_(req.token); saveProjects_(req.projects); return out_({ ok: true, projects: getProjects_() });
      case 'changeCredentials':  return out_(change_(req));
      default:                   return out_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ---------------- credentials ---------------- */
function init_() {
  if (!PROPS.getProperty('secret')) PROPS.setProperty('secret', randomHex_(32));
  if (!PROPS.getProperty('cred')) setCred_(INITIAL_USER, INITIAL_PASSWORD, 1);
  if (!PROPS.getProperty('projects')) PROPS.setProperty('projects', JSON.stringify(INITIAL_PROJECTS));
}

function setCred_(user, password, version) {
  var salt = randomHex_(16);
  PROPS.setProperty('cred', JSON.stringify({ user: user, salt: salt, hash: hash_(password, salt), v: version }));
}

function cred_() { return JSON.parse(PROPS.getProperty('cred')); }
function credUser_() { return cred_().user; }

function hash_(password, salt) {
  var h = Utilities.computeHmacSha256Signature(String(password), salt);
  for (var i = 0; i < HASH_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h, Utilities.newBlob(salt).getBytes());
  return Utilities.base64Encode(h);
}

function checkPassword_(user, password) {
  var c = cred_();
  var cache = CacheService.getScriptCache(), key = 'fails:' + String(user).toLowerCase();
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many attempts. Try again in 10 minutes.');
  var ok = String(user).toLowerCase() === c.user.toLowerCase() && safeEq_(hash_(password, c.salt), c.hash);
  if (!ok) { cache.put(key, String(fails + 1), 600); Utilities.sleep(400); throw new Error('Wrong username or password'); }
  cache.remove(key);
  return c;
}

function login_(req) {
  var c = checkPassword_(req.user || '', req.password || '');
  return { ok: true, token: makeToken_(c), user: c.user, projects: getProjects_() };
}

function change_(req) {
  var c = checkPassword_(req.user || '', req.password || '');
  var nu = String(req.newUser || '').trim(), np = String(req.newPassword || '');
  if (!/^[A-Za-z0-9._@-]{3,40}$/.test(nu)) throw new Error('Username: 3–40 letters, numbers or . _ @ -');
  if (np.length < 8) throw new Error('Password must be at least 8 characters');
  setCred_(nu, np, (c.v || 1) + 1);          // new version: every old token stops working
  return { ok: true, token: makeToken_(cred_()), user: nu };
}

/* ---------------- tokens ---------------- */
function makeToken_(c) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: c.user, v: c.v, exp: Date.now() + TOKEN_HOURS * 3600e3 }));
  return payload + '.' + sign_(payload);
}

function sign_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, PROPS.getProperty('secret')));
}

function verify_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || !safeEq_(sign_(parts[0]), parts[1])) throw new Error('Please log in again');
  var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  var c = cred_();
  if (p.exp < Date.now() || p.v !== c.v) throw new Error('Please log in again');
  return p;
}

/* ---------------- projects ---------------- */
function getProjects_() { return JSON.parse(PROPS.getProperty('projects') || '[]'); }

function saveProjects_(list) {
  if (!Array.isArray(list) || list.length > 200) throw new Error('Invalid project list');
  var clean = list.map(function (p) {
    var url = String(p.url || '').trim();
    if (!/^[A-Za-z0-9._\/-]+\/?$/.test(url) || url.indexOf('..') >= 0) throw new Error('Invalid project link: ' + url);
    return { title: String(p.title || '').slice(0, 80), description: String(p.description || '').slice(0, 160), url: url };
  });
  PROPS.setProperty('projects', JSON.stringify(clean));
}

/* ---------------- helpers ---------------- */
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function randomHex_(n) {
  var s = '';
  while (s.length < n * 2) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n * 2);
}

function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Run this once from the editor if you ever get locked out: resets to fady / fady1234. */
function resetCredentials() {
  setCred_(INITIAL_USER, INITIAL_PASSWORD, (cred_().v || 1) + 1);
}
