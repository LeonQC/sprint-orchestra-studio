import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { feedbackApi, feedbackStatuses, feedbackReasons, feedbackCauses } from '../api/feedbackApi';
import type { FeedbackDetail, FeedbackList, FeedbackStatus } from '../api/feedbackApi';
import { useSpaces } from '../context/SpaceContext';
import { useCurrentUser } from '../context/UserContext';
import { isSpaceOwner } from '../types/space';
import { ApiError } from '../api/apiError';
import './AiFeedback.css';

const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AiFeedback() {
  const { spaces } = useSpaces();
  const { currentUser } = useCurrentUser();
  const owner = spaces.some(space => isSpaceOwner(space, currentUser.id));
  return <section className="feedback-page">
    <header className="feedback-header"><div><div className="feedback-eyebrow">WORKSPACE QUALITY</div><h1>AI Feedback</h1><p>Review answers, understand what went wrong, and capture what good looks like.</p></div><span className="feedback-owner-badge">Space owners</span></header>
    {owner ? <FeedbackInbox key={currentUser.id} /> : <div className="feedback-empty"><h2>For space owners</h2><p>You can review feedback when you own all the spaces included in an answer.</p></div>}
  </section>;
}

function FeedbackInbox() {
  const { spaces } = useSpaces();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<FeedbackList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    feedbackApi.list({ status, query, page }).then(result => {
      if (active) { setData(result); setError(''); }
    }).catch(e => { if (active) { setError(message(e)); setData(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, query, page, refresh]);

  function reload() { setLoading(true); setRefresh(value => value + 1); }
  const helpfulRate = data?.signals.total
    ? `${Math.round((data.signals.helpful / data.signals.total) * 100)}%`
    : '—';
  return <>
    <div className="feedback-quality-summary" aria-label="Answer feedback summary">
      <div><span>Helpful rate</span><strong>{helpfulRate}</strong></div>
      <div><span>Helpful answers</span><strong>{data?.signals.helpful ?? '—'}</strong></div>
      <div><span>Reported issues</span><strong>{data?.signals.reported ?? '—'}</strong></div>
      <p>Positive ratings contribute to this aggregate quality signal. They do not enter the review inbox.</p>
    </div>
    <div className="feedback-stats" aria-label="Feedback overview">
      {(['new', 'reviewing', 'resolved'] as const).map(state => <button type="button" key={state} onClick={() => { setLoading(true); setStatus(state); setSelected(null); setPage(0); setRefresh(value => value + 1); }} className={status === state ? 'is-selected' : ''}>
        <span><i className={`feedback-dot feedback-dot--${state}`} />{feedbackStatuses[state]}</span><strong>{data?.counts[state] ?? '—'}</strong>
      </button>)}
    </div>
    <div className="feedback-toolbar">
      <form onSubmit={event => { event.preventDefault(); setLoading(true); setQuery(search.trim()); setPage(0); setRefresh(value => value + 1); }} className="feedback-search">
        <input aria-label="Search feedback" placeholder="Search questions, comments, or people…" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} />
        <button type="submit">Search</button>
      </form>
      <select aria-label="Filter by status" value={status} onChange={e => { setLoading(true); setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{Object.entries(feedbackStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button type="button" className="feedback-button" onClick={reload} disabled={loading}>Refresh</button>
    </div>
    <div className={`feedback-workspace ${selected ? 'has-detail' : ''}`}>
      <div className="feedback-list">
        <div className="feedback-list-heading"><strong>Inbox</strong><span>{data ? `${data.total} result${data.total === 1 ? '' : 's'}` : ''}</span></div>
        {loading ? <div className="feedback-empty" role="status">Loading feedback…</div> : error ? <div className="feedback-empty" role="alert"><p>{error}</p><button className="feedback-button" onClick={reload}>Try again</button></div> : !data?.items.length ? <div className="feedback-empty"><span className="feedback-empty-icon" aria-hidden="true">✓</span><h2>{status || query ? 'No matching feedback' : 'Nothing needs review'}</h2><p>{status || query ? 'Try another filter or search.' : 'New answer issues will appear here.'}</p></div> : <>
          <div className="feedback-list-items">
            {data.items.map(item => <button type="button" key={item.id} className={`feedback-row ${selected === item.id ? 'is-selected' : ''}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
              <div className="feedback-row-top"><span className="feedback-vote feedback-vote--down">Reported issue</span><Status value={item.status} /></div>
              <strong className="feedback-question">{item.question}</strong>
              <p className="feedback-preview">{item.comment || feedbackReasons[item.reason] || 'No additional comment'}</p>
              <div className="feedback-row-meta"><span>{item.reporterName}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></div>
              <div className="feedback-spaces">{item.spaceIds.map(id => spaces.find(space => space.id === String(id))?.key ?? `Space ${id}`).join(' · ')}</div>
            </button>)}
          </div>
          <div className="feedback-pagination"><button className="feedback-button" disabled={page === 0} onClick={() => { setLoading(true); setPage(page - 1); }}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button className="feedback-button" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => { setLoading(true); setPage(page + 1); }}>Next</button></div>
        </>}
      </div>
      {selected && <FeedbackDetailPanel key={selected} id={selected} onClose={() => setSelected(null)} onSaved={reload} />}
    </div>
    <p className="feedback-scope-note">Only reported answer issues whose spaces you own are included.</p>
  </>;
}

function FeedbackDetailPanel({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    feedbackApi.detail(id).then(result => { if (active) { setDetail(result); setError(''); } })
      .catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [id, retry]);
  return <aside className="feedback-detail" aria-label="Feedback details">
    <div className="feedback-detail-heading"><strong>Feedback details</strong><button type="button" className="feedback-button" aria-label="Close feedback details" onClick={onClose}>✕</button></div>
    {error ? <div className="feedback-empty" role="alert"><p>{error}</p><button className="feedback-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !detail ? <div className="feedback-empty" role="status">Loading answer…</div> : <ReviewForm key={`${id}-${detail.revision}`} detail={detail} onReload={() => { setDetail(null); setRetry(value => value + 1); }} onSaved={result => { setDetail(result); onSaved(); }} />}
  </aside>;
}

function ReviewForm({ detail, onSaved, onReload }: { detail: FeedbackDetail; onSaved: (result: FeedbackDetail) => void; onReload: () => void }) {
  const [status, setStatus] = useState(detail.status);
  const [rootCause, setRootCause] = useState(detail.rootCause);
  const [reviewNote, setReviewNote] = useState(detail.reviewNote);
  const [expectedAnswer, setExpectedAnswer] = useState(detail.expectedAnswer);
  const [keys, setKeys] = useState(detail.requiredIssueKeys.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const response = detail.snapshot.response;
  const dirty = status !== detail.status || rootCause !== detail.rootCause || reviewNote !== detail.reviewNote || expectedAnswer !== detail.expectedAnswer || keys !== detail.requiredIssueKeys.join(', ');

  async function save() {
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await feedbackApi.review(detail.id, { status, rootCause, reviewNote, expectedAnswer,
        requiredIssueKeys: keys.split(/[\s,]+/).filter(Boolean), revision: detail.revision });
      onSaved(result);
    } catch (e) { setError(message(e)); setConflict(e instanceof ApiError && e.status === 409); }
    finally { setBusy(false); }
  }

  return <div className="feedback-detail-body">
    <div className="feedback-reporter"><div><strong>{detail.reporterName}</strong><span>{date(detail.createdAt)}</span></div><Status value={detail.status} /></div>
    <div className="feedback-comment"><strong>{feedbackReasons[detail.reason] || 'Reported issue'}</strong><p>{detail.comment || 'No additional comment.'}</p></div>
    <section className="feedback-answer-section"><h2>Question</h2><p>{detail.question}</p><h2>AI answer</h2><div className="feedback-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{response.answer}</ReactMarkdown></div></section>
    {!!detail.snapshot.request.history?.length && <details className="feedback-evidence"><summary>Earlier conversation ({detail.snapshot.request.history.length})</summary>{detail.snapshot.request.history.map((turn, i) => <div key={i}><strong>{turn.role === 'user' ? 'User' : 'AI'}</strong><p>{turn.content}</p></div>)}</details>}
    <details className="feedback-evidence"><summary>Sources & evidence ({response.citations.length + (response.structuredEvidence?.length ?? 0)})</summary>
      {!response.citations.length && !response.structuredEvidence?.length && <p>No source excerpts were returned with this answer.</p>}
      {response.citations.map((citation, index) => <div key={index}><strong>{citation.issueKey} · {citation.chunkType}</strong><p>{citation.content}</p></div>)}
      {response.structuredEvidence?.map((evidence, index) => <p key={`structured-${index}`}>{evidence}</p>)}
    </details>
    <details className="feedback-evidence"><summary>Answer information</summary><dl><dt>Answer ID</dt><dd>{detail.snapshot.answerId}</dd><dt>Answered</dt><dd>{date(new Date(detail.snapshot.issuedAt * 1000).toISOString())}</dd><dt>From cache</dt><dd>{response.cacheHit ? 'Yes' : 'No'}</dd><dt>Tools</dt><dd>{response.routeTool || 'Not recorded'}</dd><dt>Models</dt><dd>{response.modelUsage?.map(item => item.model).join(', ') || 'Not recorded'}</dd><dt>Trace reference</dt><dd>{response.traceParent || 'Not recorded'}</dd></dl></details>
    <form className="feedback-review-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="feedback-review-title"><h2>Review</h2><span>{dirty ? 'Unsaved changes' : `Saved · ${date(detail.updatedAt)}`}</span></div>
      <div className="feedback-form-grid"><label>Status<select aria-label="Review status" value={status} disabled={busy} onChange={e => setStatus(e.target.value as FeedbackStatus)}>{Object.entries(feedbackStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Root cause<select aria-label="Root cause" value={rootCause} disabled={busy} onChange={e => setRootCause(e.target.value)}><option value="">Not classified</option>{Object.entries(feedbackCauses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <label>Review notes<textarea rows={3} maxLength={8000} value={reviewNote} disabled={busy} placeholder="What did you find? What was changed or verified?" onChange={e => setReviewNote(e.target.value)} /></label>
      <label>Expected answer<textarea rows={3} maxLength={12000} value={expectedAnswer} disabled={busy} placeholder="Describe the correct answer, verified against the source." onChange={e => setExpectedAnswer(e.target.value)} /></label>
      <label>Required issue keys <span className="feedback-optional">(optional)</span><input value={keys} disabled={busy} maxLength={5100} placeholder="ATC-123, ATC-124" onChange={e => setKeys(e.target.value)} /></label>
      {error && <p className="feedback-error" role="alert">{error}</p>}
      {conflict && <button type="button" className="feedback-button" onClick={onReload}>Discard draft and load latest review</button>}
      <div className="feedback-form-actions"><button type="submit" className="feedback-button feedback-button--primary" disabled={busy || !dirty}>{busy ? 'Working…' : 'Save review'}</button></div>
    </form>
  </div>;
}

function Status({ value }: { value: FeedbackStatus }) { return <span className={`feedback-status feedback-status--${value}`}>{feedbackStatuses[value]}</span>; }
