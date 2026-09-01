const crypto = require('crypto');
const router = require('express').Router({ mergeParams: true });
const { supabase } = require('../lib/supabase');
const { triggerScrape, fetchRunResults, normaliseReview } = require('../services/scraper');
const { analyzeReview } = require('../services/ai');
const { evaluateAlerts } = require('../services/alerts');
const { requireBusinessOwner } = require('../middleware/auth');
const { scrapeRateLimit } = require('../middleware/rateLimiter');
const { ok, accepted, AppError } = require('../lib/response');
const logger = require('../lib/logger');

// In-memory job store (swap for Redis / DB table in production —
// also required so job ownership survives a restart / multiple instances)
const jobs = new Map();

// POST /businesses/:businessId/scrape — trigger manual scrape
router.post('/', requireBusinessOwner, scrapeRateLimit, async (req, res, next) => {
  try {
    const { data: sources, error } = await supabase
      .from('review_sources')
      .select('*')
      .eq('business_id', req.params.businessId)
      .eq('is_active', true);

    if (error) throw error;
    if (!sources?.length) {
      throw new AppError('NO_SOURCES', 'No active review sources configured for this business.', 422);
    }

    const runJobs = await triggerScrape({
      businessId: req.params.businessId,
      sources,
      webhookUrl: `${process.env.API_BASE_URL}/v1/webhooks/scraper`,
    });

    const jobId = runJobs[0]?.run_id || crypto.randomUUID();

    // FIX (F-03): record the owning user, not just the business, so the
    // polling endpoint below can verify the caller is actually entitled
    // to see this job's data.
    jobs.set(jobId, {
      job_id:      jobId,
      status:      'queued',
      business_id: req.params.businessId,
      owner_id:    req.user.id,
      platforms:   runJobs.map(j => j.platform),
      queued_at:   new Date().toISOString(),
      new_reviews_found: 0,
    });

    accepted(res, {
      job_id: jobId,
      status: 'queued',
      platforms: runJobs.map(j => j.platform),
      estimated_duration_sec: 45,
    });
  } catch (err) { next(err); }
});

// NOTE (F-03): the actual GET /v1/jobs/:jobId route lives in index.js,
// not here — it's a top-level route, not nested under a businessId.
// The ownership check for it is added there (see index.js diff), using
// the `jobs` map exported from this file below. It's noted here because
// this is where jobs are created and where owner_id is now recorded.

// ── Internal webhook handler (called by Apify when a run finishes) ──
async function handleScraperWebhook(req, res) {
  const { businessId, sourceId, platform } = req.query;
  const { eventType, resource } = req.body || {};

  logger.info('Scraper webhook received', { eventType, businessId, platform });

  res.status(200).json({ received: true });

  if (eventType !== 'ACTOR.RUN.SUCCEEDED') {
    logger.warn('Scraper run did not succeed', { eventType, businessId });
    return;
  }

  const runId = resource?.id;
  if (!runId) return;

  if (jobs.has(runId)) {
    jobs.get(runId).status = 'processing';
  }

  try {
    const rawItems = await fetchRunResults(runId);
    logger.info('Fetched raw items', { count: rawItems.length, platform, businessId });

    let newCount = 0;

    for (const raw of rawItems) {
      const normalised = normaliseReview(raw, { platform, sourceId, businessId });
      if (!normalised || !normalised.rating) continue;

      const { data: saved, error } = await supabase
        .from('reviews')
        .upsert(normalised, { onConflict: 'source_id,external_review_id', ignoreDuplicates: false })
        .select()
        .single();

      if (error) {
        logger.warn('Review upsert failed', { error: error.message });
        continue;
      }

      if (saved && !saved.sentiment) {
        newCount++;

        analyzeReview(saved).then(async (analysis) => {
          await supabase.from('reviews').update({
            sentiment:       analysis.sentiment,
            sentiment_score: analysis.sentiment_score,
            topics:          analysis.topics,
            urgency:         analysis.urgency,
            ai_summary:      analysis.ai_summary,
            updated_at:      new Date().toISOString(),
          }).eq('id', saved.id);

          await evaluateAlerts(businessId, { ...saved, ...analysis });

          if (analysis.urgency === 'high' && analysis.sentiment === 'negative') {
            const { generateReply } = require('../services/ai');
            const { data: biz } = await supabase.from('businesses').select('name,category,city').eq('id', businessId).single();
            if (biz) {
              try {
                const { draft } = await generateReply({ review: saved, business: biz, tone: 'empathetic' });
                await supabase.from('reviews').update({ reply_draft: draft, reply_status: 'draft_ready', updated_at: new Date().toISOString() }).eq('id', saved.id);
                logger.info('Auto-drafted reply for urgent negative review', { reviewId: saved.id });
              } catch (e) {
                logger.warn('Auto-draft failed', { error: e.message });
              }
            }
          }
        }).catch(e => logger.error('Review analysis pipeline failed', { error: e.message, reviewId: saved.id }));
      }
    }

    await supabase.from('review_sources')
      .update({ last_scraped_at: new Date().toISOString() })
      .eq('id', sourceId);

    if (jobs.has(runId)) {
      Object.assign(jobs.get(runId), {
        status: 'completed',
        new_reviews_found: newCount,
        duration_sec: Math.round((Date.now() - new Date(jobs.get(runId).queued_at)) / 1000),
        completed_at: new Date().toISOString(),
      });
    }

    logger.info('Scraper webhook processed', { businessId, platform, newCount });

  } catch (err) {
    logger.error('Scraper webhook processing error', { error: err.message });
    if (jobs.has(runId)) jobs.get(runId).status = 'failed';
  }
}

module.exports = router;
module.exports.handleScraperWebhook = handleScraperWebhook;
module.exports.jobs = jobs;
