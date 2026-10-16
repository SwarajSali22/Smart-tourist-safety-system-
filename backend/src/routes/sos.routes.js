const express = require('express');
const { createSos, getMySos, listSos } = require('../controllers/sos.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

router.post('/',     authenticate, authorize('tourist'), validate(z.object({})), createSos);
router.get('/mine',  authenticate, authorize('tourist'), getMySos);
router.get('/',      authenticate, authorize('admin'),   listSos);

module.exports = router;
