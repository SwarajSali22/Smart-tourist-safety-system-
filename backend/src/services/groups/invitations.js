const crypto = require('crypto');
const { GroupInvitation, TouristGroup } = require('../../models');
const env = require('../../config/env');

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');

/** An invitation can only be shared as a link/QR when the public address is a real HTTPS URL (not localhost / a tunnel). */
function publicBase() {
  const u = String(env.publicAppUrl || '').trim().replace(/\/+$/, '');
  if (!u) return { ok: false, reason: 'PUBLIC_APP_URL is not set. Deploy the app, then set it to its permanent HTTPS address.' };
  let parsed;
  try { parsed = new URL(u); } catch { return { ok: false, reason: 'PUBLIC_APP_URL is not a valid URL.' }; }
  const host = parsed.hostname;
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'PUBLIC_APP_URL must be https://.' };
  const local = /^(localhost|127\.|\[?::1)/.test(host) || host.endsWith('.localhost') || host.endsWith('.local');
  const tunnel = /(trycloudflare\.com|lhr\.life|localhost\.run|ngrok)/.test(host);
  // Demo mode: a temporary HTTPS tunnel may carry a link and share text, flagged as temporary. Localhost never can, and no QR.
  if (tunnel && !local && env.inviteDemo) return { ok: true, base: u, demo: true };
  if (local || tunnel) {
    return { ok: false, reason: 'PUBLIC_APP_URL points at localhost or a temporary tunnel; use the permanent address.' };
  }
  return { ok: true, base: u };
}

/** Looks up a still-valid invitation by raw token (no side effects). */
async function findValid(token) {
  if (!token) return null;
  const inv = await GroupInvitation.findOne({ tokenHash: hash(token), revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!inv || inv.usedCount >= inv.maxUses) return null;
  const group = await TouristGroup.findOne({ _id: inv.group, isActive: true });
  return group ? { inv, group } : null;
}

const release = (invId) => GroupInvitation.updateOne({ _id: invId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });

/** Atomically uses one seat. Returns { inv, group }, or null if invalid / expired / revoked / full. */
async function consume(token) {
  const inv = await GroupInvitation.findOneAndUpdate(
    { tokenHash: hash(token), revokedAt: null, expiresAt: { $gt: new Date() }, $expr: { $lt: ['$usedCount', '$maxUses'] } },
    { $inc: { usedCount: 1 } }, { new: true });
  if (!inv) return null;
  const group = await TouristGroup.findOne({ _id: inv.group, isActive: true });
  if (!group) { await release(inv._id); return null; }
  return { inv, group };
}

/**
 * An already-registered tourist joins via an invitation. The group comes ONLY from the validated token (never from
 * the browser). Returns { status: 'joined' | 'already_member' | 'other_group' | 'invalid', group }.
 */
async function joinExisting(userId, token) {
  const { TouristProfile } = require('../../models');
  const found = await findValid(token);
  if (!found) return { status: 'invalid' };
  const profile = await TouristProfile.findOne({ user: userId });
  if (profile?.group && String(profile.group) === String(found.group._id)) return { status: 'already_member', group: found.group };
  if (profile?.group) return { status: 'other_group', group: found.group };
  const seat = await consume(token);
  if (!seat) return { status: 'invalid' };
  // Only a profile that still has no group may be changed (guards two simultaneous joins).
  const done = await TouristProfile.findOneAndUpdate({ user: userId, group: null }, { group: seat.group._id, joinedGroupAt: new Date() }, { new: true, upsert: !profile });
  if (!done) { await release(seat.inv._id); return { status: 'other_group', group: seat.group }; }
  return { status: 'joined', group: seat.group };
}

module.exports = { joinExisting, hash, newToken, publicBase, findValid, consume, release };
