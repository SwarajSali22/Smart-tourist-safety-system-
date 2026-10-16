const { z } = require('zod');

// Phone GPS report from a signed-in tourist.
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
});

module.exports = { locationSchema };
