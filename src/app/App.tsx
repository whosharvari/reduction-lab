/**
 * Phase 1 shell: edit an expression and evaluate it with the real interpreter.
 * The step-by-step reduction view arrives in later phases.
 */
import { useMemo, useState } from 'react';
import { interpret, printExpr } from '../lang';
import { EXAMPLES } from './examples';

export function App() {
  const [source, setSource] = useState(EXAMPLES[2]!.source);
  const [submitted, setSubmitted] = useState(source);
  const result = useMemo(() => interpret(submitted), [submitted]);

  const run = () => setSubmitted(source);

  return (
    <main className="shell">
      <header>
        <h1>Reduction Lab</h1>
        <p className="tagline">A tiny Haskell-like language, evaluated for real.</p>
      </header>

      <section className="examples" aria-label="Examples">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className="chip"
            onClick={() => {
              setSource(example.source);
              setSubmitted(example.source);
            }}
          >
            {example.label}
          </button>
        ))}
      </section>

      <label className="editor-label" htmlFor="editor">
        Expression <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to run
      </label>
      <textarea
        id="editor"
        className="editor"
        spellCheck={false}
        value={source}
        rows={4}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            run();
          }
        }}
      />
      <button type="button" className="run" onClick={run}>
        Evaluate
      </button>

      <section className="output" aria-live="polite">
        {result.ast && (
          <div className="row">
            <span className="label">Parsed as</span>
            <code>{printExpr(result.ast)}</code>
          </div>
        )}
        {result.ok ? (
          <div className="row">
            <span className="label">Result</span>
            <code className="value">{result.display}</code>
          </div>
        ) : (
          <pre className="error">{result.error.format(submitted)}</pre>
        )}
      </section>
    </main>
  );
}
