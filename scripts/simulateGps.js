/**
 * GPS simulator — speaks the same telemetry contract the ESP32 firmware
 * will use later (Phase 12-13): POST /api/devices/:deviceId/telemetry with
 * X-Device-Id / X-Api-Key headers. Plain Node 18+, no dependencies.
 *
 * Usage:
 *   node scripts/simulateGps.js --deviceId SIM-abcd1234 --apiKey <key> \
 *     [--baseUrl http://localhost:5000/api] [--lat 28.6139] [--lng 77.2090] \
 *     [--intervalSec 5] [--ticks 0] [--sos true]
 *
 * --ticks 0 (default) loops until Ctrl+C; a positive value stops after N ticks.
 * --sos true sends sosPressed:true every tick (simulates a held SOS button;
 * the backend only creates one SOSEvent for the whole hold — see Phase 8).
 * Args are simple --flag value pairs (no bare boolean flags), so pass an
 * explicit value even for --sos.
 */

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs();
  const { deviceId, apiKey } = args;
  if (!deviceId || !apiKey) {
    console.error('Usage: node scripts/simulateGps.js --deviceId <id> --apiKey <key> [options]');
    process.exit(1);
  }

  const baseUrl = args.baseUrl || 'http://localhost:5000/api';
  const intervalSec = Number(args.intervalSec) || 5;
  const ticks = Number(args.ticks) || 0; // 0 = run forever
  const sosPressed = args.sos === 'true';

  let lat = Number(args.lat) || 28.6139; // default: New Delhi
  let lng = Number(args.lng) || 77.209;
  let battery = 100;
  let tick = 0;

  console.log(`[simulator] device=${deviceId} baseUrl=${baseUrl} interval=${intervalSec}s`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    tick += 1;

    // Gentle random walk — a few metres per tick, like someone walking.
    lat += (Math.random() - 0.5) * 0.0006;
    lng += (Math.random() - 0.5) * 0.0006;
    battery = Math.max(0, battery - Math.random() * 0.5);

    const payload = {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      battery: Number(battery.toFixed(1)),
      sosPressed,
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(`${baseUrl}/devices/${deviceId}/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      console.log(`[simulator] tick ${tick} -> ${res.status}`, body);
    } catch (err) {
      console.error(`[simulator] tick ${tick} failed:`, err.message);
    }

    if (ticks > 0 && tick >= ticks) break;
    await sleep(intervalSec * 1000);
  }
}

main();
