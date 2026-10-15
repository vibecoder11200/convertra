# Analytics

Convertra ships a provider-agnostic analytics layer (`src/lib/analytics/`) that can send pageviews and conversion events to **Plausible**, **self-hosted [Umami](https://umami.is)**, or **both in parallel**. Users can opt out at any time from Settings → Privacy & data.

**Umami is the documented default**: it runs comfortably on a small VPS (~200–400MB RAM with its bundled Postgres), unlike Plausible CE whose ClickHouse dependency needs ≥2GB. Plausible remains fully supported — just set `PUB_PLAUSIBLE_URL` instead (or as well).

- Umami auto-tracks SPA (client-side) navigation via its own History hook — Convertra ships **no SPA-pageview fallback** and needs none; verified against **v3.4.0**. Stay on a recent v3.x.
- Env vars are baked into the Convertra image **at build time** — changing them means rebuilding the image (see [DOCKER.md](./DOCKER.md)).

---

## 1. Deploy Umami on the VPS

A self-contained stack lives at [`deploy/umami/docker-compose.yml`](../deploy/umami/docker-compose.yml): Umami (pinned by image digest) + `postgres:15-alpine`, healthchecks on both services, data in a named volume, port bound to `127.0.0.1` only (TLS is the reverse proxy's job).

```shell
cd deploy/umami
cp .env.example .env
# generate the secrets, then edit .env:
#   APP_SECRET=$(openssl rand -hex 32)
#   POSTGRES_PASSWORD=$(openssl rand -hex 16)
#   (2FA key only if you plan to enable two-factor auth)
docker compose up -d
curl http://127.0.0.1:3001/api/heartbeat   # → should return ok
```

### Reverse proxy (subdomain)

Point a subdomain (e.g. `analytics.example.com`) at the loopback port:

**Caddy** (automatic HTTPS):

```
analytics.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

**nginx**:

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    # ssl_certificate / ssl_certificate_key per your setup
    # (e.g. certbot-managed fullchain.pem / privkey.pem)

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### First login — change the password

The first boot creates the user **`admin` / `umami`**. Log in at `https://analytics.example.com`, then immediately change the password (avatar menu → Profile). Do not skip this.

### Create the website and copy its ID

1. Settings → **Websites** → _Add website_.
2. Name it (e.g. `Convertra`), set the domain (e.g. `convertra.example.com`).
3. Open the website's **Edit** dialog and copy the **Website ID** (a UUID).

## 2. Wire Convertra to Umami

Set both variables at Convertra's **build** time (they are baked into the image — see [DOCKER.md](./DOCKER.md)):

```shell
docker build -t convertra \
    --build-arg PUB_UMAMI_URL=https://analytics.example.com \
    --build-arg PUB_UMAMI_WEBSITE_ID=<your-website-id> \
    # ...your other PUB_* args
    .
```

Or in a root `.env` next to [`docker-compose.yml`](../docker-compose.yml) — compose passes it to the image build as a build arg:

```env
PUB_UMAMI_URL=https://analytics.example.com
PUB_UMAMI_WEBSITE_ID=<your-website-id>
```

…then rebuild (`docker compose up --build`). That's it — pageviews and conversion events now land in the Umami dashboard.

<details>
<summary>Using Umami Cloud instead of self-hosting</summary>

Set `PUB_UMAMI_URL` to your Umami Cloud URL (e.g. `https://analytics.umami.is`) and `PUB_UMAMI_WEBSITE_ID` to the website ID from the cloud dashboard. Everything else is identical.

</details>

## 3. Events Convertra sends

Both providers receive identical events (no file names, no error strings — only formats, sizes, and counts):

| Event              | Properties                                                 | When                               |
| ------------------ | ---------------------------------------------------------- | ---------------------------------- |
| `convert_start`    | `from_format`, `to_format`, `converter`, `size_bytes`      | a conversion begins                |
| `convert_complete` | same as `convert_start`                                    | a conversion succeeds              |
| `convert_fail`     | `from_format`, `to_format`, `converter`, `reason`          | a conversion fails or is cancelled |
| `file_select`      | `count`, `via` (`drop`/`paste`/`picker`/`zip`)             | files enter the app                |
| `download_click`   | `from_format`, `to_format` (or `count` for "download all") | a download is triggered            |
| `settings_change`  | `key`, `value`                                             | a tracked setting toggle changes   |

In Umami, these appear under your website → **Events**. Pageviews work out of the box; Umami's tracker follows client-side (SPA) navigation automatically.

### Testing locally

Plausible's script silently drops **all** events when the page hostname is `localhost` (or any localhost-equivalent) — this is upstream behavior, not a Convertra bug. To test end-to-end against a local Plausible, serve Convertra under a hostname that resolves to `127.0.0.1` but doesn't look like localhost, for example:

```shell
# localtest.me resolves to 127.0.0.1 via public DNS
PUB_HOSTNAME=convertra.localtest.me docker compose up -d --build
# then open http://convertra.localtest.me:3000/
```

Umami's tracker has no such restriction and beacons fine from `localhost`.

## 4. Plausible (supported alternative / parallel)

Set `PUB_PLAUSIBLE_URL` (and `PUB_HOSTNAME`) to keep using Plausible. If both URLs are set, both trackers inject and both receive the same events — they run independently. Custom events only show in the Plausible dashboard after you configure matching goals; the raw events are sent regardless (visible in the network tab as `/api/event` calls).

### Turning off Plausible

Build with an empty `PUB_PLAUSIBLE_URL=` (and keep `PUB_UMAMI_*` set). Remove the corresponding GitHub Actions `vars` if your image pipeline uses them. No Convertra code changes are needed.

## 5. Opt-out behavior

- The **Privacy & data** section in Settings has a single Analytics opt-in/opt-out toggle. Opting out removes the tracker scripts, restores the History methods, re-arms no-op stubs, and — most importantly — sets the trackers' own per-send opt-out flags (`plausible_ignore` in localStorage for Plausible, `umami.disabled` for Umami), which both scripts re-check on every send. This stops pageviews immediately, including those triggered by the Back button on an already-loaded tracker. Buffered, not-yet-transmitted events are dropped rather than sent.
- Known residual: if Plausible was loaded _before_ opting out, its engagement flush can emit a single last beacon (containing the last visited URL) on the next tab hide, which its `plausible_ignore` flag does not guard. Umami has no equivalent residual.
- `PUB_DISABLE_ALL_EXTERNAL_REQUESTS=true` disables analytics (and every other external request) at build time; the Settings toggle section is hidden in that mode.

## 6. Operations

**RAM expectation:** the compose idles around 200–400MB total (app ~100–150MB, Postgres ~100–250MB depending on traffic).

**Backups** — the whole database lives in the `umami-db-data` volume:

```shell
docker compose exec db pg_dump -U umami umami > umami-backup.sql
# restore:
cat umami-backup.sql | docker compose exec -T db psql -U umami umami
```

**Using a shared Postgres instead of the bundled one:** drop the `db` service and set `DATABASE_URL` in the Umami service to the shared instance's URL — a one-line change.

**Upgrading Umami** (the image is pinned by digest on purpose — ghcr publishes no version tags, only `latest`):

1. Read the release notes since your pinned version: <https://github.com/umami-software/umami/releases>.
2. Resolve the digest of the release you want and verify its version:
    ```shell
    docker pull ghcr.io/umami-software/umami:latest
    docker buildx imagetools inspect ghcr.io/umami-software/umami:latest   # copy the index Digest
    docker run --rm --entrypoint sh ghcr.io/umami-software/umami:latest \
        -c "node -e \"console.log(require('/app/package.json').version)\""
    ```
3. Replace the digest in `deploy/umami/docker-compose.yml` with the one you copied.
4. `docker compose pull && docker compose up -d` (migrations run automatically on boot).

Convertra ships no SPA-pageview fallback — Umami auto-tracks client-side navigation natively (verified against v3.4.0), so stay on a recent v3.x release.
