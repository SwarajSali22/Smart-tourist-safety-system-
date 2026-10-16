/**
 * Removes ALL simulated demo data — and only that. Anything not flagged isDemo (real
 * users, real devices, real zones, real incidents and the real audit chain) is left alone.
 *
 *   cd backend
 *   node ../scripts/demoReset.js          # delete
 *   node ../scripts/demoReset.js --dry    # just count
 */
const c = require('./lib/demoCommon');

async function main() {
  const dry = Boolean(c.ARGS.dry);
  await c.connect();
  try {
    const realUsersBefore = await c.models.User.countDocuments({ isDemo: { $ne: true } });
    const realProofsBefore = await c.models.AuditProof.countDocuments({ isDemo: { $ne: true } });

    const counts = await c.cleanupDemo({ dry });
    console.log(dry ? 'Dry run — would delete:' : 'Deleted simulated data:');
    Object.entries(counts).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));

    const realUsersAfter = await c.models.User.countDocuments({ isDemo: { $ne: true } });
    const realProofsAfter = await c.models.AuditProof.countDocuments({ isDemo: { $ne: true } });
    console.log(`\nReal users:  ${realUsersBefore} → ${realUsersAfter}   Real audit proofs: ${realProofsBefore} → ${realProofsAfter}   (must be unchanged)`);
    if (realUsersBefore !== realUsersAfter || realProofsBefore !== realProofsAfter) {
      console.error('WARNING: real data counts changed — please investigate.');
      process.exitCode = 2;
    }
  } finally {
    await c.disconnect();
  }
}

main().catch((err) => { console.error(`Reset failed: ${err.message}`); process.exit(1); });
