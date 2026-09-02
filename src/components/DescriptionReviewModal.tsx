import { useEffect, useState } from 'react';
import { aiApi } from '../api';
import type { DescriptionReviewResponseDto } from '../api';
import { aiFingerprint, getCachedAiResult, invalidateAiResult, setCachedAiResult } from '../utils/aiResultCache';
import { formatRelativeAgo } from '../utils/relativeTime';
import { AiUsageCard } from './AiUsageCard';
import './DescriptionReviewModal.css';

const FEATURE = 'description-review';

const KIND_LABEL: Record<string, string> = {
  typo: 'Typo',
  grammar: 'Grammar',
  unclear: 'Unclear',
  ambiguous: 'Ambiguous',
};

interface DescriptionReviewModalProps {
  /** Issue key — scopes the cache to this ticket (see aiResultCache.ts). */
  ticketKey: string;
  description: string;
  title?: string;
  /** Persists the edited description. Only ever called from the explicit Apply button, on text the
   *  user has just seen as a before/after list. */
  onApply: (improvedDescription: string) => Promise<void> | void;
  onClose: () => void;
}

export function DescriptionReviewModal({
  ticketKey, description, title, onApply, onClose,
}: DescriptionReviewModalProps) {
  const fingerprint = aiFingerprint([description]);
  const cached = getCachedAiResult<DescriptionReviewResponseDto>(FEATURE, ticketKey, fingerprint);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DescriptionReviewResponseDto | null>(cached?.result ?? null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(cached?.generatedAt ?? null);
  const [fromCache, setFromCache] = useState(cached != null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function runReview() {
    setLoading(true);
    setError(null);
    aiApi.reviewDescription(description, title)
      .then((res) => {
        setResult(res);
        setGeneratedAt(Date.now());
        setFromCache(false);
        setCachedAiResult(FEATURE, ticketKey, fingerprint, res);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Description review failed.'))
      .finally(() => setLoading(false));
  }

  async function handleApply() {
    if (!result?.improvedDescription) return;
    setApplying(true);
    try {
      await onApply(result.improvedDescription);
      // The cached review describes text that no longer exists — keeping it would offer the same
      // edits again against a description that already has them.
      invalidateAiResult(FEATURE, ticketKey);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  const findings = result?.findings ?? [];

  return (
    <div className="bl-overlay" onMouseDown={onClose}>
      <div className="bl-modal dr-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bl-modal__header">
          <h2 className="bl-modal__title">✎ Improve Description</h2>
          <button type="button" className="bl-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="bl-modal__body dr-body">
          {!result && !loading && !error && (
            <div className="dr-startup">
              <p className="dr-hint">
                Checks this description for typos, grammar, and wording that could be misread. It
                only proposes — nothing changes until you apply it. Most descriptions come back with
                no changes needed.
              </p>
              <button type="button" className="bl-btn bl-btn--primary" onClick={runReview}>
                ✦ Check description
              </button>
            </div>
          )}

          {loading && (
            <div className="dr-loading">
              <span className="dr-spinner" aria-hidden />
              Reading the description…
            </div>
          )}

          {error && (
            <div className="dr-startup">
              <p className="dr-error">{error}</p>
              <button type="button" className="bl-btn bl-btn--outline" onClick={runReview}>Try again</button>
            </div>
          )}

          {result && (
            <>
              {generatedAt && (
                <div className="dr-regen-row">
                  <span className="dr-hint dr-hint--cached">
                    {fromCache ? 'From an earlier run, ' : 'Checked '}
                    {formatRelativeAgo(new Date(generatedAt).toISOString())}
                  </span>
                  <button type="button" className="dr-regen-btn" onClick={runReview} disabled={loading}>
                    ↻ Re-check
                  </button>
                </div>
              )}

              {result.skipped && (
                <p className="dr-hint">
                  This description is too short to review — there isn't enough text to check.
                </p>
              )}

              {result.degraded && (
                <p className="dr-hint dr-hint--warn">
                  The AI check was unavailable. Your description is untouched — nothing was changed.
                </p>
              )}

              {!result.skipped && !result.degraded && result.verdict === 'fine_as_is' && (
                <div className="dr-verdict dr-verdict--ok">
                  <span className="dr-verdict__icon" aria-hidden>✓</span>
                  <div>
                    <strong>Looks good — no changes needed.</strong>
                    <p>Nothing here reads as a typo, a grammar slip, or wording that could be misread.</p>
                  </div>
                </div>
              )}

              {result.truncated && (
                <p className="dr-hint">
                  This description is very long — only the beginning was reviewed.
                </p>
              )}

              {findings.length > 0 && (
                <>
                  <p className="dr-count">
                    {findings.length} suggested change{findings.length !== 1 ? 's' : ''} — review before applying.
                  </p>
                  <ul className="dr-findings">
                    {findings.map((f, i) => (
                      <li key={i} className="dr-finding">
                        <span className={`dr-kind dr-kind--${f.kind}`}>{KIND_LABEL[f.kind] ?? f.kind}</span>
                        <div className="dr-finding__body">
                          <div className="dr-diff">
                            <del className="dr-diff__before">{f.quote}</del>
                            <span className="dr-diff__arrow" aria-hidden>→</span>
                            <ins className="dr-diff__after">{f.suggestion}</ins>
                          </div>
                          <p className="dr-why">{f.why}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {result.droppedFindingCount > 0 && (
                <p className="dr-hint dr-hint--muted">
                  {result.droppedFindingCount} further suggestion{result.droppedFindingCount !== 1 ? 's were' : ' was'} discarded
                  for not matching the description exactly.
                </p>
              )}

              {!result.degraded && !result.skipped && (
                <AiUsageCard
                  title="AI analysis details"
                  description="Usage for this description check"
                  inputTokens={result.inputTokens}
                  outputTokens={result.outputTokens}
                  cachedInputTokens={result.cachedInputTokens}
                  estimatedCostUsd={result.estimatedCostUsd}
                  latencySeconds={result.latencySeconds}
                />
              )}
            </>
          )}
        </div>

        <div className="bl-modal__footer">
          {result?.improvedDescription && (
            <button
              type="button"
              className="bl-btn bl-btn--primary"
              onClick={handleApply}
              disabled={applying}
            >
              {applying ? 'Applying…' : `Apply ${findings.length} change${findings.length !== 1 ? 's' : ''}`}
            </button>
          )}
          <button type="button" className="bl-btn bl-btn--outline" onClick={onClose}>
            {result?.improvedDescription ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
