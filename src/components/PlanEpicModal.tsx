import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import type { Sprint } from '../types/sprint';
import { labelColor } from '../types/ticket';
import { aiApi, labelApi } from '../api';
import type {
  ChangeSummaryDto,
  IssueDraftDto,
  LabelDto,
  PlanEpicResponse,
  RolloutSprintTargetDto,
  RolloutStatusDto,
} from '../api';
import {
  hasCompleteBucketLayout,
  isValidStoryPoint,
  needsExtraSprintAcceptance,
  nextManualTempId,
  normalizeSprintNameInput,
  normalizedSprintName,
  uniqueSprintName,
  parsedRequirements,
} from './planEpicUtils';
import { IssueKeyChip } from './IssueKeyChip';
import './PlanEpicModal.css';

type Stage = 'input' | 'preview' | 'committing' | 'error';

interface BucketChoice {
  mode: 'existing' | 'new';
  sprintId?: number;
  newName: string;
}

interface SavedPlanEpicDraft {
  epicTitle: string;
  epicDescription: string;
  epicGoals?: string[];
  issues: IssueDraftDto[];
  bucketAssignment: Record<string, number>;
  bucketOrder: number[];
  bucketChoices: Record<number, BucketChoice>;
  acceptedExtraSprints?: boolean;
  usage?: PlanUsage;
}

interface PlanUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencySeconds: number;
}

const EMPTY_USAGE: PlanUsage = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  latencySeconds: 0,
};

/** The prerequisites that will actually become `is blocked by` links in Jira on approval.
 *
 *  Everything else in `dependsOn` is ordering only: it shapes the topological sort and the sprint
 *  packing, and a Jira issue link cannot express it (the tracker has blocks, clones, duplicates and
 *  relates-to — none of which mean "do this later"). Showing those here would advertise a
 *  relationship that vanishes the moment the plan is published, so this preview lists only what
 *  publishing will really create. */
function blockingPrerequisites(issue: IssueDraftDto): string[] {
  return issue.dependsOn.filter((id) => issue.dependencyKinds?.[id] === 'blocks');
}

function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { onChange, className, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    if (ref.current) resize(ref.current);
  }, [rest.value]);
  return (
    <textarea
      {...rest}
      ref={ref}
      className={`${className ?? ''} pe-auto-grow`.trim()}
      onChange={(event) => {
        resize(event.currentTarget);
        onChange?.(event);
      }}
    />
  );
}

const draftStorageKey = (threadId: string) => `plan-epic-draft:${threadId}`;

function clearSavedDraft(threadId: string) {
  try {
    window.localStorage.removeItem(draftStorageKey(threadId));
  } catch {
    // Storage may be unavailable in a locked-down browser; server-side workflow recovery still works.
  }
  try {
    // Clean up drafts written by versions that only survived a tab refresh.
    window.sessionStorage.removeItem(draftStorageKey(threadId));
  } catch {
    // Storage may be unavailable in a locked-down browser; server-side workflow recovery still works.
  }
}

function readSavedDraft(threadId: string): string | null {
  try {
    const durableDraft = window.localStorage.getItem(draftStorageKey(threadId));
    if (durableDraft) return durableDraft;
  } catch {
    // Fall through to the legacy per-tab copy.
  }
  try {
    return window.sessionStorage.getItem(draftStorageKey(threadId));
  } catch {
    return null;
  }
}

interface PlanEpicModalProps {
  spaceId: number;
  /** Full sprint list for this space — used to offer existing future sprints as commit targets and
   *  to auto-compute a sensible sprint capacity from recent real velocity. */
  sprints: Sprint[];
  /** Refresh callback (wired to TicketContext's refreshData) — called whenever publishing reports
   *  real Jira writes, including a partial failure, so the background reflects what actually landed. */
  onCommitted: () => void;
  onClose: () => void;
}

/** What the server is doing and for how long. Generating takes up to a minute, and the old button
 *  label sat unchanged for the ~30s the model writes, which looked hung. A ticking counter shows it's
 *  alive; no progress bar, since the server can't say how far along it is. */
function GenerationProgress({ label }: { label: string | null }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.round((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="pe-progress" role="status" aria-live="polite">
      <span className="pe-progress__spinner" aria-hidden />
      <span className="pe-progress__label">{label ?? 'Starting…'}</span>
      <span className="pe-progress__elapsed">{seconds}s</span>
    </div>
  );
}

const LOOKS_LIKE_MARKUP = /<(h[1-6]|p|ul|ol|li|strong|em|br)\b/i;

/** Description field showing what will actually be published, with the raw HTML one click away.
 *  Descriptions are HTML (the board's layout), and showing `<h3>Context</h3>…` in a textarea made the
 *  review screen unreadable. Formatted by default; the raw view is the existing textarea (no rich-text
 *  editor, whose caret would jump on re-render). Plain-text descriptions just get the textarea. */
function DescriptionField({
  value,
  placeholder,
  disabled,
  onChange,
  className = 'bl-modal__input pe-issue__desc',
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (next: string) => void;
  className?: string;
}) {
  const [showSource, setShowSource] = useState(false);
  const isMarkup = LOOKS_LIKE_MARKUP.test(value);

  if (!isMarkup) {
    return (
      <AutoGrowTextarea
        className={className}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="pe-desc">
      <button
        type="button"
        className="pe-desc__toggle"
        onClick={() => setShowSource((current) => !current)}
        title={showSource ? 'Show it the way it will look on the board' : 'Edit the underlying markup'}
      >
        {showSource ? 'Preview' : 'Edit markup'}
      </button>
      {showSource ? (
        <AutoGrowTextarea
          className={className}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      ) : (
        <div className="pe-desc__rendered" dangerouslySetInnerHTML={{ __html: value }} />
      )}
    </div>
  );
}

/** Where a planned issue came from, in one line. `estimateReference` keys are verified server-side
 *  (made-up keys are removed), so each chip opens a real issue to check. Renders nothing when there's
 *  no history to cite — a normal outcome. */
function IssueProvenance({ issue }: { issue: IssueDraftDto }) {
  const references = issue.estimateReference ?? [];
  const patterns = issue.patternBasis ?? [];
  if (references.length === 0 && patterns.length === 0) return null;

  // Only meaningful alongside a reference — confidence in an estimate that cited nothing is always
  // "low" by construction, and printing it there would read as a warning about the plan rather than
  // as the absence of a comparison.
  const confidence = references.length > 0 ? issue.estimateConfidence : undefined;
  const comparison = issue.complexityVsReference?.replace('_', ' ');

  return (
    <p className="pe-issue__provenance">
      {references.length > 0 && (
        <>
          <span className="pe-issue__provenance-label">Sized against</span>
          {references.map((key) => (
            <IssueKeyChip key={key} issueKey={key} size="sm" />
          ))}
          {comparison && issue.historicalBaselinePoints != null && (
            <span
              className="pe-issue__provenance-note"
              title={`Those issues really took ${issue.historicalBaselinePoints} points; this work was judged ${comparison}.`}
            >
              {issue.historicalBaselinePoints} pts, {comparison}
            </span>
          )}
          {confidence && (
            <span className={`pe-issue__confidence pe-issue__confidence--${confidence}`}>
              {confidence} confidence
            </span>
          )}
        </>
      )}
      {patterns.length > 0 && (
        <span className="pe-issue__provenance-note" title={patterns.join(' · ')}>
          from past practice: {patterns.join(' · ')}
        </span>
      )}
    </p>
  );
}

/** A log of what each Apply actually did, oldest round first, so a reviewer about to type a third
 *  instruction can see what the first two already accomplished instead of re-reading every card.
 *  Every line here is `ChangeSummaryDto` — a server-side diff of the plan before/after that round,
 *  never the model's own account of itself. */
function RefineHistoryPanel({ history }: { history: ChangeSummaryDto[] }) {
  if (history.length === 0) return null;
  return (
    <div className="pe-refine-history">
      {history.map((round, index) => {
        const nothingChanged = round.added.length === 0 && round.removed.length === 0
          && round.retitled.length === 0 && round.reEstimated.length === 0;
        return (
          // Rounds are append-only and never reordered, so an index is a stable key here.
          <div className="pe-refine-history__round" key={index}>
            <p className="pe-refine-history__instruction">
              <span className="pe-refine-history__round-label">Round {index + 1}</span>
              “{round.instruction}”
            </p>
            {nothingChanged ? (
              <p className="pe-refine-history__line pe-refine-history__line--muted">No cards changed.</p>
            ) : (
              <ul className="pe-refine-history__list">
                {round.added.map((title) => (
                  <li key={`add-${title}`} className="pe-refine-history__line pe-refine-history__line--added">
                    + added “{title}”
                  </li>
                ))}
                {round.removed.map((title) => (
                  <li key={`rm-${title}`} className="pe-refine-history__line pe-refine-history__line--removed">
                    − removed “{title}”
                  </li>
                ))}
                {round.retitled.map((line) => (
                  <li key={`rt-${line}`} className="pe-refine-history__line">renamed {line}</li>
                ))}
                {round.reEstimated.map((line) => (
                  <li key={`est-${line}`} className="pe-refine-history__line">re-estimated {line}</li>
                ))}
              </ul>
            )}
            {round.unchangedCount > 0 && (
              <p className="pe-refine-history__line pe-refine-history__line--muted">
                {round.unchangedCount} other card{round.unchangedCount !== 1 ? 's' : ''} left unchanged.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PlanEpicModal({ spaceId, sprints, onCommitted, onClose }: PlanEpicModalProps) {
  const [stage, setStage] = useState<Stage>('input');
  const [proposal, setProposal] = useState('');
  /** One requirement per line. An epic title is a direction; these are the pieces it has to deliver,
   *  and each one is searched for separately server-side — so an issue written for a requirement is
   *  sized against the past work resembling THAT piece rather than the epic as a whole. Kept as raw
   *  text rather than a list of inputs: people paste bullets from a doc, and a row-per-requirement
   *  widget makes that the one thing you cannot do. */
  const [requirementsText, setRequirementsText] = useState('');
  const [spaceLabels, setSpaceLabels] = useState<LabelDto[]>([]);
  const [capacityInput, setCapacityInput] = useState('');
  const [targetSprintCountInput, setTargetSprintCountInput] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [workflowThreadId, setWorkflowThreadId] = useState<string | null>(null);
  const [checkingForExisting, setCheckingForExisting] = useState(true);
  const [resumedExisting, setResumedExisting] = useState(false);
  const [degraded, setDegraded] = useState(false);
  /** Params used for the last generate/refine call — reused on refine so bin-packing stays
   *  consistent with what the user originally asked for, without re-prompting for them each time. */
  const [lastCapacity, setLastCapacity] = useState<number | null>(null);
  const [lastTargetSprintCount, setLastTargetSprintCount] = useState<number | null>(null);

  const [epicTitle, setEpicTitle] = useState('');
  const [epicDescription, setEpicDescription] = useState('');
  const [epicGoals, setEpicGoals] = useState<string[]>([]);
  const [issues, setIssues] = useState<IssueDraftDto[]>([]);
  const [bucketAssignment, setBucketAssignment] = useState<Record<string, number>>({});
  const [bucketOrder, setBucketOrder] = useState<number[]>([]);
  const [bucketChoices, setBucketChoices] = useState<Record<number, BucketChoice>>({});
  const [layoutRepairNotice, setLayoutRepairNotice] = useState<string | null>(null);
  const [acceptedExtraSprints, setAcceptedExtraSprints] = useState(false);
  const [usage, setUsage] = useState<PlanUsage>(EMPTY_USAGE);
  const manualIdCounter = useRef(0);

  const [refineInstruction, setRefineInstruction] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [refineStage, setRefineStage] = useState<string | null>(null);
  /** One entry per Apply so far, oldest first — the server-computed diff for that round, not the
   *  model's word for it (see `ChangeSummaryDto`). Kept so a reviewer writing a third instruction can
   *  see what the first two actually did without re-reading every card. Reset when a fresh plan is
   *  generated; a resumed/restored draft starts with none of its own history either, since only the
   *  plan state itself is persisted. */
  const [refineHistory, setRefineHistory] = useState<ChangeSummaryDto[]>([]);

  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitProgress, setCommitProgress] = useState<{ created: number; total: number } | null>(null);
  const [backLoading, setBackLoading] = useState(false);
  /** Which issue's label picker is expanded — only one at a time, and only shows labels not already
   *  on that issue, so the preview doesn't dump the space's whole label list under every issue. */
  const [labelPickerFor, setLabelPickerFor] = useState<string | null>(null);

  const futureSprints = useMemo(() => sprints.filter((s) => s.status === 'future'), [sprints]);
  const activeBucketCount = useMemo(
    () => bucketOrder.filter((idx) => issues.some((i) => bucketAssignment[i.tempId] === idx)).length,
    [bucketOrder, issues, bucketAssignment],
  );
  const totalPoints = useMemo(
    () => issues.reduce((sum, i) => sum + (i.estimateStoryPoints ?? 0), 0),
    [issues],
  );
  const unestimatedIssueCount = useMemo(
    () => issues.filter((issue) => issue.estimateStoryPoints == null).length,
    [issues],
  );
  const unassignedIssueCount = useMemo(() => {
    const validBuckets = new Set(bucketOrder);
    return issues.filter((issue) => !validBuckets.has(bucketAssignment[issue.tempId])).length;
  }, [bucketOrder, issues, bucketAssignment]);
  const bucketPointsByIndex = useMemo(() => Object.fromEntries(
    bucketOrder.map((sprintIndex) => [
      sprintIndex,
      issues
        .filter((issue) => bucketAssignment[issue.tempId] === sprintIndex)
        .reduce((sum, issue) => sum + (issue.estimateStoryPoints ?? 0), 0),
    ]),
  ), [bucketOrder, issues, bucketAssignment]);
  const overCapacityBucketCount = useMemo(
    () => lastCapacity == null
      ? 0
      : bucketOrder.filter((index) => (bucketPointsByIndex[index] ?? 0) > lastCapacity).length,
    [bucketOrder, bucketPointsByIndex, lastCapacity],
  );
  const capacityConflict = lastCapacity != null
    && lastTargetSprintCount != null
    && totalPoints > lastCapacity * lastTargetSprintCount;
  const additionalBucketCount = lastTargetSprintCount == null
    ? 0
    : Math.max(0, activeBucketCount - lastTargetSprintCount);
  const requiresExtraSprintAcceptance = needsExtraSprintAcceptance(
    activeBucketCount, lastTargetSprintCount, acceptedExtraSprints,
  );
  const sprintNameError = useMemo(() => {
    const reserved = new Set(sprints.map((sprint) => normalizedSprintName(sprint.name)));
    for (const sprintIndex of bucketOrder) {
      if (!issues.some((issue) => bucketAssignment[issue.tempId] === sprintIndex)) continue;
      const choice = bucketChoices[sprintIndex];
      if (choice?.mode === 'existing') continue;
      const name = choice?.newName.trim() ?? '';
      if (!name) return `Plan bucket ${sprintIndex + 1} needs a new sprint name.`;
      if (name.length > 100) {
        return `Sprint name “${name}” is ${name.length} characters. Keep it at 100 or fewer.`;
      }
      const normalized = normalizedSprintName(name);
      if (reserved.has(normalized)) {
        return `Sprint name “${name}” already exists or is used by another plan bucket.`;
      }
      reserved.add(normalized);
    }
    return null;
  }, [sprints, bucketOrder, issues, bucketAssignment, bucketChoices]);
  const staleSprintTargetError = useMemo(() => {
    const validFutureIds = new Set(futureSprints.map((sprint) => Number(sprint.id)));
    for (const sprintIndex of bucketOrder) {
      if (!issues.some((issue) => bucketAssignment[issue.tempId] === sprintIndex)) continue;
      const choice = bucketChoices[sprintIndex];
      if (choice?.mode === 'existing' && (!choice.sprintId || !validFutureIds.has(choice.sprintId))) {
        return `The saved destination for plan bucket ${sprintIndex + 1} is no longer an available future sprint. Choose another destination.`;
      }
    }
    return null;
  }, [futureSprints, bucketOrder, issues, bucketAssignment, bucketChoices]);
  const autoCapacity = useMemo(() => {
    const completed = sprints
      .filter((s) => s.status === 'completed' && s.completedPoints != null && s.completedPoints > 0)
      .slice(-3)
      .map((s) => s.completedPoints as number);
    if (completed.length === 0) return 20;
    return Math.round(completed.reduce((a, b) => a + b, 0) / completed.length);
  }, [sprints]);
  const hasEmptyTitle = useMemo(() => issues.some((i) => !i.title.trim()), [issues]);
  const hasLongTitle = useMemo(() => issues.some((i) => i.title.trim().length > 120), [issues]);
  const hasEmptyDescription = useMemo(
    () => issues.some((issue) => !issue.description.trim()),
    [issues],
  );
  const invalidNumericEstimateCount = useMemo(
    () => issues.filter(
      (issue) => issue.estimateStoryPoints != null && !isValidStoryPoint(issue.estimateStoryPoints),
    ).length,
    [issues],
  );
  const duplicateTempIdCount = useMemo(() => {
    const seen = new Set<string>();
    let duplicates = 0;
    issues.forEach((issue) => {
      if (!issue.tempId.trim() || seen.has(issue.tempId)) duplicates += 1;
      seen.add(issue.tempId);
    });
    return duplicates;
  }, [issues]);
  const missingDependencyTargetCount = useMemo(() => {
    const known = new Set(issues.map((issue) => issue.tempId));
    return issues.reduce(
      (count, issue) => count + issue.dependsOn.filter((dependency) => !known.has(dependency)).length,
      0,
    );
  }, [issues]);

  const blockingLinkCount = useMemo(
    () => issues.reduce((count, issue) => count + blockingPrerequisites(issue).length, 0),
    [issues],
  );

  useEffect(() => {
    if (stage !== 'preview' || issues.length === 0 || unassignedIssueCount === 0) return;

    // A browser session may contain a draft from before a refine/restart whose tempIds no longer
    // match its issue-to-sprint map. Never make those issues disappear: preserve every valid
    // placement and deterministically recover only the orphaned ones into the least-loaded bucket.
    const recoveredOrder = bucketOrder.length > 0 ? bucketOrder : [0];
    const validBuckets = new Set(recoveredOrder);
    const nextAssignment: Record<string, number> = {};
    const load = new Map(recoveredOrder.map((index) => [index, { points: 0, count: 0 }]));
    issues.forEach((issue) => {
      const assigned = bucketAssignment[issue.tempId];
      if (!validBuckets.has(assigned)) return;
      nextAssignment[issue.tempId] = assigned;
      const bucketLoad = load.get(assigned)!;
      bucketLoad.points += issue.estimateStoryPoints ?? 0;
      bucketLoad.count += 1;
    });
    issues.forEach((issue) => {
      if (nextAssignment[issue.tempId] != null) return;
      const destination = recoveredOrder.reduce((best, candidate) => {
        const bestLoad = load.get(best)!;
        const candidateLoad = load.get(candidate)!;
        if (candidateLoad.points !== bestLoad.points) {
          return candidateLoad.points < bestLoad.points ? candidate : best;
        }
        return candidateLoad.count < bestLoad.count ? candidate : best;
      }, recoveredOrder[0]);
      nextAssignment[issue.tempId] = destination;
      const bucketLoad = load.get(destination)!;
      bucketLoad.points += issue.estimateStoryPoints ?? 0;
      bucketLoad.count += 1;
    });
    setBucketOrder(recoveredOrder);
    setBucketAssignment(nextAssignment);
    setBucketChoices((previous) => Object.fromEntries(recoveredOrder.map((index) => [
      index,
      previous[index] ?? {
        mode: 'new',
        newName: `${epicTitle || 'New epic'} — Sprint ${index + 1}`,
      },
    ])));
    setLayoutRepairNotice(
      `Recovered ${unassignedIssueCount} issue placement${unassignedIssueCount !== 1 ? 's' : ''} from an inconsistent browser draft. Review the sprint assignments before approval.`,
    );
  }, [
    stage, issues, bucketOrder, bucketAssignment, unassignedIssueCount, epicTitle,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    labelApi.getBySpace(spaceId)
      .then((fetched) => { if (!cancelled) setSpaceLabels(fetched); })
      .catch(() => { /* label suggestions are a nicety — a failed fetch shouldn't block planning */ });
    return () => { cancelled = true; };
  }, [spaceId]);

  function bucketIssues(sprintIndex: number) {
    return issues.filter((i) => bucketAssignment[i.tempId] === sprintIndex);
  }

  function applyPlanResponse(
    response: PlanEpicResponse,
    restoredTargets: RolloutSprintTargetDto[] = [],
    usageMode: 'replace' | 'add' = 'replace',
    preservedChoices: Record<number, BucketChoice> = {},
  ) {
    setLayoutRepairNotice(null);
    setAcceptedExtraSprints(false);
    // Only refine responses carry one (plan_epic has no "before" to diff against) — append rather
    // than replace, so the panel below the instruction box reads as a log of the round so far.
    if (response.changeSummary) {
      setRefineHistory((prev) => [...prev, response.changeSummary!]);
    }
    setEpicTitle(response.epic.title);
    setEpicDescription(response.epic.description);
    setEpicGoals(response.epic.goals ?? []);
    setIssues(response.issues);
    const assignment: Record<string, number> = {};
    const order: number[] = [];
    const choices: Record<number, BucketChoice> = {};
    const reservedSprintNames = new Set(sprints.map((sprint) => normalizedSprintName(sprint.name)));
    const targetByIndex = new Map(restoredTargets.map((target) => [target.sprintIndex, target]));
    response.sprintPlan.forEach((bucket) => {
      order.push(bucket.sprintIndex);
      bucket.issueTempIds.forEach((tempId) => { assignment[tempId] = bucket.sprintIndex; });
      const restored = targetByIndex.get(bucket.sprintIndex);
      const preserved = preservedChoices[bucket.sprintIndex];
      if (restored?.mode === 'existing' && restored.sprintId) {
        choices[bucket.sprintIndex] = { mode: 'existing', sprintId: restored.sprintId, newName: '' };
      } else if (preserved?.mode === 'existing' && preserved.sprintId) {
        choices[bucket.sprintIndex] = { ...preserved };
      } else if (preserved?.mode === 'new' && preserved.newName.trim()) {
        choices[bucket.sprintIndex] = { ...preserved };
        reservedSprintNames.add(normalizedSprintName(preserved.newName));
      } else {
        const baseName = restored?.sprintName
          || `${response.epic.title} — Sprint ${bucket.sprintIndex + 1}`;
        choices[bucket.sprintIndex] = {
          mode: 'new',
          newName: restored?.sprintName
            ? baseName
            : uniqueSprintName(baseName, reservedSprintNames),
        };
        if (restored?.sprintName) reservedSprintNames.add(normalizedSprintName(baseName));
      }
    });
    setBucketAssignment(assignment);
    setBucketOrder(order);
    setBucketChoices(choices);
    setDegraded(response.degraded);
    const responseUsage: PlanUsage = {
      inputTokens: response.inputTokens ?? 0,
      outputTokens: response.outputTokens ?? 0,
      estimatedCostUsd: response.estimatedCostUsd ?? 0,
      latencySeconds: response.latencySeconds ?? 0,
    };
    setUsage((current) => usageMode === 'add' ? {
      inputTokens: current.inputTokens + responseUsage.inputTokens,
      outputTokens: current.outputTokens + responseUsage.outputTokens,
      estimatedCostUsd: current.estimatedCostUsd + responseUsage.estimatedCostUsd,
      latencySeconds: current.latencySeconds + responseUsage.latencySeconds,
    } : responseUsage);
  }

  function restoreSavedDraft(threadId: string): boolean {
    try {
      const raw = readSavedDraft(threadId);
      if (!raw) return false;
      const saved = JSON.parse(raw) as SavedPlanEpicDraft;
      if (
        typeof saved.epicTitle !== 'string'
        || !Array.isArray(saved.issues)
        || !Array.isArray(saved.bucketOrder)
        || typeof saved.bucketAssignment !== 'object'
        || saved.bucketAssignment == null
        || !hasCompleteBucketLayout(
          saved.issues.map((issue) => issue.tempId), saved.bucketOrder, saved.bucketAssignment,
        )
      ) {
        clearSavedDraft(threadId);
        return false;
      }
      setEpicTitle(saved.epicTitle);
      setEpicDescription(saved.epicDescription ?? '');
      setEpicGoals(saved.epicGoals ?? []);
      setIssues(saved.issues);
      setBucketAssignment(saved.bucketAssignment ?? {});
      setBucketOrder(saved.bucketOrder);
      setBucketChoices(saved.bucketChoices ?? {});
      setAcceptedExtraSprints(saved.acceptedExtraSprints ?? false);
      setUsage(saved.usage ?? EMPTY_USAGE);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!workflowThreadId || stage !== 'preview') return;
    const saved: SavedPlanEpicDraft = {
      epicTitle,
      epicDescription,
      epicGoals,
      issues,
      bucketAssignment,
      bucketOrder,
      bucketChoices,
      acceptedExtraSprints,
      usage,
    };
    try {
      window.localStorage.setItem(draftStorageKey(workflowThreadId), JSON.stringify(saved));
    } catch {
      try {
        window.sessionStorage.setItem(draftStorageKey(workflowThreadId), JSON.stringify(saved));
      } catch {
        // The durable server checkpoint remains recoverable even if browser storage is unavailable.
      }
    }
  }, [
    workflowThreadId, stage, epicTitle, epicDescription, epicGoals, issues,
    bucketAssignment, bucketOrder, bucketChoices, acceptedExtraSprints, usage,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await aiApi.findActivePlanEpic(spaceId);
        if (cancelled || !existing?.plan?.epic) return;
        const restoredLocalEdits = restoreSavedDraft(existing.threadId);
        if (!restoredLocalEdits) {
          applyPlanResponse({
            epic: existing.plan.epic,
            issues: existing.plan.issues,
            sprintPlan: existing.plan.sprintPlan,
          degraded: existing.degraded,
          latencySeconds: existing.planningLatencySeconds,
          inputTokens: existing.inputTokens,
          outputTokens: existing.outputTokens,
          estimatedCostUsd: existing.estimatedCostUsd,
        }, existing.plan.sprintTargets);
        } else {
          setDegraded(existing.degraded);
        }
        setWorkflowThreadId(existing.threadId);
        setLastCapacity(existing.sprintCapacityPoints);
        setLastTargetSprintCount(existing.targetSprintCount);
        setResumedExisting(true);
        if (existing.status === 'pending_approval') {
          setStage('preview');
          return;
        }
        const created = Object.keys(existing.committedIssueKeys).length;
        setCommitProgress({ created, total: existing.plan.issues.length });
        setCommitError(
          existing.error
            ? `Published ${created} of ${existing.plan.issues.length} issues before an error: ${existing.error}`
            : `Publishing was interrupted after ${created} of ${existing.plan.issues.length} issues. Resume from the saved checkpoint.`,
        );
        setStage('error');
      } catch {
        // Discovery is best-effort: a fresh Plan Epic remains available if no workflow can be restored.
      } finally {
        if (!cancelled) setCheckingForExisting(false);
      }
    })();
    return () => { cancelled = true; };
  // Discovery intentionally reruns only when the selected space changes. Including the local
  // restore helpers would recreate this effect on every preview edit and overwrite that edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  async function handleGenerate() {
    if (!proposal.trim() || genLoading) return;
    setGenLoading(true);
    setGenError(null);
    setStageLabel(null);
    setRefineHistory([]);
    try {
      const capacity = capacityInput.trim() ? Number(capacityInput) : autoCapacity;
      const targetCount = targetSprintCountInput.trim() ? Number(targetSprintCountInput) : NaN;
      const resolvedCapacity = Number.isFinite(capacity) ? capacity : null;
      const resolvedTargetCount = Number.isFinite(targetCount) ? targetCount : null;
      if (resolvedCapacity == null || !Number.isInteger(resolvedCapacity) || resolvedCapacity <= 0) {
        setGenError('Sprint capacity must be a whole number greater than 0.');
        return;
      }
      if (resolvedTargetCount != null && (!Number.isInteger(resolvedTargetCount) || resolvedTargetCount <= 0)) {
        setGenError('Desired sprint count must be a whole number greater than 0.');
        return;
      }
      const workflow = await aiApi.startRolloutStream(
        proposal.trim(),
        spaceId,
        parsedRequirements(requirementsText),
        spaceLabels.map((l) => l.name),
        resolvedCapacity,
        resolvedTargetCount,
        setStageLabel,
      );
      if (!workflow.plan?.epic) {
        throw new Error(workflow.error || 'Plan generation returned no editable plan.');
      }
      applyPlanResponse({
        epic: workflow.plan.epic,
        issues: workflow.plan.issues,
        sprintPlan: workflow.plan.sprintPlan,
        degraded: workflow.degraded,
        latencySeconds: workflow.planningLatencySeconds,
        inputTokens: workflow.inputTokens,
        outputTokens: workflow.outputTokens,
        estimatedCostUsd: workflow.estimatedCostUsd,
      });
      setWorkflowThreadId(workflow.threadId);
      setResumedExisting(false);
      setLastCapacity(resolvedCapacity);
      setLastTargetSprintCount(resolvedTargetCount);
      setStage('preview');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Plan generation failed — try again.');
    } finally {
      setGenLoading(false);
      setStageLabel(null);
    }
  }

  async function runRefinement(instruction: string, clearManualInput = false) {
    if (!instruction.trim() || refineLoading) return;
    setRefineLoading(true);
    setRefineError(null);
    try {
      const response = await aiApi.refinePlanStream(
        { title: epicTitle, description: epicDescription, goals: epicGoals },
        issues,
        instruction.trim(),
        spaceLabels.map((l) => l.name),
        lastCapacity,
        lastTargetSprintCount,
        spaceId,
        parsedRequirements(requirementsText),
        setRefineStage,
      );
      applyPlanResponse(response, [], 'add', bucketChoices);
      if (clearManualInput) setRefineInstruction('');
      // Cleared on success so the next Apply starts from "Starting…" rather than flashing the
      // previous round's last label before the first event of the new one arrives.
      setRefineStage(null);
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : 'Refine failed — try again.');
    } finally {
      setRefineLoading(false);
    }
  }

  async function handleRefine() {
    await runRefinement(refineInstruction, true);
  }

  /** Editing an issue no longer wipes its dependents' dependency reasons. This runs on every keystroke,
   *  so fixing one typo used to empty every downstream explanation. A slightly stale reason is far
   *  cheaper than losing a good one. */
  function updateIssue(tempId: string, patch: Partial<IssueDraftDto>) {
    setIssues((prev) => prev.map(
      (issue) => (issue.tempId === tempId ? { ...issue, ...patch } : issue),
    ));
  }

  function updatePoints(tempId: string, value: string) {
    // A manual point edit invalidates whatever rationale the AI gave for its own number.
    updateIssue(tempId, { estimateStoryPoints: value ? Number(value) : null, estimateRationale: null });
  }

  function toggleIssueLabel(tempId: string, name: string) {
    setIssues((prev) => prev.map((i) => {
      if (i.tempId !== tempId) return i;
      const has = i.labels.includes(name);
      return { ...i, labels: has ? i.labels.filter((l) => l !== name) : [...i.labels, name] };
    }));
  }

  /** A blocking link is the AI's suggestion, so declining one is a single click and needs no reason —
   *  the reviewer confirms what survives rather than justifying what the model proposed.
   *
   *  This demotes the edge to plain ordering rather than deleting it: the reviewer is saying "don't
   *  claim this card is blocked", not "these two pieces of work are unrelated", and demoting leaves
   *  the topological order (and so the sprint layout they are looking at) undisturbed. */
  function removeDependency(issueTempId: string, dependencyTempId: string) {
    setIssues((prev) => prev.map((issue) => {
      if (issue.tempId !== issueTempId) return issue;
      return {
        ...issue,
        dependencyKinds: { ...(issue.dependencyKinds ?? {}), [dependencyTempId]: 'after' },
      };
    }));
  }

  function removeIssue(tempId: string) {
    setIssues((prev) => prev
      .filter((i) => i.tempId !== tempId)
      .map((i) => {
        const dependencyReasons = { ...(i.dependencyReasons ?? {}) };
        delete dependencyReasons[tempId];
        return {
          ...i,
          dependsOn: i.dependsOn.filter((d) => d !== tempId),
          dependencyReasons,
        };
      }));
    setBucketAssignment((prev) => {
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
    setLabelPickerFor((current) => (current === tempId ? null : current));
  }

  function addIssue(sprintIndex: number) {
    const nextId = nextManualTempId(
      issues.map((issue) => issue.tempId), manualIdCounter.current,
    );
    manualIdCounter.current = nextId.counter;
    const { tempId } = nextId;
    const newIssue: IssueDraftDto = {
      tempId,
      title: '',
      description: '',
      issueType: 'task',
      labels: [],
      estimateStoryPoints: null,
      estimateRationale: null,
      dependsOn: [],
      dependencyReasons: {},
    };
    setIssues((prev) => [...prev, newIssue]);
    setBucketAssignment((prev) => ({ ...prev, [tempId]: sprintIndex }));
  }

  function finalSprintTargets(): RolloutSprintTargetDto[] {
    const targets: RolloutSprintTargetDto[] = [];
    bucketOrder.forEach((sprintIndex) => {
      const issueTempIds = bucketIssues(sprintIndex).map((issue) => issue.tempId);
      if (issueTempIds.length === 0) return;
      const choice = bucketChoices[sprintIndex];
      if (choice?.mode === 'existing') {
        if (!choice.sprintId) throw new Error(`Sprint ${sprintIndex + 1} needs a destination.`);
        targets.push({
          sprintIndex,
          issueTempIds,
          mode: 'existing',
          sprintId: choice.sprintId,
          sprintName: null,
        });
        return;
      }
      targets.push({
        sprintIndex,
        issueTempIds,
        mode: 'new',
        sprintId: null,
        sprintName: choice?.newName.trim() || `${epicTitle.trim()} — Sprint ${sprintIndex + 1}`,
      });
    });
    return targets;
  }

  function completePublish(result: RolloutStatusDto, total: number): boolean {
    const created = Object.keys(result.committedIssueKeys).length;
    setCommitProgress({ created, total });
    if (result.epicIssueKey || created > 0) onCommitted();
    if (result.status === 'committed') {
      if (workflowThreadId) clearSavedDraft(workflowThreadId);
      onClose();
      return true;
    }
    setCommitError(
      result.error
        ? `Published ${created} of ${total} issues before an error: ${result.error}`
        : `Publishing paused after ${created} of ${total} issues. Resume to continue from the saved checkpoint.`,
    );
    setStage('error');
    return false;
  }

function finalEditedPlan() {
    return {
      epic: { title: epicTitle.trim(), description: epicDescription.trim(), goals: epicGoals },
      issues,
      sprintTargets: finalSprintTargets(),
    };
  }

  async function handleCommit() {
    if (!workflowThreadId) {
      setCommitError('This plan has no durable workflow. Go back and generate it again.');
      setStage('error');
      return;
    }
    setStage('committing');
    setCommitError(null);
    const total = issues.length;
    setCommitProgress({ created: 0, total });
    try {
      const result = await aiApi.submitRolloutDecision(workflowThreadId, 'edit', finalEditedPlan());
      completePublish(result, total);
    } catch (err) {
      try {
        const current = await aiApi.getRolloutStatus(workflowThreadId);
        if (completePublish(current, total)) return;
      } catch {
        setCommitError(
          `${err instanceof Error ? err.message : 'Publishing request failed.'} `
          + 'Workflow progress is stored server-side; use Resume to continue safely.',
        );
        setStage('error');
      }
    }
  }

  async function handleRetry() {
    if (!workflowThreadId) return;
    setStage('committing');
    setCommitError(null);
    try {
      const current = await aiApi.getRolloutStatus(workflowThreadId);
      if (current.status === 'committed') {
        completePublish(current, issues.length);
        return;
      }
      setCommitProgress({
        created: Object.keys(current.committedIssueKeys).length,
        total: issues.length,
      });
      const result = current.status === 'pending_approval'
        ? await aiApi.submitRolloutDecision(workflowThreadId, 'edit', finalEditedPlan())
        : await aiApi.retryRollout(workflowThreadId);
      completePublish(result, issues.length);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Could not resume publishing.');
      setStage('error');
    }
  }

  async function handleBack() {
    const threadId = workflowThreadId;
    setBackLoading(true);
    setCommitError(null);
    try {
      if (threadId) {
        await aiApi.submitRolloutDecision(threadId, 'reject');
      }
      if (threadId) clearSavedDraft(threadId);
      setWorkflowThreadId(null);
      setResumedExisting(false);
      setStage('input');
    } catch {
      setCommitError(
        'Could not discard this saved workflow. Nothing was published; try Back again so the old plan does not unexpectedly return later.',
      );
    } finally {
      setBackLoading(false);
    }
  }

  return (
    <div className="bl-overlay" onMouseDown={onClose}>
      <div
        className="bl-modal pe-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pe-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bl-modal__header">
          <h2 id="pe-modal-title" className="bl-modal__title">✨ Plan Epic with AI</h2>
          <button type="button" className="bl-modal__close" aria-label="Close Plan Epic" onClick={onClose}>✕</button>
        </div>
        <div className="bl-modal__body pe-body">
          {checkingForExisting && (
            <p className="pe-hint">Checking for an unfinished Plan Epic workflow…</p>
          )}
          {!checkingForExisting && stage === 'input' && (
            <>
              <label className="bl-modal__label" htmlFor="pe-proposal">Proposal</label>
              <AutoGrowTextarea
                id="pe-proposal"
                className="bl-modal__input pe-textarea"
                placeholder="e.g. Add dark mode support across the app, including a settings toggle and persisted preference..."
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                autoFocus
              />
              <label className="bl-modal__label" htmlFor="pe-requirements">
                Requirements <span className="pe-label-hint">one per line — optional, but this is what
                gets matched against past work</span>
              </label>
              <AutoGrowTextarea
                id="pe-requirements"
                className="bl-modal__input pe-textarea"
                placeholder={'e.g.\nAn admin uploads a spreadsheet and the import runs in the background\nEvery row is validated before anything is created, and bad rows are reported\nOnly authorized admins can start an import'}
                value={requirementsText}
                onChange={(e) => setRequirementsText(e.target.value)}
              />
              <div className="pe-row">
                <div className="pe-field">
                  <label className="bl-modal__label" htmlFor="pe-capacity">Capacity per sprint (points)</label>
                  <input
                    id="pe-capacity"
                    className="bl-modal__input"
                    type="number"
                    min="1"
                    step="1"
                    placeholder={String(autoCapacity)}
                    value={capacityInput}
                    onChange={(e) => setCapacityInput(e.target.value)}
                  />
                  <span className="pe-hint">
                    Per-sprint ceiling. Auto: recent completed-sprint average ({autoCapacity}).
                  </span>
                </div>
                <div className="pe-field">
                  <label className="bl-modal__label" htmlFor="pe-sprint-count">Desired sprint count (optional)</label>
                  <input
                    id="pe-sprint-count"
                    className="bl-modal__input"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Auto"
                    value={targetSprintCountInput}
                    onChange={(e) => setTargetSprintCountInput(e.target.value)}
                  />
                </div>
              </div>
              {genLoading && <GenerationProgress label={stageLabel} />}
              {genError && <p className="pe-error">{genError}</p>}
            </>
          )}

          {(stage === 'preview' || stage === 'committing' || stage === 'error') && (
            <>
              {degraded && (
                <p className="pe-hint pe-hint--warn">
                  The AI's review of this plan didn't finish, so it wasn't double-checked. Review it
                  carefully before publishing.
                </p>
              )}
              {stage === 'preview' && (
                <p className="pe-hint">
                  Review and edit the complete plan below. Approval publishes the epic, sprint
                  assignments, issues, and dependencies through a durable server-side workflow.
                </p>
              )}
              {resumedExisting && (
                <p className="pe-hint pe-hint--restored">
                  Restored your unfinished Plan Epic workflow from its server checkpoint.
                </p>
              )}
              <div className="pe-field">
                <label className="bl-modal__label" htmlFor="pe-epic-title">Epic title</label>
                <input
                  id="pe-epic-title"
                  className="bl-modal__input"
                  value={epicTitle}
                  maxLength={120}
                  disabled={stage !== 'preview'}
                  onChange={(e) => setEpicTitle(e.target.value)}
                />
              </div>
              <div className="pe-field">
                <label className="bl-modal__label" htmlFor="pe-epic-desc">Epic description</label>
                <DescriptionField
                  value={epicDescription}
                  placeholder="What this epic delivers, who it is for, and the boundaries"
                  disabled={stage !== 'preview'}
                  onChange={setEpicDescription}
                  className="bl-modal__input pe-textarea"
                />
              </div>

              <div className="pe-summary">
                <span><strong>{issues.length}</strong> issue{issues.length !== 1 ? 's' : ''}</span>
                <span><strong>{totalPoints}</strong> estimated point{totalPoints !== 1 ? 's' : ''}</span>
                {unestimatedIssueCount > 0 && (
                  <span className="pe-summary__warning">
                    <strong>{unestimatedIssueCount}</strong> unestimated
                  </span>
                )}
                {additionalBucketCount > 0 && lastTargetSprintCount != null ? (
                  <span>
                    <strong>{lastTargetSprintCount}</strong> requested +{' '}
                    <strong>{additionalBucketCount}</strong> additional proposed
                  </span>
                ) : (
                  <span>
                    <strong>{activeBucketCount}</strong> proposed sprint bucket
                    {activeBucketCount !== 1 ? 's' : ''}
                  </span>
                )}
                {blockingLinkCount > 0 && (
                  <span>
                    <strong>{blockingLinkCount}</strong> blocking link
                    {blockingLinkCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* The type rule used to live only in a hover `title` on the dropdown, which made a
                  deliberate, consistently-applied choice look arbitrary to anyone reviewing a plan.
                  It is one quiet line, shown once per plan rather than once per issue. */}
              <p className="pe-legend">
                <strong>Story</strong> delivers something a stakeholder outside engineering would
                recognise as shipped. <strong>Task</strong> is enabling work with no user-visible
                outcome on its own — data models, wiring, tests. Change either on any issue below.
              </p>
              {(usage.inputTokens > 0 || usage.outputTokens > 0 || usage.latencySeconds > 0) && (
                <div className="pe-usage" aria-label="AI planning details">
                  <div className="pe-usage__heading">
                    <strong>AI planning details</strong>
                    <span>Generation and adjustments in this planning session</span>
                  </div>
                  <div className="pe-usage__metrics">
                    <div><span>Total tokens</span><strong>{(usage.inputTokens + usage.outputTokens).toLocaleString()}</strong></div>
                    <div><span>Prompt</span><strong>{usage.inputTokens.toLocaleString()}</strong></div>
                    <div><span>Response</span><strong>{usage.outputTokens.toLocaleString()}</strong></div>
                    <div>
                      <span>Estimated cost</span>
                      <strong>
                        {usage.estimatedCostUsd > 0 && usage.estimatedCostUsd < 0.000001
                          ? '<$0.000001'
                          : `$${usage.estimatedCostUsd.toFixed(6)}`}
                      </strong>
                    </div>
                    <div><span>AI time</span><strong>{usage.latencySeconds.toFixed(2)}s</strong></div>
                  </div>
                </div>
              )}
              {layoutRepairNotice && (
                <p className="pe-capacity-warning"><strong>Layout recovered:</strong> {layoutRepairNotice}</p>
              )}
              {(!epicDescription.trim() || hasEmptyDescription) && (
                <p className="pe-capacity-warning">
                  <strong>Description required.</strong>{' '}
                  {!epicDescription.trim()
                    ? 'Explain the epic outcome before approval.'
                    : 'Every issue needs a short description of what will be done and why.'}
                </p>
              )}
              {(duplicateTempIdCount > 0 || missingDependencyTargetCount > 0) && (
                <p className="pe-capacity-warning">
                  <strong>The plan structure is inconsistent.</strong>{' '}
                  Use Adjust plan to regenerate it before approval; no Jira data has been created.
                </p>
              )}
              {unestimatedIssueCount > 0 && (
                <p className="pe-capacity-warning">
                  <strong>{unestimatedIssueCount} issue{unestimatedIssueCount !== 1 ? 's have' : ' has'} no estimate.</strong>{' '}
                  Capacity totals only include estimated work. Add story points below before approval
                  so the sprint split is meaningful.
                </p>
              )}
              {invalidNumericEstimateCount > 0 && (
                <p className="pe-capacity-warning">
                  <strong>{invalidNumericEstimateCount} estimate{invalidNumericEstimateCount !== 1 ? 's are' : ' is'} outside the planning scale.</strong>{' '}
                  Use 1, 2, 3, 5, 8, or 13 points before approval.
                </p>
              )}
              {additionalBucketCount > 0 && lastTargetSprintCount != null && lastCapacity != null && (
                <div className="pe-capacity-warning pe-capacity-decision">
                  <p>
                    <strong>Decision required:</strong> you requested {lastTargetSprintCount}{' '}
                    sprint{lastTargetSprintCount !== 1 ? 's' : ''} × {lastCapacity} points, but this
                    plan needs {activeBucketCount} buckets
                    {capacityConflict
                      ? ` because ${totalPoints} points exceed the requested ${lastCapacity * lastTargetSprintCount}-point total`
                      : ' because the issue sizes and required order do not fit safely into the requested buckets'}.
                    {' '}No sprint has been created yet.
                  </p>
                  {activeBucketCount > lastTargetSprintCount && (
                    <button
                      type="button"
                      className="bl-btn bl-btn--outline"
                      onClick={() => setAcceptedExtraSprints(true)}
                      disabled={acceptedExtraSprints}
                    >
                      {acceptedExtraSprints
                        ? `Accepted ${activeBucketCount} sprint buckets`
                        : `Use ${activeBucketCount} sprint buckets`}
                    </button>
                  )}
                  {!acceptedExtraSprints && (
                    <span>Or revise/remove work until it fits the requested capacity.</span>
                  )}
                </div>
              )}
              {sprintNameError && (
                <p className="pe-capacity-warning"><strong>Sprint name required:</strong> {sprintNameError}</p>
              )}
              {staleSprintTargetError && (
                <p className="pe-capacity-warning">
                  <strong>Sprint destination changed:</strong> {staleSprintTargetError}
                </p>
              )}
              {lastCapacity != null && overCapacityBucketCount > 0 && (
                <p className="pe-capacity-warning">
                  <strong>{overCapacityBucketCount} sprint bucket{overCapacityBucketCount !== 1 ? 's are' : ' is'} over capacity.</strong>{' '}
                  This happens only when an individual issue is larger than {lastCapacity} points, or
                  after a manual point edit. Split or re-estimate the highlighted work before approval.
                </p>
              )}

              {stage === 'preview' && (
                <div className="pe-refine">
                  <label className="bl-modal__label" htmlFor="pe-refine-instruction">
                    Adjust the plan — like talking it through in sprint planning
                  </label>
                  <div className="pe-refine__row">
                    <AutoGrowTextarea
                      id="pe-refine-instruction"
                      className="bl-modal__input pe-refine__input"
                      placeholder="e.g. 'add a QA/testing task', 'combine the two backend setup issues', 'drop the inventory one for MVP'"
                      value={refineInstruction}
                      onChange={(e) => setRefineInstruction(e.target.value)}
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleRefine();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="bl-btn bl-btn--outline"
                      onClick={handleRefine}
                      disabled={!refineInstruction.trim() || refineLoading}
                    >
                      {refineLoading ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                  {refineLoading && <GenerationProgress label={refineStage} />}
                  {refineError && <p className="pe-error">{refineError}</p>}
                  <RefineHistoryPanel history={refineHistory} />
                </div>
              )}

              {bucketOrder.map((sprintIndex) => {
                const rows = bucketIssues(sprintIndex);
                if (rows.length === 0 && stage !== 'preview') return null;
                const bucketPoints = bucketPointsByIndex[sprintIndex] ?? 0;
                const bucketUnestimated = rows.filter((issue) => issue.estimateStoryPoints == null).length;
                const overCapacity = lastCapacity != null && bucketPoints > lastCapacity;
                const isAdditionalBucket = lastTargetSprintCount != null
                  && activeBucketCount > lastTargetSprintCount
                  && sprintIndex >= lastTargetSprintCount;
                const choice = bucketChoices[sprintIndex] ?? { mode: 'new' as const, newName: '' };
                return (
                  <section className={`pe-bucket${overCapacity ? ' pe-bucket--over-capacity' : ''}`} key={sprintIndex}>
                    <div className="pe-bucket__header">
                      <div className="pe-bucket__identity">
                        <span className="pe-bucket__eyebrow">
                          {isAdditionalBucket ? 'ADDITIONAL CAPACITY PROPOSAL' : 'REQUESTED SPRINT BUCKET'}
                        </span>
                        <span className="pe-bucket__title">
                          {isAdditionalBucket && !acceptedExtraSprints
                            ? 'Overflow work — decision needed'
                            : `Plan bucket ${sprintIndex + 1}`}
                        </span>
                      </div>
                      <span className={`pe-bucket__points${overCapacity ? ' is-over' : ''}`}>
                        {bucketPoints}{lastCapacity != null ? ` / ${lastCapacity}` : ''} pts
                        {bucketUnestimated > 0 ? ` · ${bucketUnestimated} unestimated` : ''}
                      </span>
                    </div>
                    <div className="pe-bucket__target">
                      <span className="pe-bucket__section-label">SPRINT DESTINATION</span>
                      {isAdditionalBucket && !acceptedExtraSprints ? (
                        <p className="pe-bucket__pending-target">
                          No sprint will be created for this work unless you accept the additional
                          bucket above. The issues remain visible below so you can review them first.
                        </p>
                      ) : (
                        <div className="pe-bucket__target-controls">
                        <label className="pe-bucket__target-field">
                          <span>Destination</span>
                          <select
                          className="bl-modal__input"
                          value={choice.mode === 'existing' ? String(choice.sprintId ?? '') : 'new'}
                          disabled={stage !== 'preview'}
                          onChange={(e) => {
                            const value = e.target.value;
                            setBucketChoices((prev) => {
                              if (value !== 'new') {
                                return {
                                  ...prev,
                                  [sprintIndex]: { mode: 'existing', sprintId: Number(value), newName: '' },
                                };
                              }
                              const reserved = new Set(sprints.map((sprint) => normalizedSprintName(sprint.name)));
                              Object.entries(prev).forEach(([index, target]) => {
                                if (Number(index) !== sprintIndex && target.mode === 'new' && target.newName.trim()) {
                                  reserved.add(normalizedSprintName(target.newName));
                                }
                              });
                              return {
                                ...prev,
                                [sprintIndex]: {
                                  mode: 'new',
                                  newName: uniqueSprintName(
                                    `${epicTitle || 'New epic'} — Sprint ${sprintIndex + 1}`,
                                    reserved,
                                  ),
                                },
                              };
                            });
                          }}
                        >
                          <option value="new">+ Create new sprint</option>
                          {futureSprints.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                          </select>
                        </label>
                        {choice.mode === 'new' && (
                          <label className="pe-bucket__target-field">
                            <span>New sprint name</span>
                            <AutoGrowTextarea
                            className="bl-modal__input pe-sprint-name"
                            rows={1}
                            value={choice.newName}
                            maxLength={100}
                            disabled={stage !== 'preview'}
                            placeholder="New sprint name"
                            onChange={(e) => setBucketChoices((prev) => ({
                              ...prev,
                              [sprintIndex]: {
                                ...choice,
                                newName: normalizeSprintNameInput(e.target.value),
                              },
                            }))}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.preventDefault();
                            }}
                          />
                          </label>
                        )}
                        </div>
                      )}
                    </div>
                    <div className="pe-bucket__issues-header">
                      <span className="pe-bucket__section-label">ISSUES IN THIS SPRINT</span>
                      <span>{rows.length} work item{rows.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="pe-issues">
                      {rows.map((issue, issueIndex) => {
                        const unusedLabels = spaceLabels.filter((l) => !issue.labels.includes(l.name));
                        return (
                          <div className="pe-issue" key={issue.tempId}>
                            <div className="pe-issue__topline">
                              <span className="pe-issue__eyebrow">ISSUE {issueIndex + 1}</span>
                              {stage === 'preview' && (
                                <button
                                  type="button"
                                  className="pe-issue__remove"
                                  aria-label={`Remove ${issue.title || 'issue'}`}
                                  onClick={() => removeIssue(issue.tempId)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                            <input
                              className="bl-modal__input pe-issue__title"
                              value={issue.title}
                              maxLength={120}
                              placeholder="Issue title"
                              disabled={stage !== 'preview'}
                              onChange={(e) => updateIssue(issue.tempId, { title: e.target.value })}
                            />
                            <DescriptionField
                              value={issue.description}
                              placeholder="Description — what needs to be done and why"
                              disabled={stage !== 'preview'}
                              onChange={(next) => updateIssue(issue.tempId, { description: next })}
                            />
                            <div className="pe-issue__meta">
                              <select
                                className="bl-modal__input pe-issue__type"
                                value={issue.issueType}
                                disabled={stage !== 'preview'}
                                title="story = user-facing, value-delivering work. task = internal/technical/enabling work. bug = fixing an existing defect."
                                onChange={(e) => updateIssue(issue.tempId, { issueType: e.target.value as IssueDraftDto['issueType'] })}
                              >
                                <option value="task">Task</option>
                                <option value="story">Story</option>
                                <option value="bug">Bug</option>
                              </select>
                              <input
                                className="bl-modal__input pe-issue__points"
                                type="number"
                                min="1"
                                max="13"
                                step="1"
                                placeholder="pts"
                                value={issue.estimateStoryPoints ?? ''}
                                disabled={stage !== 'preview'}
                                onChange={(e) => updatePoints(issue.tempId, e.target.value)}
                              />
                              <div className="pe-issue__labels">
                                {issue.labels.map((name) => {
                                  const { bg, text } = labelColor(name);
                                  return (
                                    <button
                                      key={name}
                                      type="button"
                                      className="pe-chip"
                                      disabled={stage !== 'preview'}
                                      style={{ background: bg, color: text, borderColor: 'transparent' }}
                                      onClick={() => toggleIssueLabel(issue.tempId, name)}
                                    >
                                      {name} ✕
                                    </button>
                                  );
                                })}
                                {stage === 'preview' && unusedLabels.length > 0 && (
                                  <button
                                    type="button"
                                    className="pe-chip pe-chip--add"
                                    onClick={() => setLabelPickerFor((current) => (current === issue.tempId ? null : issue.tempId))}
                                  >
                                    + label
                                  </button>
                                )}
                              </div>
                            </div>
                            {issue.estimateStoryPoints != null && issue.estimateRationale && (
                              <p className="pe-issue__rationale">Why {issue.estimateStoryPoints} pts: {issue.estimateRationale}</p>
                            )}
                            <IssueProvenance issue={issue} />
                            {labelPickerFor === issue.tempId && (
                              <div className="pe-issue__labels pe-issue__labels--picker">
                                {unusedLabels.map((label) => {
                                  const { bg, text } = labelColor(label.name);
                                  return (
                                    <button
                                      key={label.id}
                                      type="button"
                                      className="pe-chip"
                                      style={{ background: 'transparent', color: text, borderColor: bg }}
                                      onClick={() => toggleIssueLabel(issue.tempId, label.name)}
                                    >
                                      {label.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {/* Only blocking edges are listed. A Jira issue link has no relation that
                                means "do this later" — the tracker offers blocks, clones, duplicates
                                and relates-to and nothing else — so a softer edge shown here would be
                                a promise the publish step cannot keep. Those edges still order the
                                plan, and that ordering is already visible and editable as the sprint
                                each issue sits in. */}
                            {blockingPrerequisites(issue).length > 0 && (
                              <div className="pe-issue__deps">
                                <strong>Blocked by</strong>
                                {blockingPrerequisites(issue).map((id) => {
                                  const prerequisite = issues.find((candidate) => candidate.tempId === id);
                                  const prerequisiteTitle = prerequisite?.title || id;
                                  const reason = issue.dependencyReasons?.[id]?.trim();
                                  return (
                                    <div className="pe-issue__dependency" key={id}>
                                      <div className="pe-issue__dependency-head">
                                        <span><strong>{prerequisiteTitle}</strong></span>
                                        {stage === 'preview' && (
                                          <button
                                            type="button"
                                            className="pe-dep-remove"
                                            onClick={() => removeDependency(issue.tempId, id)}
                                            title="Don't create this blocking link"
                                            aria-label={`Remove the blocking link on ${prerequisiteTitle}`}
                                          >
                                            ×
                                          </button>
                                        )}
                                      </div>
                                      {reason && <p>{reason}</p>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {stage === 'preview' && (
                        <button type="button" className="pe-add-issue" onClick={() => addIssue(sprintIndex)}>
                          + Add issue to this sprint
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}

              {(stage === 'committing' || stage === 'error') && commitProgress && (
                <p className="pe-hint">Published issues: {commitProgress.created} of {commitProgress.total}</p>
              )}
              {commitError && <p className="pe-error">{commitError}</p>}
            </>
          )}
        </div>
        <div className="bl-modal__footer">
          {checkingForExisting && (
            <button type="button" className="bl-btn bl-btn--primary" disabled>Checking…</button>
          )}
          {!checkingForExisting && stage === 'input' && (
            <>
              <button type="button" className="bl-btn bl-btn--ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="bl-btn bl-btn--primary"
                onClick={handleGenerate}
                disabled={!proposal.trim() || genLoading}
              >
                {genLoading ? 'Generating…' : 'Generate plan'}
              </button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <button
                type="button"
                className="bl-btn bl-btn--ghost"
                onClick={handleBack}
                disabled={backLoading}
              >
                {backLoading ? 'Discarding…' : 'Back'}
              </button>
              <button
                type="button"
                className="bl-btn bl-btn--primary"
                onClick={handleCommit}
                disabled={
                  !epicTitle.trim()
                  || epicTitle.trim().length > 120
                  || !epicDescription.trim()
                  || issues.length === 0
                  || hasEmptyTitle
                  || hasLongTitle
                  || hasEmptyDescription
                  || unassignedIssueCount > 0
                  || unestimatedIssueCount > 0
                  || invalidNumericEstimateCount > 0
                  || overCapacityBucketCount > 0
                  || duplicateTempIdCount > 0
                  || missingDependencyTargetCount > 0
                  || requiresExtraSprintAcceptance
                  || sprintNameError != null
                  || staleSprintTargetError != null
                  || backLoading
                }
                title={
                  !epicDescription.trim()
                    ? 'Describe the epic outcome before creating'
                    : hasEmptyTitle
                    ? 'Every issue needs a title before creating'
                    : hasEmptyDescription
                      ? 'Every issue needs a description before creating'
                      : invalidNumericEstimateCount > 0
                        ? 'Use only 1, 2, 3, 5, 8, or 13 story points'
                        : overCapacityBucketCount > 0
                          ? 'Split or re-estimate work that exceeds a sprint capacity'
                          : duplicateTempIdCount > 0 || missingDependencyTargetCount > 0
                            ? 'Regenerate the inconsistent plan structure before creating'
                            : unassignedIssueCount > 0
                              ? 'Every issue must be assigned to a sprint before creating'
                              : unestimatedIssueCount > 0
                                ? 'Estimate every issue before creating so sprint capacity is reliable'
                                : requiresExtraSprintAcceptance
                                  ? 'Accept the additional sprint buckets or revise the plan first'
                                  : staleSprintTargetError ?? sprintNameError ?? undefined
                }
              >
                Approve &amp; create epic + {issues.length} issue{issues.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {stage === 'committing' && (
            <button type="button" className="bl-btn bl-btn--primary" disabled>Publishing durably…</button>
          )}
          {stage === 'error' && (
            <>
              <button type="button" className="bl-btn bl-btn--ghost" onClick={onClose}>Close</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleRetry}>Resume publishing</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
