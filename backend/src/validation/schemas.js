const { z } = require('zod');

/**
 * Request schemas (zod). Unknown keys are stripped, so e.g. a client can never
 * smuggle `role` into registration. Used through middleware/validate.js, which
 * answers 400 { success: false, message } on failure.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');
const idParams = z.object({ id: objectId });
const trimmed = (min, max, label) => z.string().trim().min(min, `${label} is required`).max(max, `${label} is too long`);
const phone = z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'must be a valid phone number');

// ── auth ──
const registerSchema = z.object({
  name: trimmed(1, 100, 'name'),
  email: z.string().trim().toLowerCase().email('must be a valid email').max(200),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
  phone: phone.optional().or(z.literal('')),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('must be a valid email').max(200),
  password: z.string().min(1, 'is required').max(128),
});
const refreshSchema = z.object({ refreshToken: z.string().min(10).max(2000) });

const responderCreateSchema = z.object({
  name: trimmed(1, 100, 'name'),
  email: z.string().trim().toLowerCase().email('must be a valid email').max(200),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
  phone: phone.optional().or(z.literal('')),
});

// ── tourists ──
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
});
const contactsSchema = z.object({
  emergencyContacts: z.array(z.object({
    name: trimmed(1, 100, 'name'),
    phone,
    relationship: z.string().trim().max(50).nullable().optional(),
  })).max(10, 'at most 10 contacts'),
});
const itinerarySchema = z.object({
  itinerary: z.array(z.object({
    destination: trimmed(1, 120, 'destination'),
    arrivalAt: z.union([z.string(), z.null()]).optional(),
    departureAt: z.union([z.string(), z.null()]).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })).max(50, 'at most 50 stops'),
});

// ── zones ──
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const polygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(position).min(3, 'a polygon needs at least 3 points')).min(1),
});
const zoneType = z.enum(['safe', 'danger', 'restricted']);
const zoneCreateSchema = z.object({
  name: trimmed(1, 80, 'name'),
  description: z.string().trim().max(500).nullable().optional(),
  type: zoneType,
  riskLevel: z.number().min(0).max(100).optional(),
  geometry: polygon,
});
const zoneUpdateSchema = z.object({
  name: trimmed(1, 80, 'name').optional(),
  description: z.string().trim().max(500).nullable().optional(),
  type: zoneType.optional(),
  riskLevel: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

// ── devices ──
const deviceRegisterSchema = z.object({
  tourist: objectId,
  deviceId: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, 'must be 3–40 letters, digits, - or _').optional(),
  isSimulated: z.boolean().optional(),
});
const telemetrySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  battery: z.number().min(0).max(100).optional(),
  accuracy: z.number().min(0).max(100000).optional(),
  sosPressed: z.boolean().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

// ── safety checks ──
const checkRespondSchema = z.object({
  response: z.enum(['safe', 'unsafe']),
  message: z.string().trim().max(500).optional(),
});
const checkTriggerSchema = z.object({ tourist: objectId });

// ── incidents ──
const incidentStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed']),
  note: z.string().trim().max(1000).optional(),
  assignee: objectId.optional(),
});
const incidentNoteSchema = z.object({ note: trimmed(1, 1000, 'note') });
const incidentResolveSchema = z.object({ resolution: z.string().trim().max(1000).optional() });
const csv = (allowed) => z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
  .refine((arr) => arr.every((x) => allowed.includes(x)), { message: `must be one of: ${allowed.join(', ')}` });
const incidentListQuery = z.object({
  status: csv(['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed']),
  severity: csv(['low', 'medium', 'high', 'critical']),
  type: csv(['sos', 'geofence_violation', 'no_response', 'risk_escalation', 'other']),
  active: z.enum(['1', 'true']).optional(),
  tourist: objectId.optional(),
  assignee: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['createdAt', 'severity', 'status', 'type']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── help centers ──
const helpType = z.enum(['hospital', 'police', 'fire', 'embassy', 'pharmacy', 'other']);
const helpCenterCreateSchema = z.object({
  name: trimmed(1, 120, 'name'),
  type: helpType.default('other'),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{3,20}$/, 'must be a valid phone number').nullable().optional().or(z.literal('')),
  address: z.string().trim().max(300).nullable().optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});
const helpCenterUpdateSchema = z.object({
  name: trimmed(1, 120, 'name').optional(),
  type: helpType.optional(),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{3,20}$/, 'must be a valid phone number').nullable().optional().or(z.literal('')),
  address: z.string().trim().max(300).nullable().optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  isActive: z.boolean().optional(),
});
const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  maxKm: z.coerce.number().min(0.1).max(20000).default(50),
  type: helpType.optional(),
});

// ── notifications ──
const notificationListQuery = z.object({
  unread: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

module.exports = {
  objectId, idParams,
  registerSchema, loginSchema, refreshSchema, responderCreateSchema,
  locationSchema, contactsSchema, itinerarySchema,
  zoneCreateSchema, zoneUpdateSchema,
  deviceRegisterSchema, telemetrySchema,
  checkRespondSchema, checkTriggerSchema,
  incidentStatusSchema, incidentNoteSchema, incidentResolveSchema, incidentListQuery,
  notificationListQuery,
  helpCenterCreateSchema, helpCenterUpdateSchema, nearbyQuery,
};
