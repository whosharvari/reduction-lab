/**
 * Reduction Spotlight: the step that produced the current state — which redex,
 * which rule, before → after, and why. Shares redex / replacement ids with the
 * main expression and the syntax tree, so all three always describe one step.
 */
import { useMemo } from 'react';
import type { Expr, ExecutionSnapshot } from '../../lang';
import { deriveSpotlight, type Part } from '../model/spotlight';
import { CodeView } from './CodeView';

const PREVIEW_CHARS = 240;

function Explanation({ parts }: { readonly parts: readonly Part[] }) {
  return (
    <p className="spotlight-explanation">
      {parts.map((p, i) => (typeof p === 'string' ? p : <code key={i} className="code">{p.code}</code>))}
    </p>
  );
}

type Mark = 'redex' | 'changed' | 'error';

/** The node as the syntax tree draws it: same label, same mark classes. */
function TreeBadge({ expr, label, marks, note }: { readonly expr: Expr; readonly label: string; readonly marks: readonly Mark[]; readonly note?: string }) {
  return (
    <span className="spotlight-tree">
      tree node <span className={`tree-label tree-${expr.kind.toLowerCase()} ${marks.map((m) => `m-${m}`).join(' ')}`}>{label}</span>
      {note && <span>{note}</span>}
    </span>
  );
}

export function Spotlight({ snapshot }: { readonly snapshot: ExecutionSnapshot }) {
  const view = useMemo(() => deriveSpotlight(snapshot), [snapshot]);

  return (
    <section className="panel spotlight" aria-labelledby="spotlight-title">
      <header className="panel-header">
        <h2 id="spotlight-title">Reduction spotlight</h2>
        {view.kind === 'step' && <span className="muted">step {view.index}</span>}
      </header>

      {view.kind === 'idle' && (
        <div className="spotlight-body" aria-label="No step applied yet">
          {view.next ? (
            <>
              <p className="spotlight-rule">
                <span className={`rule-chip rule-${view.next.rule}`}>{view.next.symbol}</span>
                <span>
                  First up: <strong>{view.next.name}</strong>
                </span>
                <TreeBadge expr={view.next.redex} label={view.next.treeLabel} marks={['redex']} />
              </p>
              <div className="spotlight-pair">
                <CodeView expr={view.next.redex} className="code-redex" label="Next redex" maxChars={PREVIEW_CHARS} />
              </div>
              <p className="muted spotlight-note">Press Next step to apply it; its before and after will appear here.</p>
            </>
          ) : (
            <p className="muted spotlight-note">
              {view.alreadyValue ? 'This program is already a value, so there is nothing to reduce.' : 'No step to show.'}
            </p>
          )}
        </div>
      )}

      {view.kind === 'step' && (
        <div className="spotlight-body" aria-label="Latest rewrite">
          <p className="spotlight-rule">
            <span className={`rule-chip rule-${view.rule}`}>{view.symbol}</span>
            <strong>{view.name}</strong>
            <TreeBadge
              expr={view.replacement}
              label={view.treeLabel}
              marks={view.replacementIsNext ? ['changed', 'redex'] : ['changed']}
              {...(view.replacementIsNext ? { note: '· reduces next' } : {})}
            />
          </p>
          <div className="spotlight-pair">
            <span className="spotlight-side">
              <span className="spotlight-label">Before</span>
              <CodeView expr={view.redex} className="code-redex" label="Redex" maxChars={PREVIEW_CHARS} />
            </span>
            <span className="spotlight-arrow" aria-hidden="true">⟶</span>
            <span className="spotlight-side">
              <span className="spotlight-label">After</span>
              <CodeView expr={view.replacement} className="code-changed" label="Replacement" maxChars={PREVIEW_CHARS} />
            </span>
          </div>
          <Explanation parts={view.explanation} />
          {view.context.id !== view.redexId && (
            <div className="spotlight-context">
              <span className="spotlight-label">In</span>
              <CodeView expr={view.context} marks={[[view.redexId, 'redex']]} label="Expression before the latest step" />
            </div>
          )}
          {view.completes && (
            <p className="spotlight-note spotlight-done" role="status">
              That was the final step: the expression is now a value.
            </p>
          )}
        </div>
      )}

      {view.kind === 'error' && (
        <div className="spotlight-body" aria-label="Stuck reduction">
          <p className="spotlight-rule">
            <span className="rule-chip rule-stuck">!</span>
            <strong>No reduction possible</strong>
            {view.stuck && view.stuckLabel && <TreeBadge expr={view.stuck} label={view.stuckLabel} marks={['error']} />}
          </p>
          {view.stuck && (
            <div className="spotlight-pair">
              <span className="spotlight-side">
                <span className="spotlight-label">Stuck at</span>
                <CodeView expr={view.stuck} className="code-error" label="Stuck redex" maxChars={PREVIEW_CHARS} />
              </span>
            </div>
          )}
          <p className="spotlight-explanation error-text">
            <strong>{view.errorKind}</strong>: {view.message}
          </p>
          {view.context.id !== view.stuckId && (
            <div className="spotlight-context">
              <span className="spotlight-label">In</span>
              <CodeView expr={view.context} marks={view.stuckId !== undefined ? [[view.stuckId, 'error']] : []} label="Expression where reduction is stuck" />
            </div>
          )}
          {view.lastStep && (
            <p className="muted spotlight-note">
              The last successful step was step {view.lastStep.index} ({view.lastStep.name}); press Previous to inspect it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
