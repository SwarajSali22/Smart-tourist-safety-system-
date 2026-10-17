const express = require('express');
const {
  listHelpCenters,
  nearby,
  createHelpCenter,
  updateHelpCenter,
  deleteHelpCenter,
} = require('../controllers/helpCenter.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParams, helpCenterCreateSchema, helpCenterUpdateSchema, nearbyQuery } = require('../validation/schemas');

const router = express.Router();

router.get('/', authenticate, listHelpCenters);
router.get('/nearby', authenticate, validate(nearbyQuery, 'query'), nearby);
router.post('/', authenticate, authorize('admin'), validate(helpCenterCreateSchema), createHelpCenter);
router.patch('/:id', authenticate, authorize('admin'), validate(idParams, 'params'), validate(helpCenterUpdateSchema), updateHelpCenter);
router.delete('/:id', authenticate, authorize('admin'), validate(idParams, 'params'), deleteHelpCenter);

module.exports = router;
