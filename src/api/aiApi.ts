import { api } from './client';

/**
 * Routed through the gateway (`/api/ai/**`, see gateway/src/main/resources/application.yml's
 * `ai-service-draft-task` route), not called directly against ai-service — same auth boundary
 * (JWT, enforced globally for `/api/**` by GatewaySecurityConfig) every other API call in this app
 * goes through, unlike the project's standalone demo page (`demo/index.html`), which talks to
 * ai-service directly with an open CORS policy meant only for local backend-only testing.
 */

/** Consumes a `text/event-stream` response shaped as `event: <name>\ndata: <json>\n\n` frames — the
 *  "stage progress labels, not token streaming" pattern every SSE endpoint in this codebase follows
 *  (see ai-service/app/api/routes.py's `POST /ask/stream` docstring for why: structured/Instructor
 *  outputs can't be meaningfully streamed token-by-token, so this streams *checkpoint* labels instead,
 *  resolving once a `result` frame arrives). Shared by `askStream` and the sprint-recovery stream
 *  variants below rather than duplicating this parser per endpoint. */
async function consumeStageStream<T>(
  path: string, body: unknown, onStage?: (label: string) => void, headers?: HeadersInit,
  onToken?: (text: string) => void,
): Promise<T> {
  const res = await api.postStream(path, body, headers);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming is not supported in this browser.');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sepIndex = buffer.indexOf('\n\n');
    while (sepIndex !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const lines = frame.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (eventLine && dataLine) {
        const eventName = eventLine.slice('event: '.length);
        const data = JSON.parse(dataLine.slice('data: '.length));
        if (eventName === 'stage') onStage?.(data.label as string);
        // A fragment of the final answer's prose as the model generates it (`/ask/stream` only).
        // The free-text answer body — including an abstention the model writes out; a clarification
        // and the forced-abstention fallback stream nothing. It is an optimistic preview: the
        // `result` frame still carries the authoritative post-verification answer, and the caller
        // must replace whatever streamed with `result.answer` (verification can rewrite the draft).
        else if (eventName === 'token') onToken?.(data.text as string);
        else if (eventName === 'result') return data as T;
        else if (eventName === 'error') throw new Error((data.detail as string) ?? 'request failed');
      }
      sepIndex = buffer.indexOf('\n\n');
    }
  }
  throw new Error('Stream ended before a result arrived.');
}

export type IssueType = 'bug' | 'task' | 'story';

export interface TaskDraftDto {
  title: string;
  issueType: IssueType;
  labels: string[];
  estimateStoryPoints: number | null;
  /** One sentence explaining what drives that size. Non-null only alongside an estimate — the
   *  server enforces the pairing (ai-service/app/drafting/schemas.py). */
  estimateRationale: string | null;
  dependencies: string[];
}

export interface DraftTaskResponse {
  draft: TaskDraftDto;
  degraded: boolean;
  latencySeconds: number;
}

export interface EpicDraftDto {
  title: string;
  description: string;
  goals: string[];
}

export interface IssueDraftDto {
  tempId: string;
  title: string;
  description: string;
  issueType: IssueType;
  labels: string[];
  estimateStoryPoints: number | null;
  estimateRationale: string | null;
  dependsOn: string[];
  dependencyReasons?: Record<string, string>;
}

export interface SprintBucketDto {
  sprintIndex: number;
  issueTempIds: string[];
  totalPoints: number;
}

export interface PlanEpicResponse {
  epic: EpicDraftDto;
  issues: IssueDraftDto[];
  sprintPlan: SprintBucketDto[];
  degraded: boolean;
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
}

export interface CitationDto {
  issueKey: string;
  chunkType: string;
  sourceId: number;
  content: string;
}

/** One prior turn's final text only — never the tool-call plumbing a completed turn produced
 *  internally (search queries, retrieved chunks, etc.). Matches ai-service's `ChatTurnIn`
 *  (app/api/routes.py): the model only needs to see what was answered, not how it was found. */
export interface ChatTurnDto {
  role: 'user' | 'assistant';
  content: string;
}

/** Server-measured wall-clock split for one /ask(/stream) call — see ai-service's `StageTimingsOut`
 *  (app/api/routes.py). Not the same number as a client-side stopwatch: this is exactly where the
 *  backend spent time (cache lookup / retrieval tool calls / LLM calls), independent of network. */
export interface StageTimingsDto {
  cacheLookupMs: number;
  retrievalMs: number;
  llmMs: number;
  totalMs: number;
}

export interface ModelUsageDto {
  role: 'router' | 'answer_agent';
  provider: string;
  model: string;
  deployment: 'local' | 'hosted';
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
  pricingStatus: 'free_local' | 'estimated' | 'unavailable';
}

export interface ClarificationOptionDto {
  label: string;
  issueKey?: string;
}

export interface AskResponseDto {
  answer: string;
  abstained: boolean;
  /** True when `answer` is a clarification QUESTION, not a completed answer — the agent found
   *  several independently plausible sources and is asking which one, rather than guessing (see
   *  ai-service's ground rule 2b / `ask_clarification` tool). Render `answer` as the question text
   *  and `clarificationOptions` as a picker instead of the normal markdown answer body; the same
   *  `answer` field carries both shapes, so this flag must be checked before rendering it as prose. */
  needsClarification?: boolean;
  /** Present (2-5 entries) whenever `needsClarification` is true; absent/empty otherwise. */
  clarificationOptions?: ClarificationOptionDto[];
  retrievalRounds: number;
  queriesUsed: string[];
  citations: CitationDto[];
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
  /** Per-role attribution. Optional so a rolling frontend deploy still accepts an older backend. */
  modelUsage?: ModelUsageDto[];
  routeSource?: 'keyword' | 'model' | 'fallback';
  routeTool?: string;
  cacheHit: boolean;
  stageTimings?: StageTimingsDto;
  /** A W3C `traceparent` naming this call's own entrypoint span (see ai-service's
   *  `_current_traceparent`). Send it back as a literal `traceparent` request header on the next
   *  `ask`/`askStream` call in the same conversation (see `aiApi.ask`'s `traceParent` param) so that
   *  request's span joins this same trace instead of starting a disconnected one — the fix for a
   *  clarification round (or any other follow-up) showing up as two separate traces. Optional so a
   *  rolling frontend deploy still accepts an older backend. */
  traceParent?: string;
}

export interface SemanticSearchHitDto {
  issueId: number;
  issueKey: string;
  /** Raw retrieval score, on whichever scale the backend produced it: cosine similarity (0-1)
   *  normally, but an UNBOUNDED cross-encoder logit when vectorization-service reranked (which it
   *  does by default). Only the server knows which, so never display or scale this — the earlier
   *  comment here claimed it was always cosine, and rendering `score * 100 + '%'` on that assumption
   *  is what produced the "640% match" chip in the duplicate check. Use `confidence` instead. */
  score: number;
  /** The same signal converted server-side into a real 0-1 confidence whichever scale it came from
   *  (see relevance_confidence() in ai-service/app/search/service.py). This is the one that is safe
   *  to render as a percentage. Anything the backend returns has already cleared its relevance
   *  floor, which sits at 0.5 on this scale. */
  confidence: number;
  snippet: string;
}

export interface SemanticSearchResponseDto {
  results: SemanticSearchHitDto[];
}

export interface FlaggedIssueDto {
  issueKey: string;
  title: string;
  detail?: string;
}

export type SprintRiskLevel = 'on_track' | 'at_risk' | 'behind' | 'incomplete' | 'unavailable';

export interface SprintPaceRequestDto {
  sprintName: string;
  riskLevel: SprintRiskLevel;
  daysRemaining: number | null;
  committedPoints: number | null;
  completedPoints: number | null;
  totalPoints: number | null;
  issueCountsByStatus: Record<string, number>;
  blockedIssues: FlaggedIssueDto[];
  staleIssues: FlaggedIssueDto[];
  unestimatedIssues: FlaggedIssueDto[];
}

export interface SprintPaceResponseDto {
  summary: string;
  recommendations: string[];
  degraded: boolean;
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
}

/** One proposed copy-edit. `quote` is verbatim text from the description that the server already
 *  verified exists (a finding whose quote didn't match was dropped server-side), so it can be shown
 *  as a before/after pair without the UI having to re-check anything. */
export interface DescriptionFindingDto {
  kind: 'typo' | 'grammar' | 'unclear' | 'ambiguous';
  quote: string;
  suggestion: string;
  why: string;
}

export interface DescriptionReviewResponseDto {
  /** 'fine_as_is' is the common, expected answer — the feature working, not failing. */
  verdict: 'fine_as_is' | 'needs_changes';
  findings: DescriptionFindingDto[];
  /** The original description with every finding applied, computed server-side from the original
   *  rather than regenerated by the model (so HTML structure and attachment chips are preserved).
   *  Null whenever there is nothing to apply. */
  improvedDescription: string | null;
  /** Findings the server discarded because their quoted text wasn't really in the description. */
  droppedFindingCount: number;
  /** Too little prose to be worth reviewing. */
  skipped: boolean;
  truncated: boolean;
  degraded: boolean;
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
}

/** One earlier issue worth reading before starting the current work. */
export interface PrecedentDto {
  issueKey: string;
  /** The candidate's real title, from the server's own records — never something the model wrote. */
  title: string;
  /** Why it's worth opening — what it actually has in common, not a similarity score. */
  relevance: string;
  /** The specific thing to reuse or avoid, when the source material actually stated one. */
  takeaway: string | null;
}

export interface PrecedentResponseDto {
  /** 'none_relevant' is a real answer: nothing here would genuinely help. */
  verdict: 'found' | 'none_relevant';
  precedents: PrecedentDto[];
  /** How many retrieved issues the model was asked to judge — makes 'none_relevant' over a full
   *  candidate set readable as a decision rather than as retrieval having come up empty. */
  candidatesConsidered: number;
  /** Retrieval found nothing above the similarity floor (a young space), not a failure. */
  noCandidates: boolean;
  degraded: boolean;
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
}

/** One comment as sent to /summarize-comments — same fields the ticket detail modal already loaded via
 *  commentApi, just enough to summarize (see ai-service/app/comment_digest/schemas.py::CommentIn). */
export interface CommentDigestInputDto {
  id: number;
  authorName: string;
  createdAt: string;
  content: string;
}

/** A claim the digest makes, with the id(s) of the comment(s) that actually support it — the server
 *  drops any claim whose ids don't resolve against the real thread (see
 *  ai-service/app/comment_digest/service.py::_ground), so every point here is grounded. */
export interface AttributedPointDto {
  text: string;
  commentIds: number[];
}

export interface ActionItemDto extends AttributedPointDto {
  owner: string | null;
}

export interface CommentDigestResponseDto {
  /** Why this thread exists — what prompted it. */
  context: string;
  /** What was actually debated — differing views, objections, what changed. Empty string when the
   *  thread had no real back-and-forth (a single status update, an unpushed-back answer). */
  discussion: string;
  /** Where the thread landed as of the last comment, with the comment(s) that establish it — this is
   *  also where a reached decision belongs (there's no separate decisions list: showing "what was
   *  decided" twice, once here and once as its own cited item, read as redundant rather than as two
   *  different pieces of information). Empty text when nothing was resolved. */
  outcome: AttributedPointDto;
  openQuestions: AttributedPointDto[];
  actionItems: ActionItemDto[];
  /** Too few comments to be worth summarizing — not a failure, just nothing to show. */
  skipped: boolean;
  /** Model/provider call failed — context/discussion/outcome/etc. are empty; the raw comment list is
   *  still there for the user to read directly. */
  degraded: boolean;
  /** >0 means only the most recent comments were sent to the model (see _MAX_COMMENTS server-side);
   *  the digest may be missing context from earlier in the thread. */
  truncatedCount: number;
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
}

/**
 * Sprint recovery: diagnose -> grounded root-cause hypotheses -> confidence-gated clarification ->
 * concrete recovery plans -> durable human approval -> idempotent multi-action execution -> wait for
 * a real Jira event (or a manual re-check) -> re-evaluate -> escalate/replan or close. See
 * ai-service/app/sprint_recovery/graph.py's module docstring for the full design rationale — this is
 * a genuinely different LangGraph shape than epic rollout: 3 differently-shaped pauses (not 1), a
 * conditional replan loop bounded by an escalation cap, and re-entry driven by a real Kafka event as
 * well as by a human.
 */
// 'revising' is transient server-side only (approval_node -> plan_node happens within one HTTP call,
// same request-response) — included here for structural completeness, never actually observed by a
// client between calls.
export type RecoveryStatus =
  | 'diagnosing' | 'no_risk_found' | 'awaiting_clarification'
  | 'awaiting_plan_approval' | 'committing' | 'committed' | 'waiting_reevaluation' | 'recovered'
  | 'escalated' | 'rejected' | 'revising' | 'failed';

export type RecoveryActionType = 'link_dependency' | 'change_priority' | 'move_out_of_sprint' | 'add_comment';

export interface RecoveryActionDto {
  actionType: RecoveryActionType;
  targetIssueKey: string;
  dependsOnIssueKey: string | null;
  newPriority: string | null;
  commentBody: string | null;
}

export interface RecoveryPlanDto {
  planId: string;
  name: string;
  rationale: string;
  impactOnGoal: string;
  actions: RecoveryActionDto[];
}

export interface RecoveryHypothesisDto {
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  supportingEvidenceIds: string[];
}

export interface RecoveryEvidenceDto {
  citationId: string;
  issueKey: string;
  sourceType: 'comment' | 'attachment' | 'history' | 'description' | 'structured';
  content: string;
}

export interface RecoveryStatusDto {
  threadId: string;
  status: RecoveryStatus;
  riskSignalCount: number;
  evidence: RecoveryEvidenceDto[];
  hypotheses: RecoveryHypothesisDto[];
  clarificationQuestion: string | null;
  plans: RecoveryPlanDto[];
  committedActions: Record<string, string>;
  escalationRound: number;
  planRevisionRound: number;
  maxPlanRevisionRounds: number;
  maxEscalationRounds: number;
  tokenUsage: number;
  /** Real measured $ for this thread — provider-reported token counts priced per model, not
   *  `tokenUsage * a guess`. Found live: this used to be derived from a flat 4000-tokens-per-call
   *  estimate, so "what did this check cost" had no honest answer. */
  costUsd: number;
  error: string | null;
  // Only ever populated when status === 'escalated' — structured (a card per round), not a single
  // pre-flattened paragraph, so the UI can lay it out readably instead of one wall of text.
  escalationRounds: RecoveryEscalationRoundDto[];
  escalationStillAtRiskReasons: string[];
  // Empty: every flagged issue was acted on at least once across the rounds above — what remains is
  // real engineering time, not more planning. Non-empty: these issue keys were never even attempted.
  escalationUnaddressedIssueKeys: string[];
  // True only when this status was reached without confirming the read model had caught up with its
  // own writes first — staleness can only make a result look more at-risk than reality, never less, so
  // this is worth showing next to an 'escalated'/'diagnosing' status but not a 'recovered' one.
  indexCatchUpTimedOut: boolean;
  // The plan actually being (or already) executed — distinct from `plans`, which is always the
  // *original* 1-3 proposed options and never reflects a human edit. Found live: after an edited plan
  // failed partway through, `plans` still showed the pre-edit action list — wrong action text, and
  // `committedActions`' indices pointing at the wrong entries entirely. Populated once a plan is
  // actually approved; null while still choosing.
  approvedPlan: RecoveryPlanDto | null;
  /** The AI's direct reply to whatever you last told it — what it changed about these plans, or the
   *  concrete reason it couldn't. Found live: a note that genuinely couldn't change the outcome
   *  ("we will add 2 extra engineers" against work blocked on an external legal reviewer) produced
   *  plans that simply never mentioned it, which looks exactly like being ignored. Null when nothing
   *  was said this round. */
  noteResponse: string | null;
  // **Found live**: a crash between committing all of a round's actions and the *next* round's plan
  // even being generated left a checkpoint at status === 'diagnosing' with real work still pending —
  // but the "Resume" button only ever checked for the literal strings 'committing'/'failed', so this
  // crash had no button anywhere and the modal just... stopped, with no explanation. The status string
  // alone can't tell that case apart from a genuine `clarify` pause (which also shows 'diagnosing' but
  // must never be silently resumed) — this is computed server-side from whether LangGraph itself has a
  // pending task with no interrupt on it, which is the only place that distinction is actually knowable.
  resumable: boolean;
}

export interface ActiveRecoveryLookupDto {
  availability: 'none' | 'resumable' | 'busy';
  recovery: RecoveryStatusDto | null;
  /** Present for a same-space teammate's active workflow. Optional for rolling compatibility with
   *  the first availability response version. Never includes the private thread id or plan data. */
  ownerUsername?: string | null;
  currentStatus?: RecoveryStatus | null;
}

export interface RecoveryEscalationRoundDto {
  round: number;
  planName: string;
  rationale: string;
  actions: string[];
}

export interface RecoveryCheckpointDto {
  checkpointId: string;
  nextNode: string | null;
  status: string | null;
  /** ISO-8601 timestamp of when this checkpoint was written; null on older records. */
  createdAt: string | null;
  /** Which specific action this step applied, when the generic step label can't say (a multi-action
   *  plan produces one otherwise-identical "Applying changes in Jira…" row per action). Null elsewhere. */
  detail: string | null;
  /** Real Jira actions this thread committed *after* this step, oldest first — what rewinding here
   *  would discard this thread's own awareness of (the writes themselves stay in Jira either way).
   *  Empty is the clean, intended rewind case; found live that every checkpoint used to be selectable
   *  with no way to tell that apart from "this thread already took real actions past this point," and
   *  a bare count wasn't enough either — the next question was always "which ones?". */
  realActionsCommittedAfter: string[];
  /** What was actually on the table at this decision point — the proposed plan(s) or the clarifying
   *  question. Null everywhere except real rewind targets; found live that "Waiting for your decision"
   *  repeated across every revision gave no way to tell revision 1 apart from revision 3 without
   *  clicking each one. */
  revisionSummary: string | null;
  /** The human note that produced this revision — a clarifying answer, or the note typed into a
   *  time-travel rewind. Found live: a user rewound with "we will add 2 extra engineers to this
   *  sprint" and nothing in the timeline showed it, so a plan that didn't mention engineers read as
   *  the input being thrown away (it wasn't — it became evidence and the hypothesis weighed it). */
  triggeredByNote: string | null;
}

/** Durable lifecycle behind Plan Epic: generate, pause for review, then publish the final edited
 * epic, sprint destinations, child issues, and dependency links server-side. The `/rollout` path is
 * retained for API compatibility; it is no longer presented as a separate product feature. */
export type RolloutStatus = 'pending_approval' | 'committing' | 'committed' | 'rejected' | 'failed';

export interface RolloutPlanDto {
  epic: EpicDraftDto | null;
  issues: IssueDraftDto[];
  sprintPlan: SprintBucketDto[];
  sprintTargets: RolloutSprintTargetDto[];
}

export interface RolloutStatusDto {
  threadId: string;
  status: RolloutStatus;
  plan: RolloutPlanDto | null;
  epicIssueKey: string | null;
  committedIssueKeys: Record<string, string>;
  degraded: boolean;
  error: string | null;
  sprintCapacityPoints: number | null;
  targetSprintCount: number | null;
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the fresh count, so the raw provider total (what a trace shows) is
   *  input + cached + output. Optional so a rolling deploy still parses an older backend. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
  planningLatencySeconds: number;
}

export interface RolloutSprintTargetDto {
  sprintIndex: number;
  issueTempIds: string[];
  mode: 'existing' | 'new';
  sprintId: number | null;
  sprintName: string | null;
}

export const aiApi = {
  draftTask: (description: string, existingLabels: string[]) =>
    api.post<DraftTaskResponse>('/api/ai/draft-task', {
      description,
      existing_labels: existingLabels,
    }),
  planEpic: (
    proposal: string,
    existingLabels: string[],
    sprintCapacityPoints: number | null,
    targetSprintCount: number | null,
  ) =>
    api.post<PlanEpicResponse>('/api/ai/plan-epic', {
      proposal,
      existing_labels: existingLabels,
      sprint_capacity_points: sprintCapacityPoints ?? undefined,
      target_sprint_count: targetSprintCount ?? undefined,
    }),
  /** Applies a free-text edit ("add a QA task", "drop the inventory issue") to a plan already
   *  returned by planEpic (or a previous refinePlan call) — never persists anything, same as planEpic. */
  refinePlan: (
    epic: EpicDraftDto,
    issues: IssueDraftDto[],
    instruction: string,
    existingLabels: string[],
    sprintCapacityPoints: number | null,
    targetSprintCount: number | null,
  ) =>
    api.post<PlanEpicResponse>('/api/ai/plan-epic/refine', {
      epic,
      issues,
      instruction,
      existing_labels: existingLabels,
      sprint_capacity_points: sprintCapacityPoints ?? undefined,
      target_sprint_count: targetSprintCount ?? undefined,
    }),
  /** Agentic Q&A over the space's own issues/comments — answers with citations, or abstains rather
   *  than guessing. `spaceIds` scopes retrieval to spaces the caller already has (see SpaceContext) —
   *  see gateway route ai-service-ask's comment for the trust-boundary note on that parameter.
   *  `history` (optional, oldest-first) lets a follow-up resolve context from earlier turns — this
   *  service is stateless, so the caller (AskAiPanel) owns the running transcript and resends it on
   *  every call; omit/pass `[]` for an independent question. `traceParent` is the previous turn's own
   *  `AskResponseDto.traceParent` (undefined for the first question of a conversation) — sent as a
   *  real `traceparent` request header so this call's server span joins the same trace as the rest of
   *  the conversation instead of starting a new one; see that field's doc comment. */
  ask: (question: string, spaceIds: number[], history: ChatTurnDto[] = [], traceParent?: string) =>
    api.post<AskResponseDto>(
      '/api/ai/ask', { question, space_ids: spaceIds, history },
      traceParent ? { traceparent: traceParent } : undefined,
    ),
  /** SSE variant of `ask`: identical request/response shape, but the wait is surfaced as it
   *  happens. `onStage` fires with a human-readable progress label ("searching the knowledge
   *  base", ...) at each checkpoint; `onToken` fires with fragments of the final answer's prose as
   *  the model generates it (answer body only — never a clarification or an abstention). The
   *  streamed text is an optimistic preview: this still resolves with the authoritative
   *  `AskResponseDto` once the "result" event arrives, and `result.answer` may differ from the sum
   *  of the tokens because a verification pass can rewrite the draft — so the caller must replace
   *  whatever streamed with `result.answer`. See ai-service/app/api/routes.py's `POST /ask/stream`.
   *  `traceParent`: see `ask()`'s parameter of the same name. */
  askStream: (
    question: string, spaceIds: number[], history: ChatTurnDto[] = [],
    onStage?: (label: string) => void, traceParent?: string,
    onToken?: (text: string) => void,
  ) =>
    consumeStageStream<AskResponseDto>(
      '/api/ai/ask/stream', { question, space_ids: spaceIds, history }, onStage,
      traceParent ? { traceparent: traceParent } : undefined,
      onToken,
    ),
  /** Retrieval only, no LLM — ranked issues (deduped, best chunk per issue), not a generated answer.
   *  Backs both the "find related issues" search mode and duplicate-issue detection. */
  search: (query: string, spaceIds: number[], limit = 10) =>
    api.post<SemanticSearchResponseDto>('/api/ai/search', { query, space_ids: spaceIds, limit }),
  /** Turns pre-computed sprint stats (real burndown math, done by the caller) into a short narrative
   *  + recommendations — never calculates risk itself, see app/sprint_pace/schemas.py. */
  sprintPace: (req: SprintPaceRequestDto) =>
    api.post<SprintPaceResponseDto>('/api/ai/sprint-pace', req),
  /** "Summarize comments": grounded summary/decisions/open-questions/action-items over an issue's
   *  comment thread, each claim citing which comment(s) it came from. Stateless like draftTask — the
   *  caller already has the comments loaded, so this sends bodies directly rather than an issue id. */
  summarizeComments: (comments: CommentDigestInputDto[]) =>
    api.post<CommentDigestResponseDto>('/api/ai/summarize-comments', { comments }),
  /** "Improve description": a copy-edit pass that abstains by default. Send the description exactly
   *  as stored (HTML and all) — the server strips it for the model but applies the accepted edits to
   *  this exact string, so a pre-stripped version would come back unusable. Persists nothing. */
  reviewDescription: (description: string, title?: string) =>
    api.post<DescriptionReviewResponseDto>('/api/ai/description-review', { description, title }),
  /** "Link similar work items", built as a precedent finder: has this team already solved something
   *  close, and what did they learn? Unlike the other issue-level AI calls this one retrieves, so
   *  `spaceIds` is a real permission scope and is revalidated server-side against the caller. */
  findPrecedents: (spaceIds: number[], issueKey: string, title: string, description: string) =>
    api.post<PrecedentResponseDto>('/api/ai/link-similar-work-items', {
      spaceIds, issueKey, title, description,
    }),
  /** Starts the durable Plan Epic lifecycle and pauses server-side at its editable preview. */
  startRollout: (
    proposal: string,
    spaceId: number,
    existingLabels: string[] = [],
    sprintCapacityPoints: number | null = null,
    targetSprintCount: number | null = null,
  ) =>
    api.post<RolloutStatusDto>('/api/ai/plan-epic/rollout', {
      proposal,
      space_id: spaceId,
      existing_labels: existingLabels,
      sprint_capacity_points: sprintCapacityPoints ?? undefined,
      target_sprint_count: targetSprintCount ?? undefined,
    }),
  /** SSE variant of `startRollout` — `onStage` fires once ("generating the rollout plan") since
   *  `plan_node` is the only LLM call this graph makes on start; still worth it since that call is the
   *  entire wait. See ai-service's `POST /plan-epic/rollout/stream`. */
  startRolloutStream: (
    proposal: string,
    spaceId: number,
    existingLabels: string[] = [],
    sprintCapacityPoints: number | null = null,
    targetSprintCount: number | null = null,
    onStage?: (label: string) => void,
  ) =>
    consumeStageStream<RolloutStatusDto>('/api/ai/plan-epic/rollout/stream', {
      proposal,
      space_id: spaceId,
      existing_labels: existingLabels,
      sprint_capacity_points: sprintCapacityPoints ?? undefined,
      target_sprint_count: targetSprintCount ?? undefined,
    }, onStage),
  /** Reads current status (a Postgres read via the checkpointer, no node re-execution) — safe to poll,
   *  and the way to check whether a rollout survived an ai-service restart while paused/committing. */
  getRolloutStatus: (threadId: string) =>
    api.get<RolloutStatusDto>(`/api/ai/plan-epic/rollout/${threadId}`),
  /** Finds this user's latest unfinished Plan Epic workflow in a space after modal close/reload. */
  findActivePlanEpic: (spaceId: number) =>
    api.get<RolloutStatusDto | null>(`/api/ai/plan-epic/rollout/active?space_id=${spaceId}`),
  /** Approves the final human-edited plan. Sprint targets are included by the integrated Plan Epic
   *  UI so the server-side workflow has full parity with the former browser commit loop. */
  submitRolloutDecision: (
    threadId: string,
    decision: 'approve' | 'edit' | 'reject',
    edited?: { epic: EpicDraftDto; issues: IssueDraftDto[]; sprintTargets?: RolloutSprintTargetDto[] },
  ) =>
    api.post<RolloutStatusDto>(`/api/ai/plan-epic/rollout/${threadId}/decision`, {
      decision,
      epic: decision === 'edit' ? edited?.epic : undefined,
      issues: decision === 'edit' ? edited?.issues : undefined,
      sprint_targets: decision === 'edit' ? edited?.sprintTargets : undefined,
    }),
  /** Explicitly resumes a rollout left at `committing` by a process crash or at `failed` by a caught
   *  Jira error. A status GET is deliberately read-only; this call advances the saved checkpoint and
   *  never re-creates steps already present in its durable ledgers. */
  retryRollout: (threadId: string) =>
    api.post<RolloutStatusDto>(`/api/ai/plan-epic/rollout/${threadId}/retry`),

  /** Starts a sprint-recovery diagnosis workflow. Runs to the first pause — either a clarifying
   *  question (confidence-gated) or a full set of recovery plans (awaiting_plan_approval). */
  startSprintRecovery: (spaceId: number, sprintId: number, sprintName: string) =>
    api.post<RecoveryStatusDto>('/api/ai/sprint-recovery/start', { spaceId, sprintId, sprintName }),
  /** SSE variant of `startSprintRecovery` — `onStage` fires ("detecting risk signals and analyzing
   *  evidence", "generating recovery plans") as `diagnose_node`/`plan_node` are reached; a fresh
   *  diagnosis can chain through both in one call. See ai-service's `POST /sprint-recovery/start/stream`. */
  startSprintRecoveryStream: (spaceId: number, sprintId: number, sprintName: string, onStage?: (label: string) => void) =>
    consumeStageStream<RecoveryStatusDto>('/api/ai/sprint-recovery/start/stream', { spaceId, sprintId, sprintName }, onStage),
  getSprintRecoveryStatus: (threadId: string) =>
    api.get<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}`),
  /** Found live: crash-resume was correct at the graph/API level (same thread_id, /retry picks up
   *  exactly where a killed process left off) but the UI had no way to *discover* that thread_id again
   *  once it was lost from browser memory (modal closed, page reloaded, or the crash itself) —
   *  `startSprintRecovery(Stream)` always minted a fresh thread. Called on mount, before offering
   *  "Diagnose Sprint Risk"; null means no non-terminal thread exists for this sprint, not an error. */
  findActiveSprintRecovery: (spaceId: number, sprintId: number) =>
    // The union is intentional rolling-deploy compatibility. Older ai-service versions returned a
    // bare status or null; the modal normalizes both while the backend and browser bundle restart.
    api.get<ActiveRecoveryLookupDto | RecoveryStatusDto | null>(
      `/api/ai/sprint-recovery/by-sprint?space_id=${spaceId}&sprint_id=${sprintId}`,
    ),
  /** Answers the one specific clarifying question the confidence gate raised — folded in as evidence,
   *  loops back into diagnosis (bounded by the server-side max_clarification_rounds). */
  answerSprintRecoveryClarification: (threadId: string, answer: string) =>
    api.post<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/clarify`, { answer }),
  /** SSE variant of `answerSprintRecoveryClarification` — same stage events as the start stream, since
   *  answering can chain straight from `diagnose_node` into `plan_node` again on a confident pass. */
  answerSprintRecoveryClarificationStream: (threadId: string, answer: string, onStage?: (label: string) => void) =>
    consumeStageStream<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/clarify/stream`, { answer }, onStage),
  submitSprintRecoveryDecision: (
    threadId: string,
    decision: 'approve' | 'edit' | 'reject' | 'revise',
    planId?: string,
    actions?: RecoveryActionDto[],
    feedback?: string,
  ) =>
    api.post<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/decision`, {
      decision,
      planId: decision === 'approve' || decision === 'edit' ? planId : undefined,
      actions: decision === 'edit' ? actions : undefined,
      feedback: decision === 'revise' ? feedback : undefined,
    }),
  /** SSE variant of `submitSprintRecoveryDecision` — only `revise` ever emits a `stage` event (it's
   *  the only decision that re-enters `plan_node`, a real LLM call), but every decision goes through
   *  this so the caller has one code path regardless of which button was clicked. */
  submitSprintRecoveryDecisionStream: (
    threadId: string,
    decision: 'approve' | 'edit' | 'reject' | 'revise',
    planId?: string,
    actions?: RecoveryActionDto[],
    feedback?: string,
    onStage?: (label: string) => void,
  ) =>
    consumeStageStream<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/decision/stream`, {
      decision,
      planId: decision === 'approve' || decision === 'edit' ? planId : undefined,
      actions: decision === 'edit' ? actions : undefined,
      feedback: decision === 'revise' ? feedback : undefined,
    }, onStage),
  /** Un-sticks a workflow at status='committing' (a suspected crash) or 'failed' (jira-backend was
   *  briefly unreachable while ai-service stayed up) — same two-case split as retryRollout, applied
   *  to a heterogeneous 4-action-type execution instead of a single homogeneous "create issue" one. */
  retrySprintRecovery: (threadId: string) =>
    api.post<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/retry`),
  /** The manual half of the "human or Kafka event, identical resume protocol" wait — a real
   *  IssueContentChangedEvent calls the same underlying resume from kafka_trigger.py instead. */
  triggerSprintRecoveryReevaluation: (threadId: string) =>
    api.post<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/trigger-reevaluation`),
  /** SSE variant — `reevaluate_node` itself is fast/deterministic, but replanning (when still at
   *  risk and under the escalation cap) chains straight into `plan_node`, a real LLM call worth a
   *  `stage` event for instead of a bare "Checking…" with no feedback. */
  triggerSprintRecoveryReevaluationStream: (threadId: string, onStage?: (label: string) => void) =>
    consumeStageStream<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/trigger-reevaluation/stream`, {}, onStage),
  getSprintRecoveryHistory: (threadId: string) =>
    api.get<RecoveryCheckpointDto[]>(`/api/ai/sprint-recovery/${threadId}/history`),
  /** Rewinds to an earlier checkpoint (from getSprintRecoveryHistory) and continues forward from
   *  there with `note` folded in as if a human had just answered a clarifying question at that point
   *  — rewrites this thread's own forward history, verified live not to fork a separate thread. */
  timeTravelSprintRecovery: (threadId: string, checkpointId: string, note: string) =>
    api.post<RecoveryStatusDto>(`/api/ai/sprint-recovery/${threadId}/time-travel`, { checkpointId, note }),
};
