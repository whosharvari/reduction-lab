/**
 * AST -> source text, inserting only the parentheses the grammar needs.
 * `parse(printExpr(e))` is structurally equal to `e` (modulo ids/spans), which
 * is what lets the reducer show every intermediate expression as real code.
 */
import type { BinaryOperator, Expr, NodeId } from './ast';

// Higher binds tighter. Mirrors the parser in src/lang/parser.ts.
const PREC = {
  prefix: 0, // let, lambda, if
  or: 1,
  and: 2,
  compare: 3,
  additive: 4,
  term: 5,
  unary: 6,
  application: 7,
  atom: 8,
} as const;

const BINARY_PREC: Record<BinaryOperator, number> = {
  '||': PREC.or,
  '&&': PREC.and,
  '==': PREC.compare, '/=': PREC.compare, '<': PREC.compare, '<=': PREC.compare, '>': PREC.compare, '>=': PREC.compare,
  '+': PREC.additive, '-': PREC.additive,
  '*': PREC.term, '/': PREC.term,
};

export function precedence(expr: Expr): number {
  switch (expr.kind) {
    case 'Number':
      return expr.value < 0 || Object.is(expr.value, -0) ? PREC.unary : PREC.atom;
    case 'Boolean':
    case 'Var':
    case 'List':
      return PREC.atom;
    case 'App':
      return PREC.application;
    case 'Unary':
      return PREC.unary;
    case 'Binary':
      return BINARY_PREC[expr.op];
    case 'Lambda':
    case 'Let':
    case 'If':
      return PREC.prefix;
  }
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Trim binary-float noise such as 0.1 + 0.2 = 0.30000000000000004.
  return String(Number(n.toPrecision(12)));
}

export function printExpr(expr: Expr): string {
  return printWithRanges(expr).text;
}

/** Character range `[start, end)` of a node within printed text (parentheses excluded). */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface PrintedExpr {
  readonly text: string;
  /** Where each node ended up in `text`, keyed by node id. */
  readonly ranges: ReadonlyMap<NodeId, TextRange>;
}

/** Print and record each node's range, so the UI can highlight redexes in rewritten code. */
export function printWithRanges(expr: Expr): PrintedExpr {
  const writer = new Writer();
  writer.print(expr, PREC.prefix);
  return { text: writer.text, ranges: writer.ranges };
}

class Writer {
  text = '';
  readonly ranges = new Map<NodeId, TextRange>();

  private emit(s: string): void {
    this.text += s;
  }

  print(expr: Expr, context: number): void {
    const parens = precedence(expr) < context;
    if (parens) this.emit('(');
    const start = this.text.length;
    this.printBare(expr);
    this.ranges.set(expr.id, { start, end: this.text.length });
    if (parens) this.emit(')');
  }

  private printBare(expr: Expr): void {
    switch (expr.kind) {
      case 'Number':
        return this.emit(Object.is(expr.value, -0) ? '-0' : formatNumber(expr.value));
      case 'Boolean':
        return this.emit(expr.value ? 'True' : 'False');
      case 'Var':
        return this.emit(expr.name);
      case 'List':
        this.emit('[');
        expr.elements.forEach((element, i) => {
          if (i > 0) this.emit(', ');
          this.print(element, PREC.prefix);
        });
        return this.emit(']');
      case 'Lambda':
        this.emit(`\\${expr.param} -> `);
        return this.print(expr.body, PREC.prefix);
      case 'Let':
        this.emit(`let ${expr.name} = `);
        this.print(expr.value, PREC.prefix);
        this.emit(' in ');
        return this.print(expr.body, PREC.prefix);
      case 'If':
        this.emit('if ');
        this.print(expr.cond, PREC.prefix);
        this.emit(' then ');
        this.print(expr.thenBranch, PREC.prefix);
        this.emit(' else ');
        return this.print(expr.elseBranch, PREC.prefix);
      case 'App':
        this.print(expr.fn, PREC.application);
        this.emit(' ');
        return this.print(expr.arg, PREC.atom);
      case 'Unary':
        // Operand is printed at a tighter level so `-(-x)` never becomes `--x` (a comment).
        this.emit('-');
        return this.print(expr.operand, PREC.application);
      case 'Binary': {
        const p = BINARY_PREC[expr.op];
        const rightAssoc = expr.op === '&&' || expr.op === '||';
        const nonAssoc = p === PREC.compare;
        this.print(expr.left, rightAssoc || nonAssoc ? p + 1 : p);
        this.emit(` ${expr.op} `);
        return this.print(expr.right, rightAssoc ? p : p + 1);
      }
    }
  }
}
