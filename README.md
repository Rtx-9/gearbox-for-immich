# Gearbox for Immich

A gear shelf for your Immich library: every **camera body** and **lens** you've shot with,
as album-style cards with a product picture and a photo count, most used first.

- Reads EXIF (make / model / lens) from your Immich library.
- Finds a picture of each body and lens on **Wikipedia** and **Wikimedia Commons**
  (exact article first, e.g. `Sony ILCE-7M3` → *Sony α7 III*; then a search whose result
  must contain the model number, so a D3 never gets a D300's picture).
- Gear with no info — `0.0 mm f/0.0`, `----`, empty lens fields, photos without a camera —
  gets a big **?**. So does anything it can't find a picture for.
- Click a card to see its photos, open them in Immich, swap the picture (paste any link,
  or force the ?), or **make a real Immich album** of everything shot with it.

**Just want it running? Follow the 4-step [INSTALL.md](INSTALL.md).**

## How it works

Gearbox is a small Node.js service (no dependencies) that sits in front of Immich, the same
way [Folio](https://github.com/Rtx-9/folio-for-immich) does:

```
browser ──► (Folio :2284) ──► Gearbox :2285 ──► Immich :2283
                                 │
                                 ├─ /gearbox     the shelf page (uses your Immich login)
                                 ├─ /_gearbox/*  its files and API
                                 └─ everything else is passed through to Immich unchanged
                                    (+ a tiny script that adds "Gearbox" to the sidebar)
```

Because it's on the same domain as Immich, the browser's Immich session is all it needs —
no API key. Each person sees their own library. Found pictures are shared and remembered in
`/data/covers.json`, so Wikimedia is only asked once per item.

Folio and Gearbox chain: Folio's `IMMICH_URL` points at Gearbox, Gearbox's points at Immich,
and both add their link to the sidebar (Sharing → Folio → Gearbox).

Immich's own "plugins" are server-side workflow automations and can't add UI, so a companion
service like this is the way to extend the web app.

## Settings

| Variable           | Default                 | What                                              |
| ------------------ | ----------------------- | ------------------------------------------------- |
| `IMMICH_URL`       | `http://localhost:2283` | Where Gearbox reaches Immich                      |
| `PORT`             | `2285`                  |                                                   |
| `GEARBOX_DATA`     | `./data` (`/data` in Docker) | Where picked/found pictures are remembered   |
| `SCAN_TTL_MINUTES` | `30`                    | How long a library scan is reused (Rescan forces) |
| `ALBUM_PREFIX`     | `📷 `                   | Prefix for albums Gearbox creates                 |
| `GEARBOX_INJECT`   | `true`                  | Add the sidebar link                              |

## Try it without Immich

```bash
node dev/mock-immich.mjs
IMMICH_URL=http://localhost:2283 node server.mjs
```

Open http://localhost:2285/auth/login, click **Sign in**, then **Gearbox** in the sidebar.

## Notes

- The scan reads every asset's EXIF in pages of 1000 — a few seconds for big libraries, then cached.
- Pictures come from Wikimedia and are mostly CC-licensed; each one links back to its source
  in the detail view.
