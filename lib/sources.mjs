// Product pictures and device names.
//
// Indexes, downloaded once and refreshed every two weeks:
//   phones    Google Play's supported-devices list: model code → marketing name
//             ("21081111RG" → "Xiaomi 11T", "SM-G991B" → "Galaxy S21 5G")
//   dji       Wikimedia Commons' table of DJI camera codes ("FC3582" → "Mini 3 Pro")
//   gsmarena  GSMArena's quick-search index: every phone with its product picture
//   cameras   Apotelyt: clean product shots of ~600 camera bodies
//   lenses    Apotelyt lens catalogs: ~1,200 lens product shots
// Searched per item (and remembered by the caller):
//   Kamerastore  used-gear shop with white-background photos of compacts, action cams, drones…
//
// Every source is optional. A lookup made while an index was unavailable is marked
// `incomplete`, so the caller can try again later instead of remembering a wrong answer.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { cameraKey, lensSpec, mountClash, tokens } from './gear.mjs';

const MAX_AGE = 14 * 24 * 3600_000;
const APO = 'https://apotelyt.com';
const KAMERASTORE = 'https://kamerastore.com';

export class Unavailable extends Error {}

export function createSources({ dataDir, ua }) {
  const dir = path.join(dataDir, 'indexes');
  const state = {};  // name → { data, promise, failedAt, error, at, size }

  async function get(url, type = 'text') {
    const res = await fetch(url, { headers: { 'user-agent': ua, accept: type === 'json' ? 'application/json' : '*/*' } });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    if (type === 'buffer') return Buffer.from(await res.arrayBuffer());
    return type === 'json' ? res.json() : res.text();
  }

  // Load an index from disk, (re)building it when missing or old. A failed rebuild keeps the
  // old copy; with no copy at all we retry after 10 minutes. Resolves to null when unavailable.
  function index(name, build) {
    const st = (state[name] ||= {});
    if (st.data) return st.data;
    if (st.failedAt && Date.now() - st.failedAt < 10 * 60_000) return null;
    st.promise ||= (async () => {
      const file = path.join(dir, `${name}.json`);
      let disk = null;
      try { disk = JSON.parse(await readFile(file, 'utf8')); } catch {}
      const keep = (d) => { st.data = d.data; st.at = d.at; st.size = sizeOf(d.data); st.error = null; return st.data; };
      if (disk && Date.now() - disk.at < MAX_AGE) return keep(disk);
      try {
        const fresh = { at: Date.now(), data: await build() };
        await mkdir(dir, { recursive: true });
        await writeFile(file + '.tmp', JSON.stringify(fresh));
        await rename(file + '.tmp', file);
        console.log(`[gearbox] downloaded ${name} index (${sizeOf(fresh.data)} entries)`);
        return keep(fresh);
      } catch (e) {
        console.warn(`[gearbox] could not download ${name} index: ${e.message}`);
        st.error = e.message;
        if (disk) return keep(disk);
        st.failedAt = Date.now();
        return null;
      }
    })().finally(() => { st.promise = null; });
    return st.promise;
  }
  const sizeOf = (d) => (Array.isArray(d) ? d.length : Object.keys(d || {}).length);

  // An index the lookup needs; throws Unavailable so the caller knows the answer isn't final.
  async function need(load) {
    const data = await load();
    if (!data) throw new Unavailable();
    return data;
  }

  // ───────── phones: model code → name ─────────
  const phones = () => index('phones', async () => {
    const csv = (await get('https://storage.googleapis.com/play_public/supported_devices.csv', 'buffer')).toString('utf16le');
    const out = {};
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const [brand, name, , model] = parseCsvLine(line);
      if (!brand || !name || !model) continue;
      out[model.toLowerCase()] ||= [brand, name];
    }
    return out;
  });

  // ───────── DJI: camera code → product ─────────
  const dji = () => index('dji', async () => {
    const wikitext = await get('https://commons.wikimedia.org/w/index.php?title=DJI_camera_model_names&action=raw');
    const out = parseDjiTable(wikitext);
    if (Object.keys(out).length < 10) throw new Error('DJI table looks empty');
    return out;
  });

  // ───────── GSMArena: phone name → picture ─────────
  const gsmarena = () => index('gsmarena', async () => {
    // The home page names the current index file; older file names keep working, so fall
    // back to a known one if the home page is behind a bot check.
    let file = 'quicksearch-82983.jpg';
    try { file = (await get('https://www.gsmarena.com/')).match(/quicksearch-\d+\.jpg/)?.[0] || file; } catch {}
    const [makers, list] = JSON.parse(await get(`https://www.gsmarena.com/${file}`));
    return list
      .filter((p) => p[4] && !/^(smartphone|tablet|watch|nophoto)/i.test(p[4]))
      .map((p) => [`${makers[p[0]]} ${p[2]}`, p[1], p[4]]);
  });

  // ───────── Apotelyt: camera bodies ─────────
  const sitemaps = async () => {
    const root = await get(`${APO}/sitemap-00.xml/`);
    return [...root.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  };

  const cameras = () => index('cameras', async () => {
    const slugs = new Set();
    for (const url of await sitemaps()) {
      const xml = await get(url);
      const before = slugs.size;
      for (const m of xml.matchAll(/\/camera-specs\/([a-z0-9-]+)-sensor-size</g)) slugs.add(m[1]);
      if (before > 0 && slugs.size === before) break; // camera pages come in one block
    }
    if (!slugs.size) throw new Error('no cameras in sitemap');
    return [...slugs];
  });

  // ───────── Apotelyt: lens catalogs ─────────
  const lenses = () => index('lenses', async () => {
    const catalogs = new Set();
    for (const url of await sitemaps()) {
      const xml = await get(url);
      for (const m of xml.matchAll(/<loc>(https:\/\/apotelyt\.com\/camera-kit\/[a-z0-9-]+-catalog)<\/loc>/g)) catalogs.add(m[1]);
      if (catalogs.size) break;
    }
    const out = {};
    for (const url of catalogs) {
      const html = await get(url);
      for (const m of html.matchAll(/\/abc-i1d\/([a-z0-9-]+)-960x640\.webp/g)) {
        if (!/-body$|-on-|-with-|roadmap/.test(m[1])) out[m[1]] ||= url;
      }
    }
    if (!Object.keys(out).length) throw new Error('no lenses in catalogs');
    return out;
  });

  const INDEXES = { phones, dji, gsmarena, cameras, lenses };

  // Warm everything up in the background on start.
  const warm = () => Promise.all(Object.values(INDEXES).map((f) => f()));

  // For the gear report.
  function status() {
    return Object.keys(INDEXES).map((name) => {
      const st = state[name] || {};
      return { name, ok: !!st.data, size: st.size || 0, at: st.at || null, error: st.error || null, loading: !!st.promise };
    });
  }

  // ───────── names (synchronous, for the library scan) ─────────

  async function nameLookups() {
    const [p, d] = await Promise.all([phones(), dji()]);
    return {
      phone: (model) => phoneName(p, model),
      dji: (model) => d?.[(model || '').trim().toUpperCase()] || null,
    };
  }

  function phoneName(p, model) {
    const hit = p?.[(model || '').trim().toLowerCase()];
    if (!hit) return null;
    const [brand, name] = hit;
    const tidyBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
    return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${tidyBrand} ${name}`;
  }

  // ───────── pictures ─────────

  const compact = (s) => s.toLowerCase().replace(/[^a-z0-9+]+/g, '');

  async function phoneImage(name) {
    const list = await need(gsmarena);
    const want = [compact(name), compact(name.replace(/\b5g\b/i, '')), compact(name + ' 5G')];
    const hit = list.find((p) => want.includes(compact(p[0])));
    if (!hit) return null;
    const slug = hit[0].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return { url: `https://fdn2.gsmarena.com/vv/bigpic/${hit[2]}`, page: `https://www.gsmarena.com/${slug}-${hit[1]}.php`, source: 'GSMArena' };
  }

  const exists = async (url) => {
    const res = await fetch(url, { method: 'HEAD', headers: { 'user-agent': ua } }).catch(() => null);
    if (!res) throw new Unavailable();
    return res.ok;
  };

  let cameraMap = null;
  async function cameraImage(name) {
    const slugs = await need(cameras);
    if (!cameraMap || cameraMap.src !== slugs) {
      cameraMap = { src: slugs, map: new Map() };
      for (const s of slugs) {
        const k = cameraKey(s.replace(/-/g, ' '));
        if (!cameraMap.map.has(k)) cameraMap.map.set(k, s);
      }
    }
    const slug = cameraMap.map.get(cameraKey(name));
    if (!slug) return null;
    const url = `${APO}/abc-i1d/${slug}-body-960x640.webp`;
    if (!(await exists(url))) return null;
    return { url, page: `${APO}/camera-specs/${slug}-sensor-size`, source: 'Apotelyt' };
  }

  async function lensImage(lensName, brand) {
    const catalog = await need(lenses);
    const want = lensSpec(lensName, brand);
    if (!want) return null;
    let best = null;
    for (const [slug, page] of Object.entries(catalog)) {
      const have = lensSpec(slug.replace(/-/g, ' '), '', true);
      if (!sameLens(want, have)) continue;
      const extras = have.extras.filter((t) => want.extras.includes(t)).length;
      const strays = have.extras.length - extras;
      const score = extras * 2 - strays + (have.aperture === want.aperture ? 1 : 0) - slug.length * 0.001;
      if (!best || score > best.score) best = { slug, page, score };
    }
    if (!best) return null;
    return { url: `${APO}/abc-i1d/${best.slug}-960x640.webp`, page: best.page, source: 'Apotelyt' };
  }

  // Kamerastore (Shopify) product search. Listings come and go, but their photos stay up.
  const ACCESSORY = /\b(case|bag|pouch|strap|battery|batteries|charger|grip|cap|hood|filter|adapter|housing|cage|manual|box|remote|cable|tripod|protector|propellers?|snorkel|dome|mount|bracket|charging|hub|sd card|lens cap|eyecup|flash)\b/i;
  const ROMAN = new Set(['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii']);
  // Words that make it a different product when only the listing has them.
  const VARIANT = new Set(['pro', 'plus', 'max', 'mini', 'ultra', 'se', 'lite', 'zoom', 'cine', 'mark', 'mk', 's', 'x', 'r', 'rs']);
  // Words our EXIF name has that listings often leave out.
  const OPTIONAL = new Set(['black', 'silver', 'white', 'edition', 'hs', 'is', 'mark', 'digital', 'camera', 'lumix', 'powershot', 'coolpix', 'cyber', 'shot', 'finepix', 'eos', 'body', 'the']);
  const handleTokens = (p) => tokens((p.url || '').split('?')[0].split('/').pop().replace(/-t\d+$/, '').replace(/-/g, ' '));

  // The shop redirects to a country path ("/en-fi/…") and the redirect garbles the search
  // parameters, so find that path once and search there directly.
  let storePrefix = null;
  async function kamerastorePrefix() {
    if (storePrefix !== null) return storePrefix;
    try {
      const res = await fetch(`${KAMERASTORE}/`, { headers: { 'user-agent': ua } });
      storePrefix = new URL(res.url).pathname.replace(/\/+$/, '').match(/^\/[a-z]{2}(-[a-z]{2})?$/i)?.[0] ?? '';
    } catch { throw new Unavailable(); }
    return storePrefix;
  }

  async function kamerastoreSearch(q) {
    const url = `${KAMERASTORE}${await kamerastorePrefix()}/search/suggest.json?` + new URLSearchParams({ q, 'resources[type]': 'product', 'resources[limit]': '10' });
    let json;
    try { json = await get(url, 'json'); } catch { throw new Unavailable(); }
    return json?.resources?.results?.products || [];
  }

  const kamerastoreHit = (p) => ({
    url: p.image.includes('?') ? `${p.image}&width=800` : `${p.image}?width=800`,
    page: KAMERASTORE + (p.url || '').split('?')[0],
    source: 'Kamerastore',
  });

  // A listing is our camera when it has every word of our model ("Mini", "SX", "P"…) and every
  // number or variant word in it is ours too (so no "Pro", "SE", "Mark II" or "+ 28-70mm kit").
  // The URL handle counts as part of the title: it often carries the mount ("…-canon-ef-t138455").
  async function kamerastoreBody(g) {
    const brandTokens = new Set(tokens(g.brand));
    const ours = new Set([...tokens(g.name), ...tokens(g.code || '')]);
    const required = tokens(g.name).filter((t) => !brandTokens.has(t) && !OPTIONAL.has(t));
    const queries = [...new Set([g.name, spaced(g.name)])];
    for (const q of queries) {
      for (const p of await kamerastoreSearch(q)) {
        if (!p.image || ACCESSORY.test(p.title)) continue;
        const t = tokens(p.title);
        const all = new Set([...t, ...handleTokens(p)]);
        if (brandTokens.size && ![...brandTokens].some((b) => all.has(b))) continue;
        if (!required.every((r) => all.has(r))) continue;
        if (t.some((x) => (/^\d+$/.test(x) || ROMAN.has(x) || VARIANT.has(x)) && !ours.has(x))) continue;
        return kamerastoreHit(p);
      }
    }
    return null;
  }

  async function kamerastoreLens(lensName, brand) {
    const want = lensSpec(lensName, brand);
    if (!want) return null;
    const q = `${brand && !tokens(lensName).includes(tokens(brand)[0]) ? brand + ' ' : ''}${want.focal}mm ${want.aperture ? 'f' + want.aperture : ''}`.trim();
    for (const p of await kamerastoreSearch(q)) {
      if (!p.image || ACCESSORY.test(p.title)) continue;
      if (tokens(p.title).some((x) => ROMAN.has(x) && !tokens(lensName).includes(x))) continue; // "GM II" isn't "GM"
      const have = lensSpec(`${p.title} ${handleTokens(p).join(' ')}`, brand);
      if (!have || !sameLens(want, have) || (want.aperture && !have.aperture)) continue;
      return kamerastoreHit(p);
    }
    return null;
  }

  return { warm, status, nameLookups, phoneImage, cameraImage, lensImage, kamerastoreBody, kamerastoreLens };
}

function sameLens(want, have) {
  if (!have || have.brand !== want.brand || have.focal !== want.focal || mountClash(want, have)) return false;
  return !(want.aperture && have.aperture && Math.abs(want.aperture - have.aperture) > 0.05);
}

// "GoPro HERO8 Black" → "GoPro HERO 8 Black" (shop search is picky about glued numbers)
const spaced = (s) => s.replace(/([a-z])(\d)/gi, '$1 $2');

// Commons' DJI table comes in two layouts: one camera per line under a product cell, or
// "| product || CODE || …" rows. Products with several cameras span several rows.
export function parseDjiTable(wikitext) {
  const out = {};
  let section = '';
  let product = '';
  for (const block of wikitext.split(/\n(?:<!--\s*-->)?\|-/)) {
    const heading = [...block.matchAll(/^==\s*([^=]+?)\s*==\s*$/gm)].pop();
    if (heading) section = heading[1];
    const body = block.replace(/\[\[:Category:Taken with[^\]]*\]\]/g, '').replace(/<!--(?!\s*-->)[\s\S]*?-->/g, '');
    const lines = body.split('\n').filter((l) => /^\s*(<!--\s*-->)?\s*\|/.test(l) && !/^\s*\|\}/.test(l) && !/^\s*\{\|/.test(l));
    if (!lines.length) continue;
    const first = lines[0].trim();
    const productLink = first.match(/^\|\s*(?:rowspan="\d+"\s*\|\s*)?\[\[:Category:[^|\]]+\|([^\]]+)\]\]/);
    if (productLink) product = productLink[1].trim();
    if (!product) continue;
    const codes = new Set();
    for (const m of body.matchAll(/\[\[:Category:(?:DJI |Hasselblad )?[^|\]]+\|([^\]]+)\]\]/g)) {
      const label = m[1].trim();
      if (label !== product && /^[A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*$/i.test(label) && !/^Q\d+$/.test(label)) codes.add(label);
    }
    // "| [[…|Phantom 4]] || FC330 || …" — the plain-text second cell
    const cells = lines.join('\n').split('||').map((c) => c.replace(/\{\{[^}]*\}\}/g, '').replace(/\[\[[^\]]*\]\]/g, '').replace(/^\s*(<!--\s*-->)?\s*\|/, '').trim());
    const codeCell = productLink ? cells[1] : cells[0]; // continuation rows start with the code
    if (codeCell && /\d/.test(codeCell) && /^[A-Z0-9 .-]+$/i.test(codeCell) && !/^Q\d+$/.test(codeCell)) codes.add(codeCell);
    const kind = /stabili[sz]ed|osmo|action|pocket/i.test(section) ? 'action' : /ronin/i.test(section) ? 'camera' : 'drone';
    const name = /^dji\b/i.test(product) ? product : `DJI ${product}`;
    for (const c of codes) out[c.toUpperCase()] ||= { name: name.replace(/\s*\(original( model)?\)/i, ''), kind };
  }
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
