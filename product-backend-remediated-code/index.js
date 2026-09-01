require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');

const logger     = require('./lib/logger');
const { errorResponse, AppError } = require('./lib/response');
const { authenticate }            = require('./middleware/auth');
const { generalLimiter }          = require('./middleware/rateLimiter');

const businessRoutes  = require('./routes/businesses');
const reviewRoutes    = require('./routes/reviews');
const analyticsRoutes = require('./routes/analytics');
const alertRoutes     = require('./routes/alerts');
const templateRoutes  = require('./routes/templates');
const scrapeRoutes    = require('./routes/scrape');
const webhookRoutes   = require('./routes/webhooks');
const { jobs }        = require('./routes/scrape');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }));

app.use('/v1/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'cornervoice-api',
    version: process.env.npm_package_version || '1.0.0',
    time:    new Date().toISOString(),
  });
});

app.use('/v1/webhooks', webhookRoutes);

// ── Authenticated routes ──────────────────────────────────────
app.use('/v1', authenticate, generalLimiter);

app.use('/v1/businesses',                                    businessRoutes);
app.use('/v1/businesses/:businessId/reviews',                reviewRoutes);
app.use('/v1/businesses/:businessId/analytics',              analyticsRoutes);
app.use('/v1/businesses/:businessId/alerts',                 alertRoutes);
app.use('/v1/businesses/:businessId/templates',              templateRoutes);
app.use('/v1/businesses/:businessId/scrape',                 scrapeRoutes);

// FIX (F-03): this route already runs after `authenticate` above (Express
// matches middleware/routes in registration order, and this path still
// falls under the '/v1' prefix mounted with `authenticate` at line 47),
// so req.user is always populated here. The missing piece was the
// ownership check, which is now added: a job's owner_id (set at
// creation time in routes/scrape.js) must match the requesting user.
app.get('/v1/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return errorResponse(res, new AppError('NOT_FOUND', 'Job not found', 404));

  if (job.owner_id !== req.user.id) {
    // Respond identically to "not found" so we don't confirm to an
    // unauthorized caller that a given job ID is valid but belongs
    // to someone else.
    return errorResponse(res, new AppError('NOT_FOUND', 'Job not found', 404));
  }

  res.json(job);
});

app.use((req, res) => {
  errorResponse(res, new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404));
});

app.use((err, req, res, _next) => {
  if (err.code === '23505') {
    return errorResponse(res, new AppError('CONFLICT', 'A record with these details already exists', 409));
  }
  if (err.code === '23503') {
    return errorResponse(res, new AppError('VALIDATION_ERROR', 'Referenced record does not exist', 422));
  }

  if (!(err instanceof AppError)) {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  }

  errorResponse(res, err);
});

app.listen(PORT, () => {
  logger.info(`Corner Voice API running on port ${PORT}`, {
    env: process.env.NODE_ENV,
    port: PORT,
  });

  if (process.env.NODE_ENV !== 'test') {
    require('./jobs/scheduler');
  }
});

module.exports = app;
