import { useEffect, useState } from 'react';
import { aiApi } from '../api';
import type { AttributedPointDto, CommentDigestInputDto, CommentDigestResponseDto } from '../api';
import { aiFingerprint, getCachedAiResult, setCachedAiResult } from '../utils/aiResultCache';
import { formatRelativeAgo } from '../utils/relativeTime';
import { AiUsageCard } from './AiUsageCard';
import './CommentDigestModal.css';

interface CommentDigestModalProps {
  /** Issue key — scopes the cache to this ticket (see aiResultCache.ts). */
  ticketKey: string;
  comments: CommentDigestInputDto[];
  /** Jumps the underlying activity list to a specific comment and closes this modal — lets a
   *  decision/question/action item be verified against its source instead of trusted on faith. */
  onJumpToComment: (commentId: number) => void;
  onClose: () => void;
}

function CiteChips({ commentIds, onJumpToComment }: { commentIds: number[]; onJumpToComment: (commentId: number) => void }) {
  if (commentIds.length === 0) return null;
  return (
    <span className="cd-point__cites">
      {commentIds.map((id) => (
        <button
          type="button"
          key={id}
          className="cd-cite"
          title="Jump to this comment"
          onClick={() => onJumpToComment(id)}
        >
          #{id}
        </button>
      ))}
    </span>
  );
}

function AttributedList({
  label,
  points,
  onJumpToComment,
}: {
  label: string;
  points: AttributedPointDto[];
  onJumpToComment: (commentId: number) => void;
}) {
  if (points.length === 0) return null;
  return (
    <div className="cd-group">
      <span className="cd-group__label">{label}</span>
      <ul className="cd-group__list">
        {points.map((point, i) => (
          <li key={i} className="cd-point">
            <span>{point.text}</span>
            <CiteChips commentIds={point.commentIds} onJumpToComment={onJumpToComment} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CommentDigestModal({ ticketKey, comments, onJumpToComment, onClose }: CommentDigestModalProps) {
  const fingerprint = aiFingerprint(comments.map((c) => `${c.id}:${c.content}`));
  const cached = getCachedAiResult<CommentDigestResponseDto>('comment-digest', ticketKey, fingerprint);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommentDigestResponseDto | null>(cached?.result ?? null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(cached?.generatedAt ?? null);
  const [fromCache, setFromCache] = useState(cached != null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function runDigest() {
    setLoading(true);
    setError(null);
    aiApi.summarizeComments(comments)
      .then((res) => {
        setResult(res);
        setGeneratedAt(Date.now());
        setFromCache(false);
        // Skipped (too-few-comments) and degraded (model/provider failure) results are cheap or
        // free respectively — worth remembering anyway so reopening the popup doesn't re-show the
        // loading spinner for something that already resolved, but neither is "the real answer",
        // so a degraded run in particular should be easy to retry rather than sticky.
        setCachedAiResult('comment-digest', ticketKey, fingerprint, res);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Comment summary failed.'))
      .finally(() => setLoading(false));
  }

  return (
    <div className="bl-overlay" onMouseDown={onClose}>
      <div className="bl-modal cd-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bl-modal__header">
          <h2 className="bl-modal__title">☰ Summarize Comments</h2>
          <button type="button" className="bl-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="bl-modal__body cd-body">
          {!result && !loading && !error && (
            <div className="cd-startup">
              <p className="cd-hint">
                Reads {comments.length} comment{comments.length !== 1 ? 's' : ''} and asks the AI for a
                grounded summary — this is a real model call, so it only runs when you ask for it.
              </p>
              <button type="button" className="bl-btn bl-btn--primary" onClick={runDigest}>
                ✦ Generate summary
              </button>
            </div>
          )}

          {loading && (
            <div className="cd-loading">
              <span className="cd-spinner" aria-hidden />
              Reading {comments.length} comment{comments.length !== 1 ? 's' : ''}…
            </div>
          )}
          {error && (
            <div className="cd-startup">
              <p className="cd-error">{error}</p>
              <button type="button" className="bl-btn bl-btn--outline" onClick={runDigest}>Try again</button>
            </div>
          )}

          {result?.skipped && (
            <p className="cd-hint">Not enough comments to summarize yet — check back once the thread has a bit more discussion.</p>
          )}

          {result && !result.skipped && (
            <>
              {generatedAt && (
                <div className="cd-regen-row">
                  <span className="cd-hint cd-hint--cached">
                    {fromCache ? 'From an earlier run, ' : 'Generated '}
                    {formatRelativeAgo(new Date(generatedAt).toISOString())}
                  </span>
                  <button type="button" className="cd-regen-btn" onClick={runDigest} disabled={loading}>
                    ↻ Regenerate
                  </button>
                </div>
              )}
              {result.degraded && (
                <p className="cd-hint cd-hint--warn">
                  AI summary was unavailable — the comment thread below is unaffected, just read it directly.
                </p>
              )}
              {result.truncatedCount > 0 && (
                <p className="cd-hint">
                  This summary covers only the most recent comments — {result.truncatedCount} earlier
                  comment{result.truncatedCount !== 1 ? 's were' : ' was'} too old to include.
                </p>
              )}
              {!result.degraded && (
                <div className="cd-report">
                  {result.context && (
                    <div className="cd-report__section">
                      <span className="cd-report__label">Context</span>
                      <p className="cd-report__text">{result.context}</p>
                    </div>
                  )}
                  {result.discussion && (
                    <div className="cd-report__section">
                      <span className="cd-report__label">Discussion</span>
                      <p className="cd-report__text">{result.discussion}</p>
                    </div>
                  )}
                  {result.outcome.text && (
                    <div className="cd-report__section">
                      <span className="cd-report__label">Outcome</span>
                      <div className="cd-report__outcome">
                        <p className="cd-report__text">{result.outcome.text}</p>
                        <CiteChips commentIds={result.outcome.commentIds} onJumpToComment={onJumpToComment} />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <AttributedList label="Open questions" points={result.openQuestions} onJumpToComment={onJumpToComment} />
              {result.actionItems.length > 0 && (
                <div className="cd-group">
                  <span className="cd-group__label">Action items</span>
                  <ul className="cd-group__list">
                    {result.actionItems.map((item, i) => (
                      <li key={i} className="cd-point">
                        <span>
                          {item.text}
                          {item.owner && <span className="cd-owner"> — {item.owner}</span>}
                        </span>
                        <CiteChips commentIds={item.commentIds} onJumpToComment={onJumpToComment} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!result.degraded
                && result.openQuestions.length === 0
                && result.actionItems.length === 0 && (
                <p className="cd-hint">No open questions or action items found in this thread.</p>
              )}
              {!result.degraded && (
                <AiUsageCard
                  title="AI analysis details"
                  description="Usage for this comment summary"
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
          <button type="button" className="bl-btn bl-btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
