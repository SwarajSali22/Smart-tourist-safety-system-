const { SOSEvent, Incident, Device } = require('../../models');

/**
 * Startup repair: an SOS whose linked incident is already resolved/closed can never be "active".
 * Brings such SOS records in line with their incident (nothing is deleted; history is kept).
 * Returns the number of SOS events repaired.
 */
async function reconcileSosState() {
  const open = await SOSEvent.find({ status: { $in: ['active', 'acknowledged'] }, incident: { $ne: null } });
  let fixed = 0;
  for (const sos of open) {
    const incident = await Incident.findById(sos.incident).select('status resolvedAt closedAt').lean();
    if (!incident || !['resolved', 'closed'].includes(incident.status)) continue;
    await SOSEvent.updateOne(
      { _id: sos._id },
      { $set: { status: 'resolved', resolvedAt: incident.resolvedAt || incident.closedAt || new Date() }, $unset: { activeKey: '' } }
    );
    if (sos.device) await Device.updateOne({ _id: sos.device }, { emergencyMode: false, status: 'inactive' });
    fixed += 1;
  }
  return fixed;
}

module.exports = { reconcileSosState };
