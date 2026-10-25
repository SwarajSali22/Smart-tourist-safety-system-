const { IdempotencyKey } = require('../models');

/**
 * Makes a mutating request safe to replay. A client (e.g. the offline queue) sends a unique
 * `Idempotency-Key`; the first request is processed normally and its response is remembered,
 * and any retry with the same key by the same user gets that same response back without the
 * action being applied again. Without the header the request is processed as usual.
 */
function idempotent(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || !req.user) return next();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    return res.status(400).json({ success: false, message: 'Invalid Idempotency-Key' });
  }
  const route = `${req.method} ${req.baseUrl}${req.route?.path || ''}`;
  IdempotencyKey.findOne({ user: req.user.id, key, route }).lean()
    .then((hit) => {
      if (hit) {
        res.set('Idempotent-Replay', 'true');
        return res.status(hit.status).json(hit.body);
      }
      const json = res.json.bind(res);
      res.json = (body) => {
        // Remember only definitive outcomes; a 5xx may be retried and should run again.
        // Stored BEFORE the response goes out, so an immediate retry always finds it.
        if (res.statusCode < 500) {
          IdempotencyKey.create({ user: req.user.id, key, route, status: res.statusCode, body })
            .catch(() => {})
            .then(() => json(body));
          return res;
        }
        return json(body);
      };
      return next();
    })
    .catch(next);
}

module.exports = idempotent;
