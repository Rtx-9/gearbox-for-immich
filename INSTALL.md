# Installing Gearbox — the quick version

You need Immich already running with Docker Compose. That's it.

## 1. Download Gearbox

In the folder that has your Immich `docker-compose.yml`, run:

```bash
git clone https://github.com/Rtx-9/gearbox-for-immich gearbox
```

(No git? Download the ZIP from the GitHub page, unzip it and rename the folder to `gearbox`.) You should end up with:

```
immich-app/
├── docker-compose.yml
├── .env
├── folio/          ← if you use Folio
└── gearbox/        ← here
```

## 2. Add Gearbox to `docker-compose.yml`

Open `docker-compose.yml` and paste this under `services:` (same indent as `immich-server:`):

```yaml
  gearbox:
    container_name: immich_gearbox
    build: ./gearbox
    environment:
      IMMICH_URL: http://immich-server:2283
    volumes:
      - ./gearbox-data:/data
    ports:
      - '2285:2285'
    restart: always
```

**Using Folio too?** In Folio's service, change one line so Folio passes through Gearbox:

```yaml
      IMMICH_URL: http://immich_gearbox:2285
```

## 3. Start it

In the `immich-app` folder:

```bash
docker compose up -d --build
```

## 4. Open Immich

- **With Folio:** nothing changes — keep using port **2284** (or your domain).
- **Without Folio:** use port **2285** instead of 2283, e.g. `http://your-server:2285`.
  Using a domain? Point your reverse proxy at `immich_gearbox:2285` instead of `immich-server:2283`.

You'll see normal Immich with a new **Gearbox** item in the sidebar. Click it.
The first visit reads your whole library and downloads the picture indexes, so give it
half a minute; pictures of your gear then pop in one by one.

## Something wrong?

| Problem | Fix |
|---|---|
| No **Gearbox** in the sidebar | Go to `/gearbox` directly, e.g. `http://your-server:2284/gearbox` |
| "Gearbox could not reach Immich" | Check that `IMMICH_URL` matches your Immich container name (usually `immich-server`) |
| Folio shows that error after step 2 | Folio's `IMMICH_URL` must be `http://immich_gearbox:2285`, and Gearbox must be running |
| A body or lens has the wrong picture | Open it and use **Change picture** (paste any image link) or **Use "?"** |
| Gear pictures never load | Open **Gear report**: the *Sources* list shows which sites the server couldn't reach. It needs apotelyt.com, gsmarena.com, kamerastore.com, storage.googleapis.com and wikipedia.org |
| A picture or name is wrong | Fix it with **Change picture**, and send the **Gear report** line for it so the matching can be improved |
| First visit is slow | The first start downloads the picture indexes (~20 MB); after that it's quick |
| Want to update Gearbox | Run `git -C gearbox pull`, then `docker compose up -d --build` again |

Picked and found pictures are saved in the `gearbox-data` folder.
