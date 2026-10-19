// Turning messy EXIF make/model/lens strings into tidy gear names and search keys.

const BRANDS = [
  ['nikon', 'Nikon'], ['canon', 'Canon'], ['sony', 'Sony'], ['fujifilm', 'Fujifilm'], ['fuji', 'Fujifilm'],
  ['om digital', 'OM System'], ['om system', 'OM System'], ['olympus', 'Olympus'], ['panasonic', 'Panasonic'],
  ['leica', 'Leica'], ['pentax', 'Pentax'], ['ricoh', 'Ricoh'], ['samsung', 'Samsung'], ['apple', 'Apple'],
  ['google', 'Google'], ['hasselblad', 'Hasselblad'], ['sigma', 'Sigma'], ['dji', 'DJI'], ['gopro', 'GoPro'],
  ['kodak', 'Kodak'], ['konica minolta', 'Konica Minolta'], ['minolta', 'Minolta'], ['xiaomi', 'Xiaomi'],
  ['redmi', 'Redmi'], ['poco', 'POCO'], ['huawei', 'Huawei'], ['honor', 'Honor'], ['oneplus', 'OnePlus'],
  ['oppo', 'OPPO'], ['vivo', 'vivo'], ['realme', 'realme'], ['motorola', 'Motorola'], ['nothing', 'Nothing'],
  ['fairphone', 'Fairphone'], ['asus', 'ASUS'], ['lg', 'LG'], ['nokia', 'Nokia'], ['hmd', 'HMD'],
  ['phase one', 'Phase One'], ['tamron', 'Tamron'], ['tokina', 'Tokina'], ['zeiss', 'Zeiss'],
  ['carl zeiss', 'Zeiss'], ['voigtlander', 'Voigtländer'], ['voigtländer', 'Voigtländer'], ['samyang', 'Samyang'],
  ['rokinon', 'Rokinon'], ['viltrox', 'Viltrox'], ['ttartisan', 'TTArtisan'], ['7artisans', '7Artisans'],
  ['laowa', 'Laowa'], ['yongnuo', 'Yongnuo'], ['insta360', 'Insta360'], ['arashi vision', 'Insta360'],
  ['casio', 'Casio'], ['autel', 'Autel'], ['parrot', 'Parrot'], ['skydio', 'Skydio'], ['akaso', 'AKASO'],
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BRAND_RES = BRANDS.map(([k, v]) => [new RegExp(`^${escape(k)}(?![a-z0-9])`, 'i'), v]);
const CORP = /\b(corporation|corp\.?|co\.?,?\s*ltd\.?|ltd\.?|company|inc\.?|imaging|optical|digital solutions|electronics?|mobile|technology|ag)\b/gi;

export function brandOf(s) {
  const t = (s || '').trim();
  for (const [re, v] of BRAND_RES) if (re.test(t)) return v;
  return '';
}

function stripBrands(s) {
  let out = s.trim(), prev;
  do {
    prev = out;
    for (const [re] of BRAND_RES) out = out.replace(re, '').replace(/^[\s,\-_]+/, '');
    out = out.replace(CORP, '').trim();
  } while (out !== prev && out);
  return out;
}

function tidyMake(make) {
  const m = make.replace(CORP, '').replace(/[\s,.]+$/, '').replace(/\s+/g, ' ').trim();
  return m === m.toUpperCase() && m.length > 3
    ? m.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : m;
}

export function prettyLens(s) {
  return s.replace(/\s+/g, ' ')
    .replace(/(\d+)\.0+(?![\d])/g, '$1')   // 18.0-55.0 → 18-55
    .replace(/(\d)\s+mm\b/gi, '$1mm')       // 50 mm → 50mm
    .trim();
}

// The "0.0 mm f/0.0" crowd, and lens fields that only name a brand ("MINOLTA").
export function isJunkLens(s) {
  const t = prettyLens(s || '');
  return !t
    || !/\d/.test(t)
    || /^[-\s.?]*$/.test(t)
    || /^(0+\s*mm)?\s*(f\/?\s*0+)?$/i.test(t)
    || /^[-\s]*mm\s*f\/?[-\s]*$/i.test(t)
    || /^(unknown|none|n\/a|manual lens)\b/i.test(t)
    || /^\(?\d+\)?$/.test(t); // bare lens-ID numbers
}

// ───────── what kind of camera is it? ─────────

const PHONE_BRANDS = new Set(['Xiaomi', 'Redmi', 'POCO', 'Huawei', 'Honor', 'OnePlus', 'OPPO', 'vivo', 'realme', 'Nothing', 'Fairphone', 'Motorola', 'Google', 'ASUS', 'HMD']);
const DRONE_BRANDS = new Set(['DJI', 'Autel', 'Parrot', 'Skydio']);
const ACTION_BRANDS = new Set(['GoPro', 'Insta360', 'AKASO']);
const COMPACT_BRANDS = new Set(['Kodak', 'Casio']);
// Never look these up in the phone list (a Nikon "D3" is not a phone model code).
const CAMERA_ONLY = new Set(['Nikon', 'Canon', 'Fujifilm', 'Olympus', 'OM System', 'Pentax', 'Ricoh', 'Leica', 'Hasselblad', 'Sigma', 'Minolta', 'Konica Minolta', 'Kodak', 'Casio', 'GoPro', 'DJI', 'Phase One', 'Insta360']);
const COMPACT = {
  Canon: /^(powershot|ixus|ixy|elph|ixy|sx\d|g\d+\s?x|g\d+$|g1\s?x|s\d+\s?is|a\d{3,4}\b)/i,
  Nikon: /^coolpix/i,
  Sony: /^(dsc-|cyber-?shot|zv-1(?![0-9e]))/i,
  Panasonic: /^((dmc|dc)-)?(tz|zs|lx|fz|fs|ft|ts|sz|xs|fx)\d/i,
  Fujifilm: /^(finepix|x100|x70|x30|x20|x10\b|xf10|xq\d|x-?half)/i,
  Olympus: /^(tg-|tough|stylus|sh-|sz-|xz-|sp-|μ|mju|c-\d|fe-)/i,
  'OM System': /^(tg-)/i,
  Ricoh: /^(gr\b|gr\s|g\d{3}|cx\d|wg-|theta)/i,
  Pentax: /^(wg-|optio)/i,
  Leica: /^(q\d?\b|q\s|x\d?\b|x\s|x-|d-lux|c-lux|v-lux)/i,
  Minolta: /^dimage/i,
  'Konica Minolta': /^dimage/i,
  Sigma: /^dp\d/i,
  Samsung: /^(?!nx|sm-|gt-|galaxy)/i, // Samsung cameras that aren't NX bodies or phones
};

// DJI writes camera codes, not product names.
const DJI = {
  FC220: 'Mavic Pro', FC1102: 'Spark', FC2103: 'Mavic Air', FC3170: 'Mavic Air 2', FC3411: 'Air 2S',
  FC7203: 'Mavic Mini', FC7303: 'Mini 2', FC3582: 'Mini 3 Pro', FC8482: 'Mini 4 Pro', FC2204: 'Mavic 2 Zoom',
  FC330: 'Phantom 4', FC6310: 'Phantom 4 Pro', FC6310S: 'Phantom 4 Pro V2.0', FC300X: 'Phantom 3 Professional',
  FC300S: 'Phantom 3 Advanced', 'L1D-20C': 'Mavic 2 Pro', 'L2D-20C': 'Mavic 3',
};

function kindOf(brand, model) {
  if (/^(iphone|ipad|ipod)/i.test(model)) return 'phone';
  if (/^(pixel|galaxy|redmi|poco|xperia|mi\s?\d|nokia\s?\d|sm-|gt-)/i.test(model)) return 'phone';
  if (PHONE_BRANDS.has(brand)) return 'phone';
  if (DRONE_BRANDS.has(brand) && !/osmo|pocket|action/i.test(model)) return 'drone';
  if (/^l\dd-\d+c$/i.test(model)) return 'drone'; // Hasselblad cameras on DJI Mavics
  if (ACTION_BRANDS.has(brand) || /osmo|pocket|action/i.test(model)) return 'action';
  if (COMPACT_BRANDS.has(brand) || COMPACT[brand]?.test(model)) return 'compact';
  return 'camera';
}

const KIND_LABEL = { phone: 'phone', drone: 'drone', action: 'action cam', compact: 'compact' };

function body(ex, phoneName) {
  const make = (ex.make || '').trim();
  const model = (ex.model || '').trim();
  const unknown = { kind: 'body', key: '?', name: 'Unknown camera', brand: '', unknown: true, fixedLens: false };
  if (!make && !model) return unknown;
  let brand = brandOf(model) || brandOf(make) || tidyMake(make);
  const m = stripBrands(model);
  // "MINOLTA", "Canon", or a make with no model at all: not enough to name a camera.
  if (!m || m.toLowerCase() === brand.toLowerCase()) return unknown;

  const raw = { make: ex.make, model: ex.model };
  const key = `${make}|${model}`.toLowerCase();
  let name = `${brand} ${m}`.trim();
  let code = '';

  const phone = CAMERA_ONLY.has(brand) ? null : phoneName?.(model);
  const kind = phone ? 'phone' : kindOf(brand, m);
  if (phone) {
    name = phone;
    brand = brandOf(phone) || brand;
    if (!compact(phone).includes(compact(m))) code = model; // "21081111RG", not "Pixel 7"
  } else if (kind === 'drone') {
    const dji = DJI[model.toUpperCase()];
    if (dji) { name = `DJI ${dji}`; brand = 'DJI'; code = model; }
  }
  return { kind: 'body', key, name, brand, raw, type: kind, typeLabel: KIND_LABEL[kind] || '', code, fixedLens: kind !== 'camera' };
}

const compact = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Lens names that are just numbers, with a small-sensor focal length: a compact's built-in zoom.
function looksBuiltIn(name) {
  if (!/^[\d.\s\-mmf/]+$/i.test(name)) return false;
  const f = name.match(/(\d+(?:\.\d+)?)/);
  return f && Number(f[1]) < 10;
}

function lens(ex, b) {
  const raw = (ex.lensModel || '').trim();
  const name = prettyLens(raw);
  if (b.fixedLens || (!isJunkLens(raw) && looksBuiltIn(name))) {
    return { builtin: isJunkLens(raw) ? null : name };
  }
  if (isJunkLens(raw)) return { group: { kind: 'lens', key: '?', name: 'Unknown lens', brand: '', unknown: true } };
  return { group: { kind: 'lens', key: name.toLowerCase(), name, brand: brandOf(name), raw: { lensModel: ex.lensModel }, bodyBrand: b.unknown ? '' : b.brand } };
}

// → { body, lens (group or null), builtin (lens name folded into the body, or null) }
export function gearForAsset(exif, phoneName) {
  const b = body(exif, phoneName);
  const l = lens(exif, b);
  return { body: b, lens: l.group || null, builtin: l.builtin ?? null };
}

// ───────── matching against picture sources ─────────

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
const FILLER = /\b(eos|rebel|kiss|powershot|ixus|cyber ?shot|lumix|finepix|dmc|dc|dsc|digital|camera|mark|mk|alpha)\b/g;

// A loose key that makes "Sony ILCE-7M3", "sony-a7-iii", "Canon EOS 5D Mark III" and
// "canon-5d-mark-iii" collide with their twins.
export function cameraKey(name) {
  return (' ' + name.toLowerCase() + ' ')
    .replace(/_(\d)\b/g, (_, n) => ' ' + ROMAN[n])                                // Nikon "Z 6_2"
    .replace(/ilce-?(\d+)([a-z]*)m(\d)\b/g, (_, n, x, m) => `a${n}${x} ${ROMAN[m]}`) // ILCE-7RM4 → a7r iv
    .replace(/ilce-?(\d+[a-z]*)/g, 'a$1')                                          // ILCE-6400 → a6400
    .replace(/dsc-?(rx\d+)m(\d)\b/g, (_, r, m) => `${r} ${ROMAN[m]}`)             // DSC-RX100M7 → rx100 vii
    .replace(/(\d)m(\d)\b/g, (_, a, m) => `${a} ${ROMAN[m]}`)                      // R6m2 → r6 ii
    .replace(/(mark|mk)\s*(\d)\b/g, (_, w, m) => ` ${ROMAN[m]}`)
    .replace(/mark\s*(iv|v?i{0,3})\b/g, ' $1')                                     // MarkII → ii
    .replace(FILLER, ' ')
    .replace(/[^a-z0-9]/g, '');
}

const LENS_BRAND_HINTS = [[/nikkor/i, 'nikon'], [/zuiko/i, 'olympus'], [/fujinon|\bx[fc]\s?\d/i, 'fujifilm'], [/\b(ef|ef-s|rf|rf-s)\s?\d/i, 'canon'], [/\bfe\s?\d/i, 'sony']];

// Brand, focal range, widest aperture and the remaining words of a lens name or Apotelyt slug.
export function lensSpec(name, brand = '', isSlug = false) {
  let s = ` ${name.toLowerCase()} `;
  if (!isSlug) {
    s = s.replace(/([a-z])(?=\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\s*mm)/g, '$1 ')
      .replace(/mm(?=[a-z])/g, 'mm ')
      .replace(/(\d)\.0+(?!\d)/g, '$1')
      .replace(/\b(ef|af|rf)-(s|p|m|i)\b/g, '$1$2');
  }
  const tokens = s.split(/[^a-z0-9.]+/).filter(Boolean);
  let b, focal, aperture;
  if (isSlug) {
    // "sony fe 24 70mm 28 gm" (dashes already turned into spaces)
    const i = tokens.findIndex((t) => /^\d+mm$/.test(t));
    if (i < 0) return null;
    let start = i;
    focal = tokens[i].slice(0, -2);
    if (i > 1 && /^\d+$/.test(tokens[i - 1])) { focal = `${tokens[i - 1]}-${focal}`; start = i - 1; }
    aperture = slugAperture(tokens[i + 1]);
    const used = new Set([0, start, i, aperture != null ? i + 1 : -1]);
    return { brand: tokens[0], focal, aperture, extras: tokens.filter((t, k) => !used.has(k) && !/^\d+$/.test(t)) };
  }
  const fm = s.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm/);
  if (!fm) return null;
  focal = fm[2] && fm[2] !== fm[1] ? `${fm[1]}-${fm[2]}` : fm[1];
  const am = s.match(/\bf\s*\/?\s*(\d+(?:\.\d+)?)/);
  aperture = am ? Number(am[1]) : null;
  b = (brandOf(name) || LENS_BRAND_HINTS.find(([re]) => re.test(name))?.[1] || brand || '').toLowerCase();
  if (b === 'om system') b = 'olympus';
  if (b === 'voigtländer') b = 'voigtlander';
  const skip = new Set([b, 'mm', 'f', 'lens', 'zoom']);
  const extras = tokens.filter((t) => !/\d/.test(t) && !skip.has(t));
  return { brand: b, focal, aperture, extras };
}

// Same brand, different mount (Canon RF vs EF, Nikon Z vs F): never the same lens.
const MOUNTS = [['ef', 'efs'], ['rf', 'rfs'], ['afs', 'afp', 'af', 'ais'], ['z'], ['fe', 'e'], ['xf', 'xc'], ['mzd', 'zd']];
const mountOf = (extras) => MOUNTS.findIndex((family) => extras.some((t) => family.includes(t)));
export function mountClash(a, b) {
  const ma = mountOf(a.extras), mb = mountOf(b.extras);
  return ma >= 0 && mb >= 0 && ma !== mb;
}

function slugAperture(t) {
  if (!t || !/^\d+$/.test(t)) return null;
  if (t.length >= 3 && t[0] === '0') return Number(`0.${t.slice(1)}`);
  if (t.length === 2) return Number(`${t[0]}.${t[1]}`);
  return Number(t);
}

// ───────── Wikipedia / Commons fallback ─────────

export function tokens(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^file:/, '').replace(/\.(jpe?g|png|webp|tiff?|gif)$/, '')
    .replace(/(\d)\.0+(?!\d)/g, '$1')
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9α-ω]+/).filter(Boolean);
}

export function titleMatches(title, required) {
  const t = new Set(tokens(title));
  return required.every((r) => t.has(r));
}

export function scoreTitle(title, queryTokens) {
  const t = tokens(title);
  const set = new Set(t);
  const hit = queryTokens.filter((q) => set.has(q)).length;
  return hit / Math.max(1, queryTokens.length) - t.length * 0.01;
}

const hasDigit = (t) => /\d/.test(t);

export function imageQuery(g) {
  if (g.unknown) return null;

  if (g.kind === 'body') {
    const model = stripBrands(g.name.slice(g.brand.length)) || g.name;
    const modelTokens = tokens(model);
    const digits = modelTokens.filter(hasDigit);
    return { text: g.name, tokens: tokens(g.name), required: digits.length ? digits : modelTokens };
  }

  const spaced = g.name
    .replace(/([A-Za-z])(?=\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?mm)/g, '$1 ') // EF50mm → EF 50mm
    .replace(/mm(?=[A-Za-z])/g, 'mm ');                                  // 55mmF2.8 → 55mm F2.8
  const text = g.brand && !brandOf(g.name) ? `${g.brand} ${spaced}` : spaced;
  const focal = g.name.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm/i);
  const required = focal
    ? tokens(focal[2] ? `${focal[1]}-${focal[2]}` : focal[1])
    : tokens(g.name).filter(hasDigit);
  const fallback = focal ? `${g.brand} ${focal[0].replace(/\s+/g, '')} lens`.trim() : null;
  return { text, tokens: tokens(text), required, fallback };
}
