const $ = (s) => document.querySelector(s);
const state = { data: null, byId: new Map(), current: null, offset: 0 };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const plural = (n, w, pl = w + 's') => `${n.toLocaleString()} ${n === 1 ? w : pl}`;

// ───────── cover pictures ─────────

function paintCover(el, gear) {
  el.replaceChildren();
  el.classList.toggle('loading', gear.cover === null);
  if (gear.cover?.url) {
    const img = new Image();
    img.alt = gear.name;
    // Studio shots and photos fill the card; small phone renders sit centred on white.
    img.className = gear.cover.source === 'GSMArena' ? 'fit' : 'fill';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = gear.cover.url;
    img.onerror = () => { el.replaceChildren(questionMark()); };
    el.append(img);
  } else if (gear.cover) {
    el.append(questionMark());
  }
}

function questionMark() {
  return Object.assign(document.createElement('div'), { className: 'q', textContent: '?' });
}

function repaint(gear) {
  document.querySelectorAll(`[data-cover="${gear.id}"]`).forEach((el) => paintCover(el, gear));
}

// Look up missing covers a few at a time, in the order they appear on screen.
const queue = [];
let running = 0;
function enqueueCover(gear, retry = false) {
  queue.push({ gear, retry });
  pump();
}
function pump() {
  while (running < 3 && queue.length) {
    const { gear, retry } = queue.shift();
    running++;
    api(`/_gearbox/api/cover/${gear.id}${retry ? '?retry=1' : ''}`)
      .then((cover) => { gear.cover = cover; })
      .catch(() => { gear.cover = { url: null, failed: true }; })
      .finally(() => { running--; repaint(gear); if (state.current === gear) fillDetail(gear); pump(); });
  }
}

// ───────── shelves ─────────

function card(gear) {
  const btn = document.createElement('button');
  btn.className = 'card';
  btn.innerHTML = `
    <div class="cover" data-cover="${gear.id}"></div>
    <div class="label">
      <span class="text"><span class="name"></span><span class="sub"></span></span>
      <span class="count"></span>
    </div>`;
  btn.querySelector('.name').textContent = gear.name;
  btn.querySelector('.name').title = gear.name;
  btn.querySelector('.count').textContent = gear.count.toLocaleString();
  const sub = gear.unknown
    ? (gear.kind === 'lens' ? 'no lens info (0.0mm f/0 and friends)' : 'no camera info, or just a brand')
    : gear.kind === 'body' ? [gear.code, gear.typeLabel].filter(Boolean).join(' · ')
    : gear.brand && !gear.name.toLowerCase().includes(gear.brand.toLowerCase()) ? (gear.brandFromBody ? `on ${gear.brand} bodies` : gear.brand) : '';
  btn.querySelector('.sub').textContent = sub;
  btn.querySelector('.sub').hidden = !sub;
  btn.addEventListener('click', () => openDetail(gear));
  paintCover(btn.querySelector('.cover'), gear);
  return btn;
}

function render() {
  if (!state.data) return;
  const q = $('#filter').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const cmp = sort === 'name'
    ? (a, b) => a.unknown - b.unknown || a.name.localeCompare(b.name, undefined, { numeric: true })
    : (a, b) => a.unknown - b.unknown || b.count - a.count || a.name.localeCompare(b.name);

  for (const [list, el, countEl] of [[state.data.bodies, '#bodies', '#bodyCount'], [state.data.lenses, '#lenses', '#lensCount']]) {
    const shown = list.filter((g) => !q || g.name.toLowerCase().includes(q) || g.brand?.toLowerCase().includes(q)).sort(cmp);
    $(countEl).textContent = `· ${list.length}`;
    const grid = $(el);
    grid.replaceChildren(...shown.map(card));
    if (!shown.length) grid.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: q ? 'Nothing matches.' : 'Nothing here yet.' }));
  }
}

async function load(refresh = false) {
  $('#error').hidden = true;
  $('#refresh').disabled = true;
  if (refresh) $('#summary').textContent = 'Rescanning your library…';
  try {
    const data = await api(`/_gearbox/api/gear${refresh ? '?refresh=1' : ''}`);
    state.data = data;
    state.byId = new Map([...data.bodies, ...data.lenses].map((g) => [g.id, g]));
    $('#summary').textContent = `${plural(data.total, 'photo')} · ${plural(data.bodies.length, 'body', 'bodies')} · ${plural(data.lenses.length, 'lens', 'lenses')} · scanned ${new Date(data.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    render();
    const order = [...data.bodies, ...data.lenses].sort((a, b) => b.count - a.count);
    order.filter((g) => g.cover === null).forEach((g) => enqueueCover(g));
  } catch (e) {
    if (e.status === 401) {
      location.href = `/auth/login?continue=${encodeURIComponent('/gearbox')}`;
      return;
    }
    $('#error').textContent = `Couldn't read Immich: ${e.message}`;
    $('#error').hidden = false;
    $('#summary').textContent = 'Not connected';
  } finally {
    $('#refresh').disabled = false;
  }
}

// ───────── detail view ─────────

function fillDetail(gear) {
  const KIND = { phone: 'Phone', drone: 'Drone', action: 'Action camera', compact: 'Compact camera' };
  $('#dKind').textContent = gear.kind === 'lens' ? 'Lens' : KIND[gear.type] || 'Camera body';
  $('#dName').textContent = gear.name;
  $('#dCount').textContent = plural(gear.count, 'photo')
    + (gear.code ? ` · model ${gear.code}` : '')
    + (gear.kind === 'lens' && gear.brand ? (gear.brandFromBody ? ` · used on ${gear.brand} bodies` : ` · ${gear.brand}`) : '');
  $('#dBuiltin').textContent = gear.builtin?.length ? `Built-in lens: ${gear.builtin.join(', ')}` : '';
  $('#dBuiltin').hidden = !gear.builtin?.length;
  paintCover($('#dCover'), gear);
  $('#dCover').dataset.cover = gear.id;

  const src = $('#dSource');
  src.replaceChildren();
  if (gear.unknown) src.textContent = 'No EXIF to go on, so it gets a “?”.';
  else if (gear.cover === null) src.textContent = 'Looking for a picture…';
  else if (gear.cover?.failed) src.textContent = 'Picture lookup failed (offline?). Try “Search again”.';
  else if (!gear.cover?.url) src.textContent = 'No picture found — pick one yourself, or keep the “?”.';
  else {
    src.append('Picture: ');
    const a = Object.assign(document.createElement('a'), { href: gear.cover.page || gear.cover.url, target: '_blank', rel: 'noopener', textContent: gear.cover.source || 'source' });
    src.append(a);
    if (gear.cover.guess) src.append(' · best guess (the lens name has no model details)');
  }

  const searchable = !gear.unknown && gear.raw;
  $('#dSearch').hidden = !searchable;
  // model only: one card can cover several spellings of the maker's name
  const query = gear.kind === 'body' ? { model: gear.raw?.model } : { lensModel: gear.raw?.lensModel };
  if (searchable) $('#dSearch').href = `/search?query=${encodeURIComponent(JSON.stringify(query))}`;
  for (const id of ['#dPick', '#dRetry', '#dQuestion']) $(id).hidden = gear.unknown;
}

async function loadPhotos(reset) {
  const gear = state.current;
  if (reset) { state.offset = 0; $('#dPhotos').replaceChildren(); }
  const { total, items } = await api(`/_gearbox/api/gear/${gear.id}/assets?offset=${state.offset}&limit=120`);
  if (state.current !== gear) return;
  state.offset += items.length;
  $('#dPhotos').append(...items.map((id) => {
    const a = Object.assign(document.createElement('a'), { href: `/photos/${id}`, target: '_blank', rel: 'noopener' });
    a.append(Object.assign(new Image(), { src: `/api/assets/${id}/thumbnail?size=thumbnail`, loading: 'lazy', alt: '' }));
    return a;
  }));
  $('#dMore').hidden = state.offset >= total;
}

function openDetail(gear) {
  state.current = gear;
  fillDetail(gear);
  $('#detail').showModal();
  loadPhotos(true).catch((e) => toast(e.message));
}

async function setCover(body) {
  const gear = state.current;
  try {
    gear.cover = await api(`/_gearbox/api/cover/${gear.id}`, { method: 'PUT', body: JSON.stringify(body) });
    repaint(gear);
    fillDetail(gear);
  } catch (e) { toast(e.message); }
}

$('#dPick').addEventListener('click', () => {
  const url = prompt('Paste an image URL for this gear (leave empty to reset to automatic):', state.current.cover?.manual ? state.current.cover.url || '' : '');
  if (url === null) return;
  setCover(url.trim() ? { url: url.trim() } : { reset: true });
});
$('#dQuestion').addEventListener('click', () => setCover({ url: null }));
$('#dRetry').addEventListener('click', () => {
  const gear = state.current;
  if (gear.cover?.manual) return setCover({ reset: true });
  gear.cover = null;
  repaint(gear); fillDetail(gear);
  enqueueCover(gear, true);
});
$('#dAlbum').addEventListener('click', async () => {
  const gear = state.current;
  if (!confirm(`Create an Immich album “${gear.name}” with ${plural(gear.count, 'photo')}?`)) return;
  const btn = $('#dAlbum');
  btn.disabled = true;
  try {
    const { url } = await api(`/_gearbox/api/gear/${gear.id}/album`, { method: 'POST' });
    toast('Album created');
    window.open(url, '_blank', 'noopener');
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
});
$('#dMore').addEventListener('click', () => loadPhotos(false).catch((e) => toast(e.message)));
$('#detail').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) $('#detail').close();
});
$('#detail').addEventListener('close', () => { state.current = null; });

$('#filter').addEventListener('input', render);
$('#sort').addEventListener('change', render);
$('#refresh').addEventListener('click', () => load(true));

load();
