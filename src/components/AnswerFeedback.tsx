import { useId, useState } from 'react';
import { feedbackApi, feedbackReasons } from '../api/feedbackApi';
import './AnswerFeedback.css';

export function AnswerFeedback({ receipt }: { receipt: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState<'up' | 'down' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(rating: 'up' | 'down') {
    if (busy || saved) return;
    setBusy(true); setError('');
    try {
      await feedbackApi.submit(receipt, rating, reason, comment);
      setSaved(rating); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send feedback. Try again.'); }
    finally { setBusy(false); }
  }

  return <div className="answer-feedback">
    {saved ? <p className="answer-feedback__thanks" role="status">✓ Thanks — your feedback was saved.</p> : <>
      <div className="answer-feedback__actions">
        <span>Was this helpful?</span>
        <button type="button" aria-label="Helpful answer" disabled={busy} onClick={() => void submit('up')}>
          <Thumb />
        </button>
        <button type="button" aria-label="Unhelpful answer" aria-expanded={open} aria-controls={id} disabled={busy} onClick={() => setOpen(!open)}>
          <Thumb down />
        </button>
      </div>
      <p className="answer-feedback__disclosure">Feedback shares this conversation and its sources with space owners.</p>
      {open && <div id={id} className="answer-feedback__form">
        <label htmlFor={`${id}-reason`}>What could be better? <span>(optional)</span></label>
        <select id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} disabled={busy}>
          <option value="">Choose a reason</option>
          {Object.entries(feedbackReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={`${id}-comment`}>Anything else? <span>(optional)</span></label>
        <textarea id={`${id}-comment`} rows={3} maxLength={4000} value={comment} disabled={busy}
          placeholder="For example, a missing issue or the source you expected…" onChange={e => setComment(e.target.value)} />
        <div className="answer-feedback__buttons">
          <button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button type="button" className="answer-feedback__send" onClick={() => void submit('down')} disabled={busy}>{busy ? 'Sending…' : 'Send feedback'}</button>
        </div>
      </div>}
    </>}
    {error && <p className="answer-feedback__error" role="alert">{error}</p>}
  </div>;
}

function Thumb({ down = false }: { down?: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="M7 10v11H3V10h4Zm0 0 5-8c2 0 3 2 2 5l-1 3h6a2 2 0 0 1 2 2l-2 7a3 3 0 0 1-3 2H7" />
  </svg>;
}
