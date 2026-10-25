const express = require('express');
const { createSos, getMySos, listSos } = require('../controllers/sos.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const idempotent = require('../middleware/idempotency');
const { z } = require('zod');

const router = express.Router();

router.post('/',     authenticate, authorize('tourist'), validate(z.object({ clientTriggeredAt: z.coerce.date().optional() })), idempotent, createSos);
router.get('/mine',  authenticate, authorize('tourist'), getMySos);
router.get('/',      authenticate, authorize('admin'),   listSos);

module.exports = router;
