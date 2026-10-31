import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

/** Tooltip that measures the viewport and clamps itself, rendered via a portal to `document.body`
 *  with `position: fixed`. A CSS-only `:hover::after` tooltip can't know where the screen edge is, so
 *  tooltips near the modal edges went off-screen. On hover this reads the trigger's position, keeps the
 *  tooltip 8px inside the window, and flips it below when there's no room above (a small hand-rolled
 *  version of what Floating UI does). The portal also avoids clipping by `overflow` ancestors.
 *  `text` can be any ReactNode (the Backlog explainers need structure); strings still work. */
export function Tooltip({
  text,
  children,
  wide = false,
}: {
  text: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
    setPos(null);
  }

  function hide() {
    setAnchor(null);
    setPos(null);
  }

  useLayoutEffect(() => {
    if (!anchor || !bubbleRef.current) return;
    const margin = 8;
    const gap = 8;
    const rect = bubbleRef.current.getBoundingClientRect();
    const spaceAbove = anchor.top - margin;
    const spaceBelow = window.innerHeight - anchor.bottom - margin;
    const openDown = spaceBelow >= rect.height + gap || spaceBelow >= spaceAbove;
    const idealTop = openDown ? anchor.bottom + gap : anchor.top - rect.height - gap;
    const top = Math.min(Math.max(idealTop, margin), window.innerHeight - rect.height - margin);
    const idealLeft = anchor.left + anchor.width / 2 - rect.width / 2;
    const left = Math.min(Math.max(idealLeft, margin), window.innerWidth - rect.width - margin);
    setPos({ top, left });
  }, [anchor, text, wide]);

  return (
    <span
      ref={triggerRef}
      className="tt-trigger"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => { if (event.key === 'Escape') hide(); }}
    >
      {children}
      {anchor && createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          className={`tt-bubble${wide ? ' tt-bubble--wide' : ''}`}
          style={{
            left: pos?.left ?? 8,
            top: pos?.top ?? 8,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}

/** The recurring shape a "what does this feature do" tooltip needs: a title, a plain-language
 *  description, and — for anything that touches Jira — a safety note stated up front rather than
 *  buried in the description prose. Pulled out so the Backlog row's two explainer icons (health check,
 *  recovery) render from the same layout instead of two hand-built JSX blocks that could drift apart
 *  in spacing or hierarchy. */
export function TooltipExplainer({
  title,
  description,
  criteria = [],
  comparison,
  note,
}: {
  title: string;
  description: string;
  criteria?: Array<{ label: string; description: string; example?: string }>;
  comparison?: string;
  note?: string;
}) {
  return (
    <span className="tt-bubble__content">
      <span className="tt-bubble__title">{title}</span>
      <span className="tt-bubble__desc">{description}</span>
      {criteria.length > 0 && (
        <span className="tt-bubble__criteria">
          {criteria.map((criterion) => (
            <span className="tt-bubble__criterion" key={criterion.label}>
              <strong>{criterion.label}</strong>
              <span>{criterion.description}</span>
              {criterion.example && <em>{criterion.example}</em>}
            </span>
          ))}
        </span>
      )}
      {comparison && <span className="tt-bubble__comparison">{comparison}</span>}
      {note && <span className="tt-bubble__note">{note}</span>}
    </span>
  );
}
