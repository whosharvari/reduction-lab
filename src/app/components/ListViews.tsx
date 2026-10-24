/**
 * Map and fold visualisations. All state shown here comes from view models
 * derived from the real AST and history (see model/visualization.ts).
 */
import { printExpr } from '../../lang';
import type { FoldView, MapView } from '../model/visualization';
import { CodeView } from './CodeView';

/** Cells rendered at once; long lists show a window around the active element. */
export const MAX_CELLS = 40;
/** Accumulator values shown in the timeline (the most recent ones). */
export const MAX_TIMELINE = 8;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} …` : text);

/** Index range [from, to) of at most MAX_CELLS items, keeping `focus` in view. */
export function cellWindow(length: number, focus: number | undefined): [number, number] {
  if (length <= MAX_CELLS) return [0, length];
  const centre = focus ?? 0;
  const from = Math.max(0, Math.min(centre - Math.floor(MAX_CELLS / 4), length - MAX_CELLS));
  return [from, from + MAX_CELLS];
}

function Hidden({ count, where }: { count: number; where: 'before' | 'after' }) {
  if (count <= 0) return null;
  return (
    <li className="cell cell-more muted" aria-label={`${count} more elements ${where}`}>
      {where === 'before' ? `… ${count} earlier` : `${count} more …`}
    </li>
  );
}

const MAP_STATUS: Record<MapView['elements'][number]['status'], string> = {
  pending: 'pending',
  active: 'processing',
  done: 'done',
  error: 'failed',
};

export function MapVisual({ view }: { view: MapView }) {
  const firstPending = view.elements.findIndex((e) => e.status !== 'done');
  const [mapFrom, mapTo] = cellWindow(view.elements.length, view.activeIndex ?? (firstPending >= 0 ? firstPending : undefined));
  const failed = view.elements.find((e) => e.status === 'error');
  const phaseText = failed
    ? `Stopped at element ${failed.index}`
    : view.phase === 'expanding'
      ? 'About to expand into one application per element'
      : view.phase === 'complete'
        ? 'Every element is a value'
        : view.activeIndex !== undefined
          ? `Reducing element ${view.activeIndex}`
          : 'Reducing elements left to right';

  return (
    <div className="viz" aria-label="Map visualisation">
      <div className="viz-head">
        <span className="viz-title">map</span>
        <CodeView expr={view.fn} label="Mapped function" />
        <span className="muted viz-phase">{phaseText}</span>
      </div>
      <ol className="cells" aria-label="Map elements">
        <Hidden count={mapFrom} where="before" />
        {view.elements.slice(mapFrom, mapTo).map((el) => (
          <li
            key={el.index}
            className={`cell cell-${el.status}`}
            aria-current={el.status === 'active' ? 'step' : undefined}
            aria-label={`Element ${el.index}: ${MAP_STATUS[el.status]}`}
            data-status={el.status}
          >
            <span className="cell-index">{el.index}</span>
            <span className="cell-row">
              <span className="cell-key">in</span>
              {el.input ? <CodeView expr={el.input} /> : <span className="muted">?</span>}
            </span>
            <span className="cell-row">
              <span className="cell-key">now</span>
              {el.current ? <CodeView expr={el.current} /> : <span className="muted">not expanded</span>}
            </span>
            <span className="cell-status">{MAP_STATUS[el.status]}</span>
          </li>
        ))}
        <Hidden count={view.elements.length - mapTo} where="after" />
        {view.elements.length === 0 && <li className="muted">Empty list: map yields []</li>}
      </ol>
    </div>
  );
}

const FOLD_PHASE: Record<FoldView['phase'], string> = {
  consume: 'Taking the next element into the accumulator',
  accumulate: 'Computing the new accumulator',
  finish: 'List exhausted: the accumulator is the result',
  complete: 'Fold complete',
};

export function FoldVisual({ view }: { view: FoldView }) {
  const [foldFrom, foldTo] = cellWindow(view.elements.length, view.activeIndex ?? view.consumedCount);
  const hiddenValues = Math.max(0, view.timeline.length - MAX_TIMELINE);
  return (
    <div className="viz" aria-label="Fold visualisation">
      <div className="viz-head">
        <span className="viz-title">fold</span>
        <CodeView expr={view.fn} label="Fold function" />
        <span className="muted viz-phase">{FOLD_PHASE[view.phase]}</span>
      </div>

      <p className="fold-order muted">Left fold: elements are combined left to right, accumulator first.</p>
      <ol className="cells cells-compact" aria-label="Fold elements">
        <Hidden count={foldFrom} where="before" />
        {view.elements.slice(foldFrom, foldTo).map((el) => (
          <li
            key={el.index}
            className={`cell cell-${el.status}`}
            aria-current={el.status === 'active' ? 'step' : undefined}
            aria-label={`Element ${el.index}: ${el.status}`}
            data-status={el.status}
          >
            <span className="cell-index">{el.index}</span>
            <CodeView expr={el.expr} />
            <span className="cell-status">{el.status}</span>
          </li>
        ))}
        <Hidden count={view.elements.length - foldTo} where="after" />
        {view.elements.length === 0 && <li className="muted">Empty list</li>}
      </ol>

      <div className="acc">
        <div className="acc-row">
          <span className="cell-key">accumulator</span>
          <CodeView expr={view.accumulator} className="code-acc" label="Current accumulator" maxChars={400} />
        </div>
        {view.lastTransition && (
          <div className="acc-row">
            <span className="cell-key">last step</span>
            <span className="rewrite-pair">
              <CodeView expr={view.lastTransition.before} maxChars={240} />
              <span className="arrow" aria-hidden="true">⟶</span>
              <CodeView expr={view.lastTransition.after} className="code-changed" maxChars={240} />
            </span>
          </div>
        )}
        <div className="acc-row">
          <span className="cell-key">history</span>
          <span className="timeline" aria-label="Accumulator values so far">
            {hiddenValues > 0 && <span className="muted">… {hiddenValues} earlier</span>}
            {view.timeline.slice(hiddenValues).map((value, i) => (
              <span key={hiddenValues + i} className="timeline-item">
                {(i > 0 || hiddenValues > 0) && <span className="arrow" aria-hidden="true">→</span>}
                <code className="code">{clip(printExpr(value), 60)}</code>
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
