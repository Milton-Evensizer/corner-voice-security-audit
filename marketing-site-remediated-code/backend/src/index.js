require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const logger = require('./lib/logger');
const { errorResponse, AppError } = require('./lib/response');
const { demoLimiter, contactLimiter, globalLimiter } = require('./middleware/rateLimiter');
const { verifyTurnstile } = require('./middleware/verifyTurnstile');

const demoRoutes = require('./routes/demo');
const contactRoutes = require('./routes/contact');

const app = express();
const PORT = process.env.PORT || 3002;

// FIX (red-team round 2): without this, Express's req.ip returns the
// connecting socket address, not the real visitor's IP, whenever the app
// sits behind a reverse proxy — which it always will in production
// (Render). Confirmed via direct testing: with this unset, spoofed
// X-Forwarded-For headers had NO effect locally (safe from that specific
// spoofing angle), but that's because req.ip was ignoring the header
// entirely — which means in production behind Render, EVERY real visitor
// would resolve to the same proxy IP, and the "5 requests/hour/IP" rate
// limit would silently become "5 requests/hour, shared across the entire
// site's traffic." A reliability bug, not an exploitable hole — but one
// that would make the public demo unusable after 5 total uses per hour.
//
// `1` means: trust exactly one hop of reverse proxy in front of this app,
// matching Render's actual architecture (one edge proxy, then this
// process). This is the number of trusted hops, not a boolean toggle —
// setting it too high on a platform with fewer proxy hops than that
// would reopen exactly the spoofing risk this comment starts by ruling
// out, so this value should be revisited if the hosting setup changes.
app.set('trust proxy', 1);

app.use(helmet());

// FIX: CORS is locked to an explicit allowlist, not '*'. This backend
// only exists to serve the marketing site's two public forms — there's
// no reason any other origin should be able to call it, and leaving it
// open would make the rate limiting above easier to route around (an
// attacker could call it from many different pages/origins).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (e.g. curl, server-to-server health checks)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn('Blocked CORS request from disallowed origin', { origin });
    callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json({ limit: '100kb' })); // small limit — these endpoints never need large payloads
app.use(globalLimiter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cornervoice-marketing-backend', time: new Date().toISOString() });
});

app.use('/v1/demo', demoLimiter, verifyTurnstile, demoRoutes);
app.use('/v1/contact', contactLimiter, contactRoutes);

app.use((req, res) => {
  errorResponse(res, new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404));
});

app.use((err, req, res, _next) => {
  if (err.message === 'Not allowed by CORS') {
    return errorResponse(res, new AppError('FORBIDDEN', 'This origin is not permitted to access this API.', 403));
  }
  if (!(err instanceof AppError)) {
    logger.error('Unhandled error', { error: err.message, path: req.path });
  }
  errorResponse(res, err);
});

app.listen(PORT, () => {
  logger.info(`Corner Voice marketing backend running on port ${PORT}`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
  if (!process.env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY not set — contact form submissions will only be logged, not emailed. See README.');
  }
});

module.exports = app;
