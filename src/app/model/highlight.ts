/**
 * Turn text + node ranges into styled segments.
 *
 * Syntax colours come from the real lexer; highlight marks come from node ids
 * resolved through `printWithRanges`, never from substring searches, so two
 * identical sub-expressions are never confused.
 */
import { BUILTINS, tokenize, type NodeId, type TextRange, type TokenType } from '../../lang';

export type TokenClass = 'num' | 'bool' | 'kw' | 'builtin' | 'ident' | 'lambda' | 'op' | 'punct' | 'comment';
export type Mark = 'redex' | 'changed' | 'focus' | 'error';

export interface Segment {
  readonly text: string;
  readonly token?: TokenClass;
  readonly marks: readonly Mark[];
}

function classify(type: TokenType, text: string): TokenClass | undefined {
  switch (type) {
    case 'number':
      return 'num';
    case 'True':
    case 'False':
      return 'bool';
    case 'let':
    case 'in':
    case 'if':
    case 'then':
    case 'else':
      return 'kw';
    case 'ident':
      return Object.hasOwn(BUILTINS, text) ? 'builtin' : 'ident';
    case '\\':
    case '->':
      return 'lambda';
    case '(':
    case ')':
    case '[':
    case ']':
    case ',':
      return 'punct';
    case 'eof':
      return undefined;
    default:
      return 'op';
  }
}

/** Per-character token class. Falls back to unstyled text if the source does not lex. */
export function tokenClasses(text: string): Array<TokenClass | undefined> {
  const classes: Array<TokenClass | undefined> = new Array(text.length).fill(undefined);
  let tokens;
  try {
    tokens = tokenize(text);
  } catch {
    // Still colour comments so partially typed code stays readable.
    markComments(text, classes, 0, text.length);
    return classes;
  }
  let cursor = 0;
  for (const token of tokens) {
    markComments(text, classes, cursor, token.span.start);
    const cls = classify(token.type, token.text);
    for (let i = token.span.start; i < token.span.end; i++) classes[i] = cls;
    cursor = token.span.end;
  }
  return classes;
}

/** Gaps between tokens are whitespace or `--` comments. */
function markComments(text: string, classes: Array<TokenClass | undefined>, from: number, to: number): void {
  let i = from;
  while (i < to) {
    if (text.startsWith('--', i)) {
      while (i < to && text[i] !== '\n') classes[i++] = 'comment';
    } else {
      i++;
    }
  }
}

/** Split `text` into maximal runs with the same token class and marks. */
export function buildSegments(
  text: string,
  ranges: ReadonlyMap<NodeId, TextRange>,
  marks: ReadonlyArray<readonly [NodeId | undefined, Mark]>,
  extraRanges: ReadonlyArray<readonly [TextRange, Mark]> = [],
): Segment[] {
  const tokens = tokenClasses(text);
  const perChar: Mark[][] = Array.from({ length: text.length }, () => []);
  const apply = (range: TextRange | undefined, mark: Mark) => {
    if (!range) return;
    for (let i = Math.max(0, range.start); i < Math.min(text.length, range.end); i++) {
      if (!perChar[i]!.includes(mark)) perChar[i]!.push(mark);
    }
  };
  for (const [id, mark] of marks) if (id !== undefined) apply(ranges.get(id), mark);
  for (const [range, mark] of extraRanges) apply(range, mark);

  const segments: Array<{ text: string; token?: TokenClass; marks: Mark[] }> = [];
  for (let i = 0; i < text.length; i++) {
    const token = tokens[i];
    const charMarks = perChar[i]!;
    const last = segments.at(-1);
    if (last && last.token === token && sameMarks(last.marks, charMarks)) {
      last.text += text[i];
    } else {
      segments.push({ text: text[i]!, ...(token ? { token } : {}), marks: charMarks });
    }
  }
  return segments;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}
