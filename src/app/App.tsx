/**
 * Reduction Lab workspace. All execution goes through the language engine's
 * ExecutionController (via useExecution); the UI only renders its snapshots.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isLangError, parse, runtimeError, type LangError } from '../lang';
import { Controls } from './components/Controls';
import { Editor } from './components/Editor';
import { HistoryPanel } from './components/HistoryPanel';
import { Inspector } from './components/Inspector';
import { FoldVisual, MapVisual } from './components/ListViews';
import { Stage } from './components/Stage';
import { SyntaxTree } from './components/SyntaxTree';
import { DEFAULT_EXAMPLE, EXAMPLES, type Example } from './examples';
import { deriveFoldView, deriveMapView, type Position } from './model/visualization';
import { EXECUTION_LIMITS, useExecution } from './useExecution';

const INTRO_KEY = 'reduction-lab:intro-dismissed';

function readIntroDismissed(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

function syntaxErrorOf(source: string): LangError | undefined {
  try {
    parse(source);
    return undefined;
  } catch (error) {
    if (isLangError(error)) return error;
    return runtimeError(`Internal error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function App() {
  const [example, setExample] = useState<Example>(DEFAULT_EXAMPLE);
  const [code, setCode] = useState(DEFAULT_EXAMPLE.source);
  const [view, activity, actions] = useExecution(DEFAULT_EXAMPLE.source);
  const [vizTab, setVizTab] = useState<'list' | 'tree'>('list');
  const [introHidden, setIntroHidden] = useState(readIntroDismissed);

  const dirty = code !== view.source;
  const liveError = useMemo(() => syntaxErrorOf(code), [code]);
  const snapshot = view.snapshot;

  const position = useMemo<Position | undefined>(() => {
    if (!snapshot) return undefined;
    const failure = snapshot.status === 'error' && snapshot.outcome?.status === 'error' ? snapshot.outcome : undefined;
    return {
      history: view.history,
      index: snapshot.index,
      ...(snapshot.next ? { next: snapshot.next } : {}),
      ...(failure ? { failure } : {}),
    };
  }, [snapshot, view.history]);
  const mapView = useMemo(() => position && deriveMapView(position), [position]);
  const foldView = useMemo(() => position && deriveFoldView(position), [position]);

  const restart = () => actions.load(code);
  // Stable identity so the memoised editor does not re-render on every step.
  const restartRef = useRef(restart);
  restartRef.current = restart;
  const submitFromEditor = useCallback(() => restartRef.current(), []);
  // Running edited code that does not parse would throw away a valid history; the editor already shows the error.
  const canRunEdited = !(dirty && liveError);
  const runAll = () => {
    if (canRunEdited) actions.run(code);
  };

  const selectExample = (next: Example) => {
    setExample(next);
    setCode(next.source);
    actions.load(next.source);
  };

  // Global stepping shortcuts (ignored while typing in the editor or a form control).
  const shortcuts = useRef({ actions, runAll });
  shortcuts.current = { actions, runAll };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest('textarea, input, select');
      if (e.metaKey || e.ctrlKey || e.altKey || typing) return;
      const { actions: a, runAll: run } = shortcuts.current;
      const handlers: Record<string, () => void> = { ArrowRight: a.next, ArrowLeft: a.previous, Home: a.reset, End: run };
      const handler = handlers[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hideIntro = () => {
    setIntroHidden(true);
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      // Storage unavailable (private mode etc.): the intro simply reappears next visit.
    }
  };

  const hasListViz = !!(mapView || foldView);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">λ</span>
          <div>
            <h1>Reduction Lab</h1>
            <p className="tagline">Every expression has a story. Watch it unfold.</p>
          </div>
        </div>
        <p className="topbar-keys muted" aria-label="Keyboard shortcuts">
          <kbd>→</kbd> next · <kbd>←</kbd> previous · <kbd>Home</kbd> reset · <kbd>End</kbd> run · <kbd>⌘/Ctrl</kbd>+<kbd>↵</kbd> load code
        </p>
      </header>

      {!introHidden && (
        <aside className="intro" aria-label="How to use Reduction Lab">
          <div>
            <strong>Each Next step performs one real reduction.</strong>{' '}
            The interpreter rewrites the expression in place, exactly as the language semantics dictate: no pre-recorded
            animation. Amber marks what reduces next, blue what was just rewritten.
          </div>
          <ol className="intro-steps">
            <li>Pick an example or write your own code.</li>
            <li>
              Press <strong>Next step</strong> (or <kbd>→</kbd>) to reduce once; <strong>Previous</strong> restores the
              earlier state.
            </li>
            <li>
              <strong>Run to end</strong> finishes the program; click any entry in History to jump back to it.
            </li>
          </ol>
          <button type="button" className="btn btn-ghost intro-close" onClick={hideIntro} aria-label="Dismiss introduction">
            Got it
          </button>
        </aside>
      )}

      <main className="workspace">
        <div className="col col-source">
          <section className="panel" aria-labelledby="examples-title">
            <header className="panel-header">
              <h2 id="examples-title">Examples</h2>
            </header>
            <ul className="examples">
              {EXAMPLES.map((ex) => (
                <li key={ex.id}>
                  <button
                    type="button"
                    className={`example${ex.id === example.id ? ' is-selected' : ''}`}
                    aria-pressed={ex.id === example.id}
                    aria-label={`${ex.title} (${ex.concept})`}
                    onClick={() => selectExample(ex)}
                  >
                    <span className="example-title">{ex.title}</span>
                    <span className="example-concept">{ex.concept}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="editor-title">
            <header className="panel-header">
              <h2 id="editor-title">Program</h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCode(example.source)}
                disabled={code === example.source}
              >
                Reset to example
              </button>
            </header>
            <p className="example-explanation">
              <span className="example-concept">{example.concept}</span> {example.explanation}
            </p>
            <Editor value={code} onChange={setCode} onSubmit={submitFromEditor} {...(liveError ? { error: liveError } : {})} />
            {liveError ? (
              <pre className="error-box" id="editor-error" role="alert">
                {liveError.format(code)}
              </pre>
            ) : (
              <p className="muted editor-hint">
                {dirty ? (
                  <>
                    Code changed. Press <strong>Restart</strong> or <kbd>⌘/Ctrl</kbd>+<kbd>↵</kbd> to step through it.
                  </>
                ) : (
                  <>Parsed successfully. The stepper is showing this program.</>
                )}
              </p>
            )}
          </section>
        </div>

        <div className="col col-main">
          <Controls
            snapshot={snapshot}
            activity={activity}
            actions={actions}
            onRestart={restart}
            onRun={runAll}
            dirty={dirty}
            canRunEdited={canRunEdited}
          />

          {snapshot ? (
            <>
              <Stage snapshot={snapshot} />

              <section className="panel" aria-labelledby="viz-title">
                <header className="panel-header">
                  <h2 id="viz-title">Visualise</h2>
                  <div className="tabs" role="tablist" aria-label="Visualisation">
                    <button
                      type="button"
                      role="tab"
                      id="tab-list"
                      aria-controls="viz-panel"
                      aria-selected={vizTab === 'list'}
                      className="tab"
                      onClick={() => setVizTab('list')}
                    >
                      Lists
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="tab-tree"
                      aria-controls="viz-panel"
                      aria-selected={vizTab === 'tree'}
                      className="tab"
                      onClick={() => setVizTab('tree')}
                    >
                      Syntax tree
                    </button>
                  </div>
                </header>
                <div id="viz-panel" role="tabpanel" aria-labelledby={vizTab === 'list' ? 'tab-list' : 'tab-tree'}>
                {vizTab === 'list' ? (
                  hasListViz ? (
                    <div className="viz-stack">
                      {foldView && <FoldVisual view={foldView} />}
                      {mapView && <MapVisual view={mapView} />}
                    </div>
                  ) : (
                    <p className="muted empty">
                      No map or fold at this point of the reduction. Try the Map or Fold example, or open the syntax tree.
                    </p>
                  )
                ) : (
                  <SyntaxTree snapshot={snapshot} />
                )}
                </div>
              </section>
            </>
          ) : (
            <section className="panel stage" aria-label="Current expression">
              <p className="error-banner" role="alert">
                <strong>{view.parseError?.kind}</strong> {view.parseError?.message}
              </p>
              <p className="muted">Fix the program and press Restart to step through it.</p>
            </section>
          )}
        </div>

        <div className="col col-side">
          {snapshot && <Inspector snapshot={snapshot} {...(mapView ? { mapView } : {})} {...(foldView ? { foldView } : {})} />}
          {snapshot && (
            <HistoryPanel
              history={view.history}
              index={snapshot.index}
              finished={snapshot.finished}
              onSelect={actions.goTo}
              disabled={activity === 'running'}
            />
          )}
        </div>
      </main>

      <footer className="footer muted">
        Runs entirely in your browser. Strict, call-by-value, left-to-right reduction · limit: {EXECUTION_LIMITS.maxSteps} steps
      </footer>
    </div>
  );
}
