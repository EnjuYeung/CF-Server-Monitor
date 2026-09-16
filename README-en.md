# Server Monitor

Independent fork of CF-Server-Monitor. The controller is now a single Node.js 24 process with Vue 3, native HTTP/WebSocket and persistent SQLite WAL storage, deployed with Docker Compose on a bridge network. TLS terminates at your reverse proxy. Fresh installations only; no old database migration.

Initial scope: up to 50 Agents and 10 dashboard viewers, one controller replica, seven days of history, automatic country detection with manual override, and manual SQLite backup. Original Agent reporting/configuration protocols remain supported, including an Agent running natively on the same VPS as the Docker controller.

```bash
cp .env.example .env
# Set API_SECRET to your own random secret (at least 16 characters).
# Set ADMIN_PATH to a separate random 8–128 character path, e.g. openssl rand -hex 12.
docker compose up -d --build
curl -f http://127.0.0.1:8080/healthz
```

The domain root shows the dashboard without an anonymous settings link. Open `/<ADMIN_PATH>` using the value from `.env`; `/admin` returns 404. After signing in, the dashboard settings icon opens the same admin UI. Initial credentials are `admin` and your API_SECRET. The default binding is loopback port 8080. Configure your reverse proxy using `deploy/nginx.conf.example`, and set TRUSTED_PROXIES to its actual source IP/CIDR. Never trust every address. Data is mounted from `./data` to `/app/data`; retain it across container replacements.

Enable 2FA in Settings → Security using your current password, then scan the QR code in 1Password or Google Authenticator (or enter the manual key) and confirm its six-digit code. TOTP uses SHA-1 and 30-second steps. Save the ten one-time recovery codes shown after activation. Disabling 2FA requires your password and a fresh code or recovery code. Changing 2FA revokes other sessions. Keep the original API_SECRET when restoring encrypted 2FA data; disable 2FA before rotating that secret, then re-enroll.

Download a consistent database snapshot in Admin → Database → Download database backup. Stop the controller before restoring the snapshot as `data/monitor.sqlite`, using a fresh data directory without stale WAL/SHM files. Keep the corresponding `.env` separately. No automatic backup or online restore is provided.

Development requires Node.js 24.11+ (24.x) and Go 1.26.8: run `npm ci`, `npm run geoip:download`, `npm run build`, then `npm start`. Validate with `npm run test:all` and `npm run test:acceptance`.

GeoIP updates run in the background at startup and every 24 hours, requesting the current UTC month's DB-IP Country Lite database. Verified downloads are stored in `data/geoip/dbip-country-lite.mmdb` and loaded immediately for subsequent Agent reports. Unchanged files are not rewritten; failed downloads or writes retain the current database and retry the next day. Restarts select the newer valid bundled or persisted database. The data directory preserves updates across container recreation; SQLite backups do not include the downloadable GeoIP database.

See [Chinese deployment guide](README.md), [architecture](architecture.md), [code map](code_map.md), [latest test report](TEST_REPORT.md), [API](API.md), and [change log](changelog.md) for full details and known limits.

Based on [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor) and [cfsm-agent](https://github.com/huilang-me/cfsm-agent). IP Geolocation by [DB-IP](https://db-ip.com); see `geoip/NOTICE.md` for attribution.

## Native Agent

The Go Agent source is included in `agent/`, based on upstream stable v1.0.16. The current native Agent version is v1.1.1, independent of the controller version. Docker builds exactly four targets: Linux amd64/arm64 and FreeBSD amd64/arm64. macOS, Windows, 32-bit x86/ARM and LoongArch binaries are not published. Installation, version discovery and automatic updates use the controller's `/agent` endpoints; GitHub Releases are not required. Metrics, probes, traffic accounting, reporting, configuration and service management retain upstream behavior.

Production startup archives bundled binaries under `data/agent-releases`, preserving explicit-version installations across image upgrades. Automatic updates remain off by default. Bump `agent/release.json` before shipping changed binaries; reusing a version with different artifacts is rejected. `CONTROLLER_URL` accepts legacy `WORKER_URL` configurations. The SQLite backup does not include binary archives. See [agent/README.md](agent/README.md) for builds, mirrors, updates and platform support.
