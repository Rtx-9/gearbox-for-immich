// Product-picture and device-name indexes, downloaded once and refreshed every two weeks.
//
//   phones   Google Play's supported-devices list: model code → marketing name
//            ("21081111RG" → "Xiaomi 11T", "SM-G991B" → "Galaxy S21 5G")
//   gsmarena GSMArena's quick-search index: every phone with its product picture
//   cameras  Apotelyt: clean product shots of ~600 camera bodies
//   lenses   Apotelyt lens catalogs: ~2,500 lens product shots
//
// Each index is optional: if one can't be downloaded, Gearbox falls back to Wikipedia.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { cameraKey, lensSpec, mountClash } from './gear.mjs';

const MAX_AGE = 14 * 24 * 3600_000;
const APO = 'https://apotelyt.com';

export function createSources({ dataDir, ua }) {
  const dir = path.join(dataDir, 'indexes');
  const state = {};  // name → { data, promise, failedAt }

  async function get(url, type = 'text') {
    const res = await fetch(url, { headers: { 'user-agent': ua } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return type === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text();
  }

  // Load an index from disk, (re)building it when missing or old. A failed rebuild keeps the
  // old copy; with no copy at all we retry after 10 minutes.
  function index(name, build) {
    const st = (state[name] ||= {});
    if (st.data) return st.data;
    if (st.failedAt && Date.now() - st.failedAt < 10 * 60_000) return null;
    st.promise ||= (async () => {
      const file = path.join(dir, `${name}.json`);
      let disk = null;
      try { disk = JSON.parse(await readFile(file, 'utf8')); } catch {}
      if (disk && Date.now() - disk.at < MAX_AGE) return (st.data = disk.data);
      try {
        const data = await build();
        await mkdir(dir, { recursive: true });
        await writeFile(file + '.tmp', JSON.stringify({ at: Date.now(), data }));
        await rename(file + '.tmp', file);
        console.log(`[gearbox] downloaded ${name} index`);
        return (st.data = data);
      } catch (e) {
        console.warn(`[gearbox] could not download ${name} index: ${e.message}`);
        if (disk) return (st.data = disk.data);
        st.failedAt = Date.now();
        return null;
      }
    })().finally(() => { st.promise = null; });
    return st.promise;
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

  // ───────── GSMArena: phone name → picture ─────────
  const gsmarena = () => index('gsmarena', async () => {
    const home = await get('https://www.gsmarena.com/');
    const file = home.match(/quicksearch-\d+\.jpg/)?.[0];
    if (!file) throw new Error('quick-search index not found');
    const [makers, list] = JSON.parse(await get(`https://www.gsmarena.com/${file}`));
    return list
      .filter((p) => p[4] && !/^(smartphone|tablet|watch|nophoto)/i.test(p[4]))
      .map((p) => [`${makers[p[0]]} ${p[2]}`, p[1], p[4]]);
  });

  // ───────── Apotelyt: camera bodies ─────────
  const cameras = () => index('cameras', async () => {
    const root = await get(`${APO}/sitemap-00.xml/`);
    const maps = [...root.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const slugs = new Set();
    for (const url of maps) {
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
    const home = await get(`${APO}/sitemap-00.xml/`);
    const maps = [...home.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const catalogs = new Set();
    for (const url of maps) {
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

  // Warm everything up in the background on start.
  const warm = () => Promise.all([phones(), gsmarena(), cameras(), lenses()]);

  // ───────── lookups ─────────

  // Resolves once, then returns a synchronous code → name lookup for the library scan.
  async function phoneNames() {
    const p = await phones();
    return (model) => phoneName(p, model);
  }

  function phoneName(p, model) {
    const hit = p?.[(model || '').trim().toLowerCase()];
    if (!hit) return null;
    const [brand, name] = hit;
    const tidyBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
    return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${tidyBrand} ${name}`;
  }

  const compact = (s) => s.toLowerCase().replace(/[^a-z0-9+]+/g, '');

  async function phoneImage(name) {
    const list = await gsmarena();
    if (!list) return null;
    const want = [compact(name), compact(name.replace(/\b5g\b/i, '')), compact(name + ' 5G')];
    const hit = list.find((p) => want.includes(compact(p[0])));
    if (!hit) return null;
    const slug = hit[0].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return { url: `https://fdn2.gsmarena.com/vv/bigpic/${hit[2]}`, page: `https://www.gsmarena.com/${slug}-${hit[1]}.php`, source: 'GSMArena' };
  }

  const exists = async (url) => {
    try { return (await fetch(url, { method: 'HEAD', headers: { 'user-agent': ua } })).ok; } catch { return false; }
  };

  let cameraMap = null;
  async function cameraImage(name) {
    const slugs = await cameras();
    if (!slugs) return null;
    if (!cameraMap || cameraMap.src !== slugs) {
      cameraMap = { src: slugs, map: new Map() };
      for (const s of slugs) if (!cameraMap.map.has(cameraKey(s.replace(/-/g, ' ')))) cameraMap.map.set(cameraKey(s.replace(/-/g, ' ')), s);
    }
    const slug = cameraMap.map.get(cameraKey(name));
    if (!slug) return null;
    const url = `${APO}/abc-i1d/${slug}-body-960x640.webp`;
    if (!(await exists(url))) return null;
    return { url, page: `${APO}/camera-specs/${slug}-sensor-size`, source: 'Apotelyt' };
  }

  async function lensImage(lensName, brand) {
    const catalog = await lenses();
    if (!catalog) return null;
    const want = lensSpec(lensName, brand);
    if (!want) return null;
    let best = null;
    for (const [slug, page] of Object.entries(catalog)) {
      const have = lensSpec(slug.replace(/-/g, ' '), '', true);
      if (!have || have.brand !== want.brand || have.focal !== want.focal || mountClash(want, have)) continue;
      if (want.aperture && have.aperture && want.aperture !== have.aperture) continue;
      const extras = have.extras.filter((t) => want.extras.includes(t)).length;
      const strays = have.extras.length - extras;
      const score = extras * 2 - strays + (have.aperture === want.aperture ? 1 : 0) - slug.length * 0.001;
      if (!best || score > best.score) best = { slug, page, score };
    }
    if (!best) return null;
    return { url: `${APO}/abc-i1d/${best.slug}-960x640.webp`, page: best.page, source: 'Apotelyt' };
  }

  return { warm, phoneNames, phoneImage, cameraImage, lensImage };
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
