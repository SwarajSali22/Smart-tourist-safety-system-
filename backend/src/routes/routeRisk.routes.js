const express = require('express');
const { z } = require('zod');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { assessRoute } = require('../services/routing/routeRisk');

const pt = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const schema = z.object({ from: pt, to: pt });

const router = express.Router();

// POST /api/route-risk  { from, to } — checks candidate routes against the configured zones
router.post('/', authenticate, authorize('tourist', 'admin', 'responder'), validate(schema), async (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (from.lat === to.lat && from.lng === to.lng) return res.status(400).json({ success: false, message: 'Start and end must be different places' });
    return res.json({ success: true, ...(await assessRoute(from, to)) });
  } catch (err) { next(err); }
});

module.exports = router;
