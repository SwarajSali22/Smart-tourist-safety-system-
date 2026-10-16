const express = require('express');
const healthRoutes  = require('./health.routes');
const authRoutes    = require('./auth.routes');
const touristRoutes = require('./tourist.routes');
const deviceRoutes  = require('./device.routes');
const zoneRoutes    = require('./zone.routes');
const geofenceEventRoutes = require('./geofenceEvent.routes');
const sosRoutes      = require('./sos.routes');
const incidentRoutes = require('./incident.routes');
const safetyCheckRoutes = require('./safetyCheck.routes');
const riskRoutes = require('./risk.routes');
const blockchainRoutes = require('./blockchain.routes');
const analyticsRoutes = require('./analytics.routes');

const router = express.Router();

router.use(healthRoutes);
router.use('/auth',     authRoutes);
router.use('/tourists', touristRoutes);
router.use('/devices',  deviceRoutes);
router.use('/zones',    zoneRoutes);
router.use('/geofence-events', geofenceEventRoutes);
router.use('/sos',       sosRoutes);
router.use('/incidents', incidentRoutes);
router.use('/safety-checks', safetyCheckRoutes);
router.use('/risk', riskRoutes);
router.use('/blockchain', blockchainRoutes);
router.use('/analytics', analyticsRoutes);

module.exports = router;
