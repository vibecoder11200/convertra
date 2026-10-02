# Analytics

Convertra ships a provider-agnostic analytics layer (`src/lib/analytics/`) that can send pageviews and conversion events to **Plausible**, **self-hosted [Umami](https://umami.is)**, or **both in parallel**. Users can opt out at any time from Settings → Privacy & data.

**Umami is the documented default**: it runs comfortably on a small VPS (~200–400MB RAM with its bundled Postgres), unlike Plausible CE whose ClickHouse dependency needs ≥2GB. Plausible remains fully supported — just set `PUB_PLAUSIBLE_URL` instead (or as well).

- Minimum supported Umami version: **v3.2.0** (the SPA pageview fallback uses `data-auto-pageview`, introduced in 3.2.0).
- Env vars are baked into the Convertra image **at build time** — changing them means rebuilding the image (see [DOCKER.md](./DOCKER.md)).

---

## 1. Deploy Umami on the VPS

A self-contained stack lives at [`deploy/umami/docker-compose.yml`](../deploy/umami/docker-compose.yml): Umami (pinned tag) + `postgres:15-alpine`, healthchecks on both services, data in a named volume, port bound to `127.0.0.1` only (TLS is the reverse proxy's job).

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

1. Settings → **Websites** → *Add website*.
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

Or in the repo-root [`docker-compose.yml`](../docker-compose.yml) environment:

```yaml
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

| Event             | Properties                                              | When                                    |
| ----------------- | ------------------------------------------------------- | --------------------------------------- |
| `convert_start`   | `from_format`, `to_format`, `converter`, `size_bytes`   | a conversion begins                     |
| `convert_complete`| same as `convert_start`                                 | a conversion succeeds                   |
| `convert_fail`    | `from_format`, `to_format`, `converter`, `reason`       | a conversion fails or is cancelled      |
| `file_select`     | `count`, `via` (`drop`/`paste`/`picker`/`zip`)          | files enter the app                     |
| `download_click`  | `from_format`, `to_format` (or `count` for "download all") | a download is triggered           |
| `settings_change` | `key`, `value`                                          | a tracked setting toggle changes        |

In Umami, these appear under your website → **Events**. Pageviews work out of the box; Umami's tracker follows client-side (SPA) navigation automatically.

## 4. Plausible (supported alternative / parallel)

Set `PUB_PLAUSIBLE_URL` (and `PUB_HOSTNAME`) to keep using Plausible. If both URLs are set, both trackers inject and both receive the same events — they run independently. Custom events only show in the Plausible dashboard after you configure matching goals; the raw events are sent regardless (visible in the network tab as `/api/event` calls).

### Turning off Plausible

Build with an empty `PUB_PLAUSIBLE_URL=` (and keep `PUB_UMAMI_*` set). Remove the corresponding GitHub Actions `vars` if your image pipeline uses them. No Convertra code changes are needed.

## 5. Opt-out behavior

- The **Privacy & data** section in Settings has a single Analytics opt-in/opt-out toggle; opting out stops all providers immediately (including pageviews triggered by the Back button) and buffered, not-yet-transmitted events are dropped rather than sent.
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

**Upgrading Umami** (image tag is pinned on purpose):

1. Read the release notes between your tag and the target: <https://github.com/umami-software/umami/releases>.
2. Bump the tag in `deploy/umami/docker-compose.yml`.
3. `docker compose pull && docker compose up -d` (migrations run automatically on boot).

Keep at least **v3.2.0** — Convertra's SPA-pageview fallback relies on `data-auto-pageview` from that release.
