# Server Setup and Web Surface

This document captures the current web server behavior for the Octopus project and the production host at:

- `https://energy.465streetlane.co.uk`

It is intended as a living reference for endpoint behavior, generated pages, and auth/session setup.

## Runtime layout

### Node processes in repo

- `server/web_server.js` (Express, port `52529`): main UI/API server for energy and charging views.
- `server/webhook_server.js` (Express, port `52530`): webhook receiver/logger.
- `server/socket_listener.js`: websocket listener for Home Assistant event ingestion.

This document focuses on `server/web_server.js`.

## Endpoint inventory (web_server)

### Authentication/session endpoints

- `GET /login`
  - Serves Bootstrap login form.
  - Optional query params:
    - `next` (relative path): where to redirect after successful login.
    - `error=1`: shows invalid-credentials error banner.

- `POST /login`
  - Body: `username`, `password`, optional `next`.
  - Validates credentials against configured users.
  - Creates session and sets HTTP-only cookie.
  - Redirects to `next` or `/view-electric`.

- `POST /logout`
  - Destroys the in-memory session if present.
  - Clears session cookie.
  - Redirects to `/login`.

- `GET /`
  - Redirects to `/view-electric` (after auth).

### Existing feature endpoints

- `GET /logs`
  - Activity log viewer page.
  - Query:
    - `date=YYYY-MM-DD` (default today)
    - `lines=<n>` (default 500, max 5000)
  - Reads from `logs/activity-YYYY-MM-DD.log`.

- `GET /view-electric`
  - Interactive electric dashboard (day/week/month modes, toggles, summaries, chart, table, exports).

- `GET /view-gas`
  - Interactive gas dashboard with the same UI/controls as electric.

- `GET /view_charging_events`
  - Charging events table page (search/pagination/export).
  - Optional filter query:
    - `startDate=<datetime-local>`
    - `endDate=<datetime-local>`


- `GET /api/usage/electric` and `GET /api/usage/gas`
  - Dashboard data API for bucketed usage/cost.
  - Query: `view=day|week|month`, `date=YYYY-MM-DD`, `month=YYYY-MM`, `includeTypical=0|1`, `includeLast=0|1`.
  - Returns metadata, totals, and bucket rows for current selection.

- `GET /api/usage/electric/export` and `GET /api/usage/gas/export`
  - Server-side export API for the currently displayed dashboard slice.
  - Query: same as usage API plus `format=csv|json|xlsx`.
  - Exports include metadata and rows shown in UI.

- `GET /view_charge_event/:id_number`
  - Detailed charging event view.
  - Includes editable comment textarea with Save button.

- `POST /update_table`
  - JSON endpoint used by detail page to update charging event comment.
  - Body: `{ "id": <number>, "comment": <string> }`.

- `GET /view_charge_event_error/:id_number`
  - Error-styled detail view for charge events.

- `GET /pico_display`
  - JSON endpoint used by Pico display clients.
  - Returns 8 days of daily electric/gas usage totals.

- `GET /pico_summary`
  - JSON summary endpoint.
  - Returns:
    - `7-Day Cost`
    - `Difference`
    - `This Month`

- Static assets:
  - `GET /vendor/chart.js/*` served from `node_modules/chart.js/dist`.

## Pages generated

### `GET /view-electric` and `GET /view-gas`

- Shared dashboard template and shared client module (`/public/js/usage-dashboard.js`).
- Bootstrap layout with local assets only (`/vendor/bootstrap`, `/vendor/chart.js`).
- Day/week/month controls with prev/next navigation and date/month picker.
- Toggle switches for typical usage and last-period overlay.
- Summary cards (total kWh, total £, delta panel), chart, sortable bucket table, and export dropdown (CSV/JSON/XLSX).

### `GET /view_charging_events`

- Bootstrap + bootstrap-table page.
- Search, pagination, column toggling.
- XLSX export button.
- Links each ID to `/view_charge_event/:id`.

### `GET /view_charge_event/:id`

- Detailed table view for one charging event.
- Comment textarea and async save via `fetch('/update_table', { method: 'POST' ... })`.

### `GET /logs`

- Log inspection page with date and line-count filters.
- Shows most recent lines first (reverse chronological display).

## Production host verification snapshot

Endpoints checked against `https://energy.465streetlane.co.uk`:

- `/view-electric` → `200` and HTML page.
- `/view-gas` → `200` and HTML page.
- `/view_charging_events` → `200` and HTML page.
- `/logs` → `200` and HTML page.
- `/pico_display` → `200` and JSON payload.
- `/pico_summary` → `200` and JSON payload.

(Verified by curl from this workspace.)

## Authentication and hardening model

A lightweight session-based authentication layer protects all feature routes.

### Credential sources

Credentials are loaded from one of:

1. `WEB_AUTH_USERS_FILE` environment variable path (if set), or
2. `server/web_users_active.json` symlink/file (if present), or
3. `server/web_users.json` fallback, or
4. `WEB_AUTH_USERS` environment variable containing JSON array.

Supported user shapes:

- Hash-only form (required):

```json
[
  {
    "username": "alice",
    "salt": "hex-salt",
    "passwordHash": "hex-scrypt-hash"
  }
]
```

Plain-text passwords are intentionally rejected to avoid storing clear-text credentials in config files.

To generate values, run:

```bash
node server/generate_password_hash.js "your-password"
```

### Session behavior

- Cookie name: `octopus_session`
- Cookie flags:
  - `HttpOnly`
  - `SameSite=Lax`
  - `Secure` when HTTPS is detected (`x-forwarded-proto=https`) or `WEB_AUTH_SECURE_COOKIE=true`
- Session TTL: `WEB_AUTH_SESSION_TTL_MS` (default 12 hours)
- Session storage: in-memory `Map` in `web_server.js`

### Route protection policy

- Public routes:
  - `/login` (GET/POST)
  - `/logout` (POST)
  - `/vendor/chart.js/*` static assets
- All other routes require authenticated session.
- Unauthenticated behavior:
  - Browser/HTML requests: redirect to `/login?next=<original-url>`
  - JSON/API requests: `401 { "error": "Authentication required." }`

## Operational notes

- Because sessions are in-memory, restarting `web_server.js` logs everyone out.
- For multi-instance deployment, replace in-memory session store with a shared store (e.g., Redis).
- `server/web_users.json` should not be committed with real credentials.


## Typical usage implementation

- Day view: same weekday, prior 8 weeks by hour; falls back to 4 weeks when data is sparse.
- Week view: prior 8 weeks, weekday-aligned daily averages (Mon-Sun).
- Month view: same calendar month in prior years (day-of-month averages); fallback is prior 3 months day-of-month averages.
- Typical includes both `kwh` and `cost_gbp` based on stored `price_pence` values.


## Codex test-user toggle

For temporary prod testing, two npm scripts switch which credential file is active and restart the systemd service:

- `npm run server:enable_codex` → points `server/web_users_active.json` to `server/web_users_codex.json` and runs `sudo systemctl restart octopus_web_server`.
- `npm run server:disable_codex` → points `server/web_users_active.json` to `server/web_users.json` and runs the same restart.
