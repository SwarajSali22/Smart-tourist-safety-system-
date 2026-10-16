const express = require('express');
const { createSos, getMySos, listSos } = require('../controllers/sos.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.post('/',     authenticate, authorize('tourist'), createSos);
router.get('/mine',  authenticate, authorize('tourist'), getMySos);
router.get('/',      authenticate, authorize('admin'),   listSos);

module.exports = router;
