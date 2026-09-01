const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { errorResponse, AppError } = require('../lib/response');
const logger = require('../lib/logger');

/**
 * Verifies the Supabase JWT in the Authorization header.
 * Attaches req.user  = { id, email }
 *           req.sub  = { plan, businesses_limit, status }
 *           req.token = raw JWT (for user-scoped Supabase calls)
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(res, new AppError('UNAUTHORIZED', 'Missing Bearer token', 401));
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return errorResponse(res, new AppError('UNAUTHORIZED', 'Invalid or expired token', 401));
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan, businesses_limit, status')
    .eq('owner_id', user.id)
    .maybeSingle();

  req.user  = { id: user.id, email: user.email };
  req.sub   = sub || { plan: 'free', businesses_limit: 1, status: 'active' };
  req.token = token;

  next();
}

/**
 * Verifies the caller owns the business at req.params.businessId.
 * Must run after authenticate().
 */
async function requireBusinessOwner(req, res, next) {
  const { businessId } = req.params;
  if (!businessId) return next();

  const { data: biz, error } = await supabase
    .from('businesses')
    .select('id, owner_id, name')
    .eq('id', businessId)
    .maybeSingle();

  if (error || !biz) {
    return errorResponse(res, new AppError('NOT_FOUND', 'Business not found', 404));
  }

  if (biz.owner_id !== req.user.id) {
    return errorResponse(res, new AppError('FORBIDDEN', 'Access denied', 403));
  }

  req.business = biz;
  next();
}

// FIX (F-05): constant-time comparison for the shared webhook secret.
// Standard string !== short-circuits on the first differing byte,
// which is a recognized (if hard-to-exploit-over-a-network) timing
// side channel. crypto.timingSafeEqual requires equal-length buffers,
// so we pad/hash both sides to a fixed length first.
function safeCompare(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a)).digest();
  const bufB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Inbound webhook auth for the Apify scraper callback.
 * Uses a shared secret in the X-Scraper-Secret header.
 */
function authenticateScraper(req, res, next) {
  const secret = req.headers['x-scraper-secret'];
  const expected = process.env.SCRAPER_WEBHOOK_SECRET;

  if (!secret || !expected || !safeCompare(secret, expected)) {
    return errorResponse(res, new AppError('UNAUTHORIZED', 'Invalid scraper secret', 401));
  }
  next();
}

module.exports = { authenticate, requireBusinessOwner, authenticateScraper };
