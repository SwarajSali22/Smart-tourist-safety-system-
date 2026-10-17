const express = require('express');
const { listTourists, getTouristDetail, getMyProfile, updateEmergencyContacts, updateItinerary } = require('../controllers/tourist.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');
const validate     = require('../middleware/validate');
const { locationLimiter } = require('../middleware/rateLimits');
const { reportMyLocation } = require('../controllers/location.controller');
const { locationSchema, contactsSchema, itinerarySchema, idParams } = require('../validation/schemas');

const router = express.Router();

// Admin: list all tourists
router.get('/',    authenticate, authorize('admin'),            listTourists);
// Tourist: own profile
router.get('/me',  authenticate, authorize('tourist', 'admin'), getMyProfile);
// Tourist: update emergency contacts
router.patch('/me/emergency-contacts', authenticate, authorize('tourist'), validate(contactsSchema), updateEmergencyContacts);

// Tourist phone: report own GPS position (max 1 per 3 s)
router.post('/me/location', authenticate, authorize('tourist'), locationLimiter, validate(locationSchema), reportMyLocation);
// Tourist: update itinerary
router.patch('/me/itinerary', authenticate, authorize('tourist'), validate(itinerarySchema), updateItinerary);

// Admin: one tourist's full picture (keep AFTER the /me routes)
router.get('/:id', authenticate, authorize('admin'), validate(idParams, 'params'), getTouristDetail);

module.exports = router;
