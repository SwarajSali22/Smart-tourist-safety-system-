/**
 * Request validation with zod. On failure responds with the app's standard
 * error shape and a 400:  { success: false, message: "path: problem; ..." }.
 * On success the parsed (coerced / stripped) data replaces req[source].
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const message = result.error.issues
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ');
      return res.status(400).json({ success: false, message });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = validate;
