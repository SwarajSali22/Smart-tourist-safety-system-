const express = require('express');
const { z } = require('zod');
const c = require('../controllers/trip.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const idempotent = require('../middleware/idempotency');
const { objectId, idParams } = require('../validation/schemas');

const stopParams = z.object({ id: objectId, stopId: objectId });
const date = z.coerce.date();
const tripSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  destination: z.string().trim().min(1, 'destination is required').max(160),
  startAt: date,
  endAt: date,
  checkInEveryMin: z.coerce.number().int().min(0).max(720).optional(),
  deviationThresholdM: z.coerce.number().int().min(200).max(50000).optional(),
  stops: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    expectedArrival: date,
    radiusM: z.number().int().min(50).max(5000).optional(),
  })).min(1, 'add at least one stop').max(30),
});

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('tourist', 'admin'), c.listTrips);
router.post('/', authorize('tourist'), validate(tripSchema), c.createTrip);
router.get('/:id', authorize('tourist'), validate(idParams, 'params'), c.getTrip);
router.patch('/:id/start', authorize('tourist'), validate(idParams, 'params'), idempotent, c.startTrip);
router.post('/:id/stops/:stopId/arrive', authorize('tourist'), validate(stopParams, 'params'), idempotent, c.arriveAtStop);
router.post('/:id/check-in', authorize('tourist'), validate(idParams, 'params'), idempotent, c.checkIn);
router.post('/:id/acknowledge', authorize('tourist'), validate(idParams, 'params'), c.acknowledge);
router.patch('/:id/cancel', authorize('tourist'), validate(idParams, 'params'), c.cancelTrip);
router.patch('/:id/complete', authorize('tourist'), validate(idParams, 'params'), c.completeTrip);

module.exports = router;
