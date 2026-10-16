const express = require('express');
const { listTourists, getMyProfile, updateEmergencyContacts, updateItinerary } = require('../controllers/tourist.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

const router = express.Router();

// Admin: list all tourists
router.get('/',    authenticate, authorize('admin'),            listTourists);
// Tourist: own profile
router.get('/me',  authenticate, authorize('tourist', 'admin'), getMyProfile);
// Tourist: update emergency contacts
router.patch('/me/emergency-contacts', authenticate, authorize('tourist'), updateEmergencyContacts);

// Tourist: update itinerary
router.patch('/me/itinerary', authenticate, authorize('tourist'), updateItinerary);

module.exports = router;
