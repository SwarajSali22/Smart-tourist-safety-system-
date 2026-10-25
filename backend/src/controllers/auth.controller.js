const { User, TouristProfile } = require('../models');
const {
  hashPassword,
  verifyPassword,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} = require('../services/auth.service');
const { logActivity } = require('../services/activity/logActivity');
const { consume: consumeInvite, release: releaseInvite } = require('../services/groups/invitations');

// ── POST /api/auth/register ───────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { name, email, password, phone, invite } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email and password are required' });
    }

    // Only 'tourist' can self-register. Admins are created by seeding or by
    // an existing admin — self-registration must never take role from the client.
    const assignedRole = 'tourist';

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // An invitation only ever adds the new tourist to ONE group; it cannot change the role. Invalid -> no account.
    let seat = null;
    if (invite) {
      seat = await consumeInvite(invite);
      if (!seat) return res.status(400).json({ success: false, message: 'This invitation is invalid, expired or has been withdrawn. Ask your guide for a new link.' });
    }

    let user;
    try {
      const passwordHash = await hashPassword(password);
      user = await User.create({ name, email, phone: phone || null, passwordHash, role: assignedRole });
      await TouristProfile.create({ user: user._id, group: seat ? seat.group._id : null, joinedGroupAt: seat ? new Date() : null });
    } catch (err) {
      if (seat) await releaseInvite(seat.inv._id); // give the seat back if the account was not created
      throw err;
    }
    if (seat) {
      await logActivity({ actor: user._id, role: 'tourist', action: 'group.join', targetModel: 'TouristGroup', targetId: seat.group._id, summary: `Joined "${seat.group.name}" via invitation` });
    }

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);

    return res.status(201).json({
      success: true,
      accessToken,
      refreshToken,
      user: _safeUser(user),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password, portal } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.isActive) {
      await logActivity({ req, action: 'auth.login', outcome: 'failure', summary: 'Sign-in refused (unknown or inactive account)', metadata: { email: String(email).toLowerCase().trim().slice(0, 120) } });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await logActivity({ req, actor: user._id, role: user.role, action: 'auth.login', outcome: 'failure', summary: 'Wrong password' });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Right password, wrong door: refuse before any token is issued.
    if ((portal === 'staff' && user.role === 'tourist') || (portal === 'tourist' && user.role !== 'tourist')) {
      await logActivity({ req, actor: user._id, role: user.role, action: 'auth.login', outcome: 'denied', summary: `Signed in on the wrong portal (${portal})` });
    }
    if (portal === 'staff' && user.role === 'tourist') {
      return res.status(403).json({ success: false, message: 'This account is not an administrator or responder account. Use the tourist login.' });
    }
    if (portal === 'tourist' && user.role !== 'tourist') {
      return res.status(403).json({ success: false, message: 'This is a staff account. Use the administrator login.' });
    }

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);
    if (user.role !== 'tourist') await logActivity({ req, actor: user._id, role: user.role, action: 'auth.login', summary: 'Staff sign-in' });

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: _safeUser(user),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'refreshToken is required' });
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    const accessToken = issueAccessToken(user);
    const newRefreshToken = issueRefreshToken(user);

    return res.json({ success: true, accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
// Tokens are stateless JWTs — logout is handled client-side by discarding
// them. This endpoint exists so the client has a consistent pattern; a token
// blacklist can be added here in Phase 17 (security hardening) if required.
function logout(_req, res) {
  return res.json({ success: true, message: 'Logged out' });
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function _safeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

module.exports = { register, login, refresh, logout, me };
