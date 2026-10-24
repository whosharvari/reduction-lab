/**
 * The centrepiece: the current expression, with the next redex, the region
 * the last step produced, and the active list element highlighted by node id.
 * What the last step did, in detail, is shown by the Spotlight panel below it.
 */
import { nodeAt, printExpr, type ExecutionSnapshot } from '../../lang';
import { RULES } from '../model/visualization';
import { CodeView, type MarkList } from './CodeView';

export function Stage({ snapshot }: { readonly snapshot: ExecutionSnapshot }) {
  const { current, next } = snapshot;
  const last = current.step;
  const failure = snapshot.status === 'error' && snapshot.outcome?.status === 'error' ? snapshot.outcome : undefined;
  const focus = next?.listFocus ?? failure?.listFocus;
  const failedNode = failure?.path && nodeAt(current.expr, failure.path);

  const marks: MarkList = [
    [last?.replacementId, 'changed'],
    [focus?.elementBefore.id, 'focus'],
    [next?.redexId, 'redex'],
    [failedNode?.id, 'error'],
  ];

  return (
    <section className="panel stage" aria-labelledby="stage-title">
      <header className="panel-header">
        <h2 id="stage-title">Current expression</h2>
        <ul className="legend" aria-label="Highlight legend">
          {next && <li><span className="swatch swatch-redex" />reduces next</li>}
          {last && <li><span className="swatch swatch-changed" />just rewritten</li>}
          {focus && <li><span className="swatch swatch-focus" />active element</li>}
          {failedNode && <li><span className="swatch swatch-error" />stuck here</li>}
        </ul>
      </header>

      <div className="stage-expr">
        <CodeView expr={current.expr} marks={marks} label="Expression being reduced" className="code-xl" />
      </div>

      <div className="stage-footer">
        {next && (
          <p className="next-hint">
            <span className={`rule-chip rule-${next.rule}`}>{RULES[next.rule].symbol}</span>
            <span>
              <strong>Next:</strong> {next.description}
            </span>
          </p>
        )}
        {snapshot.status === 'done' && (
          <p className="result-banner" role="status">
            <span className="result-label">Final value</span>
            <code className="code">{printExpr(current.expr)}</code>
            <span className="muted">after {current.index} step{current.index === 1 ? '' : 's'}</span>
          </p>
        )}
        {failure && (
          <p className="error-banner" role="alert">
            <strong>{failure.error.kind}</strong> {failure.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
