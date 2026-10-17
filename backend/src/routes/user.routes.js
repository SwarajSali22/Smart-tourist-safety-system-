const express = require('express');
const { listAssignable, createResponder, updateResponder } = require('../controllers/user.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { responderCreateSchema, responderUpdateSchema, idParams } = require('../validation/schemas');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/assignable', listAssignable);
router.post('/responders', validate(responderCreateSchema), createResponder);
router.patch('/:id', validate(idParams, 'params'), validate(responderUpdateSchema), updateResponder);

module.exports = router;
