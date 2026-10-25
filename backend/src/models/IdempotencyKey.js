const mongoose = require('mongoose');

// Remembers the response given for a client-generated event id so a retried request
// (e.g. replayed by the offline queue) is answered the same way instead of being applied twice.
const idempotencySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    route: { type: String, required: true },
    status: { type: Number, required: true },
    body: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 },
  },
  { versionKey: false }
);
idempotencySchema.index({ user: 1, key: 1, route: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyKey', idempotencySchema);
