/**
 * Structured errors shared by every stage of the interpreter.
 *
 * Every error carries a `kind` (so callers can branch without `instanceof`
 * chains) and, whenever the failing construct is known, the source span it
 * came from so the UI can underline it.
 */

/** A half-open character range `[start, end)` plus the 1-based line/column of `start`. */
export interface Span {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}

export type ErrorKind =
  /** Malformed source: bad characters, unexpected tokens, unclosed brackets. */
  | 'SyntaxError'
  /** Reference to a variable that is not bound in the current lexical scope. */
  | 'NameError'
  /** An operation was applied to a value of the wrong shape (e.g. `5 3`, `1 + True`). */
  | 'TypeError'
  /** A well-typed operation failed at runtime (division by zero, runaway recursion). */
  | 'RuntimeError';

export class LangError extends Error {
  readonly kind: ErrorKind;
  readonly span: Span | undefined;

  constructor(kind: ErrorKind, message: string, span?: Span) {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.span = span;
  }

  /** `TypeError at 1:3: message`, optionally followed by a code frame with a caret. */
  format(source?: string): string {
    const where = this.span ? ` at ${this.span.line}:${this.span.column}` : '';
    const header = `${this.kind}${where}: ${this.message}`;
    if (!source || !this.span) return header;
    return `${header}\n${codeFrame(source, this.span)}`;
  }

  /** Plain-object form, safe to `JSON.stringify` or post across a worker boundary. */
  toJSON(): { kind: ErrorKind; message: string; span?: Span } {
    return this.span
      ? { kind: this.kind, message: this.message, span: this.span }
      : { kind: this.kind, message: this.message };
  }
}

export const syntaxError = (message: string, span?: Span) => new LangError('SyntaxError', message, span);
export const nameError = (message: string, span?: Span) => new LangError('NameError', message, span);
export const typeError = (message: string, span?: Span) => new LangError('TypeError', message, span);
export const runtimeError = (message: string, span?: Span) => new LangError('RuntimeError', message, span);

export function isLangError(value: unknown): value is LangError {
  return value instanceof LangError;
}

/** Render the offending source line with `^^^` under the span (clipped to that line). */
export function codeFrame(source: string, span: Span): string {
  const lines = source.split('\n');
  const text = lines[span.line - 1] ?? '';
  const gutter = String(span.line);
  const width = Math.max(1, Math.min(span.end - span.start, text.length - (span.column - 1)));
  const pad = ' '.repeat(gutter.length);
  return `${gutter} | ${text}\n${pad} | ${' '.repeat(span.column - 1)}${'^'.repeat(width)}`;
}
