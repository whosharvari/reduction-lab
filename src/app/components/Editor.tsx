/**
 * Lightweight code editor: a transparent <textarea> over a syntax-highlighted
 * <pre>, both using identical metrics. Highlighting uses the language's own
 * lexer, so it always matches what the parser accepts.
 */
import { useMemo, useRef } from 'react';
import type { LangError } from '../../lang';
import { buildSegments } from '../model/highlight';
import { Segments } from './CodeView';

interface EditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Cmd/Ctrl + Enter. */
  readonly onSubmit: () => void;
  readonly error?: LangError;
}

export function Editor({ value, onChange, onSubmit, error }: EditorProps) {
  const overlay = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const segments = useMemo(() => {
    const span = error?.span;
    // Show a one-character marker even for zero-width spans (e.g. unexpected end of input).
    const range = span && { start: span.start, end: Math.max(span.end, span.start + 1) };
    const text = range && range.start >= value.length ? `${value} ` : value;
    return buildSegments(text, new Map(), [], range ? [[range, 'error'] as const] : []);
  }, [value, error]);

  const lineCount = value.split('\n').length;

  return (
    <div className="editor">
      <div className="editor-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className={error?.span?.line === i + 1 ? 'has-error' : undefined}>
            {i + 1}
          </div>
        ))}
      </div>
      <div className="editor-body">
        <pre className="editor-highlight" ref={overlay} aria-hidden="true">
          <Segments segments={segments} />
          {'\n'}
        </pre>
        <textarea
          className="editor-input"
          aria-label="Program source"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'editor-error' : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            const { scrollTop, scrollLeft } = e.currentTarget;
            if (overlay.current) overlay.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
            if (gutter.current) gutter.current.style.transform = `translateY(${-scrollTop}px)`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>
    </div>
  );
}
