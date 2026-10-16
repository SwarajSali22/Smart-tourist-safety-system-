# 5-minute demo script

Everything here is **simulated**. Demo users, devices and zones are flagged `isDemo`, shown as
**Simulated** in the UI, chained in a *separate* audit chain, and **never send a real SMS**.
`demoReset.js` removes exactly that data and nothing else.

## Before you start (1 minute)

```bash
# terminal 1 — backend            # terminal 2 — front-end
cd backend && npm start           cd client && npm run dev
```

Open <http://localhost:5173>. You need an admin account (real one via `node ../scripts/seedAdmin.js`,
or use the demo admin the scenario script prints — its password is regenerated each run).

Open the admin app on a big screen and keep **Live map** visible. Run the commands below from `backend/`.

```bash
cd backend
node ../scripts/demoReset.js          # optional: start from a clean slate
```

## The script

| Min | Say | Run | What the audience sees |
|---|---|---|---|
| 0:00 | "Tourists carry a GPS wristband or share their phone location. Here is a quiet day." | `node ../scripts/demoScenarios.js normal-walk --fast` | Marker moves on the **Live map**, labelled **Simulator**; risk Low; nothing fires. |
| 0:45 | "Admins draw zones. A restricted zone warns, it doesn't panic." | `node ../scripts/demoScenarios.js restricted-zone --fast` | Bell shows a **persistent** “Zone violation” notification (unread count, deep link). No SOS. Open **Zones** to see the events. |
| 1:30 | "Now a *danger* zone — the system acts by itself." | `node ../scripts/demoScenarios.js danger-zone --fast` | Red **SOS banner**, pulsing SOS marker, critical alert + sound. Click **Respond** → incident page. |
| 2:15 | "An admin works the case." | in the UI on that incident: **Acknowledge → Assign to me → Mark en route → Resolve…** | Lifecycle bar advances; each step lands in the **activity history**; the tourist is notified at each step. Try to skip a step: the server refuses it. |
| 3:00 | "Every critical event is hash-chained so nobody can quietly rewrite history." | On the incident page press **Verify** on each audit proof, then run `node ../scripts/tamper.js` | Proofs show **Verified**. The script edits the database behind the app's back and the same check flips to **Modified** / **Missing**. (A tamper-evident *database* chain — not a public blockchain.) |
| 3:45 | "What if a device just goes quiet?" | `node ../scripts/demoScenarios.js silent-device --fast` | Marker turns **grey** and is labelled **Offline** — old data is never shown as live. Same badge on **Devices** and **Tourists**. |
| 4:15 | "And if someone doesn't answer a safety check-in?" | `node ../scripts/demoScenarios.js missed-checkin --fast` (≈10–60 s) | The real scheduler escalates the unanswered check-in into an SOS. |
| 4:45 | "Clean up." | `node ../scripts/demoReset.js` | Prints what was removed and confirms real data counts are unchanged. |

Prefer one command? `node ../scripts/demoScenarios.js full-lifecycle --fast` walks a tourist into the
danger zone and drives the whole lifecycle (Acknowledged → Assigned → En route → Resolved → Closed),
then shows the server refusing to reopen a closed incident.

## The seven scenarios

| Scenario | Expect |
|---|---|
| `normal-walk` | Moves, Low risk, no alerts |
| `restricted-zone` | Zone-violation notification, audit proof, **no** SOS |
| `danger-zone` | Automatic SOS, critical risk, incident left open |
| `sos-button` | One SOS even though the button is held for 3 pings |
| `silent-device` | Grey marker, **Offline** badge (last ping backdated — see `--stale-minutes`) |
| `missed-checkin` | Scheduler escalates the unanswered check-in |
| `full-lifecycle` | New → Acknowledged → Assigned → En route → Resolved → Closed |

Options: `--fast` (150 ms between pings), `--step <ms>`, `--stale-minutes <n>`, `--base <api url>`, `--app <ui url>`.

## Honest notes for the audience

- The wristband is **simulated** (`scripts/simulateGps.js` and these scenarios speak the same API the real hardware will).
  Anything simulated carries a **Simulated** / **Simulator** label.
- **SMS** to emergency contacts only happens when Twilio keys are configured *and* the tourist is real. The incident page says
  exactly what happened (“Not sent — SMS not configured”, “2 sent, 1 failed”, or “simulated”).
- The device's **emergency flag** is set on the device record; the physical buzzer/LED is **not built yet** (ESP32 firmware pending).
- `silent-device` backdates one timestamp in the database because waiting 15 minutes is not a demo; everything else goes through the APIs.
