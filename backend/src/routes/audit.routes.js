const express = require('express');
const { z } = require('zod');
const { ActivityLog } = require('../models');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');

const query = z.object({
  action: z.string().trim().max(60).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const router = express.Router();
router.use(authenticate, authorize('admin'));

// GET /api/audit/activity — administrator activity log (newest first)
router.get('/activity', validate(query, 'query'), async (req, res, next) => {
  try {
    const { action, outcome, limit, page } = req.query;
    const filter = {};
    if (action) filter.action = new RegExp(`^${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (outcome) filter.outcome = outcome;
    const [total, rows] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name role').lean(),
    ]);
    return res.json({ success: true, total, page, limit, activity: rows });
  } catch (err) { next(err); }
});

module.exports = router;
