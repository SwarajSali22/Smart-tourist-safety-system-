/**
 * Tamper demo for the audit chain.
 *
 * The audit chain is a SHA-256 hash chain kept in the database (each proof hashes an
 * event's unchangeable fields and links to the previous proof). It is tamper-EVIDENT,
 * not tamper-proof, and it is NOT a public blockchain: someone with full database access
 * could rewrite everything — but they could not do it without the verification noticing
 * a mismatch somewhere. This script shows that on a throw-away SIMULATED incident.
 *
 *   cd backend
 *   node ../scripts/tamper.js
 *
 * It creates a simulated tourist + SOS, then, step by step: verifies it, edits the SOS
 * location behind the application's back, verifies again (→ Modified), restores it
 * (→ Verified), edits a proof (→ the chain breaks), deletes the source (→ Missing), and
 * finally removes the demo data (demoReset). Nothing real is touched.
 */
const c = require('./lib/demoCommon');
const { triggerSos } = require('../backend/src/services/sos/triggerSos');
const { verifyProof, verifyChain } = require('../backend/src/services/blockchain/auditChain');

const { models } = c;
const show = (label, v) => console.log(`  ${label.padEnd(46)} ${v}`);

async function main() {
  await c.connect();
  try {
    console.log('\nAudit-chain tamper demo (simulated data only)\n');
    const user = await models.User.create({ name: 'Demo Tamper', email: `demo-tamper-${Date.now().toString(36)}@sts.demo`, passwordHash: await c.hashPassword(c.randomPassword()), role: 'tourist', isDemo: true });
    await models.TouristProfile.create({ user: user._id });
    const device = await models.Device.create({ deviceId: `DEMO-TAMPER-${Date.now().toString(36)}`, tourist: user._id, isDemo: true, isSimulated: true, status: 'active' });
    const { sosEvent } = await triggerSos({ tourist: user._id, device: device._id, location: { lat: 28.6139, lng: 77.209 }, source: 'app' });
    const proof = await models.AuditProof.findOne({ eventType: 'sos_triggered', eventRef: sosEvent._id });

    const verdict = async () => (await verifyProof(proof._id)).status;
    console.log('1. A fresh SOS was recorded and hashed.');
    show('verify the proof →', await verdict());

    console.log('\n2. Someone edits the SOS location directly in the database (bypassing the app):');
    await models.SOSEvent.updateOne({ _id: sosEvent._id }, { 'location.lat': 51.5 });
    show('verify the proof →', await verdict() + '   (the live record no longer matches its hash)');

    console.log('\n3. They put it back exactly as it was:');
    await models.SOSEvent.updateOne({ _id: sosEvent._id }, { 'location.lat': 28.6139 });
    show('verify the proof →', await verdict());

    console.log('\n4. They edit the stored proof itself to cover their tracks:');
    const original = proof.dataHash;
    await models.AuditProof.updateOne({ _id: proof._id }, { dataHash: 'f'.repeat(64) });
    show('verify the proof →', await verdict());
    const broken = await verifyChain();
    show('verify the demo chain →', broken.demo.valid ? 'valid' : `BROKEN at #${broken.demo.brokenAtSequence} (${broken.demo.reason})`);
    await models.AuditProof.updateOne({ _id: proof._id }, { dataHash: original });
    show('after restoring the proof, the chain →', (await verifyChain()).demo.valid ? 'valid' : 'still broken');

    console.log('\n5. They delete the SOS record altogether:');
    await models.SOSEvent.deleteOne({ _id: sosEvent._id });
    show('verify the proof →', await verdict() + '   (the proof outlives the record)');

    console.log('\nCleaning up (only the records this script created — any other demo data is left alone)…');
    const incidents = await models.Incident.find({ tourist: user._id }).select('_id').lean();
    const refs = [sosEvent._id, ...incidents.map((i) => i._id)];
    // these are the newest proofs in the demo chain, so removing them leaves no gap
    const proofs = await models.AuditProof.deleteMany({ isDemo: true, eventRef: { $in: refs } });
    await Promise.all([
      models.Incident.deleteMany({ tourist: user._id }),
      models.SOSEvent.deleteMany({ tourist: user._id }),
      models.Notification.deleteMany({ $or: [{ recipient: user._id }, { 'payload.tourist': user._id }] }),
      models.RiskAssessment.deleteMany({ tourist: user._id }),
      models.Device.deleteMany({ tourist: user._id }),
      models.TouristProfile.deleteMany({ user: user._id }),
      models.User.deleteOne({ _id: user._id }),
    ]);
    console.log(`  removed the demo tourist and ${proofs.deletedCount} proof(s); demo chain valid: ${(await verifyChain()).demo.valid}\n`);
    console.log('Reminder: this is a tamper-EVIDENT database hash chain, not a public blockchain.\n');
  } finally {
    await c.disconnect();
  }
}

main().catch((err) => { console.error(`tamper demo failed: ${err.message}`); process.exit(1); });
