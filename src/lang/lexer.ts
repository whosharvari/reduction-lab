/**
 * Tokenizer: source text -> flat token list (always terminated by an `eof` token).
 */
import { syntaxError, type Span } from './errors';

export const KEYWORDS = ['let', 'in', 'if', 'then', 'else', 'True', 'False'] as const;
export type Keyword = (typeof KEYWORDS)[number];

/** Ordered longest-first so that `->` wins over `-`, `<=` over `<`, and so on. */
export const SYMBOLS = [
  '->', '==', '/=', '!=', '<=', '>=', '&&', '||',
  '\\', '(', ')', '[', ']', ',', '=', '+', '-', '*', '/', '<', '>',
] as const;
/** `!=` is accepted as an alias and normalised to `/=` by the lexer. */
export type SymbolText = Exclude<(typeof SYMBOLS)[number], '!='>;

export type TokenType = 'number' | 'ident' | Keyword | SymbolText | 'eof';

export interface Token {
  readonly type: TokenType;
  /** Raw text for numbers/identifiers; the symbol or keyword otherwise. */
  readonly text: string;
  readonly span: Span;
}

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_']/.test(c);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  const advance = (count: number) => {
    for (let i = 0; i < count; i++) {
      if (source[pos] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      pos++;
    }
  };

  while (pos < source.length) {
    const c = source[pos]!;

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      advance(1);
      continue;
    }

    // Haskell-style line comment: `-- ...` up to end of line.
    if (source.startsWith('--', pos)) {
      while (pos < source.length && source[pos] !== '\n') advance(1);
      continue;
    }

    const start = pos;
    const startLine = line;
    const startColumn = column;
    const spanTo = (end: number): Span => ({ start, end, line: startLine, column: startColumn });

    if (isDigit(c)) {
      let end = pos;
      while (end < source.length && isDigit(source[end]!)) end++;
      if (source[end] === '.' && isDigit(source[end + 1] ?? '')) {
        end++;
        while (end < source.length && isDigit(source[end]!)) end++;
      }
      if (end < source.length && isIdentStart(source[end]!)) {
        let bad = end;
        while (bad < source.length && isIdentPart(source[bad]!)) bad++;
        throw syntaxError(`Invalid number literal '${source.slice(start, bad)}'`, spanTo(bad));
      }
      tokens.push({ type: 'number', text: source.slice(start, end), span: spanTo(end) });
      advance(end - start);
      continue;
    }

    if (isIdentStart(c)) {
      let end = pos;
      while (end < source.length && isIdentPart(source[end]!)) end++;
      const text = source.slice(start, end);
      const type: TokenType = KEYWORD_SET.has(text) ? (text as Keyword) : 'ident';
      tokens.push({ type, text, span: spanTo(end) });
      advance(end - start);
      continue;
    }

    const symbol = SYMBOLS.find((s) => source.startsWith(s, pos));
    if (symbol) {
      const normalised: SymbolText = symbol === '!=' ? '/=' : symbol;
      tokens.push({ type: normalised, text: normalised, span: spanTo(pos + symbol.length) });
      advance(symbol.length);
      continue;
    }

    throw syntaxError(`Unexpected character '${c}'`, spanTo(pos + 1));
  }

  tokens.push({ type: 'eof', text: '', span: { start: pos, end: pos, line, column } });
  return tokens;
}
