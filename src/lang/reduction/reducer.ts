/**
 * Small-step reducer: performs exactly one semantic rewrite per call.
 *
 * `findRedex` walks the tree in evaluation order (call-by-value, left to
 * right — mirroring evaluator.ts) and returns the first sub-expression whose
 * operands are all values. `contract` rewrites that redex, or throws a
 * `LangError` if it is stuck (e.g. `5 3`, `1 / 0`, an unbound variable).
 */
import { IdGenerator, type Application, type Binary, type Expr, type ListLiteral } from '../ast';
import { BUILTINS, type BuiltinDefinition } from '../builtins';
import { LangError, nameError, typeError, type Span } from '../errors';
import { arithmetic, closestName } from '../evaluator';
import { nodeAt, replaceAt, type Path, type PathSegment } from '../paths';
import { printExpr } from '../printer';
import { cloneWithFreshIds, substitute, type SubstitutionStats } from './substitution';
import type { FoldFocus, ListFocus, Reducer, ReductionRule, ReductionStep, StepDetail, StepResult } from './types';

// ---- values ----------------------------------------------------------------

function isBuiltinName(name: string): boolean {
  return Object.hasOwn(BUILTINS, name);
}

interface BuiltinSpine {
  readonly def: BuiltinDefinition;
  readonly head: Expr;
  readonly args: readonly Expr[];
}

/** `fold f z xs` -> { def: fold, args: [f, z, xs] } when the head is a builtin name. */
function builtinSpine(expr: Expr): BuiltinSpine | undefined {
  const args: Expr[] = [];
  let current = expr;
  while (current.kind === 'App') {
    args.unshift(current.arg);
    current = current.fn;
  }
  if (current.kind !== 'Var' || !isBuiltinName(current.name)) return undefined;
  return { def: BUILTINS[current.name]!, head: current, args };
}

/** A builtin applied to fewer value arguments than its arity, e.g. `map f`. */
function isPartialBuiltin(expr: Expr): boolean {
  const spine = builtinSpine(expr);
  return !!spine && spine.args.length < spine.def.arity && spine.args.every(isValue);
}

/**
 * Normal forms: numbers, booleans, lambdas, lists of values, builtin names and
 * partially applied builtins. (Variables in evaluation position are always
 * free, because bound ones have been substituted away.)
 */
export function isValue(expr: Expr): boolean {
  // Immutable nodes are shared between steps, so the answer can be cached per node.
  const cached = valueCache.get(expr);
  if (cached !== undefined) return cached;
  const result = computeIsValue(expr);
  valueCache.set(expr, result);
  return result;
}

const valueCache = new WeakMap<Expr, boolean>();

function computeIsValue(expr: Expr): boolean {
  switch (expr.kind) {
    case 'Number':
    case 'Boolean':
    case 'Lambda':
      return true;
    case 'Var':
      return isBuiltinName(expr.name);
    case 'List':
      return expr.elements.every(isValue);
    case 'App':
      return isPartialBuiltin(expr);
    default:
      return false;
  }
}

function isFunctionValue(expr: Expr): boolean {
  return expr.kind === 'Lambda' || (expr.kind === 'Var' && isBuiltinName(expr.name)) || isPartialBuiltin(expr);
}

function typeOf(expr: Expr): string {
  switch (expr.kind) {
    case 'Number': return 'number';
    case 'Boolean': return 'boolean';
    case 'List': return 'list';
    default: return 'function';
  }
}

const describe = (expr: Expr) => `${typeOf(expr)} ${printExpr(expr)}`;

// ---- locating the next redex -----------------------------------------------

/** The innermost list element (by position) that contains a redex. */
interface ListRef {
  readonly listPath: Path;
  readonly listId: number;
  readonly index: number;
}

interface Redex {
  readonly path: Path;
  readonly node: Expr;
  readonly list?: ListRef;
}

/**
 * `path` is a shared, mutable stack of the segments leading to `expr`; it is
 * copied only when a redex is found, so descending is O(depth) per step
 * rather than O(depth²).
 */
function findRedex(expr: Expr, path: PathSegment[]): Redex | undefined {
  // Values contain no redex. `isValue` is cached per node, so already-reduced
  // sub-trees (e.g. a large accumulator) are skipped in O(1) on every step.
  if (isValue(expr)) return undefined;
  const here = (): Redex => ({ path: [...path], node: expr });
  const into = (segment: PathSegment, child: Expr): Redex | undefined => {
    path.push(segment);
    const found = findRedex(child, path);
    path.pop();
    return found;
  };
  switch (expr.kind) {
    case 'Number':
    case 'Boolean':
    case 'Lambda':
      return undefined;
    case 'Var':
      // A free non-builtin variable is "stuck"; contract() reports the NameError.
      return isBuiltinName(expr.name) ? undefined : here();
    case 'List':
      for (let i = 0; i < expr.elements.length; i++) {
        const found = into(['elements', i], expr.elements[i]!);
        if (found) return found.list ? found : { ...found, list: { listPath: [...path], listId: expr.id, index: i } };
      }
      return undefined;
    case 'App':
      return into('fn', expr.fn) ?? into('arg', expr.arg) ?? (isPartialBuiltin(expr) ? undefined : here());
    case 'Let':
      return into('value', expr.value) ?? here();
    case 'If':
      return into('cond', expr.cond) ?? here();
    case 'Unary':
      return into('operand', expr.operand) ?? here();
    case 'Binary': {
      const inLeft = into('left', expr.left);
      if (inLeft) return inLeft;
      if ((expr.op === '&&' || expr.op === '||') && shortCircuits(expr)) return here();
      return into('right', expr.right) ?? here();
    }
  }
}

/** True when the (already evaluated) left operand decides the result — or is not a boolean. */
function shortCircuits(expr: Binary): boolean {
  if (expr.left.kind !== 'Boolean') return true; // stuck: contract() reports the TypeError
  return expr.op === '&&' ? !expr.left.value : expr.left.value;
}

// ---- contracting a redex ---------------------------------------------------

interface Contraction {
  readonly rule: ReductionRule;
  readonly description: string;
  readonly replacement: Expr;
  readonly detail: StepDetail;
}

class Contractor {
  private readonly ids: IdGenerator;

  constructor(ids: IdGenerator) {
    this.ids = ids;
  }

  private number(value: number, span: Span): Expr {
    return { kind: 'Number', id: this.ids.next(), span, value };
  }

  private boolean(value: boolean, span: Span): Expr {
    return { kind: 'Boolean', id: this.ids.next(), span, value };
  }

  private app(fn: Expr, arg: Expr, span: Span): Application {
    return { kind: 'App', id: this.ids.next(), span, fn, arg };
  }

  /** `body[name := value]`, plus what the substitution actually did. */
  private substitution(body: Expr, name: string, value: Expr): { replacement: Expr; detail: StepDetail } {
    const stats: SubstitutionStats = { occurrences: 0, renamed: [] };
    const replacement = substitute(body, name, value, this.ids, stats);
    return { replacement, detail: { kind: 'substitution', name, value, occurrences: stats.occurrences, renamed: stats.renamed } };
  }

  contract(node: Expr): Contraction {
    switch (node.kind) {
      case 'Var':
        throw undefinedVariable(node.name, node.span);
      case 'App':
        return this.application(node);
      case 'Let':
        return {
          rule: 'let',
          description: `Bind ${node.name} = ${printExpr(node.value)} in the body`,
          ...this.substitution(node.body, node.name, node.value),
        };
      case 'If': {
        if (node.cond.kind !== 'Boolean') {
          throw typeError(`The condition of 'if' must be a boolean, but got ${describe(node.cond)}`, node.cond.span);
        }
        const branch = node.cond.value ? 'then' : 'else';
        const [kept, discarded] = node.cond.value ? [node.thenBranch, node.elseBranch] : [node.elseBranch, node.thenBranch];
        return {
          rule: 'if',
          description: `Condition is ${printExpr(node.cond)}: take the '${branch}' branch`,
          replacement: kept,
          detail: { kind: 'branch', condition: node.cond.value, kept, discarded },
        };
      }
      case 'Unary': {
        if (node.operand.kind !== 'Number') {
          throw typeError(`Unary '-' expects a number, but got ${describe(node.operand)}`, node.span);
        }
        const result = this.number(-node.operand.value, node.span);
        return {
          rule: 'negate',
          description: `Negate ${printExpr(node.operand)}`,
          replacement: result,
          detail: { kind: 'operation', op: 'negate', operands: [node.operand], result },
        };
      }
      case 'Binary':
        return this.binary(node);
      default:
        throw new Error(`Internal error: ${node.kind} is not a redex`);
    }
  }

  private application(node: Application): Contraction {
    const { fn, arg } = node;
    if (fn.kind === 'Lambda') {
      return {
        rule: 'beta',
        description: `Apply ${printExpr(fn)} to ${printExpr(arg)}: substitute ${fn.param} := ${printExpr(arg)}`,
        ...this.substitution(fn.body, fn.param, arg),
      };
    }
    const spine = builtinSpine(node);
    if (spine && spine.args.length === spine.def.arity) {
      return spine.def.name === 'map' ? this.map(node, spine) : this.fold(node, spine);
    }
    throw typeError(`Cannot apply ${describe(fn)} to an argument: only functions can be applied`, node.span);
  }

  private map(node: Application, { args: [f, xs] }: BuiltinSpine): Contraction {
    if (!isFunctionValue(f!)) {
      throw typeError(`map expects a function as its first argument, but got ${describe(f!)}`, node.span);
    }
    if (xs!.kind !== 'List') {
      throw typeError(`map expects a list as its second argument, but got ${describe(xs!)}`, node.span);
    }
    const elements = xs!.elements.map((x, i) => this.app(i === 0 ? f! : cloneWithFreshIds(f!, this.ids), x, x.span));
    const replacement: ListLiteral = { kind: 'List', id: this.ids.next(), span: node.span, elements };
    const n = elements.length;
    return {
      rule: 'map',
      description: n === 0
        ? 'map over the empty list gives []'
        : `Apply ${printExpr(f!)} to each of the ${n} element${n === 1 ? '' : 's'}`,
      replacement,
      detail: { kind: 'map', fn: f!, count: n },
    };
  }

  private fold(node: Application, { head, args: [f, z, xs] }: BuiltinSpine): Contraction {
    if (!isFunctionValue(f!)) {
      throw typeError(`fold expects a function as its first argument, but got ${describe(f!)}`, node.span);
    }
    if (xs!.kind !== 'List') {
      throw typeError(`fold expects a list as its third argument, but got ${describe(xs!)}`, node.span);
    }
    const list = xs!;
    if (list.elements.length === 0) {
      return {
        rule: 'fold-done',
        description: `fold reached the end of the list: the result is ${printExpr(z!)}`,
        replacement: z!,
        detail: { kind: 'fold', fn: f!, accumulator: z!, remaining: 0 },
      };
    }
    const [x, ...rest] = list.elements as [Expr, ...Expr[]];
    // fold f z [x, ...rest]  ->  fold f (f z x) [...rest]
    const step = this.app(this.app(cloneWithFreshIds(f!, this.ids), z!, z!.span), x, x.span);
    const remaining: ListLiteral = { ...list, elements: rest };
    const replacement = this.app(this.app(this.app(head, f!, node.span), step, node.span), remaining, node.span);
    return {
      rule: 'fold-step',
      description: `Combine accumulator ${printExpr(z!)} with element ${printExpr(x)}`,
      replacement,
      detail: { kind: 'fold', fn: f!, accumulator: z!, element: x, remaining: rest.length },
    };
  }

  private binary(node: Binary): Contraction {
    const { op, left, right, span } = node;

    if (op === '&&' || op === '||') {
      if (left.kind !== 'Boolean') {
        throw typeError(`Operator '${op}' expects booleans, but its left operand is ${describe(left)}`, left.span);
      }
      if (shortCircuits(node)) {
        return {
          rule: 'logic',
          description: `${printExpr(left)} ${op} … is ${printExpr(left)} without evaluating the right side`,
          replacement: left,
          detail: { kind: 'logic', op, left, shortCircuit: true, result: left },
        };
      }
      if (right.kind !== 'Boolean') {
        throw typeError(`Operator '${op}' expects booleans, but its right operand is ${describe(right)}`, right.span);
      }
      return {
        rule: 'logic',
        description: `${printExpr(node)} is ${printExpr(right)}`,
        replacement: right,
        detail: { kind: 'logic', op, left, shortCircuit: false, result: right },
      };
    }

    if (op === '==' || op === '/=') {
      const equal = exprEquals(left, right, span);
      const result = this.boolean(op === '==' ? equal : !equal, span);
      return {
        rule: 'comparison',
        description: `${printExpr(node)} is ${printExpr(result)}`,
        replacement: result,
        detail: { kind: 'operation', op, operands: [left, right], result },
      };
    }

    if (left.kind !== 'Number') {
      throw typeError(`Operator '${op}' expects numbers, but its left operand is ${describe(left)}`, left.span);
    }
    if (right.kind !== 'Number') {
      throw typeError(`Operator '${op}' expects numbers, but its right operand is ${describe(right)}`, right.span);
    }
    const a = left.value;
    const b = right.value;
    let result: Expr;
    let rule: ReductionRule = 'comparison';
    switch (op) {
      case '<': result = this.boolean(a < b, span); break;
      case '<=': result = this.boolean(a <= b, span); break;
      case '>': result = this.boolean(a > b, span); break;
      case '>=': result = this.boolean(a >= b, span); break;
      default:
        rule = 'arithmetic';
        result = this.number(arithmetic(op, a, b, span), span);
    }
    return {
      rule,
      description: `${printExpr(node)} = ${printExpr(result)}`,
      replacement: result,
      detail: { kind: 'operation', op, operands: [left, right], result },
    };
  }
}

/** Structural equality on value expressions; mirrors `valuesEqual` in the evaluator. */
function exprEquals(a: Expr, b: Expr, span: Span): boolean {
  if (typeOf(a) === 'function' || typeOf(b) === 'function') {
    throw typeError('Functions cannot be compared for equality', span);
  }
  if (a.kind !== b.kind) throw typeError(`Cannot compare ${describe(a)} with ${describe(b)}`, span);
  if (a.kind === 'List' && b.kind === 'List') {
    return a.elements.length === b.elements.length && a.elements.every((x, i) => exprEquals(x, b.elements[i]!, span));
  }
  return (a as { value: unknown }).value === (b as { value: unknown }).value;
}

function undefinedVariable(name: string, span: Span): LangError {
  // Bound variables have been substituted away, so only builtins are in scope here.
  const hint = closestName(name, Object.keys(BUILTINS));
  return nameError(`Undefined variable '${name}'.${hint ? ` Did you mean '${hint}'?` : ''}`, span);
}

// ---- public reducer --------------------------------------------------------

// ---- UI metadata ------------------------------------------------------------

const elementPath = (ref: ListRef): Path => [...ref.listPath, ['elements', ref.index]];

function listFocus(ref: ListRef, before: Expr, after?: Expr): ListFocus {
  const path = elementPath(ref);
  const elementAfter = after && nodeAt(after, path);
  return {
    listPath: ref.listPath,
    listId: ref.listId,
    index: ref.index,
    elementBefore: nodeAt(before, path)!,
    ...(elementAfter ? { elementAfter } : {}),
  };
}

/** `fold f acc xs` with exactly three arguments. */
function isSaturatedFold(expr: Expr | undefined): expr is Application {
  const spine = expr && builtinSpine(expr);
  return !!spine && spine.def.name === 'fold' && spine.args.length === 3;
}

// Inside `App(App(App(fold, f), acc), xs)` the accumulator is at ['fn', 'arg'], the list at ['arg'].
const ACC: readonly PathSegment[] = ['fn', 'arg'];
const LIST: readonly PathSegment[] = ['arg'];

function foldFocus(rule: ReductionRule, path: Path, before: Expr, after: Expr, redex: Expr): FoldFocus | undefined {
  if (rule === 'fold-step' || rule === 'fold-done') {
    const [, z, xs] = builtinSpine(redex)!.args as [Expr, Expr, ListLiteral];
    if (rule === 'fold-done') {
      return { phase: 'finish', foldPath: path, accumulatorPath: path, listId: xs.id, accumulatorBefore: z, accumulatorAfter: z };
    }
    const accumulatorPath = [...path, ...ACC];
    return {
      phase: 'consume',
      foldPath: path,
      accumulatorPath,
      listPath: [...path, ...LIST],
      listId: xs.id,
      accumulatorBefore: z,
      accumulatorAfter: nodeAt(after, accumulatorPath)!,
      element: xs.elements[0]!,
    };
  }
  // Innermost enclosing fold whose accumulator contains the redex.
  for (let k = path.length - ACC.length; k >= 0; k--) {
    if (path[k] !== 'fn' || path[k + 1] !== 'arg') continue;
    const foldPath = path.slice(0, k);
    const fold = nodeAt(before, foldPath);
    if (!isSaturatedFold(fold)) continue;
    const accumulatorPath = [...foldPath, ...ACC];
    return {
      phase: 'accumulate',
      foldPath,
      accumulatorPath,
      listPath: [...foldPath, ...LIST],
      listId: fold.arg.id,
      accumulatorBefore: nodeAt(before, accumulatorPath)!,
      accumulatorAfter: nodeAt(after, accumulatorPath)!,
    };
  }
  return undefined;
}

export class SmallStepReducer implements Reducer {
  /** Shared across steps so an id, once retired, is never reissued in this reducer's history. */
  private readonly ids = new IdGenerator();
  /** The last tree this reducer produced: its ids all came from `ids`, so no rescan is needed. */
  private lastOutput: Expr | undefined;

  step(expr: Expr): StepResult {
    const redex = findRedex(expr, []);
    if (!redex) return { status: 'done', expr };
    if (expr !== this.lastOutput) this.ids.reserveAbove(expr);
    try {
      const { rule, description, replacement, detail } = new Contractor(this.ids).contract(redex.node);
      const after = replaceAt(expr, redex.path, replacement);
      const fold = foldFocus(rule, redex.path, expr, after, redex.node);
      const step: ReductionStep = {
        rule,
        description,
        detail,
        before: expr,
        after,
        path: redex.path,
        redexId: redex.node.id,
        replacementId: replacement.id,
        completes: isValue(after),
        ...(redex.list ? { listFocus: listFocus(redex.list, expr, after) } : {}),
        ...(fold ? { foldFocus: fold } : {}),
      };
      this.lastOutput = after;
      return { status: 'step', step };
    } catch (error) {
      if (!(error instanceof LangError)) throw error;
      return {
        status: 'error',
        expr,
        error,
        path: redex.path,
        ...(redex.list ? { listFocus: listFocus(redex.list, expr) } : {}),
      };
    }
  }
}
