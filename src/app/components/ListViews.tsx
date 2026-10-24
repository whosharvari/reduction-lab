/**
 * Map and fold visualisations. All state shown here comes from view models
 * derived from the real AST and history (see model/visualization.ts).
 */
import { printExpr } from '../../lang';
import type { FoldView, MapView } from '../model/visualization';
import { CodeView } from './CodeView';

const MAP_STATUS: Record<MapView['elements'][number]['status'], string> = {
  pending: 'pending',
  active: 'processing',
  done: 'done',
  error: 'failed',
};

export function MapVisual({ view }: { view: MapView }) {
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
        {view.elements.map((el) => (
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
  return (
    <div className="viz" aria-label="Fold visualisation">
      <div className="viz-head">
        <span className="viz-title">fold</span>
        <CodeView expr={view.fn} label="Fold function" />
        <span className="muted viz-phase">{FOLD_PHASE[view.phase]}</span>
      </div>

      <p className="fold-order muted">Left fold: elements are combined left to right, accumulator first.</p>
      <ol className="cells cells-compact" aria-label="Fold elements">
        {view.elements.map((el) => (
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
        {view.elements.length === 0 && <li className="muted">Empty list</li>}
      </ol>

      <div className="acc">
        <div className="acc-row">
          <span className="cell-key">accumulator</span>
          <CodeView expr={view.accumulator} className="code-acc" label="Current accumulator" />
        </div>
        {view.lastTransition && (
          <div className="acc-row">
            <span className="cell-key">last step</span>
            <span className="rewrite-pair">
              <CodeView expr={view.lastTransition.before} />
              <span className="arrow" aria-hidden="true">⟶</span>
              <CodeView expr={view.lastTransition.after} className="code-changed" />
            </span>
          </div>
        )}
        <div className="acc-row">
          <span className="cell-key">history</span>
          <span className="timeline" aria-label="Accumulator values so far">
            {view.timeline.map((value, i) => (
              <span key={i} className="timeline-item">
                {i > 0 && <span className="arrow" aria-hidden="true">→</span>}
                <code className="code">{printExpr(value)}</code>
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
