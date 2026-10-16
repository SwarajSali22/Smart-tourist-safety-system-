const { User, TouristProfile } = require('../models');
const {
  hashPassword,
  verifyPassword,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} = require('../services/auth.service');

// ── POST /api/auth/register ───────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { name, email, password, phone } = req.body;

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

    const passwordHash = await hashPassword(password);
    const user = await User.create({ name, email, phone: phone || null, passwordHash, role: assignedRole });

    // Auto-create an empty tourist profile for tourist accounts
    if (user.role === 'tourist') {
      await TouristProfile.create({ user: user._id });
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);

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
