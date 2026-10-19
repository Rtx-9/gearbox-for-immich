# Gearbox for Immich

A gear shelf for your Immich library: every **camera body** and **lens** you've shot with,
as album-style cards with a product picture and a photo count, most used first.

- Reads EXIF (make / model / lens) from your Immich library.
- Product pictures come from:
  - **[Apotelyt](https://apotelyt.com)** — clean product shots of ~600 camera bodies and ~1,200 lenses
  - **[GSMArena](https://www.gsmarena.com)** — phones
  - **Wikipedia** — everything else (drones, superzooms…), only when the article really is about that model
- Phone model codes become real names using Google Play's device list:
  `21081111RG` → **Xiaomi 11T**, `SM-G991B` → **Samsung Galaxy S21 5G**. DJI drone codes too
  (`FC7303` → **DJI Mini 2**).
- Phones, drones, action cams and compacts keep their lens on the camera's card
  ("Built-in lens: iPhone 14 back dual wide camera 5.7mm f/1.5") instead of filling the lens shelf.
- Gear with no info — `0.0 mm f/0.0`, `----`, empty fields, or just a brand like `MINOLTA` —
  goes under **Unknown** with a big **?**. So does anything it can't find a picture for.
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
`/data/covers.json`. The picture and device-name indexes (~20 MB) are downloaded to
`/data/indexes` on first start and refreshed every two weeks, so each site is only asked a
handful of times.

DPReview would be the obvious picture source, but it blocks automated requests, so it isn't used.

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
