const express = require('express');
const { listAssignable, createResponder } = require('../controllers/user.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { responderCreateSchema } = require('../validation/schemas');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/assignable', listAssignable);
router.post('/responders', validate(responderCreateSchema), createResponder);

module.exports = router;
