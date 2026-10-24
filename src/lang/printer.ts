/**
 * AST -> source text, inserting only the parentheses the grammar needs.
 * `parse(printExpr(e))` is structurally equal to `e` (modulo ids/spans), which
 * is what lets the reducer show every intermediate expression as real code.
 */
import type { BinaryOperator, Expr } from './ast';

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
  return print(expr, PREC.prefix);
}

function print(expr: Expr, context: number): string {
  const text = printBare(expr);
  return precedence(expr) < context ? `(${text})` : text;
}

function printBare(expr: Expr): string {
  switch (expr.kind) {
    case 'Number':
      return Object.is(expr.value, -0) ? '-0' : formatNumber(expr.value);
    case 'Boolean':
      return expr.value ? 'True' : 'False';
    case 'Var':
      return expr.name;
    case 'List':
      return `[${expr.elements.map((e) => print(e, PREC.prefix)).join(', ')}]`;
    case 'Lambda':
      return `\\${expr.param} -> ${print(expr.body, PREC.prefix)}`;
    case 'Let':
      return `let ${expr.name} = ${print(expr.value, PREC.prefix)} in ${print(expr.body, PREC.prefix)}`;
    case 'If':
      return `if ${print(expr.cond, PREC.prefix)} then ${print(expr.thenBranch, PREC.prefix)} else ${print(expr.elseBranch, PREC.prefix)}`;
    case 'App':
      return `${print(expr.fn, PREC.application)} ${print(expr.arg, PREC.atom)}`;
    case 'Unary':
      // Operand is printed at a tighter level so `-(-x)` never becomes `--x` (a comment).
      return `-${print(expr.operand, PREC.application)}`;
    case 'Binary': {
      const p = BINARY_PREC[expr.op];
      const rightAssoc = expr.op === '&&' || expr.op === '||';
      const nonAssoc = p === PREC.compare;
      const leftCtx = rightAssoc || nonAssoc ? p + 1 : p;
      const rightCtx = rightAssoc ? p : p + 1;
      return `${print(expr.left, leftCtx)} ${expr.op} ${print(expr.right, rightCtx)}`;
    }
  }
}
