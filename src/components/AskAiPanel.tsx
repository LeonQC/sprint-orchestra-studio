import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSpaces } from '../context/SpaceContext';
import { aiApi } from '../api';
import type {
  AskMode, AskResponseDto, ChatTurnDto, ClarificationOptionDto, HistorySummaryDto, ModelUsageDto,
} from '../api';
import { IssueKeyChip } from './IssueKeyChip';
import { AiUsageCard } from './AiUsageCard';
import { AnswerFeedback } from './AnswerFeedback';
import { formatDuration } from '../utils/formatDuration';
import './AskAiPanel.css';

interface AskAiPanelProps {
  onClose: () => void;
}

/** Clickable starting points shown only before the first question — gives an empty conversation
 *  something purposeful to show instead of dead space, and doubles as a hint at the kinds of
 *  questions this tool is actually good at (content vs. counts vs. history). */
const SUGGESTED_PROMPTS = [
  "What's blocking the payment epic?",
  'Which issues were reopened after being marked done?',
  "What's the current sprint's goal?",
  'How many bugs are still open?',
];

/** What each answer mode means, shown under the picker. Deep costs more, so that is stated before the
 *  click, not found out after the wait. */
const MODE_OPTIONS: { value: AskMode; label: string; hint: string }[] = [
  {
    value: 'fast',
    label: 'Fast',
    hint: 'One search agent looks through all the selected spaces. Quickest and cheapest.',
  },
  {
    value: 'deep',
    label: 'Deep investigation',
    hint: 'If your question compares spaces, one agent per space searches on its own and the results '
      + 'are combined and checked. That is slower (about 2x) and costs about 2x more. Other '
      + 'questions are still answered by one agent.',
  },
];

const USAGE_ROLE_TITLES: Record<ModelUsageDto['role'], string> = {
  router: 'Router',
  answer_agent: 'Answer agent',
  mode_router: 'Fast or deep choice',
  history_summary: 'Chat summary',
};

/** Deep starts one agent per space, and only up to this many (ai-service's max_multi_spaces). */
const MAX_DEEP_SPACES = 3;

/** One exchange in the running conversation — the question as asked, plus the full response (so
 *  citations/abstained render per-turn, not just the latest one). */
interface ConversationTurn {
  question: string;
  result: AskResponseDto;
  /** Set when the user dismissed a clarification with "Never mind" instead of answering it. The
   *  turn stays visible (greyed, non-interactive) so the thread still reads truthfully, but it is
   *  dropped from the derived `history` below — a dangling "which source did you mean?" exchange
   *  would otherwise be sent as context for whatever the user asks next and skew that answer. */
  abandoned?: boolean;
}

/** Shows an ask_clarification turn as a picker: one button per plausible source plus a free-text
 *  "none of these". A choice is sent through the normal `handleSubmit`, so it's just the next message
 *  in `history`. Only the latest turn is `interactive` — an old picker would reopen a settled question. */
function ClarificationPrompt({
  question,
  options,
  interactive,
  abandoned,
  onPick,
  onAbandon,
}: {
  question: string;
  options: ClarificationOptionDto[];
  interactive: boolean;
  abandoned: boolean;
  onPick: (text: string) => void;
  onAbandon: () => void;
}) {
  const [otherText, setOtherText] = useState('');

  function submitOther() {
    const text = otherText.trim();
    if (!text) return;
    onPick(text);
    setOtherText('');
  }

  // The user asked something the agent couldn't pin to one source and would rather move on than
  // answer "which one?" — without this the only exits are closing the panel or "New chat", both of
  // which cost the whole thread. Dropping the turn from `history` (see ConversationTurn.abandoned)
  // is what keeps the unanswered clarification from being sent as context for the next question.
  if (abandoned) {
    return (
      <div className="aa-clarification aa-clarification--abandoned">
        <p className="aa-clarification__question">{question}</p>
        <p className="aa-clarification__abandoned-note">Skipped — this question was left unanswered.</p>
      </div>
    );
  }

  // Empty when the agent has no genuine candidates to offer — a question this vague ("What does
  // the attachment say?" with nothing else identifying which one) gets a plain open question
  // instead of a menu of unrelated top-k hits dressed up as choices (see ask_clarification's tool
  // description, "situation 2"). The options block and its divider only make sense when there's
  // something above the text field to divide it from.
  const hasOptions = options.length > 0;

  return (
    <div className="aa-clarification">
      <p className="aa-clarification__question">{question}</p>
      {hasOptions && (
        <div className="aa-clarification__options">
          {options.map((opt, oi) => (
            <button
              key={oi}
              type="button"
              className="aa-suggestion aa-clarification__option"
              disabled={!interactive}
              onClick={() => onPick(opt.label)}
            >
              {opt.issueKey && <IssueKeyChip issueKey={opt.issueKey} size="sm" />}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`aa-clarification__other${hasOptions ? ' aa-clarification__other--divided' : ''}`}>
        <input
          type="text"
          className="aa-clarification__other-input"
          placeholder={hasOptions ? 'Or type your own answer…' : 'Type your answer…'}
          value={otherText}
          disabled={!interactive}
          onChange={(e) => setOtherText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitOther(); } }}
        />
        <button
          type="button"
          className="aa-clarification__other-submit"
          disabled={!interactive || !otherText.trim()}
          onClick={submitOther}
        >
          Send
        </button>
      </div>
      <button
        type="button"
        className="aa-clarification__abandon"
        disabled={!interactive}
        onClick={onAbandon}
      >
        Never mind — skip this question
      </button>
    </div>
  );
}

export function AskAiPanel({ onClose }: AskAiPanelProps) {
  const { spaces, currentSpace } = useSpaces();
  const [query, setQuery] = useState('');
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<Set<string>>(() => new Set(spaces.map((s) => s.id)));
  const [loading, setLoading] = useState(false);
  // Fast by default: deep investigation costs about twice as much and did not answer more accurately
  // in our evals, so it is something you ask for, not something you get by accident.
  const [mode, setMode] = useState<AskMode>('fast');
  // The question currently in flight, shown as its own bubble above the loading indicator while
  // waiting — `query` alone can't serve this: a suggested-prompt chip submits via `explicitQuestion`
  // without ever touching `query`, and `query` isn't cleared until the request actually succeeds, so
  // either using it directly or clearing it early would desync the input box from what's really
  // in flight. Cleared in `finally` regardless of outcome, alongside `loading`.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Latest SSE progress label from askStream's onStage callback (e.g. "searching the knowledge
  // base") — null while idle or before the first event of a request arrives. Replaces a single
  // static "Working…" string with what the CragAgent loop is actually doing right now.
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  // Answer prose streamed from askStream's onToken while a request is in flight. Shown live as a
  // plain-text preview under the progress indicator, then discarded the moment the authoritative
  // `result` lands — that turn renders from `result.answer` (markdown, citations, and any
  // verification rewrite the preview wouldn't have). Empty except during a streaming answer.
  const [streamingText, setStreamingText] = useState('');
  // The running "ask" conversation — each entry is one question + its full answer. Follow-up
  // questions resolve against this (see `history` below); "New chat" is the only thing that clears
  // it, so an old topic's context never bleeds into an unrelated new one by accident.
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);

  // Derived, not separately stored state: the wire format ai-service expects (see ChatTurnDto) is
  // just each turn's question + final answer text, oldest first — recomputing it from `conversation`
  // means there's exactly one source of truth for "what has this chat said so far."
  const history: ChatTurnDto[] = useMemo(
    () => conversation
      .filter((t) => !t.abandoned)  // a skipped clarification is not context for the next question
      .flatMap((t): ChatTurnDto[] => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.result.answer, clarification: !!t.result.needsClarification },
      ]),
    [conversation],
  );

  // The most recent turn's own traceParent — sent back as a real header on the NEXT call so that
  // request's span joins the same trace instead of starting a new one (see aiApi.askStream's `traceParent`
  // doc comment). Undefined for the very first question, same as `history` being empty; "New chat"
  // resets both the same way, by clearing `conversation`. Abandoned turns are skipped for the same
  // reason they are dropped from `history` — the next question is not a continuation of one.
  const lastTraceParent = conversation.filter((t) => !t.abandoned).at(-1)?.result.traceParent;

  // The latest summary of this chat's earlier turns, sent back so ai-service never summarizes the
  // same turns twice. Abandoned turns count too: a summary never covers the turn it was written on,
  // and only the newest turn can be abandoned, so the turns it covers are still in `history`.
  const historySummary: HistorySummaryDto | undefined = conversation
    .map((t) => t.result.historySummary)
    .filter((s): s is HistorySummaryDto => !!s)
    .at(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-scroll, ChatGPT-style: a sentinel div at the very end of the scrollable body, scrolled into
  // view whenever a new turn lands or the "Working…" indicator appears — so a growing conversation
  // always keeps the newest content in view instead of leaving the user scrolled up on turn 1.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation.length, loading]);

  // A <details> toggle grows content without adjusting scroll, so it can push the composer out of view.
  // Decide by whether this is the LATEST turn, not by measuring distance to the bottom (the browser has
  // already grown the container when `toggle` fires): the latest turn keeps following the bottom; an
  // older turn only scrolls its box into view.
  function makeDetailsToggleHandler(isLatestTurn: boolean) {
    return (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (!e.currentTarget.open) return;
      if (isLatestTurn) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
  }

  const spaceIds = useMemo(
    () => spaces.filter((s) => selectedSpaceIds.has(s.id)).map((s) => Number(s.id)),
    [spaces, selectedSpaceIds],
  );

  function toggleSpace(id: string) {
    setSelectedSpaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Accepts an explicit question so a suggested-prompt chip can fire-and-submit in one click rather
  // than needing a setQuery + wait-for-re-render + second click round trip.
  async function handleSubmit(explicitQuestion?: string) {
    const question = (explicitQuestion ?? query).trim();
    if (!question || loading || spaceIds.length === 0) return;
    setLoading(true);
    setPendingQuestion(question);
    setError(null);
    setStageLabel(null);
    setStreamingText('');
    try {
      const result = await aiApi.askStream(
        question, spaceIds, history, setStageLabel, lastTraceParent,
        (t) => setStreamingText((prev) => prev + t),
        mode,
        historySummary,
      );
      setConversation((prev) => [...prev, { question, result }]);
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed — try again.');
    } finally {
      setLoading(false);
      setPendingQuestion(null);
      setStageLabel(null);
      setStreamingText('');
    }
  }

  /** Clears the current input/error only — deliberately leaves an in-progress
   *  conversation alone (e.g. clearing a typo mid-question shouldn't cost you the thread). */
  function handleClear() {
    setQuery('');
    setError(null);
  }

  /** "Never mind" on a clarification: keep the turn on screen (greyed) but mark it abandoned so it
   *  leaves `history`, then the user can just type a new question without the unanswered "which
   *  source?" tagging along as context. */
  function handleAbandonClarification(turnIndex: number) {
    setConversation((prev) =>
      prev.map((t, i) => (i === turnIndex ? { ...t, abandoned: true } : t)),
    );
  }

  /** Starts a fresh conversation: the one action that actually drops `history`, so a new,
   *  unrelated topic never gets the previous topic's context mixed in. */
  function handleNewChat() {
    setConversation([]);
    setQuery('');
    setError(null);
  }

  const hasResult = conversation.length > 0 || error !== null;
  const isEmpty = conversation.length === 0 && !loading && !error;

  return (
    <div className="bl-overlay" onMouseDown={onClose}>
      <div className="bl-modal aa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bl-modal__header aa-header">
          <h2 className="bl-modal__title aa-header__title">
            <span className="aa-header__badge" aria-hidden>✨</span>
            Ask AI
          </h2>
          <button type="button" className="bl-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="bl-modal__body aa-body">
          <div className="aa-top">
            <p className="aa-hint">
              Ask about existing issues, sprints, or decisions — AI automatically chooses the right
              search or structured data source, cites real issues, and says when it does not know.
            </p>

            <div className="aa-scope">
              <span className="aa-scope__label">Search in</span>
              <div className="aa-scope__pills">
                {spaces.map((s) => {
                  const active = selectedSpaceIds.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`aa-scope__pill${active ? ' aa-scope__pill--active' : ''}`}
                      aria-pressed={active}
                      onClick={() => toggleSpace(s.id)}
                    >
                      {s.name}{s.id === currentSpace.id ? ' · current' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="aa-scope">
              <span className="aa-scope__label">Mode</span>
              <div className="aa-scope__pills">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`aa-scope__pill${mode === option.value ? ' aa-scope__pill--active' : ''}`}
                    aria-pressed={mode === option.value}
                    disabled={loading}
                    onClick={() => setMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className={`aa-mode-hint${mode === 'deep' ? ' aa-mode-hint--warn' : ''}`}>
              {MODE_OPTIONS.find((o) => o.value === mode)?.hint}
            </p>
            {mode === 'deep' && spaceIds.length > MAX_DEEP_SPACES && (
              <p className="aa-mode-hint aa-mode-hint--warn">
                You selected {spaceIds.length} spaces. Deep investigation covers up to {MAX_DEEP_SPACES},
                so one search agent will answer. Deselect some spaces to use it.
              </p>
            )}
          </div>

          {/* Scrollable message thread, ChatGPT-style — the composer below stays fixed while this
              area grows and scrolls independently as the conversation gets longer. */}
          <div className="aa-scroll">
            {isEmpty && (
              <div className="aa-empty">
                <div className="aa-empty__icon" aria-hidden>✨</div>
                <p className="aa-empty__title">Ask anything about this workspace</p>
                <p className="aa-empty__hint">Try one of these, or type your own below.</p>
                <div className="aa-suggestions">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="aa-suggestion"
                      disabled={spaceIds.length === 0}
                      onClick={() => handleSubmit(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="aa-error">{error}</p>}

            {conversation.length > 0 && (
              <div className="aa-thread">
                {conversation.map((turn, i) => (
                  <div className="aa-result" key={i}>
                    <div className="aa-turn-question__row">
                      <p className="aa-turn-question">{turn.question}</p>
                    </div>
                    <div className="aa-turn-answer__row">
                      <span className="aa-turn-answer__avatar" aria-hidden>✨</span>
                      <div className="aa-turn-answer__body">
                        {turn.result.cacheHit && (
                          // Rendered only on a hit: an uncached answer is the normal case and gets
                          // no badge, so this never becomes decoration people stop reading. The
                          // elapsed time is part of the badge rather than a separate line because
                          // the number IS the claim — "Cached" alone invites "cached from where,
                          // and did it actually save anything?", which a single-digit millisecond
                          // figure answers on sight.
                          <div
                            className="aa-cached"
                            title={
                              'Served from the semantic answer cache — no retrieval and no LLM call. '
                              + 'Cached answers are scoped to these spaces and are discarded '
                              + 'automatically when anything they could depend on is re-indexed. '
                              + 'Expand "Stage latency" for the per-stage proof.'
                            }
                          >
                            <span className="aa-cached__icon" aria-hidden>⚡</span>
                            <span>Cached</span>
                            {turn.result.stageTimings && (
                              <span className="aa-cached__meta">
                                · {formatDuration(turn.result.stageTimings.totalMs)}
                              </span>
                            )}
                          </div>
                        )}
                        {turn.result.executionMode === 'multi' && (
                          <div className="aa-mode-badge" title={turn.result.modeRouteReason}>
                            Several search agents were used · one per space
                          </div>
                        )}
                        {turn.result.executionMode === 'single'
                          && turn.result.modeRouteSource !== undefined
                          && ['rule', 'model', 'fallback'].includes(turn.result.modeRouteSource)
                          && turn.result.modeRouteReason && (
                          // Deep was on but one agent answered: say why, so the answer is never
                          // mistaken for a deep one. Fast never reaches here (its source is "user").
                          <div className="aa-mode-badge aa-mode-badge--note">
                            Answered by one search agent: {turn.result.modeRouteReason}
                          </div>
                        )}
                        {turn.result.historySummary && (
                          <div className="aa-mode-badge aa-mode-badge--note">
                            This chat is long, so its earlier questions were summarized. The
                            latest answer is still read in full.
                          </div>
                        )}
                        {turn.result.needsClarification ? (
                          // Clarification picker: the choice is resent through the normal
                          // handleSubmit as the next message. Only the latest turn is clickable.
                          <ClarificationPrompt
                            question={turn.result.answer}
                            options={turn.result.clarificationOptions ?? []}
                            interactive={i === conversation.length - 1 && !loading && !turn.abandoned}
                            abandoned={turn.abandoned ?? false}
                            onPick={(text) => handleSubmit(text)}
                            onAbandon={() => handleAbandonClarification(i)}
                          />
                        ) : turn.result.abstained ? (
                          // Render the backend's own answer text rather than separate hardcoded copy:
                          // it's the exact ABSTENTION_PHRASE contract ai-service guarantees
                          // (app/agent/crag_loop.py) — duplicating that string here would just be one
                          // more place for the two to drift out of sync, which already happened once.
                          <p className="aa-abstained">{turn.result.answer}</p>
                        ) : (
                          <div className="aa-answer">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {turn.result.answer}
                            </ReactMarkdown>
                          </div>
                        )}
                        {turn.result.feedbackReceipt && !turn.abandoned && !turn.result.needsClarification && (
                          <AnswerFeedback receipt={turn.result.feedbackReceipt} />
                        )}
                        {turn.result.citations.length > 0 && (
                          // <details> gives collapse/expand for free — no state, no JS, keyboard/
                          // screen reader accessible by default — matching the "answer first, sources
                          // on demand" pattern most modern chat UIs use over always-open citation dumps.
                          <details className="aa-citations" onToggle={makeDetailsToggleHandler(i === conversation.length - 1)}>
                            <summary className="aa-citations__summary">
                              Sources ({turn.result.citations.length})
                            </summary>
                            <div className="aa-citations__list">
                              {turn.result.citations.map((c, ci) => (
                                <div className="aa-citation" key={`${c.issueKey}-${ci}`}>
                                  <IssueKeyChip issueKey={c.issueKey} size="sm" />
                                  <span className="aa-citation__snippet">{c.content}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {turn.result.stageTimings && (
                          // Same collapse-for-free <details> pattern as Sources above — server-
                          // measured wall-clock split, off by default so it doesn't clutter a normal
                          // read of the answer, one click away when latency itself is the question.
                          <details className="aa-citations" onToggle={makeDetailsToggleHandler(i === conversation.length - 1)}>
                            <summary className="aa-citations__summary">Stage latency</summary>
                            <div className="aa-citations__list">
                              <span className="aa-citation__snippet">
                                {/* Exactly 0 does not mean "instant" — it means the cache was never
                                    consulted at all. ai-service initialises this to 0.0 and only
                                    overwrites it inside the branch that actually performs a lookup,
                                    and a real lookup (a Redis round trip, plus an embedding call
                                    when the exact tier misses) cannot come back under 5µs. Printing
                                    "0ms" for it reads as a very fast hit and is how a cache that was
                                    silently switched off went unnoticed for months. */}
                                cache lookup: {turn.result.stageTimings.cacheLookupMs === 0
                                  ? 'not consulted'
                                  : formatDuration(turn.result.stageTimings.cacheLookupMs)}
                                {' · '}retrieval: {formatDuration(turn.result.stageTimings.retrievalMs)}
                                {' · '}LLM calls: {formatDuration(turn.result.stageTimings.llmMs)}
                                {' · '}total: {formatDuration(turn.result.stageTimings.totalMs)}
                              </span>
                            </div>
                          </details>
                        )}
                        {turn.result.modelUsage && turn.result.modelUsage.length > 0 && (
                          <details className="aa-citations" onToggle={makeDetailsToggleHandler(i === conversation.length - 1)}>
                            <summary className="aa-citations__summary">
                              AI usage
                              {turn.result.routeTool
                                ? ` · ${turn.result.routeSource ?? 'route'} → ${turn.result.routeTool}`
                                : ''}
                            </summary>
                            <div className="aa-model-usage-list">
                              {turn.result.modelUsage.map((usage) => (
                                <AiUsageCard
                                  key={`${usage.role}-${usage.provider}-${usage.model}`}
                                  compact
                                  title={USAGE_ROLE_TITLES[usage.role]}
                                  description={`${usage.provider} · ${usage.model} · ${usage.deployment === 'local' ? 'Local' : 'Hosted API'}`}
                                  inputTokens={usage.inputTokens}
                                  outputTokens={usage.outputTokens}
                                  cachedInputTokens={usage.cachedInputTokens}
                                  estimatedCostUsd={usage.estimatedCostUsd}
                                  pricingStatus={usage.pricingStatus}
                                />
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* The in-flight question + its loading indicator, rendered AFTER the completed thread
                (not before it) so a new turn appears where a new turn belongs — right after the
                last completed one, not stranded above the whole history. Previously this loading
                block was rendered ahead of `.aa-thread` in JSX order, so it rendered above every
                completed turn regardless of scroll position — confirmed live: asking a 3rd question
                showed its "reviewing results…" indicator above turns 1 and 2, not below them, no
                matter how far down the user had scrolled. */}
            {loading && (
              <div className="aa-result">
                <div className="aa-turn-question__row">
                  <p className="aa-turn-question">{pendingQuestion}</p>
                </div>
                <div className="aa-loading">
                  <span className="aa-loading__dot" aria-hidden />
                  <span className="aa-loading__dot" aria-hidden />
                  <span className="aa-loading__dot" aria-hidden />
                  {/* Live progress from the SSE stream (see askStream) once the first event arrives;
                      falls back to a generic message for the brief gap before it does. */}
                  <span>{stageLabel ? `${stageLabel}…` : 'Retrieving relevant data and reasoning through an answer…'}</span>
                </div>
                {/* The answer prose as it streams in (askStream's onToken), rendered as markdown as
                    it grows so the reader never sees raw "**" / "- " mid-stream. react-markdown
                    tolerates unclosed syntax — a trailing "**" shows literally until its partner
                    arrives, then reflows. The completed turn below still replaces this wholesale the
                    instant `result` lands (citations, and any verification rewrite).
                    The tag + dashed rule + opacity below are the "still a draft" cue that lives ON
                    the block itself, not just in the stage label above it — a fully-formatted
                    markdown answer (bold, bullets, citations) reads as finished the moment it's done
                    streaming, well before verification (which can rewrite it) actually completes, so
                    the "verifying and finalizing…" line above can no longer be the only signal that
                    what's on screen is provisional. Found live: a multi-second verification pause
                    left a complete-looking, citation-bearing answer on screen with only a small,
                    easy-to-miss label above it claiming otherwise. */}
                {streamingText && (
                  <div className="aa-answer aa-streaming-preview">
                    <span className="aa-streaming-preview__tag">Draft · verifying</span>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Composer pinned at the bottom of the panel, same placement as a modern LLM chat UI. */}
          <div className="aa-composer">
            {hasResult && !loading && (
              <div className="aa-composer__actions">
                <button
                  type="button"
                  className="aa-icon-btn"
                  onClick={handleClear}
                  title="Clear what you've typed below (keeps the conversation above)"
                >
                  <svg className="aa-icon-btn__icon" viewBox="0 0 16 16" aria-hidden>
                    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  Clear
                </button>
                {conversation.length > 0 && (
                  <button
                    type="button"
                    className="aa-icon-btn"
                    onClick={handleNewChat}
                    title="Start a fresh conversation — this thread's history won't be sent with your next question"
                  >
                    <svg className="aa-icon-btn__icon" viewBox="0 0 16 16" aria-hidden>
                      <path
                        d="M8.5 3H3.75a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7.25"
                        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
                      />
                      <path
                        d="M11.85 2.15a1.1 1.1 0 0 1 1.56 1.56L8.7 8.4 6.9 9l.6-1.8z"
                        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
                      />
                    </svg>
                    New chat
                  </button>
                )}
              </div>
            )}
            <div className="aa-query-row">
              <input
                className="aa-query-input"
                placeholder="e.g. what's blocking the payment epic?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
                autoFocus
              />
              <button
                type="button"
                className="aa-send-btn"
                onClick={() => handleSubmit()}
                disabled={!query.trim() || loading || spaceIds.length === 0}
                aria-label={loading ? 'Working…' : 'Ask'}
                title={loading ? 'Working…' : 'Ask'}
              >
                {loading ? <span className="aa-spinner" aria-hidden /> : <span aria-hidden>↑</span>}
              </button>
            </div>
            {spaceIds.length === 0 && <p className="aa-error">Select at least one space to search.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
