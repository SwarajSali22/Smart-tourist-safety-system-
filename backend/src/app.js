const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimits');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(helmet()); // security headers (JSON API: no inline content to allow)
// Only the configured front-end origin(s) get CORS headers; any other origin gets none.
const allowedOrigins = env.clientOrigin.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));

app.use('/api', apiLimiter, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
