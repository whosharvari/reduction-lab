/**
 * Big-step, environment-based evaluator: Expr -> Value.
 *
 * Semantics: strict (call-by-value), left-to-right. In an application the
 * function is evaluated before the argument; in a binary operation the left
 * operand before the right. `&&`, `||` and `if` evaluate only what they need.
 *
 * This is the *reference semantics*. The Phase 2 small-step reducer must reach
 * the same final value for every program (see src/lang/reduction/types.ts).
 */
import type { ArithmeticOperator, Binary, Expr } from './ast';
import { BUILTINS, createGlobalEnvironment } from './builtins';
import type { Environment } from './environment';
import { LangError, nameError, runtimeError, typeError, type Span } from './errors';
import { bool, formatValue, list, num, typeName, type Value } from './values';

export interface EvalOptions {
  /** Maximum nesting of evaluation (guards against runaway recursion). */
  readonly maxDepth?: number;
}

export const DEFAULT_MAX_DEPTH = 2000;

export function evaluate(expr: Expr, env: Environment = createGlobalEnvironment(), options: EvalOptions = {}): Value {
  const evaluator = new Evaluator(options.maxDepth ?? DEFAULT_MAX_DEPTH);
  try {
    return evaluator.eval(expr, env);
  } catch (error) {
    if (error instanceof RangeError) {
      // The JS stack overflowed before our own depth limit did.
      throw runtimeError('Evaluation is nested too deeply (possible infinite recursion)', expr.span);
    }
    throw error;
  }
}

function describe(value: Value): string {
  return `${typeName(value)} ${formatValue(value)}`;
}

class Evaluator {
  private depth = 0;
  private readonly maxDepth: number;

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  eval(expr: Expr, env: Environment): Value {
    if (++this.depth > this.maxDepth) {
      throw runtimeError(
        `Evaluation exceeded the maximum depth of ${this.maxDepth} (possible infinite recursion)`,
        expr.span,
      );
    }
    try {
      return this.evalNode(expr, env);
    } finally {
      this.depth--;
    }
  }

  private evalNode(expr: Expr, env: Environment): Value {
    switch (expr.kind) {
      case 'Number':
        return num(expr.value);
      case 'Boolean':
        return bool(expr.value);
      case 'List':
        return list(expr.elements.map((element) => this.eval(element, env)));
      case 'Var': {
        const value = env.lookup(expr.name);
        if (value === undefined) throw undefinedVariable(expr.name, env, expr.span);
        return value;
      }
      case 'Lambda':
        return { kind: 'closure', param: expr.param, body: expr.body, env };
      case 'App': {
        const fn = this.eval(expr.fn, env);
        const arg = this.eval(expr.arg, env);
        return this.apply(fn, arg, expr.span);
      }
      case 'Let': {
        // Non-recursive: `value` is evaluated in the outer environment.
        const value = this.eval(expr.value, env);
        return this.eval(expr.body, env.extend(expr.name, value));
      }
      case 'If': {
        const cond = this.eval(expr.cond, env);
        if (cond.kind !== 'boolean') {
          throw typeError(`The condition of 'if' must be a boolean, but got ${describe(cond)}`, expr.cond.span);
        }
        return this.eval(cond.value ? expr.thenBranch : expr.elseBranch, env);
      }
      case 'Unary': {
        const operand = this.eval(expr.operand, env);
        if (operand.kind !== 'number') {
          throw typeError(`Unary '-' expects a number, but got ${describe(operand)}`, expr.span);
        }
        return num(-operand.value);
      }
      case 'Binary':
        return this.evalBinary(expr, env);
    }
  }

  apply(fn: Value, arg: Value, span: Span): Value {
    switch (fn.kind) {
      case 'closure':
        return this.eval(fn.body, fn.env.extend(fn.param, arg));
      case 'builtin': {
        const args = [...fn.args, arg];
        if (args.length < fn.arity) return { ...fn, args };
        const def = BUILTINS[fn.name]!;
        return def.impl(args, { span, apply: (f, x) => this.apply(f, x, span) });
      }
      default:
        throw typeError(`Cannot apply ${describe(fn)} to an argument: only functions can be applied`, span);
    }
  }

  private evalBinary(expr: Binary, env: Environment): Value {
    const { op } = expr;

    if (op === '&&' || op === '||') {
      const left = this.expectBoolean(op, 'left', this.eval(expr.left, env), expr.left.span);
      if (op === '&&' ? !left : left) return bool(left);
      return bool(this.expectBoolean(op, 'right', this.eval(expr.right, env), expr.right.span));
    }

    const left = this.eval(expr.left, env);
    const right = this.eval(expr.right, env);

    switch (op) {
      case '==':
        return bool(valuesEqual(left, right, expr.span));
      case '/=':
        return bool(!valuesEqual(left, right, expr.span));
      default: {
        const a = this.expectNumber(op, 'left', left, expr.left.span);
        const b = this.expectNumber(op, 'right', right, expr.right.span);
        switch (op) {
          case '<': return bool(a < b);
          case '<=': return bool(a <= b);
          case '>': return bool(a > b);
          case '>=': return bool(a >= b);
          default: return num(arithmetic(op, a, b, expr.span));
        }
      }
    }
  }

  private expectNumber(op: string, side: string, value: Value, span: Span): number {
    if (value.kind !== 'number') {
      throw typeError(`Operator '${op}' expects numbers, but its ${side} operand is ${describe(value)}`, span);
    }
    return value.value;
  }

  private expectBoolean(op: string, side: string, value: Value, span: Span): boolean {
    if (value.kind !== 'boolean') {
      throw typeError(`Operator '${op}' expects booleans, but its ${side} operand is ${describe(value)}`, span);
    }
    return value.value;
  }
}

/** Shared with the reducer so both engines agree on arithmetic edge cases. */
export function arithmetic(op: ArithmeticOperator, a: number, b: number, span: Span): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/':
      if (b === 0) throw runtimeError('Division by zero', span);
      return a / b;
  }
}

/** Structural equality on numbers, booleans and lists; functions are not comparable. */
export function valuesEqual(a: Value, b: Value, span: Span): boolean {
  if (a.kind === 'closure' || a.kind === 'builtin' || b.kind === 'closure' || b.kind === 'builtin') {
    throw typeError('Functions cannot be compared for equality', span);
  }
  if (a.kind !== b.kind) {
    throw typeError(`Cannot compare ${describe(a)} with ${describe(b)}`, span);
  }
  if (a.kind === 'list' && b.kind === 'list') {
    return a.elements.length === b.elements.length && a.elements.every((x, i) => valuesEqual(x, b.elements[i]!, span));
  }
  return (a as { value: unknown }).value === (b as { value: unknown }).value;
}

function undefinedVariable(name: string, env: Environment, span: Span): LangError {
  const suggestion = closestName(name, env.names());
  const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
  return nameError(`Undefined variable '${name}'.${hint}`, span);
}

export function closestName(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.max(1, Math.floor(name.length / 3)) + 1;
  for (const candidate of candidates) {
    const d = editDistance(name, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
