/**
 * Phase 4 audit: regression tests for bugs found, plus randomized differential
 * tests that compare the big-step evaluator against the small-step reducer.
 */
import { describe, expect, it } from 'vitest';
import {
  children,
  evaluate,
  ExecutionController,
  formatNumber,
  formatValue,
  isLangError,
  LangError,
  MAX_NESTING,
  MAX_TREE_DEPTH,
  parse,
  printExpr,
  tokenize,
  traceReduction,
  type Expr,
  type Value,
} from '../src/lang';
import { rng, typedProgram, untypedProgram } from './generators';

function syntaxErrorOf(source: string): LangError {
  try {
    parse(source);
  } catch (error) {
    expect(error).toBeInstanceOf(LangError);
    return error as LangError;
  }
  throw new Error('expected a syntax error');
}

describe('deeply nested input never overflows the JavaScript stack', () => {
  // Bug: these inputs threw a raw RangeError, which crashed the UI (it parses on every keystroke).
  it('deep parentheses are a SyntaxError', () => {
    const error = syntaxErrorOf('('.repeat(5000) + '1' + ')'.repeat(5000));
    expect(error.kind).toBe('SyntaxError');
    expect(error.message).toMatch(/nested too deeply/);
  });

  it('long unary-minus chains are a SyntaxError', () => {
    expect(syntaxErrorOf(Array(5000).fill('- ').join('') + '1').message).toMatch(/nested too deeply/);
  });

  it('long || and && chains are a SyntaxError, not a stack overflow', () => {
    // Regression: right-associative operators recursed in the parser outside the nesting guard.
    for (const op of ['||', '&&']) {
      const error = syntaxErrorOf(Array(12_000).fill('True').join(` ${op} `));
      expect(error.message).toMatch(/too deeply nested \(12000 levels/);
    }
    // ...while keeping right associativity: a || b || c is a || (b || c).
    const tree = parse('a || b || c') as Extract<Expr, { kind: 'Binary' }>;
    expect(tree.left).toMatchObject({ kind: 'Var', name: 'a' });
    expect(tree.right).toMatchObject({ kind: 'Binary', op: '||' });
    expect(printExpr(parse('(a || b) || c'))).toBe('(a || b) || c');
    expect(formatValue(evaluate(parse(Array(900).fill('False').join(' || ') + ' || True')))).toBe('True');
  });

  it('long operator chains (deep trees built iteratively) are a SyntaxError', () => {
    // Bug: parsed fine, then the printer and reducer overflowed.
    const error = syntaxErrorOf(Array(6000).fill('1').join(' + '));
    expect(error.message).toBe(`The program is too deeply nested (6000 levels; the limit is ${MAX_TREE_DEPTH})`);
  });

  it('inputs just inside the limits still work in both engines', () => {
    const chain = Array(MAX_TREE_DEPTH - 1).fill('1').join(' + ');
    expect(formatValue(evaluate(parse(chain)))).toBe(String(MAX_TREE_DEPTH - 1));
    const outcome = ExecutionController.fromSource(chain).runToCompletion();
    expect(outcome.status === 'done' && printExpr(outcome.expr)).toBe(String(MAX_TREE_DEPTH - 1));
    const parens = '('.repeat(MAX_NESTING - 10) + '7' + ')'.repeat(MAX_NESTING - 10);
    expect(printExpr(parse(parens))).toBe('7');
  }, 20_000); // ~1000 steps over a 1000-deep tree: deliberately the heaviest supported input

  it('a reduction that grows too deep ends with a RuntimeError, keeping its history', () => {
    // Bug: the controller threw RangeError mid-run (the UI's Run loop died with it).
    const elements = Array(1500).fill('1').join(', ');
    const c = ExecutionController.fromSource(`fold (\\a -> \\x -> [a, x]) [] [${elements}]`);
    const outcome = c.runToCompletion();
    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' && outcome.error.kind).toBe('RuntimeError');
    expect(outcome.status === 'error' && outcome.error.message).toMatch(/grew deeper than 1000 levels/);
    expect(c.previous()).toBe(true); // still navigable
    expect(c.current.source.length).toBeGreaterThan(0);
  });

  it('a programmatically built over-deep AST is rejected, not crashed on', () => {
    let expr: Expr = { kind: 'Number', id: 1, span: { start: 0, end: 1, line: 1, column: 1 }, value: 1 };
    for (let i = 2; i < 20_000; i++) {
      expr = { kind: 'Unary', id: i, span: expr.span, op: '-', operand: expr };
    }
    const c = new ExecutionController(expr);
    expect(c.finished).toBe(true);
    expect(c.outcome?.status === 'error' && c.outcome.error.message).toMatch(/too deeply nested/);
  });
});

describe('controller edge cases', () => {
  it('goTo(NaN) leaves the cursor where it was', () => {
    // Bug: the cursor became NaN and `current` was undefined.
    const c = ExecutionController.fromSource('(1 + 2) * 3');
    c.next();
    expect(c.goTo(Number.NaN).source).toBe('3 * 3');
    expect(c.index).toBe(1);
    expect(c.goTo(Number.POSITIVE_INFINITY).source).toBe('9');
    expect(c.goTo(Number.NEGATIVE_INFINITY).index).toBe(0);
  });
});

describe('number display', () => {
  it('negative zero displays as 0 in both engines', () => {
    // Bug: the reducer showed `-0` where the evaluator showed `0`.
    for (const source of ['0 * -1', '-0', '-(1 - 1)', '[0 * -5]']) {
      const outcome = ExecutionController.fromSource(source).runToCompletion();
      expect(outcome.status === 'done' && printExpr(outcome.expr)).toBe(formatValue(evaluate(parse(source))));
    }
    expect(formatNumber(-0)).toBe('0');
  });

  it('finite numbers always print as re-readable literals (no exponent notation)', () => {
    // Bug: 1e+24 / 1e-7 were printed, which the lexer cannot read back.
    // Integers print exactly; non-integers print their 12-significant-digit display value.
    const finite = [1e24, -1e24, 2 ** 70, Number.MAX_VALUE, 1e-7, -2.5e-8, 1.5e-10, 1e-99, 1e-101, 1e-200, -1e-200, 5e-324, 123.456, 0.1 + 0.2, 1 / 3];
    for (const n of finite) {
      const text = formatNumber(n);
      expect(text).not.toMatch(/e/i);
      expect(tokenize(text.replace(/^-/, '')).map((t) => t.type)).toEqual(['number', 'eof']);
      const expected = Number.isInteger(n) ? n : Number(n.toPrecision(12));
      expect(Number(text), `${n} printed as ${text}`).toBe(expected); // exact, not approximate
    }
    // Regression: magnitudes below 1e-100 printed as 0 / -0 (toFixed is capped at 100 decimals).
    expect(formatNumber(5e-324)).not.toBe('0');
    expect(formatNumber(-1e-200).startsWith('-0.')).toBe(true);
    expect(printExpr(parse('1000000000000 * 1000000000000'))).toBe('1000000000000 * 1000000000000');
    const big = ExecutionController.fromSource('1000000000000 * 1000000000000').runToCompletion();
    expect(big.status === 'done' && printExpr(parse(printExpr(big.expr)))).toBe(printExpr(big.expr));
  });
});

describe('error messages', () => {
  it('explains how to pass a lambda as an argument', () => {
    expect(syntaxErrorOf('map \\x -> x * 2 [1]').message).toBe(
      "Unexpected '\\' after the end of the expression. To pass a lambda as an argument, wrap it in parentheses",
    );
    expect(syntaxErrorOf('f if True then 1 else 2').message).toMatch(/To pass a 'if' expression as an argument/);
  });

  it('a `--` sequence starts a comment (documented, Haskell-compatible)', () => {
    expect(formatValue(evaluate(parse('5 --2')))).toBe('5');
    expect(formatValue(evaluate(parse('5 - -2')))).toBe('7');
  });
});

// ---- differential testing ---------------------------------------------------

function valueShape(value: Value): unknown {
  if (value.kind === 'number' || value.kind === 'boolean') return formatValue(value);
  if (value.kind === 'list') return value.elements.map(valueShape);
  return 'function';
}

function exprShape(expr: Expr): unknown {
  if (expr.kind === 'Number' || expr.kind === 'Boolean') return printExpr(expr);
  if (expr.kind === 'List') return expr.elements.map(exprShape);
  return 'function';
}

function ids(expr: Expr, into: number[] = []): number[] {
  into.push(expr.id);
  for (const child of children(expr)) ids(child, into);
  return into;
}

function checkAgreement(source: string): 'value' | 'error' {
  const ast = parse(source);
  let expected: unknown;
  try {
    expected = { value: valueShape(evaluate(ast)) };
  } catch (error) {
    if (!isLangError(error)) throw error;
    expected = { error: error.kind };
  }
  const trace = traceReduction(ast, { maxSteps: 3000 });
  const actual =
    trace.outcome.status === 'done' ? { value: exprShape(trace.outcome.expr) } : { error: trace.outcome.error.kind };
  expect(actual, source).toEqual(expected);

  for (const step of trace.steps) {
    const printed = printExpr(step.after);
    expect(printExpr(parse(printed)), source).toBe(printed); // every state is real source
    const all = ids(step.after);
    expect(new Set(all).size, source).toBe(all.length); // node ids stay unique
  }
  return trace.outcome.status === 'done' ? 'value' : 'error';
}

describe('randomized differential testing: evaluator vs reducer', () => {
  it('agree on 400 arbitrary (mostly ill-typed) programs', () => {
    const outcomes = { value: 0, error: 0 };
    for (let seed = 1; seed <= 400; seed++) outcomes[checkAgreement(untypedProgram(rng(seed)))]++;
    expect(outcomes.error).toBeGreaterThan(50); // the generator really exercises error paths
  });

  it('agree on 400 well-typed programs with closures, shadowing, map and fold', () => {
    const outcomes = { value: 0, error: 0 };
    for (let seed = 1; seed <= 400; seed++) outcomes[checkAgreement(typedProgram(rng(seed)))]++;
    expect(outcomes.value).toBeGreaterThan(300); // ...and successful reductions
  });
});
