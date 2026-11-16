import { useEffect, useMemo, useState } from 'react';
import { aiApi } from '../api';
import type { PrecedentResponseDto } from '../api';
import { aiFingerprint, getCachedAiResult, setCachedAiResult } from '../utils/aiResultCache';
import { formatRelativeAgo } from '../utils/relativeTime';
import { AiUsageCard } from './AiUsageCard';
import { IssueKeyChip } from './IssueKeyChip';
import './PrecedentModal.css';

const FEATURE = 'link_similar_work_items';
/** The relation this modal creates — "relates to" is the one Jira relation that doesn't assert an
 *  order or a blocking dependency, matching what "found as a similar work item" actually means. */
const LINK_RELATION = 'relates to';

interface PrecedentModalProps {
  ticketKey: string;
  title: string;
  description: string;
  spaceIds: number[];
  /** Omitted when the current ticket has no dbId yet (never saved) — selecting and linking is
   *  disabled in that case, since there is nothing to attach the link to. */
  onAddIssueLink?: (issueDbId: number, relation: string, targetIssueKey: string) => Promise<void>;
  ticketDbId?: number;
  /** Relations already recorded on the current ticket, keyed by target issue key — used to grey out
   *  a precedent that's already linked instead of silently letting a duplicate be requested. */
  existingRelationsByKey: Map<string, string[]>;
  onClose: () => void;
}

export function PrecedentModal({
  ticketKey, title, description, spaceIds, onAddIssueLink, ticketDbId,
  existingRelationsByKey, onClose,
}: PrecedentModalProps) {
  const fingerprint = aiFingerprint([title, description]);
  const cached = getCachedAiResult<PrecedentResponseDto>(FEATURE, ticketKey, fingerprint);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrecedentResponseDto | null>(cached?.result ?? null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(cached?.generatedAt ?? null);
  const [fromCache, setFromCache] = useState(cached != null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function run() {
    setLoading(true);
    setError(null);
    aiApi.findPrecedents(spaceIds, ticketKey, title, description)
      .then((res) => {
        setResult(res);
        setGeneratedAt(Date.now());
        setFromCache(false);
        setSelected(new Set());
        setCachedAiResult(FEATURE, ticketKey, fingerprint, res);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Precedent search failed.'))
      .finally(() => setLoading(false));
  }

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleAddSelected() {
    if (!onAddIssueLink || ticketDbId == null || selected.size === 0) return;
    setLinking(true);
    setLinkError(null);
    try {
      for (const key of selected) {
        await onAddIssueLink(ticketDbId, LINK_RELATION, key);
      }
      setJustLinked((prev) => new Set([...prev, ...selected]));
      setSelected(new Set());
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Failed to link one or more issues.');
    } finally {
      setLinking(false);
    }
  }

  const linkableCount = useMemo(() => {
    if (!result) return 0;
    return result.precedents.filter((p) => {
      const already = existingRelationsByKey.get(p.issueKey.toUpperCase()) ?? [];
      return !already.includes(LINK_RELATION) && !justLinked.has(p.issueKey);
    }).length;
  }, [result, existingRelationsByKey, justLinked]);

  return (
    <div className="bl-overlay" onMouseDown={onClose}>
      <div className="bl-modal pr-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bl-modal__header">
          <h2 className="bl-modal__title">⇄ Similar Work Items</h2>
          <button type="button" className="bl-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="bl-modal__body pr-body">
          {!result && !loading && !error && (
            <div className="pr-startup">
              <p className="pr-hint">
                Looks for work this team has already done that's close enough to be worth reading
                before you start. Pick the ones worth keeping — open them to read, or link them onto
                this issue as "relates to" references.
              </p>
              <button type="button" className="bl-btn bl-btn--primary" onClick={run}>
                ✦ Find similar work
              </button>
            </div>
          )}

          {loading && (
            <div className="pr-loading">
              <span className="pr-spinner" aria-hidden />
              Searching this space and reading what came back…
            </div>
          )}

          {error && (
            <div className="pr-startup">
              <p className="pr-error">{error}</p>
              <button type="button" className="bl-btn bl-btn--outline" onClick={run}>Try again</button>
            </div>
          )}

          {result && (
            <>
              {generatedAt && (
                <div className="pr-regen-row">
                  <span className="pr-hint pr-hint--cached">
                    {fromCache ? 'From an earlier run, ' : 'Searched '}
                    {formatRelativeAgo(new Date(generatedAt).toISOString())}
                    {result.candidatesConsidered > 0
                      && ` · reviewed ${result.candidatesConsidered} candidate${result.candidatesConsidered !== 1 ? 's' : ''}`}
                  </span>
                  <button type="button" className="pr-regen-btn" onClick={run} disabled={loading}>
                    ↻ Search again
                  </button>
                </div>
              )}

              {result.degraded && (
                <p className="pr-hint pr-hint--warn">
                  Similar work couldn't be checked right now. Please try again in a few minutes —
                  nothing was changed on this issue.
                </p>
              )}

              {!result.degraded && result.verdict === 'none_relevant' && (
                <div className="pr-verdict">
                  <span className="pr-verdict__icon" aria-hidden>○</span>
                  <div>
                    <strong>Nothing here is worth reading first.</strong>
                    <p>
                      {result.noCandidates
                        ? 'No issue in this space is close enough to this work to be a useful reference.'
                        : `Reviewed ${result.candidatesConsidered} related issue${result.candidatesConsidered !== 1 ? 's' : ''}, but none would actually help you start this one.`}
                    </p>
                  </div>
                </div>
              )}

              {result.precedents.length > 0 && (
                <ul className="pr-list">
                  {result.precedents.map((p) => {
                    const existing = existingRelationsByKey.get(p.issueKey.toUpperCase()) ?? [];
                    const alreadyLinked = existing.includes(LINK_RELATION) || justLinked.has(p.issueKey);
                    return (
                      <li key={p.issueKey} className="pr-item">
                        {onAddIssueLink && ticketDbId != null && (
                          <input
                            type="checkbox"
                            className="pr-item__check"
                            checked={selected.has(p.issueKey)}
                            onChange={() => toggleSelected(p.issueKey)}
                            disabled={alreadyLinked}
                            aria-label={`Select ${p.issueKey} to link`}
                          />
                        )}
                        <div className="pr-item__body">
                          <div className="pr-item__head">
                            {/* Always opens in a NEW tab, never in-place: this modal sits on top of
                                the ticket you're linking work onto, mid-selection — navigating away
                                in the same tab would discard that ticket and your selection. */}
                            <a
                              className="pr-item__key"
                              href={`/ticket/${p.issueKey}`}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open ${p.issueKey} in a new tab`}
                            >
                              <IssueKeyChip issueKey={p.issueKey} size="sm" />
                            </a>
                            <span className="pr-item__newtab-hint">opens in a new tab ↗</span>
                            {alreadyLinked && <span className="pr-item__linked-badge">already linked</span>}
                            {!alreadyLinked && existing.length > 0 && (
                              <span className="pr-item__linked-badge pr-item__linked-badge--other">
                                linked as {existing[0]}
                              </span>
                            )}
                          </div>
                          <a
                            className="pr-item__title"
                            href={`/ticket/${p.issueKey}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${p.issueKey} in a new tab`}
                          >
                            {p.title || p.issueKey}
                          </a>
                          <p className="pr-item__why">{p.relevance}</p>
                          {p.takeaway && (
                            <p className="pr-item__takeaway">
                              <span className="pr-item__takeaway-label">Worth knowing</span>
                              {p.takeaway}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {linkError && <p className="pr-error">{linkError}</p>}

              {!result.degraded && (
                <AiUsageCard
                  title="AI analysis details"
                  description="Usage for this similar-work search"
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
          {onAddIssueLink && ticketDbId != null && linkableCount > 0 && (
            <button
              type="button"
              className="bl-btn bl-btn--primary"
              onClick={handleAddSelected}
              disabled={selected.size === 0 || linking}
            >
              {linking
                ? 'Linking…'
                : selected.size === 0
                  ? 'Select items to link'
                  : `Link ${selected.size} selected as "${LINK_RELATION}"`}
            </button>
          )}
          <button type="button" className="bl-btn bl-btn--outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
