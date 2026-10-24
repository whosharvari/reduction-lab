/**
 * Explains the step the user is looking at, using the reducer's own rule,
 * description and metadata.
 */
import { printExpr, type ExecutionSnapshot, type ReductionStep } from '../../lang';
import type { FoldView, MapView } from '../model/visualization';
import { RULES, rewriteOf } from '../model/visualization';
import { CodeView } from './CodeView';

/** Inspector previews are clipped; the full expression is always on the stage. */
const PREVIEW_CHARS = 240;

interface InspectorProps {
  readonly snapshot: ExecutionSnapshot;
  readonly mapView?: MapView;
  readonly foldView?: FoldView;
}

function StepDetails({ step, title, collapsible = false }: { step: ReductionStep; title: string; collapsible?: boolean }) {
  const body = <StepBody step={step} />;
  return collapsible ? (
    <details className="inspector-section" aria-label={title}>
      <summary>{title}</summary>
      {body}
    </details>
  ) : (
    <section className="inspector-section" aria-label={title}>
      <h3>{title}</h3>
      {body}
    </section>
  );
}

function StepBody({ step }: { step: ReductionStep }) {
  const rule = RULES[step.rule];
  const { before, after } = rewriteOf(step);
  return (
    <>
      <p className="rule-line">
        <span className={`rule-chip rule-${step.rule}`}>{rule.symbol}</span>
        <strong>{rule.name}</strong>
      </p>
      <p className="explanation">{rule.explanation}</p>
      <p className="reducer-note">
        <span className="muted">Reducer: </span>
        {step.description}
      </p>
      <dl className="kv">
        <dt>Redex</dt>
        <dd><CodeView expr={before} className="code-redex" maxChars={PREVIEW_CHARS} /></dd>
        <dt>Becomes</dt>
        <dd><CodeView expr={after} className="code-changed" maxChars={PREVIEW_CHARS} /></dd>
        {step.listFocus && (
          <>
            <dt>List element</dt>
            <dd>
              index {step.listFocus.index}
              {step.listFocus.origin && (
                <>
                  {' · input '}
                  <code className="code">{printExpr(step.listFocus.origin.input)}</code>
                </>
              )}
            </dd>
          </>
        )}
        {step.foldFocus && (
          <>
            <dt>Fold</dt>
            <dd>
              {step.foldFocus.phase}
              {step.foldFocus.index !== undefined && ` · element ${step.foldFocus.index}`}
              {step.foldFocus.element && (
                <>
                  {' ('}
                  <code className="code">{printExpr(step.foldFocus.element)}</code>
                  {')'}
                </>
              )}
            </dd>
            <dt>Accumulator</dt>
            <dd className="rewrite-pair">
              <CodeView expr={step.foldFocus.accumulatorBefore} maxChars={PREVIEW_CHARS} />
              <span className="arrow" aria-hidden="true">⟶</span>
              <CodeView expr={step.foldFocus.accumulatorAfter} className="code-changed" maxChars={PREVIEW_CHARS} />
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

export function Inspector({ snapshot, mapView, foldView }: InspectorProps) {
  const { current, next } = snapshot;
  const failure = snapshot.status === 'error' && snapshot.outcome?.status === 'error' ? snapshot.outcome : undefined;

  return (
    <section className="panel inspector" aria-labelledby="inspector-title">
      <header className="panel-header">
        <h2 id="inspector-title">Inspector</h2>
        <span className="muted">state {current.index}</span>
      </header>

      {next && <StepDetails step={next} title="Next step" />}
      {current.step && <StepDetails step={current.step} title={`Step ${current.index} (just applied)`} collapsible={!!next} />}

      {!next && !current.step && !failure && (
        <p className="muted inspector-section">This program is already a value — there is nothing to reduce.</p>
      )}

      {snapshot.status === 'done' && (
        <section className="inspector-section" aria-label="Result">
          <h3>Result</h3>
          <CodeView expr={current.expr} className="code-lg" label="Final value" maxChars={2000} />
        </section>
      )}

      {failure && (
        <section className="inspector-section" aria-label="Error">
          <h3>Error</h3>
          <p className="error-text">
            <strong>{failure.error.kind}</strong>: {failure.error.message}
          </p>
          <p className="muted">Reduction cannot continue from this state. Step back to see how it got here.</p>
        </section>
      )}

      {(mapView || foldView) && (
        <section className="inspector-section" aria-label="List operation">
          <h3>List operation</h3>
          <dl className="kv">
            {mapView && (
              <>
                <dt>map</dt>
                <dd>
                  {mapView.elements.filter((e) => e.status === 'done').length} of {mapView.elements.length} elements are values
                </dd>
              </>
            )}
            {foldView && (
              <>
                <dt>fold</dt>
                <dd>
                  {foldView.consumedCount} of {foldView.elements.length} consumed ·
                  acc <code className="code">{printExpr(foldView.accumulator)}</code>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
    </section>
  );
}
