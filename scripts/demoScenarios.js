/**
 * Demo scenarios — SIMULATED tourists acting through the SAME HTTP APIs the real
 * wristband / phone / admin app use (registration, device telemetry, admin actions).
 * Everything created is flagged isDemo, labelled "Simulated" in the UI, and removed by
 * demoReset.js. Nothing here sends a real SMS.
 *
 * Run from the backend folder (so its node_modules resolve), with the backend running:
 *
 *   cd backend
 *   node ../scripts/demoScenarios.js list
 *   node ../scripts/demoScenarios.js danger-zone
 *   node ../scripts/demoScenarios.js all
 *
 * Options:  --fast             pings every 150 ms instead of 1 s
 *           --step <ms>        custom delay between pings
 *           --stale-minutes N  (silent-device) how old the last ping should look, default 20
 *           --base <url>       API base, default http://localhost:5000/api
 *           --app <url>        front-end URL used in the printed links
 *
 *           --outage-seconds N (network-outage) how long the device stays unreachable, default 4
 *
 * Scenarios: normal-walk, restricted-zone, danger-zone, sos-button, silent-device,
 *            missed-checkin, full-lifecycle, multi-sos, network-outage, responder-handover
 */
const c = require('./lib/demoCommon');

const { models, ARGS, APP_URL, sleep, api } = c;
const STEP_MS = ARGS.fast ? 150 : Number(ARGS.step) || 1000;
const ZONE = Object.fromEntries(c.DEMO_ZONES.map((z) => [z.key, z]));

const stamp = () => new Date().toLocaleTimeString();
const log = (msg) => console.log(`  [${stamp()}] ${msg}`);

// ── world setup (idempotent) ───────────────────────────────────────────────────────
async function ensureAdmin() {
  const email = 'demo-admin@sts.demo';
  const password = c.randomPassword();
  const passwordHash = await c.hashPassword(password);
  let admin = await models.User.findOne({ email });
  if (admin && !admin.isDemo) throw new Error(`${email} exists and is not a demo user — refusing to touch it.`);
  if (!admin) admin = await models.User.create({ name: 'Demo Admin', email, passwordHash, role: 'admin', isDemo: true });
  else await models.User.updateOne({ _id: admin._id }, { passwordHash }); // fresh password each run
  const login = await api('POST', '/auth/login', { body: { email, password } });
  if (!login.ok) throw new Error(`Demo admin login failed (${login.status}): ${login.json?.message}`);
  return { token: login.json.accessToken, email, password, user: admin };
}

async function ensureZones(adminToken) {
  for (const z of c.DEMO_ZONES) {
    if (await models.Zone.findOne({ name: z.name, isDemo: true })) continue;
    const r = await api('POST', '/zones', { token: adminToken, body: { name: z.name, type: z.type, riskLevel: z.riskLevel, description: 'Simulated demo zone', geometry: c.box(z.center[0], z.center[1], z.half) } });
    if (!r.ok) throw new Error(`Creating zone ${z.name} failed: ${r.json?.message}`);
    await models.Zone.updateOne({ _id: r.json.zone._id }, { isDemo: true });
    log(`created zone “${z.name}”`);
  }
}

/** A simulated (isDemo) responder account; password regenerated each run. Returns { id, name, token }. */
async function ensureResponder(name, email) {
  const password = c.randomPassword();
  const passwordHash = await c.hashPassword(password);
  let user = await models.User.findOne({ email });
  if (user && !user.isDemo) throw new Error(`${email} exists and is not a demo user - refusing to touch it.`);
  if (!user) user = await models.User.create({ name, email, passwordHash, role: 'responder', isDemo: true });
  else await models.User.updateOne({ _id: user._id }, { passwordHash });
  const login = await api('POST', '/auth/login', { body: { email, password } });
  if (!login.ok) throw new Error(`Demo responder login failed (${login.status}): ${login.json?.message}`);
  return { id: String(user._id), name, token: login.json.accessToken };
}

/** A fresh simulated tourist + simulated wristband, created through the public/admin APIs. */
async function newTourist(scenario, adminToken) {
  const email = `demo-${scenario}-${Date.now().toString(36)}@sts.demo`;
  const name = `Demo ${scenario.replace(/(^|-)(\w)/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()).trim()}`;
  const password = c.randomPassword();
  // Created straight in the database (like seedAdmin.js) so repeated demos never hit the sign-up rate limit.
  const user = await models.User.create({ name, email, passwordHash: await c.hashPassword(password), role: 'tourist', isDemo: true });
  await models.TouristProfile.create({ user: user._id });
  const userId = String(user._id);
  const dev = await api('POST', '/devices', { token: adminToken, body: { tourist: userId, isSimulated: true } });
  if (!dev.ok) throw new Error(`Registering demo device failed: ${dev.json?.message}`);
  await models.Device.updateOne({ _id: dev.json.device._id }, { isDemo: true, isSimulated: true });
  return {
    id: userId, name, email, password,
    deviceId: dev.json.device.deviceId, headers: { 'X-Device-Id': dev.json.device.deviceId, 'X-Api-Key': dev.json.apiKey },
  };
}

async function ping(t, [lat, lng], extra = {}) {
  const r = await api('POST', `/devices/${t.deviceId}/telemetry`, { headers: t.headers, body: { lat, lng, battery: 82, ...extra } });
  if (!r.ok) throw new Error(`Telemetry rejected (${r.status}): ${r.json?.message}`);
  return r;
}

async function walk(t, points, { label, extra, every = 4 } = {}) {
  for (let i = 0; i < points.length; i += 1) {
    await ping(t, points[i], extra);
    if (label && (i === 0 || (i + 1) % every === 0 || i === points.length - 1)) log(`${label} (${i + 1}/${points.length}) → ${points[i][0].toFixed(5)}, ${points[i][1].toFixed(5)}`);
    await sleep(STEP_MS);
  }
}

async function waitFor(fn, { timeout = 15000, interval = 500 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await sleep(interval);
  }
}

const activeIncident = (t) => models.Incident.findOne({ tourist: t.id, type: 'sos' }).sort({ createdAt: -1 });
const link = (p) => `${APP_URL}${p}`;

// ── scenarios ──────────────────────────────────────────────────────────────────────
const SCENARIOS = {
  'normal-walk': {
    about: 'A tourist strolls around the plaza and nearby streets. Nothing should fire.',
    async run({ t }) {
      await walk(t, [c.START, ...c.route(c.START, [28.6139, 77.214], 14)], { label: 'walking' });
      return {
        expect: ['Marker moves on the live map, labelled “Simulator”.', 'Risk stays Low; no incident, no notification.', 'Plaza (safe) enter/exit events appear on the Zones page only.'],
        links: [link('/admin/map?tourist=' + t.id)],
      };
    },
  },

  'restricted-zone': {
    about: 'A tourist wanders into a RESTRICTED zone, lingers, then leaves. Raises a violation — not an SOS.',
    async run({ t }) {
      const m = ZONE.market.center;
      await walk(t, [c.START, ...c.route(c.START, m, 10)], { label: 'heading to the old market' });
      await walk(t, [m, m, m], { label: 'inside the restricted zone' });
      await walk(t, c.route(m, c.START, 6), { label: 'leaving' });
      return {
        expect: ['Admins get a persistent “Zone violation” notification (bell + toast); the tourist gets a zone alert.', 'A geofence_violation audit proof is recorded.', 'NO SOS and no critical incident.'],
        links: [link('/admin/zones'), link('/admin/map?tourist=' + t.id), link('/admin/notifications')],
      };
    },
  },

  'danger-zone': {
    about: 'A tourist walks into a DANGER zone → the system raises an automatic SOS.',
    async run({ t }) {
      const r = ZONE.river.center;
      await walk(t, [c.START, ...c.route(c.START, r, 10)], { label: 'heading to the riverbank' });
      await walk(t, [r, r], { label: 'inside the danger zone' });
      const inc = await waitFor(() => activeIncident(t));
      if (!inc) throw new Error('No SOS incident appeared — is the backend running the latest code?');
      log(`auto-SOS raised → incident ${inc._id}`);
      return {
        expect: ['Red SOS banner on every admin page; critical notification with sound.', 'Marker turns into a pulsing SOS diamond; risk is Critical (rule: danger zone).', 'The incident is left OPEN so you can work it in the UI.'],
        links: [link(`/admin/incidents/${inc._id}`), link('/admin/map?tourist=' + t.id)],
      };
    },
  },

  'sos-button': {
    about: 'The wristband SOS button is held down (sosPressed = true), then released.',
    async run({ t }) {
      await walk(t, [c.START, ...c.route(c.START, [28.6139, 77.2125], 5)], { label: 'walking' });
      log('SOS button pressed and held…');
      await walk(t, Array(3).fill([28.6139, 77.2125]), { extra: { sosPressed: true } });
      log('button released');
      await walk(t, Array(2).fill([28.6139, 77.2125]));
      const inc = await waitFor(() => activeIncident(t));
      if (!inc) throw new Error('No SOS incident appeared after the button press.');
      return {
        expect: ['Exactly ONE SOS despite 3 pings with the button held (idempotent).', 'The device’s emergency flag is set on press; the SOS stays open until an admin resolves it.', 'SMS to contacts: reported as “simulated — never sent”.'],
        links: [link(`/admin/incidents/${inc._id}`)],
      };
    },
  },

  'silent-device': {
    about: 'A device stops reporting. After a few pings it goes quiet and its data ages.',
    async run({ t }) {
      await walk(t, [c.START, ...c.route(c.START, [28.6139, 77.2135], 7)], { label: 'walking, then the signal dies' });
      const minutes = Number(ARGS['stale-minutes']) || 20;
      const when = new Date(Date.now() - minutes * 60 * 1000);
      await models.Device.updateOne({ deviceId: t.deviceId }, { lastSeen: when });
      log(`device went silent — its last ping is now backdated to ${minutes} min ago (simulated; this is the only way to demo ageing without waiting)`);
      const label = minutes <= 2 ? 'Live' : minutes <= 15 ? 'Stale (grey)' : 'Offline';
      return {
        expect: [`On the live map the marker is grey and labelled “${label}” instead of looking live.`, 'The Devices and Tourists pages show the same freshness badge.', 'No alert is raised just for silence (the check-in scheduler handles unresponsive tourists).'],
        links: [link('/admin/map?tourist=' + t.id), link('/admin/devices')],
      };
    },
  },

  'missed-checkin': {
    about: 'A safety check-in goes unanswered. The existing scheduler escalates it into an SOS.',
    async run({ t, admin }) {
      await walk(t, [c.START, ...c.route(c.START, [28.6139, 77.2115], 3)], { label: 'walking' });
      const trig = await api('POST', '/safety-checks/trigger', { token: admin.token, body: { tourist: t.id } });
      if (!trig.ok) throw new Error(`Triggering the check-in failed: ${trig.json?.message}`);
      const windowMin = Number(c.env.safetyCheckResponseWindowMinutes) || 5;
      // The scheduler only escalates checks older than the response window. Backdate THIS demo
      // check so we don't have to wait for it; the escalation itself is the real scheduler's work.
      await models.SafetyCheck.updateOne({ _id: trig.json.safetyCheck._id }, { scheduledAt: new Date(Date.now() - (windowMin + 1) * 60 * 1000) });
      log(`check-in sent and backdated past the ${windowMin}-minute window — waiting for the scheduler (sweeps every 60 s)…`);
      const inc = await waitFor(() => activeIncident(t), { timeout: 130000, interval: 2000 });
      if (!inc) throw new Error('The scheduler did not escalate within 130 s. Is the backend running (the scheduler lives in the server process)?');
      log(`escalated → incident ${inc._id}`);
      return {
        expect: ['The tourist got a “Safety check-in” notification first.', 'Then an automatic SOS (source: missed check-in) and a critical admin notification.'],
        links: [link(`/admin/incidents/${inc._id}`)],
      };
    },
  },

  'full-lifecycle': {
    about: 'Danger zone → SOS → an admin works it all the way: Acknowledged → Assigned → En route → Resolved → Closed.',
    async run({ t, admin }) {
      const r = ZONE.river.center;
      await walk(t, [c.START, ...c.route(c.START, r, 8)], { label: 'heading to the riverbank' });
      await walk(t, [r, r], { label: 'inside the danger zone' });
      const inc = await waitFor(() => activeIncident(t));
      if (!inc) throw new Error('No SOS incident appeared.');
      const id = String(inc._id);
      const move = async (status, note) => {
        const res = await api('PATCH', `/incidents/${id}/status`, { token: admin.token, body: { status, ...(note ? { note } : {}) } });
        if (!res.ok) throw new Error(`Move to ${status} failed: ${res.json?.message}`);
        log(`incident → ${status}${note ? ` (“${note}”)` : ''}`);
        await sleep(Math.max(STEP_MS, 800));
      };
      await move('in_progress');
      await move('assigned');
      await move('en_route');
      await move('resolved', 'Tourist located near the riverbank and escorted back — simulated');
      await move('closed');
      // show that illegal moves are refused
      const bad = await api('PATCH', `/incidents/${id}/status`, { token: admin.token, body: { status: 'open' } });
      log(`trying to reopen a closed incident → HTTP ${bad.status} (${bad.json?.message})`);
      return {
        expect: ['The incident page shows the full activity history with every transition.', 'Audit proofs exist for the SOS, the assignment and the resolution — verify them on the incident page.', 'The tourist received a notification at each step.'],
        links: [link(`/admin/incidents/${id}`), link('/admin/blockchain')],
      };
    },
  },

  'multi-sos': {
    about: 'Three simulated tourists enter the danger zone at the same time -> three separate SOS incidents (one each, none merged).',
    async run({ t, admin }) {
      const r = ZONE.river.center;
      const others = [await newTourist('multi-sos-b', admin.token), await newTourist('multi-sos-c', admin.token)];
      const all = [t, ...others];
      // all three walk together; each ping round is sent concurrently
      const path = [c.START, ...c.route(c.START, r, 8), r, r];
      for (const p of path) { await Promise.all(all.map((x) => ping(x, p))); await sleep(STEP_MS); }
      const incidents = [];
      for (const x of all) {
        const inc = await waitFor(() => activeIncident(x));
        if (!inc) throw new Error(`No SOS incident appeared for ${x.name}.`);
        incidents.push(inc);
      }
      const unique = new Set(incidents.map((i) => String(i._id))).size;
      log(`${unique} separate SOS incidents raised for ${all.length} tourists`);
      if (unique !== all.length) throw new Error('Expected one incident per tourist.');
      return {
        expect: ['The Active SOS card shows 3 and the needs-attention list has 3 rows (one per tourist).', 'Each incident is independent: acknowledge or resolve one and the others stay open.'],
        links: [link('/admin/incidents?type=sos&active=1')],
      };
    },
  },

  'network-outage': {
    about: 'A device loses connectivity, buffers its positions, then reconnects and uploads them with their ORIGINAL timestamps.',
    async run({ t }) {
      const seconds = Number(ARGS['outage-seconds']) || 4;
      await walk(t, [c.START, ...c.route(c.START, [28.6139, 77.2135], 6)], { label: 'walking, signal still good' });
      // Outage: positions are produced on the device but cannot be sent. The data is aged by backdating
      // lastSeen (same simulation shortcut as silent-device) so the UI shows it as no longer live.
      await models.Device.updateOne({ deviceId: t.deviceId }, { lastSeen: new Date(Date.now() - 20 * 60 * 1000) });
      log(`NETWORK DOWN for ${seconds}s - the device keeps a local buffer; the map shows it Offline, never as live`);
      const buffered = c.route([28.6139, 77.2135], [28.6142, 77.2148], 4).map((pt, i) => ({ pt, at: new Date(Date.now() - (4 - i) * 15000).toISOString() }));
      await sleep(seconds * 1000);
      log('NETWORK RESTORED - uploading the buffered positions in order, each with its original timestamp');
      for (const b of buffered) { await ping(t, b.pt, { timestamp: b.at }); await sleep(Math.min(STEP_MS, 300)); }
      const dev = await models.Device.findOne({ deviceId: t.deviceId }).lean();
      const live = Date.now() - new Date(dev.lastSeen).getTime() < 2 * 60 * 1000;
      if (!live) throw new Error('Device did not return to live after reconnecting.');
      const pings = await models.LocationPing.countDocuments({ tourist: t.id });
      log(`recovered: device is Live again; ${pings} location pings stored`);
      return {
        expect: ['During the outage the marker is grey/Offline; after recovery it is Live again.', 'The trail contains the buffered points in their original time order.', 'No alert is raised just because the network dropped.'],
        links: [link('/admin/map?tourist=' + t.id), link('/admin/devices')],
      };
    },
  },

  'responder-handover': {
    about: 'SOS -> admin assigns responder A -> A adds a note and goes en route -> admin hands over to responder B -> B resolves. Shows shared notes and the handover summary.',
    async run({ t, admin }) {
      const a = await ensureResponder('Demo Responder A', 'demo-responder-a@sts.demo');
      const b = await ensureResponder('Demo Responder B', 'demo-responder-b@sts.demo');
      const r = ZONE.river.center;
      await walk(t, [c.START, ...c.route(c.START, r, 8), r, r], { label: 'walking into the danger zone' });
      const inc = await waitFor(() => activeIncident(t));
      if (!inc) throw new Error('No SOS incident appeared.');
      const id = String(inc._id);
      const call = async (who, method, path, body, what) => {
        const res = await api(method, `/incidents/${id}${path}`, { token: who.token, body });
        if (!res.ok) throw new Error(`${what} failed (${res.status}): ${res.json?.message}`);
        log(what);
        await sleep(Math.max(STEP_MS, 500));
        return res;
      };
      await call(admin, 'PATCH', '/status', { status: 'in_progress', expectedStatus: 'open' }, 'admin acknowledged');
      await call(admin, 'PATCH', '/assign', { assignee: a.id }, `admin assigned ${a.name}`);
      await call(a, 'POST', '/notes', { note: 'Heading to the riverbank, ETA 10 min (simulated)' }, `${a.name} added a note`);
      await call(a, 'PATCH', '/status', { status: 'en_route' }, `${a.name} marked en route`);
      await call(admin, 'PATCH', '/assign', { assignee: b.id, note: 'Shift change - A is off duty' }, `admin handed over to ${b.name}`);
      const refused = await api('GET', `/incidents/${id}/handover`, { token: a.token });
      log(`previous holder ${a.name} can no longer open the case -> HTTP ${refused.status}`);
      const hv = await call(b, 'GET', '/handover', undefined, `${b.name} opened the handover summary`);
      const h = hv.json.handover;
      log(`handover: held by ${h.currentAssignee.name}; assignments: ${h.assignments.map((x) => x.assignee).join(' -> ')}; ${h.recentNotes.length} note(s)`);
      await call(b, 'PATCH', '/status', { status: 'resolved', note: 'Tourist found safe - simulated' }, `${b.name} resolved the incident`);
      return {
        expect: ['The activity history shows every step in order, with both responders named.', 'The Handover summary card lists the assignment history chronologically.', 'Responder A was refused access after the handover (server-enforced).'],
        links: [link(`/admin/incidents/${id}`)],
      };
    },
  },
};

// ── runner ─────────────────────────────────────────────────────────────────────────
async function runOne(name, admin) {
  const sc = SCENARIOS[name];
  console.log(`\n━━ ${name} ━━ ${sc.about}`);
  const t = await newTourist(name, admin.token);
  log(`simulated tourist “${t.name}” with simulated wristband ${t.deviceId}`);
  const result = await sc.run({ t, admin });
  console.log('\n  What to look for:');
  result.expect.forEach((e) => console.log(`   • ${e}`));
  console.log('\n  Open:');
  result.links.forEach((l) => console.log(`   → ${l}`));
}

async function main() {
  const [cmd] = ARGS._;
  if (!cmd || cmd === 'list' || cmd === 'help') {
    console.log('Demo scenarios (simulated data, flagged isDemo, removed by demoReset.js):\n');
    Object.entries(SCENARIOS).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v.about}`));
    console.log('\nUsage: node ../scripts/demoScenarios.js <scenario|all> [--fast] [--step ms]');
    return;
  }
  const names = cmd === 'all' ? Object.keys(SCENARIOS) : [cmd];
  const unknown = names.find((n) => !SCENARIOS[n]);
  if (unknown) { console.error(`Unknown scenario "${unknown}". Run "list" to see them.`); process.exitCode = 1; return; }

  await c.assertBackendUp();
  await c.connect();
  try {
    const admin = await ensureAdmin();
    console.log(`\nDemo admin  →  ${admin.email}  /  ${admin.password}   (password is regenerated on every run)`);
    console.log(`Sign in at ${APP_URL}/login. Everything below is SIMULATED.`);
    await ensureZones(admin.token);
    for (const n of names) await runOne(n, admin);
    console.log('\nDone. Clean up with:  node ../scripts/demoReset.js\n');
  } finally {
    await c.disconnect();
  }
}

main().catch((err) => { console.error(`\nDemo failed: ${err.message}`); process.exit(1); });
