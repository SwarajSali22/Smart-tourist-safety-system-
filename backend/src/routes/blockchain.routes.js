const express = require('express');
const {
  listProofs,
  verifyOne,
  verifyWholeChain,
  proofsForIncident,
} = require('../controllers/blockchain.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/', listProofs);
router.get('/verify-chain', verifyWholeChain);
router.get('/verify/:proofId', verifyOne);
router.get('/incident/:id', proofsForIncident);

module.exports = router;
