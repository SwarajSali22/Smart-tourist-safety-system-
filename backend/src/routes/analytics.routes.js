const express = require('express');
const { z } = require('zod');
const { overview, report, reportCsv, reportPdf } = require('../controllers/analytics.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { objectId } = require('../validation/schemas');

const list = (allowed) => z.string().optional().transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []))
  .refine((a) => a.every((x) => allowed.includes(x)), { message: `must be one of: ${allowed.join(', ')}` });

const reportQuery = z.object({
  range: z.enum(['24h', '7d', '30d', 'custom']).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  type: list(['sos', 'geofence_violation', 'no_response', 'risk_escalation', 'other']),
  severity: list(['low', 'medium', 'high', 'critical']),
  status: list(['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed']),
  tourist: objectId.optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(500).optional(),
}).transform(({ lat, lng, radiusKm, ...rest }) => ({
  ...rest,
  area: lat != null && lng != null && radiusKm != null ? { lat, lng, radiusKm } : null,
}));

const router = express.Router();
router.use(authenticate, authorize('admin'));

router.get('/overview', overview);
router.get('/report', validate(reportQuery, 'query'), report);
router.get('/report.csv', validate(reportQuery, 'query'), reportCsv);
router.get('/report.pdf', validate(reportQuery, 'query'), reportPdf);

module.exports = router;
