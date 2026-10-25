# Deploying STS permanently (prepared, not deployed)

Nothing here has been deployed. A Cloudflare/localhost.run tunnel is a **temporary development link** to your PC: it dies when the PC sleeps or the process stops, and its address changes. Permanent hosting means every part runs on someone else's always-on machine.

## What has to be hosted
| Part | What it needs | Suggested home |
|---|---|---|
| Frontend (`client/dist`, static PWA) | HTTPS, SPA fallback (`client/public/_redirects` is included) | Cloudflare Pages, Netlify or Vercel (free tiers) |
| Backend (Express + Socket.IO + **scheduler**) | Always-on Node >= 18, WebSockets, outbound internet | Render web service (`render.yaml` prepared), Railway, Fly.io, or a free always-on VM |
| Database | MongoDB | The existing MongoDB Atlas cluster (M0 free tier) |

**The backend must not sleep.** The 15/20/25-minute safety workflow, risk sweep and trip monitor run inside the backend process (`setInterval`, every 60 s). A host that sleeps idle services (Render's free web service sleeps after ~15 min without traffic) stops the safety clock, and a tourist who went silent would never be escalated. Use an always-on plan (a few dollars/month), an always-free VM, or accept the risk. An external uptime pinger can keep a free service awake, but that is a workaround, not a guarantee. Check each provider's current free-tier terms before relying on them.

## Free-tier limits to expect
- Sleeping/cold starts (above); first request after a sleep takes ~30-60 s.
- Atlas M0: 512 MB storage, shared CPU, connection limits; location pings grow quickly (consider a TTL index on `LocationPing` later).
- Bandwidth/build-minute caps on the static host and the backend host.
- Gemini (Copilot) free quota; Twilio SMS is paid and **not configured**, so no SMS is sent. Notifications are in-app only. Web-push is not implemented.
- Atlas network access: hosts without a fixed IP need `0.0.0.0/0` in Atlas "Network Access". Compensate with a strong DB password and a least-privilege DB user.

## Configuration (no secrets in git)
Backend environment (set in the host dashboard, never committed): `NODE_ENV=production`, `MONGODB_URI`, `CLIENT_ORIGIN` (exact frontend origin, comma-separated if several), `PUBLIC_APP_URL` (permanent HTTPS address; unlocks invitation links), `JWT_SECRET`, `JWT_REFRESH_SECRET` (long random, different from dev), `TRUST_PROXY=1`, optional `GEMINI_API_KEY`. Optional tuning: `SAFETY_OVERDUE_MIN/REQUEST_MIN/ESCALATE_MIN` (15/20/25), `SAFETY_MAX_MONITOR_HOURS` (12).

Frontend build: `VITE_API_BASE_URL=https://<backend-host>/api npm run build` in `client/` (the socket client derives its URL from the same value). CORS is already restricted to `CLIENT_ORIGIN`; auth uses a bearer token, so no cross-site cookie settings are needed.

## Steps (when you approve)
1. Create a free Atlas user/IP rule for the host; keep the same cluster or make a fresh production DB name.
2. Deploy the backend (Render: *New > Blueprint*, point at the repo, fill the secret values). Confirm `https://<backend>/api/health` shows `database: connected`.
3. Build the frontend with `VITE_API_BASE_URL`, deploy `client/dist` to the static host. Open the site over HTTPS (needed for GPS, PWA install and service worker).
4. Set `CLIENT_ORIGIN` and `PUBLIC_APP_URL` to the final frontend address and redeploy the backend.
5. Create the first admin through your existing seeding route; do not enable public admin registration.
6. Sign in as admin > **Tour groups** > create a group > *New invitation link*. The link, WhatsApp/SMS text and (later) QR are only produced once `PUBLIC_APP_URL` is a real HTTPS address.
7. Test on a real phone: install the PWA, grant location, confirm the admin map updates, and run a controlled check-in.

## Public landing page vs protected app
The root route shows only the sign-in page. Every `/admin`, `/tourist` and `/responder` route and every `/api` data route requires a valid token and role; the only unauthenticated API calls are health, login/register and the invitation preview (returns only a group name for a valid token).

## Limits you must not hide from users
Browsers cannot run GPS when the app/tab is closed or the phone is asleep, a PWA cannot guarantee background tracking, and nothing is delivered with no internet. The safety workflow therefore treats silence as "needs a human look", never as proof of danger.
