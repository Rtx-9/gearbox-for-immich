// A pretend Immich with ~1,400 fake photos, for trying Gearbox without a real server.
//   node dev/mock-immich.mjs                          → mock Immich on :2283
//   IMMICH_URL=http://localhost:2283 node server.mjs  → Gearbox on :2285
//   open http://localhost:2285/auth/login and click "Sign in"

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const SESSION = 'mock-session-token';
const KIT = [
  [{ make: 'NIKON CORPORATION', model: 'NIKON D3' }, ['AF-S DX Zoom-Nikkor 18-55mm f/3.5-5.6G ED', 'AF-S Nikkor 50mm f/1.8G', '0.0 mm f/0.0'], 420],
  [{ make: 'NIKON CORPORATION', model: 'NIKON D90' }, ['18.0-105.0 mm f/3.5-5.6', 'AF-S DX Zoom-Nikkor 18-55mm f/3.5-5.6G ED'], 180],
  [{ make: 'Canon', model: 'Canon EOS 5D Mark III' }, ['EF50mm f/1.8 STM', 'EF24-70mm f/2.8L II USM'], 230],
  [{ make: 'SONY', model: 'ILCE-7M3' }, ['FE 24-70mm F2.8 GM', '----'], 140],
  [{ make: 'FUJIFILM', model: 'X-T3' }, ['XF18-55mmF2.8-4 R LM OIS', null], 95],
  [{ make: 'Apple', model: 'iPhone 13' }, ['iPhone 13 back dual wide camera 5.1mm f/1.6'], 260],
  [{ make: 'RICOH IMAGING COMPANY, LTD.', model: 'PENTAX K-1' }, ['0.0 mm f/0.0'], 40],
  [{ make: 'Hasselblad', model: 'Hasselblad 500C/M' }, [null], 3],
  [{}, [null], 30],
];

const assets = [];
for (const [body, lenses, n] of KIT) {
  for (let i = 0; i < n; i++) {
    assets.push({ id: randomUUID(), type: 'IMAGE', exifInfo: { ...body, lensModel: lenses[i % lenses.length] }, hue: Math.floor(Math.random() * 360) });
  }
}
assets.sort(() => Math.random() - 0.5);
const byId = new Map(assets.map((a) => [a.id, a]));

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const authed = (req) => cookies(req).immich_access_token === SESSION;

const navItem = (href, label, d) => `<div><a href="${href}" style="display:flex;gap:14px;align-items:center;padding:10px 18px;border-radius:0 99px 99px 0;color:#ddd;text-decoration:none"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="${d}"/></svg><span>${label}</span></a></div>`;
const shell = (main) => `<!doctype html><html><head><meta charset="utf-8"><title>Immich (mock)</title></head>
<body style="margin:0;display:flex;font-family:system-ui;background:#000;color:#eee;min-height:100vh">
<nav aria-label="primary" style="width:240px;padding-top:12px"><p style="padding:0 18px;font-weight:700;color:#adcbfa;font-size:22px">immich <small style="font-size:11px;color:#888">mock</small></p>
${navItem('/photos', 'Photos', 'M8.5 13.5l2.5 3 3.5-4.5 4.5 6H5m16 1V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z')}
${navItem('/explore', 'Explore', 'M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.6-.6 3.1-1.6 4.2l.3.3h.8l5 5-1.5 1.5-5-5v-.8l-.3-.3A6.5 6.5 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5z')}
${navItem('/sharing', 'Sharing', 'M16 13c-.3 0-.7 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5m-8 0c-2.3 0-7 1.2-7 3.5V19h14v-2.5c0-2.3-4.7-3.5-7-3.5m0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6m8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')}
${navItem('/albums', 'Albums', 'M3 3h18v18H3z')}
</nav><main style="padding:24px">${main}</main></body></html>`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let body = '';
  for await (const c of req) body += c;
  const json = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
  const html = (s, h, extra = {}) => { res.writeHead(s, { 'content-type': 'text/html; charset=utf-8', ...extra }); res.end(h); };

  if (p === '/auth/login') {
    const next = url.searchParams.get('continue') || '/photos';
    if (url.searchParams.has('go')) {
      res.writeHead(302, { location: next, 'set-cookie': `immich_access_token=${SESSION}; Path=/; HttpOnly; SameSite=Lax` });
      return res.end();
    }
    return html(200, shell(`<h1>Sign in</h1><p>This is the mock Immich.</p><a style="color:#adcbfa" href="/auth/login?go=1&continue=${encodeURIComponent(next)}">Sign in</a>`));
  }
  if (!p.startsWith('/api/')) {
    return html(200, shell(authed(req) ? `<h1>${p}</h1><p>Mock Immich page. Look at the sidebar.</p>` : `<h1>Welcome</h1><a style="color:#adcbfa" href="/auth/login">Sign in</a>`));
  }

  if (!authed(req)) return json(401, { message: 'Authentication required' });

  if (p === '/api/users/me') return json(200, { id: 'user-1', name: 'Mock User', email: 'mock@example.com' });
  if (req.method === 'POST' && p === '/api/search/metadata') {
    const { page = 1, size = 250 } = JSON.parse(body || '{}');
    const items = assets.slice((page - 1) * size, page * size).map(({ hue, ...a }) => a);
    return json(200, { assets: { total: items.length, count: items.length, items, nextPage: page * size < assets.length ? String(page + 1) : null } });
  }
  const thumb = p.match(/^\/api\/assets\/([\w-]+)\/thumbnail$/);
  if (thumb) {
    const a = byId.get(thumb[1]);
    if (!a) return json(404, { message: 'Not found' });
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a.hue} 70% 65%)"/><stop offset="1" stop-color="hsl(${(a.hue + 60) % 360} 60% 35%)"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`);
  }
  if (req.method === 'POST' && p === '/api/albums') return json(201, { id: randomUUID(), ...JSON.parse(body) });
  if (req.method === 'PUT' && /^\/api\/albums\/[\w-]+\/assets$/.test(p)) return json(200, []);
  json(404, { message: 'Not found' });
}).listen(2283, () => console.log(`mock immich: ${assets.length} assets on http://localhost:2283`));
