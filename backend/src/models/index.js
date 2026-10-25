// Single entry point for all Mongoose models.
// Import from here: const { User, Device } = require('../models');

const User = require('./User');
const TouristProfile = require('./TouristProfile');
const Device = require('./Device');
const LocationPing = require('./LocationPing');
const Zone = require('./Zone');
const GeofenceEvent = require('./GeofenceEvent');
const SafetyCheck = require('./SafetyCheck');
const SOSEvent = require('./SOSEvent');
const RiskAssessment = require('./RiskAssessment');
const Incident = require('./Incident');
const Notification = require('./Notification');
const AuditProof = require('./AuditProof');
const HelpCenter = require('./HelpCenter');
const ActivityLog = require('./ActivityLog');
const Trip = require('./Trip');
const IdempotencyKey = require('./IdempotencyKey');

module.exports = {
  User,
  TouristProfile,
  Device,
  LocationPing,
  Zone,
  GeofenceEvent,
  SafetyCheck,
  SOSEvent,
  RiskAssessment,
  Incident,
  Notification,
  AuditProof,
  HelpCenter,
  ActivityLog,
  Trip,
  IdempotencyKey,
};
