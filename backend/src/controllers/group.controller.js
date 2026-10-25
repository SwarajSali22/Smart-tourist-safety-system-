const { TouristGroup, GroupInvitation, TouristProfile, Device, SafetyCheck, User } = require('../models');
const { joinExisting } = require('../services/groups/invitations');
const { describeSignal, latestCheckInAt } = require('../services/safetyCheck/workflow');
const { hash, newToken, publicBase, findValid } = require('../services/groups/invitations');
const { logActivity } = require('../services/activity/logActivity');

// ── GET /api/groups (staff) ───────────────────────────────────────────────────
async function listGroups(req, res, next) {
  try {
    const groups = await TouristGroup.find({ isActive: true }).sort({ createdAt: -1 }).limit(200).lean();
    const ids = groups.map((g) => g._id);
    const [members, invites] = await Promise.all([
      TouristProfile.aggregate([{ $match: { group: { $in: ids } } }, { $group: { _id: '$group', n: { $sum: 1 } } }]),
      GroupInvitation.find({ group: { $in: ids } }).sort({ createdAt: -1 }).select('group expiresAt maxUses usedCount revokedAt createdAt').lean(),
    ]);
    const count = new Map(members.map((m) => [String(m._id), m.n]));
    const now = Date.now();
    res.json({
      success: true,
      invitationLinks: publicBase(),
      groups: groups.map((g) => ({
        ...g, members: count.get(String(g._id)) || 0,
        invitations: invites.filter((i) => String(i.group) === String(g._id)).map((i) => ({
          _id: i._id, createdAt: i.createdAt, expiresAt: i.expiresAt, maxUses: i.maxUses, usedCount: i.usedCount,
          status: i.revokedAt ? 'revoked' : new Date(i.expiresAt).getTime() <= now ? 'expired' : i.usedCount >= i.maxUses ? 'full' : 'active',
        })),
      })),
    });
  } catch (err) { next(err); }
}

// ── POST /api/groups (staff) ──────────────────────────────────────────────────
async function createGroup(req, res, next) {
  try {
    const group = await TouristGroup.create({ name: req.body.name, createdBy: req.user.id });
    await logActivity({ req, action: 'group.create', targetModel: 'TouristGroup', targetId: group._id, summary: `Created group "${group.name}"` });
    res.status(201).json({ success: true, group });
  } catch (err) { next(err); }
}

// ── POST /api/groups/:id/invitations (staff) ──────────────────────────────────
// The raw link is returned ONCE; only its hash is stored.
async function createInvitation(req, res, next) {
  try {
    const group = await TouristGroup.findOne({ _id: req.params.id, isActive: true });
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const token = newToken();
    const days = req.body.expiresInDays ?? 7;
    const inv = await GroupInvitation.create({
      group: group._id, createdBy: req.user.id, tokenHash: hash(token),
      expiresAt: new Date(Date.now() + days * 86400000), maxUses: req.body.maxUses ?? 20,
    });
    await logActivity({ req, action: 'group.invite_create', targetModel: 'GroupInvitation', targetId: inv._id, summary: `Invitation for "${group.name}" (${days} d, ${inv.maxUses} uses)` });
    const base = publicBase();
    const link = base.ok ? `${base.base}/register?invite=${token}` : null;
    res.status(201).json({
      success: true,
      invitation: { _id: inv._id, expiresAt: inv.expiresAt, maxUses: inv.maxUses },
      // No link/QR/share text unless a verified permanent HTTPS address is configured. Nothing is sent by the server.
      link, demo: Boolean(base.demo), qrAllowed: base.ok, linkUnavailableReason: base.ok ? null : base.reason,
      message: link ? `You are invited to join the tour group “${group.name}” on the Smart Tourist Safety System. Register here: ${link} (expires ${inv.expiresAt.toDateString()}).` : null,
    });
  } catch (err) { next(err); }
}

// ── DELETE /api/groups/invitations/:id (staff) ────────────────────────────────
async function revokeInvitation(req, res, next) {
  try {
    const inv = await GroupInvitation.findOneAndUpdate({ _id: req.params.id, revokedAt: null }, { revokedAt: new Date() }, { new: true });
    if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already revoked' });
    await logActivity({ req, action: 'group.invite_revoke', targetModel: 'GroupInvitation', targetId: inv._id, summary: 'Invitation revoked' });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ── GET /api/invitations/:token (public) ──────────────────────────────────────
// Reveals only the group name, and only for a currently valid token.
async function previewInvitation(req, res, next) {
  try {
    const found = await findValid(req.params.token);
    if (!found) return res.status(404).json({ success: false, message: 'This invitation is invalid, expired or has been withdrawn.' });
    res.json({ success: true, group: { name: found.group.name } });
  } catch (err) { next(err); }
}

// ── POST /api/invitations/:token/join (signed-in tourist) ─────────────────────
async function joinGroup(req, res, next) {
  try {
    const r = await joinExisting(req.user.id, req.params.token);
    if (r.status === 'invalid') return res.status(400).json({ success: false, message: 'This invitation is invalid, expired, full or has been withdrawn. Ask your guide for a new link.' });
    if (r.status === 'other_group') return res.status(409).json({ success: false, message: 'Your account already belongs to a different tour group. Ask your guide to move you.' });
    if (r.status === 'joined') await logActivity({ req, action: 'group.join', targetModel: 'TouristGroup', targetId: r.group._id, summary: `Joined "${r.group.name}" via invitation (existing account)` });
    res.json({ success: true, status: r.status, group: { _id: r.group._id, name: r.group.name } });
  } catch (err) { next(err); }
}

const maskEmail = (e) => { const [u, d] = String(e || '').split('@'); return d ? `${u.slice(0, 1)}***@${d}` : '—'; };
const maskPhone = (p) => (p ? `••••${String(p).slice(-3)}` : null);

// ── GET /api/groups/:id/members (staff) ───────────────────────────────────────
// Real records only: a member with no GPS shows status "unavailable", never an invented position.
async function listMembers(req, res, next) {
  try {
    const group = await TouristGroup.findOne({ _id: req.params.id, isActive: true }).lean();
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const profiles = await TouristProfile.find({ group: group._id }).select('user joinedGroupAt createdAt').lean();
    const users = await User.find({ _id: { $in: profiles.map((p) => p.user) }, role: 'tourist' }).select('name email phone isActive').lean();
    const uById = new Map(users.map((u) => [String(u._id), u]));
    const devices = await Device.find({ tourist: { $in: users.map((u) => u._id) }, status: { $ne: 'lost' } }).select('tourist type lastSeen lastLocation battery').lean();
    const dByUser = new Map(devices.map((d) => [String(d.tourist), d]));
    const members = [];
    for (const p of profiles) {
      const u = uById.get(String(p.user));
      if (!u) continue;
      const d = dByUser.get(String(u._id));
      const [lastCheckInAt, episode] = await Promise.all([
        latestCheckInAt(u._id),
        SafetyCheck.findOne({ tourist: u._id, episodeAt: { $ne: null }, stage: { $in: ['overdue', 'requested', 'escalated'] }, closedAt: null }).select('stage incident').lean(),
      ]);
      const sig = describeSignal({ lastSeen: d?.lastSeen, hasLocation: d?.lastLocation?.lat != null, lastCheckInAt });
      members.push({
        _id: u._id, name: u.name, email: maskEmail(u.email), phone: maskPhone(u.phone), active: u.isActive !== false,
        joinedAt: p.joinedGroupAt || p.createdAt, ...sig,
        lastLocation: d?.lastLocation?.lat != null ? { lat: d.lastLocation.lat, lng: d.lastLocation.lng } : null,
        battery: d?.battery ?? null, source: d ? d.type : null,
        alert: episode ? { stage: episode.stage, incident: episode.incident || null } : null,
      });
    }
    members.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({ success: true, group: { _id: group._id, name: group.name }, members });
  } catch (err) { next(err); }
}

module.exports = { joinGroup, listMembers, listGroups, createGroup, createInvitation, revokeInvitation, previewInvitation };
