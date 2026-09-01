document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('tryit-form');
  if (!form) return; // not on this page

  const panel = document.getElementById('results-panel');
  const submitBtn = form.querySelector('button[type=submit]');

  function chip(cls, text) {
    // FIX (red-team round 2, corrected): the first fix here used
    // escapeHtml() on `cls`, which was NOT actually sufficient — verified
    // by re-running the identical attack after that first fix and finding
    // it still worked. Root cause: escapeHtml()'s textContent/innerHTML
    // round-trip only escapes characters special to HTML TEXT CONTENT
    // (<, >, &), not double quotes — because quotes have no special
    // meaning in text content. But `cls` is inserted into an HTML
    // ATTRIBUTE value, where the quote character is exactly what allows
    // an attacker to break out. Using a dedicated attribute-escaping
    // function this time, confirmed against the same live-browser attack
    // that found the original bug.
    return `<span class="chip ${escapeAttr(cls)}">${escapeHtml(text)}</span>`;
  }

  function escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showLoading() {
    panel.className = 'results-panel';
    panel.innerHTML = `
      <div class="results-loading">
        <div class="spinner"></div>
        Analyzing your review...
      </div>`;
  }

  function showError(message) {
    panel.className = 'results-panel';
    panel.innerHTML = `<div class="tryit-error">${escapeHtml(message)}</div>`;
  }

  function showResults(data) {
    panel.className = 'results-panel has-results';

    const sentimentChip = chip(`sentiment-${data.analysis.sentiment}`, data.analysis.sentiment);
    const urgencyChip = chip(`urgency-${data.analysis.urgency}`, `urgency: ${data.analysis.urgency}`);
    const topicChips = (data.analysis.topics || []).map(t => chip('topic', t)).join('');

    let bodyHtml = '';

    if (data.escalatedForSafety) {
      bodyHtml = `
        <div class="result-escalate-box">
          <div class="result-escalate-title">🚩 Flagged for you, not auto-replied</div>
          <div class="result-escalate-text">
            This review was flagged as a possible safety or health concern
            (${escapeHtml(data.analysis.safety_reason || 'detected by automated screening')}).
            Corner Voice never auto-drafts a reply to a review like this — it's routed
            straight to the business owner for a personal response instead.
          </div>
        </div>`;
    } else {
      bodyHtml = `
        <div class="result-draft-box">
          <div class="result-draft-label">✓ Drafted reply</div>
          <div class="result-draft-text">${escapeHtml(data.reply.draft)}</div>
        </div>`;
      if (data.reply.flaggedForHumanReview) {
        bodyHtml += `
          <div class="tryit-error" style="margin-top:14px;">
            This draft was flagged by our compliance check before you saw it
            ${data.reply.moderationExplanation ? '(' + escapeHtml(data.reply.moderationExplanation) + ')' : ''}
            — in the real product, this would be held for the business owner
            to review rather than sent automatically.
          </div>`;
      }
    }

    panel.innerHTML = `
      <div class="results-header">
        <div class="analysis-row">${sentimentChip}${urgencyChip}${topicChips}</div>
      </div>
      <div class="results-body">${bodyHtml}</div>
    `;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const reviewEl = document.getElementById('ti-review');
    const ratingEl = document.getElementById('ti-rating');
    const reviewGroup = reviewEl.closest('.form-group');
    const ratingGroup = ratingEl.closest('.form-group');
    reviewGroup.classList.remove('invalid');
    ratingGroup.classList.remove('invalid');

    let valid = true;
    if (!reviewEl.value.trim()) {
      reviewGroup.classList.add('invalid');
      reviewGroup.querySelector('.field-error').textContent = 'Please paste in a review first.';
      valid = false;
    }
    if (!ratingEl.value) {
      ratingGroup.classList.add('invalid');
      ratingGroup.querySelector('.field-error').textContent = 'Please select a star rating.';
      valid = false;
    }
    if (!valid) return;

    // Turnstile only injects a real token once the challenge is solved
    // (usually automatic and near-instant for a real browser, invisible
    // to most users). If it's missing, either the widget hasn't finished
    // yet or the site key in the HTML hasn't been set up — either way,
    // don't send the request without it.
    const turnstileToken = typeof turnstile !== 'undefined' ? turnstile.getResponse() : null;
    if (!turnstileToken) {
      showError('Please complete the verification check above, then try again.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Analyzing...';
    showLoading();

    try {
      const res = await fetch(`${CORNERVOICE_API_BASE}/v1/demo/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewText: reviewEl.value.trim(),
          rating: Number(ratingEl.value),
          tone: document.getElementById('ti-tone').value,
          businessName: document.getElementById('ti-business').value.trim(),
          turnstileToken,
          businessCategory: document.getElementById('ti-category').value.trim(),
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        showError(body?.error?.message || 'Something went wrong. Please try again.');
        return;
      }

      showResults(body.data);

    } catch (err) {
      showError("Couldn't reach the server. Please check your connection and try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Analyze This Review';
      // Turnstile tokens are single-use — reset so the next attempt
      // (whether this one succeeded or failed) gets a fresh token
      // instead of silently failing verification with a spent one.
      if (typeof turnstile !== 'undefined') turnstile.reset();
    }
  });
});
