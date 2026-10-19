// Turning messy EXIF make/model/lens strings into tidy gear names and search queries.

const BRANDS = [
  ['nikon', 'Nikon'], ['canon', 'Canon'], ['sony', 'Sony'], ['fujifilm', 'Fujifilm'], ['fuji', 'Fujifilm'],
  ['om digital', 'OM System'], ['om system', 'OM System'], ['olympus', 'Olympus'], ['panasonic', 'Panasonic'],
  ['leica', 'Leica'], ['pentax', 'Pentax'], ['ricoh', 'Ricoh'], ['samsung', 'Samsung'], ['apple', 'Apple'],
  ['google', 'Google'], ['hasselblad', 'Hasselblad'], ['sigma', 'Sigma'], ['dji', 'DJI'], ['gopro', 'GoPro'],
  ['kodak', 'Kodak'], ['konica minolta', 'Konica Minolta'], ['minolta', 'Minolta'], ['xiaomi', 'Xiaomi'],
  ['huawei', 'Huawei'], ['oneplus', 'OnePlus'], ['motorola', 'Motorola'], ['nothing', 'Nothing'], ['lg', 'LG'],
  ['phase one', 'Phase One'], ['tamron', 'Tamron'], ['tokina', 'Tokina'], ['zeiss', 'Zeiss'],
  ['carl zeiss', 'Zeiss'], ['voigtlander', 'Voigtländer'], ['voigtländer', 'Voigtländer'], ['samyang', 'Samyang'],
  ['rokinon', 'Rokinon'], ['viltrox', 'Viltrox'], ['ttartisan', 'TTArtisan'], ['7artisans', '7Artisans'],
  ['laowa', 'Laowa'], ['yongnuo', 'Yongnuo'], ['insta360', 'Insta360'], ['casio', 'Casio'], ['nokia', 'Nokia'],
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BRAND_RES = BRANDS.map(([k, v]) => [new RegExp(`^${escape(k)}(?![a-z0-9])`, 'i'), v]);
const CORP = /\b(corporation|corp\.?|co\.?,?\s*ltd\.?|ltd\.?|company|inc\.?|imaging|optical|digital solutions|electronics?)\b/gi;

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

// The "0.0 mm f/0.0" crowd: manual lenses, adapters, phones that don't say.
export function isJunkLens(s) {
  const t = prettyLens(s || '');
  return !t
    || /^[-\s.?]*$/.test(t)
    || /^(0+\s*mm)?\s*(f\/?\s*0+)?$/i.test(t)
    || /^[-\s]*mm\s*f\/?[-\s]*$/i.test(t)
    || /^(unknown|none|n\/a|manual lens)\b/i.test(t)
    || /^\(?\d+\)?$/.test(t); // bare lens-ID numbers
}

function body(ex) {
  const make = (ex.make || '').trim();
  const model = (ex.model || '').trim();
  if (!make && !model) return { kind: 'body', key: '?', name: 'Unknown camera', brand: '', unknown: true };
  const brand = brandOf(model) || brandOf(make) || tidyMake(make);
  const m = stripBrands(model) || model;
  const name = m ? `${brand} ${m}`.trim() : `${brand} (unknown model)`;
  return { kind: 'body', key: `${make}|${model}`.toLowerCase(), name, brand, raw: { make: ex.make, model: ex.model } };
}

function lens(ex, bodyBrand) {
  const raw = (ex.lensModel || '').trim();
  if (isJunkLens(raw)) return { kind: 'lens', key: '?', name: 'Unknown lens', brand: '', unknown: true };
  const name = prettyLens(raw);
  return { kind: 'lens', key: name.toLowerCase(), name, brand: brandOf(name), raw: { lensModel: ex.lensModel }, bodyBrand };
}

export function gearForAsset(exif) {
  const b = body(exif);
  return [b, lens(exif, b.unknown ? '' : b.brand)];
}

// ───────── matching search results ─────────

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

  // Phone "lenses" ("iPhone 13 back dual wide camera 5.1mm f/1.6") → look for the phone itself.
  const phone = g.name.match(/^(.*?)\s+(back|front|rear)\b/i);
  if (phone) {
    const device = phone[1];
    const text = brandOf(device) || !g.brand ? device : `${g.brand} ${device}`;
    const t = tokens(device);
    return { text, tokens: tokens(text), required: t.filter(hasDigit).length ? t.filter(hasDigit) : t };
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
