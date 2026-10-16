# Smart Tourist Safety System (STS)

A full-stack web app that keeps tourists safe and gives admins a live view of them.
Tourists carry a GPS wristband (simulated for now). Admins draw geofence zones, watch every
tourist on a live map, and respond to SOS alerts. A risk engine, safety check-ins and a
tamper-evident audit trail run in the background.

**Stack:** React 18 + Vite (client) · Node/Express + Socket.IO (backend) · MongoDB Atlas via Mongoose · JWT auth · Leaflet maps.

---

## Contents

1. [Quick start](#1-quick-start)
2. [How the system works](#2-how-the-system-works)
3. [Every working feature](#3-every-working-feature)
4. [Backend API reference](#4-backend-api-reference)
5. [Real-time (Socket.IO) events](#5-real-time-socketio-events)
6. [Risk engine, safety checks and the audit chain](#6-risk-engine-safety-checks-and-the-audit-chain)
7. [Scripts and the GPS simulator](#7-scripts-and-the-gps-simulator)
8. [Project structure](#8-project-structure)
9. [Unimportant / generated files](#9-unimportant--generated-files-safe-to-ignore)
10. [What is NOT built yet](#10-what-is-not-built-yet)

---

## 1. Quick start

**Requirements:** Node 18+ and a MongoDB Atlas connection string.

```bash
# Backend
cd backend
cp .env.example .env        # then fill in MONGODB_URI and two long random JWT secrets
npm install
npm start                   # http://localhost:5000  (npm run dev for auto-restart)

# Frontend (second terminal)
cd client
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:5000/api
npm install
npm run dev                 # http://localhost:5173
```

Create the first admin (admins cannot self-register):

```bash
cd backend
node ../scripts/seedAdmin.js --name "Your Name" --email you@example.com --password "a-strong-password"
```

Open <http://localhost:5173>. Backend health check: <http://localhost:5000/api/health>
(opening `http://localhost:5000/` shows "Route not found" — that is normal, the backend only serves `/api/...`).

### Environment variables (`backend/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | 5000 |
| `MONGODB_URI` | MongoDB Atlas connection string | — (required) |
| `CLIENT_ORIGIN` | Allowed CORS origin | `http://localhost:5173` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing secrets | — (required) |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Token lifetimes | 15m / 7d |
| `BCRYPT_ROUNDS` | Password hash cost | 12 |
| `SAFETY_CHECK_INTERVAL_MINUTES` | Gap between check-ins | 25 |
| `SAFETY_CHECK_RESPONSE_WINDOW_MINUTES` | Time to answer a check-in | 5 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Optional SMS alerts (blank = off) | off |

`client/.env` only needs `VITE_API_BASE_URL`.

---

## 2. How the system works

```
 Wristband / GPS simulator ──POST telemetry──▶ Backend (Express) ──▶ MongoDB
        (device API key)                         │  geofencing · risk engine · SOS · audit chain
                                                 ▼
                                   Socket.IO (live push) ──▶ Admin dashboard
                                                         └─▶ Tourist app
```

- A device sends `{lat, lng, battery, sosPressed}` to `POST /api/devices/:id/telemetry` using its own API key.
- The backend saves the ping, checks which zones the device is inside, fires SOS/violation logic,
  re-scores risk, writes audit proofs, then pushes updates to the right browsers over Socket.IO.
- Admins join an `admin` room and see everything. Each tourist joins a private room and only sees their own events.

---

## 3. Every working feature

Everything below was checked against the running code. "Tested" means exercised end-to-end against the
real backend and database during development (37 automated API checks plus headless-browser runs of every page).

### 3.1 Accounts and security

| Feature | Details |
|---|---|
| Tourist registration | Name, email, password (min 8 chars), optional phone. Always creates the `tourist` role. |
| Login / logout | Email + password. Short-lived access token + refresh token. |
| Silent token refresh | On a 401 the client refreshes once and retries; if that fails the session ends. |
| Session restore | Tokens kept in `localStorage`; `/auth/me` restores the user on reload. |
| Role-based access | Admin and tourist areas are separate; the wrong role is redirected to its own home. Backend routes enforce roles too. |
| Admin creation | Only via `scripts/seedAdmin.js` (no public admin sign-up). |
| Device authentication | Each wristband/simulator gets a random API key shown **once**; only its bcrypt hash is stored. Phone devices have no key and cannot use the device-key route. |
| Password show/hide | Eye toggle on login and register. |

### 3.2 Public pages

- **Landing page** — product summary, four feature cards, Sign in / Register buttons, live backend + database health line, theme toggle. Logged-in users are redirected to their dashboard.
- **Login** and **Register** — inline error messages, loading states, return-to-previous-page after login.
- **404 page** with a way back home.

### 3.3 Admin area (`/admin/*`)

**Dashboard (`/admin`)**
- Four live stat cards: active tourists, active SOS alerts, open incidents, registered devices.
- Live map with risk-coloured markers, zones, legend and full-screen mode.
- Risk board: every tourist's current score and level, highest first, linking to their map position.
- Recent SOS alerts with source and time.
- Incidents-per-day bar chart (last 14 days).
- "Updated X ago" indicator.

**Live map (`/admin/map`)**
- All tourists on one map; markers coloured by risk level (low / medium / high / critical), a pulsing diamond for SOS/emergency, grey for offline.
- Searchable tourist list (emergencies first, then highest risk) with "Silent" badge for devices that stopped reporting.
- Click a tourist (or a marker) to fly to them and load their recent route.
- Route replay: play/pause, scrub slider, reset.
- Incident heatmap toggle (SOS and zone-entry locations).
- Deep link from the risk board and directory (`?tourist=<id>`).

**Tourists (`/admin/tourists`)**
- Directory with name, email, phone, assigned device, live risk, last seen, account status.
- Search, sort by any column, pagination. Names link to the live map.

**Zones (`/admin/zones`)**
- Click the map to draw a polygon (min 3 points), with undo and clear.
- Name, type (safe / restricted / danger) with a plain explanation of what each does, risk level 0–100.
- Edit a zone (name, type, risk, active on/off) and delete with a confirmation dialog.
- Zone list and **recent geofence events** (enter/exit) with "Mark resolved".
- Zone changes appear instantly for every connected admin and tourist.

**Devices (`/admin/devices`)**
- Register a device for a tourist who has none. The API key is displayed once, with a **Copy key** button.
- Table of status, battery, last seen (relative time), last location, and a "Silent" warning after 5 minutes without data. Updates live.

**Incidents (`/admin/incidents`)**
- Table with search, status and severity filters, sort, pagination.
- Expand a row for the full timeline and its **audit proofs** with a Verify button.
- Acknowledge (tells the tourist help is responding) and Resolve (with an optional note; clears the wristband's emergency mode for SOS incidents).
- New incidents appear live.

**Analytics (`/admin/analytics`)**
- Incidents in the last 14 days, average time to acknowledge an SOS, tourists at high risk now.
- Charts: incidents per day, incidents by type, most-entered zones, tourists by risk level.

**Audit proofs (`/admin/blockchain`)**
- Number of proofs on the chain and a chain-integrity status.
- **Verify entire chain**, **Verify newest 25**, and per-proof Verify. Results show Verified / Tampered with the individual checks.
- Expand a proof to see the full data hash, chain hash and previous hash.

**Everywhere in the admin area**
- **Alert bell** — live alerts for SOS, zone violations, missed or "unsafe" check-ins, and rising risk; unread count; sound mute; optional desktop notifications.
- **Red SOS banner** across every page while an SOS is open, with a Respond button.
- Toast notifications for every action (success and failure).
- Dark/light theme toggle (remembered).
- Mobile: the sidebar becomes a slide-out menu.

### 3.4 Tourist area (`/tourist/*`)

**Home**
- Real risk level with score, a meter, plain-language advice and the top contributing factors (or "Raised automatically: …" when a rule fired).
- Device status and last seen.
- Safety check card: countdown to answer, or next expected check-in time.
- Shortcuts to the map and SOS; a banner when an SOS is open.

**Map**
- Zones, the tourist's own live browser location (green pulsing dot), their tracked device's position (phone or wristband) and recent route.
- Clear fallbacks and messages if location permission is denied, unavailable or timed out.

**Share my location (Home)**
- A switch that sends the phone's GPS to the backend every 5 seconds while the app is open and the tab is visible. See [Phone GPS](#phone-gps-tourist-location-sharing).
- Default ON as soon as the browser's location permission is granted; the choice is remembered. Shows Sharing / Blocked / No signal / Wristband states with friendly messages.

**SOS**
- Two-tap confirmation (the first tap "arms" it for 5 seconds; there is a Cancel button).
- After sending: status badge and a three-step progress view (sent → acknowledged → resolved) with timestamps and any admin note.
- Only one active SOS per tourist.

**Check-ins**
- "Are you safe?" prompt with a live countdown; **I'm safe** or **I need help** (alerts an admin immediately).
- Shows the last response.

**Profile**
- Account details.
- Emergency contacts (add, remove, save) with phone validation — these are the people texted on SOS.
- Itinerary editor (destination, arrival, departure) with date validation.

**Everywhere in the tourist area**
- Live toasts for: entering a zone (with a persistent banner for danger zones), a new check-in prompt, an admin acknowledging or resolving your SOS, and rising risk.
- Mobile: a bottom tab bar (Home, Map, SOS, Check-ins, Profile).
- Dark/light theme toggle.

### 3.5 Background automation (backend)

| Automation | What happens |
|---|---|
| **Geofencing** | Every telemetry ping is matched against zones (MongoDB geo query). Enter/exit events are logged; entering a non-safe zone raises a violation to the admin and the tourist. |
| **Auto-SOS in a danger zone** | Entering a *danger* zone automatically triggers an SOS (no button press needed). |
| **Phone GPS** | The tourist's phone reports its position to `POST /api/tourists/me/location`. It runs through the same pipeline as wristband telemetry (ping saved, geofencing, danger-zone auto-SOS, audit proofs, risk re-scoring, live sockets). |
| **Wristband SOS button** | `sosPressed: true` in telemetry triggers an SOS. A held button only creates one SOS. |
| **App SOS** | The tourist's SOS button creates the same SOS pipeline and re-scores risk immediately. |
| **Emergency mode** | Any SOS sets the device's `emergencyMode` flag (this is what the real LED/buzzer will follow) until the incident is resolved. |
| **Safety check scheduler** | Every 60 s: prompts active devices every 25 min (configurable); an unanswered check past the 5-min window becomes an automatic SOS (or a medium incident if the device has no location). Answering "unsafe" opens a high-severity incident. |
| **Risk re-evaluation** | After telemetry (throttled to once per 30 s), check-in answers and SOS. High/Critical opens or updates a single *risk escalation* incident per tourist; a score-driven Critical also triggers an SOS. |
| **Audit proofs** | Created automatically for SOS, zone violations, risk escalations and incident open/resolve. |
| **SMS to emergency contacts** | On any SOS, if Twilio keys are set, each contact is texted the tourist's name and a Google Maps link. Results are logged as `Notification` records. Skipped silently when not configured. |

### 3.6 UI/UX and accessibility

- Shared components: toasts, confirm dialogs, data table (search/sort/pagination), skeleton loaders, empty states, badges, cards, charts.
- Readable labels (e.g. "No response", not `no_response`) and relative times ("3 min ago").
- Responsive layouts at desktop, tablet and phone widths (no horizontal page scroll in the tested pages).
- Dark theme (follows the system until you choose).
- Skip-to-content link, labelled form controls, status messages announced to screen readers, keyboard-operable table rows, focus rings, and reduced-motion support. Colour is never the only signal (badges carry text).

---

## 4. Backend API reference

Base URL `http://localhost:5000/api`. Send `Authorization: Bearer <accessToken>`. Responses are JSON with `success`.

| Area | Endpoint | Who |
|---|---|---|
| Health | `GET /health` | public |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; `GET /auth/me` | public / any |
| Tourists | `GET /tourists` | admin |
| | `GET /tourists/me` | tourist, admin |
| | `PATCH /tourists/me/emergency-contacts`, `PATCH /tourists/me/itinerary` | tourist |
| | `POST /tourists/me/location` — `{ lat, lng, accuracy? }`, max 1 per 3 s per user (429 otherwise) | tourist (JWT) |
| Devices | `POST /devices`, `GET /devices` | admin |
| | `GET /devices/:deviceId`, `GET /devices/:deviceId/trail?limit=` | admin or owning tourist |
| | `POST /devices/:deviceId/telemetry` | device (`X-Device-Id` + `X-Api-Key`) |
| Zones | `GET /zones` | any signed-in user |
| | `POST /zones`, `PATCH /zones/:id`, `DELETE /zones/:id` | admin |
| Geofence events | `GET /geofence-events`, `PATCH /geofence-events/:id/resolve` | admin |
| SOS | `POST /sos`, `GET /sos/mine` | tourist |
| | `GET /sos` | admin |
| Incidents | `GET /incidents`, `PATCH /incidents/:id/acknowledge`, `PATCH /incidents/:id/resolve` | admin |
| | `GET /incidents/:id` | admin or owner |
| Safety checks | `POST /safety-checks/trigger`, `GET /safety-checks` | admin |
| | `GET /safety-checks/mine`, `POST /safety-checks/:id/respond` | tourist |
| Risk | `GET /risk` (latest per tourist), `POST /risk/:tourist/evaluate` | admin |
| | `GET /risk/mine` | tourist |
| | `GET /risk/:tourist/history` | admin or owner |
| Audit chain | `GET /blockchain`, `GET /blockchain/verify/:proofId`, `GET /blockchain/verify-chain`, `GET /blockchain/incident/:id` | admin |
| Analytics | `GET /analytics/overview` | admin |

Note: `POST /safety-checks/trigger` and `POST /risk/:tourist/evaluate` exist on the backend but have no button in the UI.

---

## 5. Real-time (Socket.IO) events

Clients connect with their access token. Admins → `admin` room; tourists → `tourist:<id>` room.

| Event | Sent to | Meaning |
|---|---|---|
| `location:update` | admin + that tourist | Device position/status changed |
| `sos:triggered`, `sos:updated` | admin + that tourist | SOS created / acknowledged / resolved |
| `incident:updated` | admin + that tourist | Incident created or changed |
| `geofence:event` | admin | Zone enter/exit logged |
| `geofence:violation` | admin + that tourist | Entered a restricted or danger zone |
| `zone:created`, `zone:updated`, `zone:deleted` | everyone connected | Zone list changed |
| `safetycheck:prompt`, `safetycheck:response`, `safetycheck:missed` | admin + that tourist | Check-in lifecycle |
| `risk:updated` | admin + that tourist | New risk assessment |
| `admin:alert` | admin | Generic alert (emitted by the backend; the UI listens to the specific events above instead) |

---

### Phone GPS (tourist location sharing)

- **Endpoint:** `POST /api/tourists/me/location` with `{ "lat": number, "lng": number, "accuracy"?: number }`. Auth: the tourist's normal JWT (no device key). Validated (lat -90..90, lng -180..180); invalid input returns `400 { success: false, message }`. Limited to **1 request per 3 seconds per user** (`429` otherwise).
- **What it does:** on the first report the backend auto-creates a device with `type: "phone"` (id `PHONE-xxxxxxxx`) and links it to the tourist, then runs the shared telemetry service (`backend/src/services/telemetry/processTelemetry.js`): saves a `LocationPing`, runs geofencing, auto-SOS in danger zones, writes audit proofs for violations, re-scores risk, and emits `location:update` / `geofence:*`. Wristband telemetry uses the very same service.
- **Response:** `{ success: true, accepted: true, deviceId }`. If the tourist already has a wristband (or simulator), the response is `{ success: true, accepted: false, reason: "wristband_assigned" }` and nothing is recorded — the system assumes one tracking device per tourist. The app then shows "Your wristband is your tracker".
- **Emergencies are preserved:** a phone ping never clears an SOS/emergency already in progress (a wristband's held button can; a phone has no button).
- **Admins:** phone-tracked tourists appear on the live map, dashboard, directory and Devices page exactly like wristband ones, labelled **Phone** or **Wristband**. An admin can still register a wristband for a phone-tracked tourist; it replaces the phone device. Phone-tracked tourists also receive safety check-ins.
- **Client:** `useLocationReporter` (watches `navigator.geolocation`, sends every 5 s while the tab is visible, stops on logout) inside `LocationSharingProvider`, switched from the "Share my location" card on tourist Home.

---

## 6. Risk engine, safety checks and the audit chain

### Risk engine (hybrid, rules always win)
1. **Rules (authoritative):** an active SOS → *Critical*; standing inside a danger zone → *Critical*. These never depend on the score.
2. **Weighted score (advisory, 0–100):** safety-check history 25 · zone risk 25 · violations in last 24 h 20 · open incidents 15 · device silent >30 min 10 · battery <20% 5.
3. **Bands:** 0–29 Low · 30–59 Medium · 60–84 High · 85–100 Critical.

A rule-triggered Critical can have a low number (for example 18/100). The tourist screen shows it as "raised automatically" for that reason.

### Audit chain (tamper-evident, not a public blockchain)
- Each critical event is hashed with SHA-256 over its fields that never change afterwards.
- Each proof also stores a link to the previous proof (`sha256(previousHash | sequence | type | dataHash)`).
- **Verify** re-hashes the live database record and compares; it detects an edited record, an edited proof, a deleted or reordered proof.
- Only hashes and ids are chained. MongoDB remains the source of truth.
- Assumes one backend instance. Publishing hashes to a public testnet is not built.

---

## 7. Scripts and the GPS simulator

Run from the `backend` folder (they use its dependencies):

| Command | What it does |
|---|---|
| `node ../scripts/seedAdmin.js --name ... --email ... --password ...` | Creates an admin user |
| `node ../scripts/listAdmins.js` | Lists admin emails |
| `node ../scripts/simulateGps.js --deviceId SIM-xxxx --apiKey <key> [--baseUrl ...] [--lat 28.6139] [--lng 77.2090] [--intervalSec 5] [--ticks 0] [--sos true]` | Pretends to be a wristband: sends a moving GPS position every few seconds. `--sos true` simulates a held SOS button. `--ticks 0` runs until Ctrl+C. |

**Typical demo:** register a device in *Admin → Devices* and copy its key → run the simulator → watch the marker move on *Live map* → draw a danger zone in its path → watch the auto-SOS, banner, alert bell and risk change → acknowledge and resolve the incident → verify its proofs on *Audit proofs*.

Backend scripts: `npm start`, `npm run dev`, `npm run lint`, `npm run format`. Client: `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`, `npm run format`.

---

## 8. Project structure

```
STS/
├─ backend/
│  └─ src/
│     ├─ server.js, app.js            entry point and Express setup
│     ├─ config/                      env + database connection
│     ├─ routes/ controllers/         REST API (one pair per area)
│     ├─ middleware/                  authenticate, authorize, device auth, error handler
│     ├─ models/                      13 Mongoose models (User, TouristProfile, Device, LocationPing, Zone,
│     │                               GeofenceEvent, SafetyCheck, SOSEvent, RiskAssessment, Incident,
│     │                               Notification, AuditProof)
│     ├─ services/
│     │  ├─ geofencing/               zone enter/exit detection
│     │  ├─ riskAssessment/           rule engine, scoring, escalation
│     │  ├─ safetyCheck/              missed/unsafe check escalation
│     │  ├─ sos/                      the single SOS pipeline
│     │  ├─ blockchain/               hash-chain + verification
│     │  └─ notifications/            Twilio SMS
│     ├─ jobs/safetyCheckScheduler.js 60-second sweep
│     └─ sockets/                     Socket.IO setup and rooms
├─ client/
│  └─ src/
│     ├─ pages/                       Home, Login, Register, NotFound
│     ├─ features/admin/              AdminHome, AdminMap, Tourists, Zones, Devices, Incidents, Analytics, Blockchain
│     ├─ features/tourist/            Home, Map, SOS, Checks, Profile
│     ├─ shared/                      auth, socket, alerts (bell + provider), theme, hooks, utils,
│     │                               components (GeoMap, RiskBoard, Charts, layouts, ui kit)
│     └─ api/client.js                fetch wrapper with token refresh
├─ scripts/                           seedAdmin, listAdmins, simulateGps
├─ docs/PHASE0_PLAN.md                original requirements and architecture plan
├─ blockchain/README.md               points to the audit-chain code in the backend
└─ firmware/README.md                 placeholder for the future ESP32 sketch
```

---

## 9. Unimportant / generated files (safe to ignore)

You do not need to read, edit or commit these.

| File / folder | What it is | Safe to delete? |
|---|---|---|
| `backend/node_modules/`, `client/node_modules/` | Installed packages | Yes — `npm install` brings them back |
| `client/dist/` | Output of `npm run build` (the folder was stale before; rebuilt during development) | Yes — regenerate with `npm run build` |
| `backend/package-lock.json`, `client/package-lock.json` | Exact dependency versions | Keep for reproducible installs; never edit by hand |
| `package-lock.json` (repo root) | Empty lockfile (no dependencies) | Yes |
| `.claude/settings.local.json` | Local Claude Code permission settings | Yes (editor tooling only) |
| `.prettierrc.json`, `.prettierignore` | Code-formatting rules | Keep if you run `npm run format` |
| `backend/eslint.config.js`, `client/eslint.config.js` | Lint rules | Keep if you run `npm run lint` |
| `.gitignore`, `backend/.gitignore`, `client/.gitignore` | Tell git what to skip | Keep once you use git |
| `backend/.env.example`, `client/.env.example` | Templates for your real `.env` files | Keep (documentation) |
| `blockchain/README.md`, `firmware/README.md`, `scripts/README.md` | Short notes about those folders (`firmware` and `scripts` notes are placeholders) | Optional |
| `docs/PHASE0_PLAN.md` | Original planning document; parts are out of date (it lists routes such as `/api/locations` and `/api/admin` that were never built) | Optional reference |
| `client/vite.config.js`, `client/index.html` | Vite bootstrap | Needed — just rarely edited |

**Do not delete or share:** `backend/.env` (real database password and JWT secrets) and `client/.env`.

Dead code worth knowing about: the backend exposes `PATCH /geofence-events/:id/resolve`, `POST /safety-checks/trigger`, `GET /risk/:tourist/history` and `POST /risk/:tourist/evaluate`; the first is used by the UI, the other three have no screen.

---

## 10. What is NOT built yet

Be aware of these when presenting or deploying:

- **Real hardware:** the ESP32 wristband firmware (`firmware/` is only a placeholder). The simulator uses the same API the hardware will.
- **Cloud deployment** (Render / Vercel / Atlas network access) and any HTTPS setup.
- **One device per tourist.** Risk, SOS and the scheduler look the device up by tourist, so phone GPS is only recorded for tourists who have no wristband (details in *Phone GPS* below).
- **SMS needs Twilio keys** you provide; it has not been tried against real phone numbers. Trial accounts only reach verified numbers.
- **No automated test suite or CI** in the repo; no rate limiting, security headers (helmet) or request-validation library on the backend. Tokens are kept in `localStorage`.
- **Not implemented:** trained ML/anomaly models, route-deviation detection, multi-language and voice SOS, installable PWA / offline SOS queue, a police-responder role, QR digital tourist ID, public-blockchain anchoring, email/push notifications to contacts.
- The audit chain assumes a single running backend instance.
- Two lint errors remain in `AuthContext.jsx` and `useLiveLocation.js` (a strict React rule about setting state inside an effect); they do not affect behaviour.
