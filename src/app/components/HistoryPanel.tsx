import { memo, useEffect, useRef } from 'react';
import type { HistoryEntry } from '../../lang';
import { RULES } from '../model/visualization';

/** Rows rendered around the current state; long traces are windowed. */
const WINDOW = 150;
/** Characters of each state shown in a row (rows are one line; huge states would cost layout time). */
const PREVIEW_CHARS = 160;
const TITLE_CHARS = 1000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

interface HistoryPanelProps {
  readonly history: readonly HistoryEntry[];
  readonly index: number;
  readonly finished: boolean;
  readonly onSelect: (index: number) => void;
  readonly disabled: boolean;
}

export const HistoryPanel = memo(function HistoryPanel({ history, index, finished, onSelect, disabled }: HistoryPanelProps) {
  const active = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // Keep the current row visible by scrolling the list only (never the page).
  useEffect(() => {
    const row = active.current;
    const box = list.current;
    if (!row || !box) return;
    const top = row.offsetTop; // the list is position: relative, i.e. the row's offsetParent
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight;
  }, [index]);

  const from = Math.max(0, index - WINDOW);
  const to = Math.min(history.length, index + WINDOW + 1);
  const rows = history.slice(from, to);

  return (
    <section className="panel history" aria-labelledby="history-title">
      <header className="panel-header">
        <h2 id="history-title">History</h2>
        <span className="muted">
          {history.length - 1} step{history.length === 2 ? '' : 's'}
          {finished ? '' : ' so far'}
        </span>
      </header>
      <ol className="history-list" aria-label="Recorded states" ref={list}>
        {from > 0 && <li className="muted history-gap">… {from} earlier states</li>}
        {rows.map((entry) => {
          const isCurrent = entry.index === index;
          return (
            <li key={entry.index}>
              <button
                type="button"
                ref={isCurrent ? active : undefined}
                className={`history-item${isCurrent ? ' is-current' : ''}${entry.index > index ? ' is-ahead' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSelect(entry.index)}
                disabled={disabled}
                title={clip(entry.source, TITLE_CHARS)}
              >
                <span className="history-index">{entry.index}</span>
                <span className={`rule-chip rule-${entry.step?.rule ?? 'start'}`}>
                  {entry.step ? RULES[entry.step.rule].symbol : 'start'}
                </span>
                <code className="history-source">{clip(entry.source, PREVIEW_CHARS)}</code>
              </button>
            </li>
          );
        })}
        {to < history.length && <li className="muted history-gap">… {history.length - to} later states</li>}
      </ol>
    </section>
  );
});
