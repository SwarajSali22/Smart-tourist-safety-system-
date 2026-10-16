const express = require('express');
const {
  listProofs,
  verifyOne,
  verifyWholeChain,
  proofsForIncident,
} = require('../controllers/blockchain.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { z } = require('zod');
const { objectId, idParams } = require('../validation/schemas');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/', listProofs);
router.get('/verify-chain', verifyWholeChain);
router.get('/verify/:proofId', validate(z.object({ proofId: objectId }), 'params'), verifyOne);
router.get('/incident/:id', validate(idParams, 'params'), proofsForIncident);

module.exports = router;
