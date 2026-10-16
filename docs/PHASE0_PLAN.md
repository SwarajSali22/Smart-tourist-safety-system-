# Smart Tourist Safety System — Phase 0: Requirements & Architecture

Status: awaiting approval to start Phase 1. No source code has been written.
Prepared: 24 Aug 2026.

## 0. Repository state

The connected project folder is empty — no `package.json`, no source folders,
no prior scaffold, and no earlier Phase 0 audit in project memory. This is a
from-scratch build; there is no legacy code to reconcile with the brief.

## 1. What already exists

Nothing. The project starts at zero.

## 2. What is missing

Everything in the brief still needs to be built:

- **Foundation** — repo scaffold, workspace layout, env config, linting, base Express + React apps.
- **Data layer** — MongoDB schema (users, devices, zones, events, incidents, risk history, audit proofs).
- **Auth & security** — JWT issuance/refresh, bcrypt hashing, role-based access, device-level auth for ESP32/simulator.
- **Domain logic** — geofencing, 20–30 minute safety-check scheduler, SOS pipeline, risk-assessment engine.
- **Real-time layer** — Socket.IO wiring: device/simulator → backend → admin dashboard → tourist client.
- **Interfaces** — admin dashboard (live map, alerts, zone editor, incident console) and tourist client.
- **Hardware path** — GPS/SOS/LED/buzzer simulator now, ESP32 firmware later, one shared contract between them.
- **Integrity layer** — event hashing and blockchain anchoring for SOS, violations, escalations, resolutions, key admin actions.
- **Everything past Phase 11** — hardware integration, cloud deployment, testing, hardening, final docs.

## 3. What needs deciding before Phase 1

No existing code means nothing to "fix" — but four architectural calls shape
everything downstream. Recommended defaults, pending your approval:

1. **One React app or two?** → One Vite + React app, role-based routing (`/admin/*`, `/tourist/*`), shared auth/API client/sockets.
2. **Simulator vs. real ESP32?** → Simulator speaks the exact HTTP/telemetry contract the ESP32 will use; both funnel through one `DeviceGateway` service, so hardware in Phase 12–13 is a firmware task, not a backend rewrite.
3. **How "real" should blockchain be?** → Build an internal cryptographic hash-chain first (offline-demoable, no external dependency); add an optional public-testnet anchor (Polygon Amoy) behind a config flag.
4. **Rule-based or trained-model risk scoring?** → Start with a transparent, weighted rule engine — explainable, and it satisfies "critical actions must not depend only on AI" by construction. A trained model can sit alongside it later, never replace it as the sole trigger.

## 4. Recommended folder & module structure

```
smart-tourist-safety-system/
├─ backend/                  # Express + Socket.IO API
│  ├─ src/
│  │  ├─ config/             # env, db connection, constants
│  │  ├─ models/             # Mongoose schemas (section 5)
│  │  ├─ controllers/
│  │  ├─ routes/             # API modules (section 6)
│  │  ├─ services/
│  │  │  ├─ geofencing/
│  │  │  ├─ riskAssessment/  # ruleEngine.js + scoringModel.js
│  │  │  ├─ blockchain/
│  │  │  └─ notifications/
│  │  ├─ sockets/            # Socket.IO namespaces/handlers
│  │  ├─ jobs/                # safety-check scheduler (cron)
│  │  ├─ device-gateway/     # shared ingestion for sim + real ESP32
│  │  ├─ simulators/          # GPS/SOS/LED/buzzer simulator (Phase 5)
│  │  ├─ middleware/          # auth, role guard, error handler
│  │  └─ utils/
│  ├─ tests/
│  └─ .env.example
├─ client/                   # React app, role-based routing
│  └─ src/
│     ├─ admin/               # dashboard, map, zone editor, incidents
│     ├─ tourist/             # profile, SOS, safety-check, status
│     └─ shared/              # auth, api client, socket hook, UI kit
├─ firmware/                 # ESP32 sketch, empty until Phase 12
│  └─ esp32-wristband/
├─ blockchain/               # hash-chain + optional testnet contract
├─ docs/                     # this plan, ERD, API spec
└─ scripts/                  # seed data, deploy helpers
```

## 5. Database models

MongoDB via Mongoose. Twelve core collections; GPS pings are the only
high-volume write path, indexed by device + time.

| Model | Purpose | Key fields |
|---|---|---|
| `User` | Auth identity, either role | role, name, email, phone, passwordHash |
| `TouristProfile` | Trip & safety context | userRef, emergencyContacts[], itinerary, deviceId |
| `Device` | Wristband/ESP32 registry | deviceId, touristRef, status, isSimulated, lastSeen |
| `LocationPing` | GPS time-series | deviceId, lat, lng, speed, timestamp (indexed) |
| `Zone` | Geofence definition | name, type (safe/danger/restricted), geometry (GeoJSON), riskLevel |
| `GeofenceEvent` | Zone enter/exit log | touristRef, zoneRef, eventType, timestamp, resolved |
| `SafetyCheck` | Periodic "are you safe?" prompt | touristRef, scheduledAt, respondedAt, response |
| `SOSEvent` | Manual/triggered SOS | touristRef, deviceId, location, status, source |
| `RiskAssessment` | Scored snapshot | touristRef, score, level, factors{}, timestamp |
| `Incident` | Unified case record | type, severity, timeline[], assignedAdmin, resolution |
| `Notification` | Delivered alert log | recipientRef, channel, payload, acknowledged |
| `AuditProof` | Blockchain integrity record | eventType, eventRef, dataHash, chainRef, verified |

## 6. API modules

### REST routes

| Route | Handles |
|---|---|
| `/api/auth` | register, login, refresh, logout |
| `/api/tourists` | profile & emergency-contact CRUD |
| `/api/devices` | register device, status, simulator control |
| `/api/locations` | ingest ping, latest position, history |
| `/api/zones` | geofence CRUD (admin) |
| `/api/geofence-events` | list violations, mark resolved |
| `/api/safety-checks` | trigger, respond, configure interval |
| `/api/sos` | trigger, acknowledge, resolve |
| `/api/risk` | current score, history, force re-evaluation |
| `/api/incidents` | list, detail, timeline, resolve |
| `/api/blockchain` | fetch proof, verify event hash |
| `/api/admin` | dashboard stats, action log |

### Socket.IO events

`location:update`, `sos:triggered`, `geofence:violation`, `safetycheck:prompt`,
`safetycheck:response`, `risk:updated`, `incident:updated`, `admin:alert` —
admin sockets join a global room; tourist sockets join a room keyed to their
own ID.

## 7. Frontend modules

| Area | Screens |
|---|---|
| Auth | login, register, role-based redirect |
| Admin dashboard | live map with markers & zone overlays, alert feed, tourist directory, zone editor, incident console with timeline, risk-score board, device/simulator control panel, blockchain proof viewer |
| Tourist client | profile & emergency contacts, live map with nearby zones, SOS control (software fallback pre-hardware), safety-check prompt & response, personal status view |
| Shared | socket listener/toast layer, protected-route guard, API client, layout & component kit |

## 8. IoT integration plan

Since hardware is 2–3 days out, Phase 5 builds a simulator that speaks the
identical protocol the ESP32 will use later, so the Phase 12–13 hardware
swap is a firmware task, not a backend rewrite.

Simulator (Phase 5–8) → Device Gateway → Backend ↔ ESP32 (Phase 12–13)

- **Shared contract, defined now:** device-authenticated `POST /api/devices/:id/telemetry` — `{ lat, lng, battery, sosPressed, timestamp }` — used by both simulator and hardware.
- **Device auth:** a lightweight per-device key (not a user JWT), issued at registration.
- **LED/buzzer state:** a backend-owned `emergencyMode` flag on the device. Simulator/dashboard visualize it now; the ESP32 will later poll/receive the same flag over GSM (HTTP or MQTT) and drive the actual GPIO pins.
- **Hardware path (Phase 12–13):** ESP32 + TinyGPS++ for GPS, interrupt pin for the SOS button, GPIO for red/blue LED and buzzer, SIM800L-class GSM module for connectivity, with local buffering when signal drops.

## 9. AI risk assessment plan

The brief is explicit that critical safety actions must not depend on AI
alone, so the engine is hybrid by design:

- **Deterministic layer (authoritative):** an SOS press or entry into a danger zone triggers Critical/Emergency directly, regardless of score.
- **Scoring layer (advisory):** a transparent, weighted function over safety-check responses, zone risk, recent violations, incident history, movement pattern, and device/connectivity status → 0–100.
- **Combination:** `services/riskAssessment/` exposes one `evaluateRisk(touristId)` that runs the rule engine first; the score informs Medium-level escalation and admin prioritization, never overrides a rule-triggered Critical state.
- A trained classifier can later sit beside the weighted function as an enhancement (Phase 10 stretch goal); the deterministic layer stays the permanent safety backstop.

Risk bands: **0–29 Low · 30–59 Medium · 60–84 High · 85–100 Critical/Emergency**

## 10. Blockchain integrity layer

MongoDB stays the system of record for all tourist data. Blockchain never
stores personal information — only a proof that a critical event happened
and hasn't been altered since.

- For SOS, geofence violations, escalations, resolutions, and key admin actions: hash (SHA-256) a canonicalized event payload and store it as an `AuditProof` linked to the source record.
- **Internal hash-chain (build first):** each proof links to the hash of the one before it — tamper-evident, no external dependency, works fully offline for a live demo.
- **Optional public anchor:** an adapter batches hashes to a testnet contract (Polygon Amoy via ethers.js) behind a config flag — never a dependency for the core flow.
- `GET /api/blockchain/verify/:eventId` recomputes the event's hash and compares it to the stored proof, to demonstrate tamper-evidence live.

## 11. Cloud deployment plan

Deferred to Phase 15, planned now so nothing built earlier blocks it.

| Layer | Target |
|---|---|
| Backend | Render / Railway (single instance is enough for a demo; add the Socket.IO Redis adapter only if scaled beyond one) |
| Frontend | Vercel / Netlify, static build |
| Database | MongoDB Atlas free tier |
| Blockchain RPC | Alchemy/Infura free tier, only if the public-testnet anchor is enabled |
| Local parity | optional Docker Compose for backend + Mongo |

## 12. Implementation order

Your 18-phase roadmap, unchanged. Phase 1's concrete first steps: initialize
the monorepo, scaffold Express and the Vite/React client, connect MongoDB
Atlas, add a health-check route, and set up `.env.example`, ESLint, and
Prettier.

0. Requirements & architecture — this document
1. Project / MERN foundation — **next, pending approval**
2. Database design
3. Authentication & security
4. Tourist / admin dashboard
5. GPS simulation
6. Geofencing
7. Socket.IO real-time system
8. Simulated SOS
9. 20–30 minute safety check
10. AI risk assessment
11. Automatic emergency mode
12. ESP32 hardware
13. ESP32 ↔ backend integration
14. Blockchain
15. Cloud deployment
16. Complete testing
17. Security hardening
18. Documentation & final presentation

## Approval needed

This is Phase 0 only — no source code has been written. Confirm or amend the
four calls in section 3 (single React app, shared simulator/ESP32 contract,
hash-chain-first blockchain, rule-engine-first AI). Once confirmed, Phase 1
begins: repo scaffold, Express + React foundation, MongoDB connection, and
base project configuration.
