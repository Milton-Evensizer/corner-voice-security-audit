const sanitizeHtml = require('sanitize-html'); // FIX (F-04): npm install sanitize-html
const logger = require('../lib/logger');
const { AppError } = require('../lib/response');

const APIFY_BASE = 'https://api.apify.com/v2';
const TOKEN = process.env.APIFY_API_TOKEN;

// ── Actor IDs ─────────────────────────────────────────────────
const ACTORS = {
  google:      process.env.APIFY_GOOGLE_ACTOR_ID || 'compass/google-maps-reviews-scraper',
  yelp:        process.env.APIFY_YELP_ACTOR_ID   || 'yelp/yelp-scraper',
  facebook:    null,
  tripadvisor: null,
};

// FIX (F-07): format validation for user-supplied external IDs before
// they're ever used to build a URL sent to a third party. Reject
// obviously malformed input rather than only .trim()-ing it.
const YELP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/i;
const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,120}$/;

function assertValidExternalId(platform, externalId) {
  if (platform === 'yelp' && !YELP_SLUG_PATTERN.test(externalId)) {
    throw new AppError('VALIDATION_ERROR', 'yelp_business_id is not a valid Yelp business slug.', 422);
  }
  if (platform === 'google' && !GOOGLE_PLACE_ID_PATTERN.test(externalId)) {
    throw new AppError('VALIDATION_ERROR', 'google_place_id is not a valid Google Place ID.', 422);
  }
}

// FIX (F-04): strip all HTML from scraped, adversarial content at the
// moment it enters our system. This is a backstop independent of
// whatever the frontend does — never trust that every future rendering
// path (dashboard, email digest, PDF export, Slack integration) will
// remember to escape output correctly.
function cleanText(value) {
  if (value == null) return value;
  return sanitizeHtml(String(value), {
    allowedTags: [],
    allowedAttributes: {},
  }).trim() || null;
}

function cleanUrl(value) {
  if (!value) return null;
  // Only allow http(s) URLs through; reject javascript:/data: URIs etc.
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

// ── Trigger a scrape run ──────────────────────────────────────

async function triggerScrape({ businessId, sources, webhookUrl }) {
  const jobs = [];

  for (const source of sources) {
    const actorId = ACTORS[source.platform];
    if (!actorId) {
      logger.warn(`No actor configured for platform: ${source.platform}`);
      continue;
    }

    // FIX (F-07): validate before building any request from this value.
    assertValidExternalId(source.platform, source.external_id);

    const input = buildActorInput(source);
    const notifyUrl = `${webhookUrl}?businessId=${encodeURIComponent(businessId)}` +
                       `&sourceId=${encodeURIComponent(source.id)}` +
                       `&platform=${encodeURIComponent(source.platform)}`;

    try {
      const res = await fetch(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          webhooks: [{
            eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
            requestUrl: notifyUrl,
            headersTemplate: `{"X-Scraper-Secret": "${process.env.SCRAPER_WEBHOOK_SECRET}"}`,
          }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error('Apify run start failed', { platform: source.platform, status: res.status, body });
        throw new AppError('SCRAPER_ERROR', `Failed to start scrape for ${source.platform}`, 502);
      }

      const data = await res.json();
      jobs.push({
        platform: source.platform,
        source_id: source.id,
        run_id: data.data.id,
        status: data.data.status,
      });

      logger.info('Scrape job queued', { platform: source.platform, runId: data.data.id });

    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Apify request error', { error: err.message });
      throw new AppError('SCRAPER_ERROR', 'Could not reach Apify. Check APIFY_API_TOKEN.', 502);
    }
  }

  return jobs;
}

// ── Fetch results from a completed Apify run ──────────────────

async function fetchRunResults(runId) {
  const res = await fetch(
    `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}/dataset/items?token=${TOKEN}&limit=200&clean=true`,
    { method: 'GET' }
  );

  if (!res.ok) {
    throw new AppError('SCRAPER_ERROR', `Failed to fetch run results: ${res.status}`, 502);
  }

  return res.json();
}

// ── Normalise raw Apify output into our DB shape ──────────────
// FIX (F-04): every free-text / URL field scraped from a third party
// is sanitized here, once, at the ingestion boundary — before it ever
// reaches the database or any downstream consumer (alerts, AI prompts,
// dashboard).

function normaliseReview(raw, { platform, sourceId, businessId }) {
  switch (platform) {
    case 'google':
      return {
        business_id:        businessId,
        source_id:          sourceId,
        platform:           'google',
        external_review_id: raw.reviewId || raw.id,
        review_url:         cleanUrl(raw.reviewUrl),
        author_name:        cleanText(raw.name || raw.reviewerName),
        author_avatar:      cleanUrl(raw.profilePhotoUrl),
        rating:             Number(raw.stars || raw.rating),
        review_text:        cleanText(raw.text || raw.snippet),
        review_date:        raw.publishedAtDate
                              ? raw.publishedAtDate.slice(0, 10)
                              : new Date().toISOString().slice(0, 10),
      };

    case 'yelp':
      return {
        business_id:        businessId,
        source_id:          sourceId,
        platform:           'yelp',
        external_review_id: raw.id || raw.reviewId,
        review_url:         cleanUrl(raw.url),
        author_name:        cleanText(raw.user?.name),
        author_avatar:      cleanUrl(raw.user?.photoUrl),
        rating:             Number(raw.rating),
        review_text:        cleanText(raw.text || raw.comment),
        review_date:        raw.date
                              ? raw.date.slice(0, 10)
                              : new Date().toISOString().slice(0, 10),
      };

    default:
      return null;
  }
}

// ── Build platform-specific actor input ───────────────────────

function buildActorInput(source) {
  switch (source.platform) {
    case 'google':
      return {
        placeIds:         [source.external_id],
        maxReviews:       100,
        reviewsSort:      'newest',
        language:         'en',
      };
    case 'yelp':
      return {
        // Safe now that source.external_id is validated against
        // YELP_SLUG_PATTERN in triggerScrape() before this runs.
        businessUrls:    [`https://www.yelp.com/biz/${source.external_id}`],
        maxReviews:      100,
      };
    default:
      return {};
  }
}

module.exports = { triggerScrape, fetchRunResults, normaliseReview };
