// Gearbox — a gear shelf for Immich.
// Sits in front of Immich (like Folio), groups your photos by camera body and lens,
// and finds a product picture for each one (Apotelyt, GSMArena, then Wikipedia / Commons).
//
//   /gearbox          the shelf page (uses your Immich login)
//   /_gearbox/*       its files and API
//   everything else   passed through to Immich unchanged (+ a "Gearbox" sidebar link)
//
// Zero dependencies: Node 20+.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gearForAsset, imageQuery, titleMatches, scoreTitle } from './lib/gear.mjs';
import { createProxy } from './lib/proxy.mjs';
import { createSources, Unavailable } from './lib/sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bool = (v, fallback) => (v === undefined || v === '' ? fallback : !/^(0|false|no|off)$/i.test(v));

const VERSION = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const PORT = Number(process.env.PORT || 2285);
const HOST = process.env.HOST || '0.0.0.0';
const IMMICH_URL = (process.env.IMMICH_URL || 'http://localhost:2283').replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.env.GEARBOX_DATA || path.join(__dirname, 'data'));
const SCAN_TTL_MS = Number(process.env.SCAN_TTL_MINUTES || 30) * 60_000;
const ALBUM_PREFIX = process.env.ALBUM_PREFIX ?? '📷 ';
const INJECT = bool(process.env.GEARBOX_INJECT, true);
const UA = `Gearbox-for-Immich/${VERSION} (self-hosted gear shelf for Immich)`;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COVERS_FILE = path.join(DATA_DIR, 'covers.json');
const COVER_VERSION = 4; // bump to re-look-up every automatic picture after the sources change

const sources = createSources({ dataDir: DATA_DIR, ua: UA });
sources.warm().catch(() => {});

const proxy = createProxy({
  immichUrl: IMMICH_URL,
  inject: INJECT,
  snippet: `<script src="/_gearbox/inject.js?v=${VERSION}" defer></script>`,
});

// ───────────────────────── Immich ─────────────────────────

async function immich(pathname, auth, { method = 'GET', body } = {}) {
  const res = await fetch(`${IMMICH_URL}/api${pathname}`, {
    method,
    headers: {
      ...auth,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw httpError(401, 'Sign in to Immich first.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw httpError(502, `Immich ${method} ${pathname} → ${res.status} ${text}`.slice(0, 400));
  }
  return res.json();
}

// Who is this? Reuse the browser's Immich session cookie (same domain = same login).
const users = new Map();
async function requireUser(req) {
  const token = parseCookies(req.headers.cookie).immich_access_token;
  if (!token) throw httpError(401, 'Sign in to Immich first.');
  const auth = { cookie: `immich_access_token=${token}` };
  const k = createHash('sha256').update(token).digest('hex');
  const hit = users.get(k);
  if (hit && hit.expires > Date.now()) return hit.value;
  const me = await immich('/users/me', auth);
  const value = { id: me.id, name: me.name || me.email, auth };
  users.set(k, { value, expires: Date.now() + 60_000 });
  if (users.size > 500) users.delete(users.keys().next().value);
  return value;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ───────────────────────── Library scan (per user) ─────────────────────────

const scans = new Map();     // userId → { at, total, groups: Map<id, group> }
const scanning = new Map();  // userId → in-flight promise

const gearId = (kind, key) => kind[0] + createHash('sha1').update(key).digest('hex').slice(0, 12);

async function runScan(user) {
  const groups = new Map();
  const lookups = await sources.nameLookups();
  let total = 0;
  let page = 1;
  const add = (g, assetId) => {
    const id = gearId(g.kind, g.key);
    let entry = groups.get(id);
    if (!entry) {
      entry = { id, ...g, count: 0, assets: [], brandVotes: {}, builtin: {} };
      groups.set(id, entry);
    }
    entry.count++;
    entry.assets.push(assetId);
    if (g.bodyBrand) entry.brandVotes[g.bodyBrand] = (entry.brandVotes[g.bodyBrand] || 0) + 1;
    return entry;
  };
  while (page) {
    const { assets } = await immich('/search/metadata', user.auth, {
      method: 'POST',
      body: { page, size: 1000, withExif: true, order: 'desc' },
    });
    for (const a of assets.items) {
      total++;
      const { body, lens, builtin } = gearForAsset(a.exifInfo || {}, lookups);
      const b = add(body, a.id);
      if (lens) add(lens, a.id);
      // Phones, drones, compacts: the lens lives on the camera's card, not as a lens of its own.
      if (builtin) b.builtin[builtin] = (b.builtin[builtin] || 0) + 1;
    }
    page = assets.nextPage ? Number(assets.nextPage) : null;
  }
  // Lenses without a brand in their name borrow the brand of the body they're used on most.
  for (const g of groups.values()) {
    if (g.kind === 'lens' && !g.brand) {
      const best = Object.entries(g.brandVotes).sort((a, b) => b[1] - a[1])[0];
      g.brand = best ? best[0] : '';
    }
    delete g.brandVotes;
    delete g.bodyBrand;
    g.builtin = Object.entries(g.builtin).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }
  const scan = { at: Date.now(), total, groups };
  scans.set(user.id, scan);
  console.log(`[gearbox] ${user.name}: scanned ${total} assets → ${groups.size} gear groups`);
  return scan;
}

async function getScan(user, force = false) {
  const scan = scans.get(user.id);
  if (scan && !force && Date.now() - scan.at < SCAN_TTL_MS) return scan;
  if (!scanning.has(user.id)) scanning.set(user.id, runScan(user).finally(() => scanning.delete(user.id)));
  return scanning.get(user.id);
}

// ───────────────────────── Cover pictures (shared by everyone) ─────────────────────────

let covers = {};
try { covers = JSON.parse(await readFile(COVERS_FILE, 'utf8')); } catch {}

let saveTimer = null;
function saveCovers() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const tmp = COVERS_FILE + '.tmp';
      await writeFile(tmp, JSON.stringify(covers, null, 2));
      await rename(tmp, COVERS_FILE);
    } catch (e) {
      console.error(`[gearbox] could not save ${COVERS_FILE}: ${e.message}`);
    }
  }, 300);
}

const coverKey = (g) => `${g.kind}:${g.key}`;

async function wiki(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  return res.json();
}

const pageUrl = (host, title) => `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const OK_MIME = /^image\/(jpeg|png|webp)$/;

// Wikipedia article by exact title (follows redirects, e.g. "Sony ILCE-7M3" → "Sony α7 III").
async function wikipediaExact(title, q, trust) {
  const j = await wiki('en.wikipedia.org', {
    action: 'query', titles: title, redirects: '1', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '600',
  });
  const p = j.query?.pages?.[0];
  if (!p || p.missing || !p.thumbnail) return null;
  if (!trust && !titleMatches(p.title, q.required)) return null;
  return { url: p.thumbnail.source, page: pageUrl('en.wikipedia.org', p.title), source: 'Wikipedia' };
}

async function wikipediaSearch(q) {
  const j = await wiki('en.wikipedia.org', {
    action: 'query', generator: 'search', gsrsearch: q.text, gsrlimit: '6',
    prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '600',
  });
  const pages = (j.query?.pages || []).sort((a, b) => a.index - b.index);
  const p = pages.find((p) => p.thumbnail && titleMatches(p.title, q.required));
  return p ? { url: p.thumbnail.source, page: pageUrl('en.wikipedia.org', p.title), source: 'Wikipedia' } : null;
}

async function commonsSearch(text, q) {
  const j = await wiki('commons.wikimedia.org', {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: text, gsrlimit: '20',
    prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '600',
  });
  const candidates = (j.query?.pages || [])
    .filter((p) => p.imageinfo?.[0] && OK_MIME.test(p.imageinfo[0].mime) && titleMatches(p.title, q.required))
    .filter((p) => !/(with|on|mounted|sample|taken|shot|photo|test)/i.test(p.title)) // the lens itself, not a camera wearing it
    .map((p) => ({ p, score: scoreTitle(p.title, q.tokens) - p.index * 0.01 }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0]?.p;
  if (!best) return null;
  return { url: best.imageinfo[0].thumburl || best.imageinfo[0].url, page: best.imageinfo[0].descriptionurl, source: 'Wikimedia Commons' };
}

// Tries each source in turn. `incomplete` means a source couldn't be reached, so a miss
// shouldn't be remembered for long.
async function lookupCover(g) {
  const q = imageQuery(g);
  if (!q) return { hit: null };
  const steps = g.kind === 'body'
    ? [
        ...(g.type === 'phone' ? [() => sources.phoneImage(g.name)] : [() => sources.cameraImage(g.name)]),
        ...(g.type !== 'phone' ? [() => sources.kamerastoreBody(g)] : []),
        () => wikipediaExact(q.text, q, true), () => wikipediaSearch(q),
        // no Commons search for cameras: it finds screenshots and sample photos more often than the camera
      ]
    : [
        () => sources.lensImage(g.name, g.brand), () => sources.kamerastoreLens(g.name, g.brand),
        () => wikipediaExact(q.text, q, false), () => commonsSearch(q.text, q), ...(q.fallback ? [() => commonsSearch(q.fallback, q)] : []),
      ];
  let incomplete = false;
  for (const step of steps) {
    try {
      const hit = await step();
      if (hit) return { hit };
    } catch (e) {
      incomplete = true;
      if (!(e instanceof Unavailable)) console.warn(`[gearbox] picture source failed for ${g.name}: ${e.message}`);
    }
  }
  return { hit: null, incomplete };
}

// Max 2 Wikimedia lookups at once; dedupe concurrent requests for the same gear.
const inflight = new Map();
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

async function coverFor(g, retry = false) {
  if (g.unknown) return { url: null, unknown: true };
  const k = coverKey(g);
  const cached = covers[k];
  if (cached && (cached.manual || (!retry && fresh(cached)))) return cached;
  if (!inflight.has(k)) {
    inflight.set(k, limited(async () => {
      const { hit, incomplete } = await lookupCover(g);
      covers[k] = { ...(hit || { url: null }), v: COVER_VERSION, at: Date.now(), ...(incomplete && !hit ? { retryAt: Date.now() + 3600_000 } : {}) };
      saveCovers();
      return covers[k];
    }).finally(() => inflight.delete(k)));
  }
  return inflight.get(k);
}

// ───────────────────────── HTTP ─────────────────────────

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

async function readJson(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 1e5) throw httpError(413, 'Body too large'); }
  try { return s ? JSON.parse(s) : {}; } catch { throw httpError(400, 'Invalid JSON'); }
}

// A remembered picture is good unless it's from an older Gearbox, or a "not found" from a
// time when a source was down.
const fresh = (c) => c.v === COVER_VERSION && !(c.retryAt && c.retryAt < Date.now());

function knownCover(g) {
  if (g.unknown) return { url: null, unknown: true };
  const c = covers[coverKey(g)];
  return c && (c.manual || fresh(c)) ? c : null;
}

const publicGear = (g) => ({
  id: g.id, kind: g.kind, name: g.name, brand: g.brand, count: g.count, unknown: !!g.unknown,
  type: g.type, typeLabel: g.typeLabel, code: g.code, builtin: g.builtin,
  raw: g.raw, cover: knownCover(g),
});

async function findGear(user, id) {
  const g = (await getScan(user)).groups.get(id);
  if (!g) throw httpError(404, 'No such gear (try Rescan)');
  return g;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function serveFile(res, name, cache = 'no-cache') {
  const file = path.normalize(path.join(PUBLIC_DIR, name));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw httpError(403, 'Nope');
  let data;
  try { data = await readFile(file); } catch { throw httpError(404, 'Not found'); }
  if (name === 'gearbox.html') data = data.toString('utf8').replaceAll('__V__', VERSION);
  send(res, 200, data, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
}

async function api(req, res, parts, url) {
  // GET /_gearbox/api/meta — health check
  if (req.method === 'GET' && parts[0] === 'meta') return send(res, 200, { name: 'gearbox', version: VERSION });

  const user = await requireUser(req);

  // GET /_gearbox/api/gear[?refresh=1]
  if (req.method === 'GET' && parts[0] === 'gear' && parts.length === 1) {
    const s = await getScan(user, url.searchParams.has('refresh'));
    const all = [...s.groups.values()].map(publicGear);
    return send(res, 200, {
      scannedAt: s.at, total: s.total, user: user.name,
      bodies: all.filter((g) => g.kind === 'body'),
      lenses: all.filter((g) => g.kind === 'lens'),
    });
  }

  // GET /_gearbox/api/report — plain text: what Gearbox read from EXIF and where each picture came from
  if (req.method === 'GET' && parts[0] === 'report') {
    const s = await getScan(user);
    const ago = (t) => (t ? `${Math.round((Date.now() - t) / 3600_000)}h old` : '');
    const lines = [
      `Gearbox ${VERSION} · ${s.total} photos · scanned ${new Date(s.at).toISOString()}`,
      '',
      'Sources:',
      ...sources.status().map((x) => `  ${x.name.padEnd(9)} ${x.ok ? `ok, ${x.size} entries, ${ago(x.at)}` : x.loading ? 'downloading…' : `NOT AVAILABLE${x.error ? ` (${x.error})` : ''}`}`),
    ];
    const row = (g) => {
      const c = knownCover(g);
      const pic = g.unknown ? '?' : !c ? 'not looked up yet' : c.url ? `${c.source}${c.manual ? ' (picked)' : ''}` : c.retryAt ? 'none yet (a source was down, will retry)' : 'none found';
      const raw = g.kind === 'body' ? `make=${JSON.stringify(g.raw?.make ?? null)} model=${JSON.stringify(g.raw?.model ?? null)}` : `lens=${JSON.stringify(g.raw?.lensModel ?? null)}`;
      return [`  ${g.name} (${g.count})`, g.unknown ? '' : raw, g.typeLabel || '', g.builtin?.length ? `built-in: ${g.builtin.join(' / ')}` : '', `picture: ${pic}`].filter(Boolean).join(' | ');
    };
    const all = [...s.groups.values()].sort((a, b) => b.count - a.count);
    lines.push('', 'Bodies:', ...all.filter((g) => g.kind === 'body').map(row), '', 'Lenses:', ...all.filter((g) => g.kind === 'lens').map(row));
    return send(res, 200, lines.join('\n'), { 'content-type': 'text/plain; charset=utf-8' });
  }

  // GET /_gearbox/api/gear/:id/assets?offset=&limit=
  if (req.method === 'GET' && parts[0] === 'gear' && parts[2] === 'assets') {
    const g = await findGear(user, parts[1]);
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 120));
    return send(res, 200, { total: g.assets.length, items: g.assets.slice(offset, offset + limit) });
  }

  // POST /_gearbox/api/gear/:id/album → a real Immich album with every photo from this gear
  if (req.method === 'POST' && parts[0] === 'gear' && parts[2] === 'album') {
    const g = await findGear(user, parts[1]);
    const album = await immich('/albums', user.auth, {
      method: 'POST',
      body: { albumName: ALBUM_PREFIX + g.name, description: `Everything shot with ${g.name}. Made by Gearbox.` },
    });
    for (let i = 0; i < g.assets.length; i += 1000) {
      await immich(`/albums/${album.id}/assets`, user.auth, { method: 'PUT', body: { ids: g.assets.slice(i, i + 1000) } });
    }
    return send(res, 200, { id: album.id, url: `/albums/${album.id}` });
  }

  // GET /_gearbox/api/cover/:id[?retry=1] → look up (or return the remembered) product picture
  if (req.method === 'GET' && parts[0] === 'cover' && parts[1]) {
    const g = await findGear(user, parts[1]);
    return send(res, 200, await coverFor(g, url.searchParams.has('retry')));
  }

  // PUT /_gearbox/api/cover/:id  { url: "https://…" } | { url: null } (force "?") | { reset: true }
  if (req.method === 'PUT' && parts[0] === 'cover' && parts[1]) {
    const g = await findGear(user, parts[1]);
    const body = await readJson(req);
    const k = coverKey(g);
    if (body.reset) {
      delete covers[k];
      saveCovers();
      return send(res, 200, await coverFor(g));
    }
    if (body.url != null && !/^https?:\/\/\S+$/i.test(body.url)) throw httpError(400, 'The picture must be an http(s) link');
    covers[k] = { url: body.url ?? null, page: body.url ?? undefined, source: `Picked by ${user.name}`, manual: true, at: Date.now() };
    saveCovers();
    return send(res, 200, covers[k]);
  }

  throw httpError(404, 'Not found');
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/gearbox' || p === '/gearbox/') return serveFile(res, 'gearbox.html');
  if (p.startsWith('/_gearbox/api/')) return api(req, res, p.split('/').slice(3).filter(Boolean), url);
  if (p.startsWith('/_gearbox/')) return serveFile(res, p.slice('/_gearbox/'.length), url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache');

  return proxy.web(req, res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    else res.end();
  });
});
server.on('upgrade', proxy.upgrade);
server.listen(PORT, HOST, () => {
  console.log(`[gearbox] v${VERSION} on http://localhost:${PORT}  →  Immich at ${IMMICH_URL}`);
});
