/**
 * Abstract syntax tree.
 *
 * Design constraints (they matter for the small-step reducer in reduction/):
 *  - Nodes are plain, immutable, JSON-serialisable objects discriminated by `kind`.
 *  - Every node has a numeric `id` (unique within one tree) so the UI can track
 *    "the same" node across rewrites and highlight it, and a `span` pointing back
 *    into the original source. Nodes synthesised by a rewrite reuse the span of
 *    the redex they replaced.
 *  - Lambdas take exactly one parameter; `\a b -> e` is sugar for `\a -> \b -> e`.
 */
import type { Span } from './errors';

export type NodeId = number;

interface NodeBase {
  readonly id: NodeId;
  readonly span: Span;
}

export interface NumberLiteral extends NodeBase {
  readonly kind: 'Number';
  readonly value: number;
}

export interface BooleanLiteral extends NodeBase {
  readonly kind: 'Boolean';
  readonly value: boolean;
}

export interface ListLiteral extends NodeBase {
  readonly kind: 'List';
  readonly elements: readonly Expr[];
}

export interface Variable extends NodeBase {
  readonly kind: 'Var';
  readonly name: string;
}

export interface Lambda extends NodeBase {
  readonly kind: 'Lambda';
  readonly param: string;
  readonly body: Expr;
}

export interface Application extends NodeBase {
  readonly kind: 'App';
  readonly fn: Expr;
  readonly arg: Expr;
}

export interface Let extends NodeBase {
  readonly kind: 'Let';
  readonly name: string;
  readonly value: Expr;
  readonly body: Expr;
}

export interface If extends NodeBase {
  readonly kind: 'If';
  readonly cond: Expr;
  readonly thenBranch: Expr;
  readonly elseBranch: Expr;
}

export type ArithmeticOperator = '+' | '-' | '*' | '/';
export type ComparisonOperator = '==' | '/=' | '<' | '<=' | '>' | '>=';
export type LogicalOperator = '&&' | '||';
export type BinaryOperator = ArithmeticOperator | ComparisonOperator | LogicalOperator;

export interface Binary extends NodeBase {
  readonly kind: 'Binary';
  readonly op: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
}

export interface Unary extends NodeBase {
  readonly kind: 'Unary';
  readonly op: '-';
  readonly operand: Expr;
}

export type Expr =
  | NumberLiteral
  | BooleanLiteral
  | ListLiteral
  | Variable
  | Lambda
  | Application
  | Let
  | If
  | Binary
  | Unary;

export type ExprKind = Expr['kind'];

/** Issues fresh node ids. The parser and (later) the reducer each own one. */
export class IdGenerator {
  private nextId: NodeId;
  constructor(start: NodeId = 1) {
    this.nextId = start;
  }
  next(): NodeId {
    return this.nextId++;
  }
  /** Ensure future ids are greater than every id already present in `expr`. */
  reserveAbove(expr: Expr): void {
    this.nextId = Math.max(this.nextId, maxNodeId(expr) + 1);
  }
}

/** Direct sub-expressions in left-to-right source order. */
export function children(expr: Expr): readonly Expr[] {
  switch (expr.kind) {
    case 'Number':
    case 'Boolean':
    case 'Var':
      return [];
    case 'List':
      return expr.elements;
    case 'Lambda':
      return [expr.body];
    case 'App':
      return [expr.fn, expr.arg];
    case 'Let':
      return [expr.value, expr.body];
    case 'If':
      return [expr.cond, expr.thenBranch, expr.elseBranch];
    case 'Binary':
      return [expr.left, expr.right];
    case 'Unary':
      return [expr.operand];
  }
}

/** Rebuild `expr` with each direct child replaced by `f(child)` (other fields, incl. id, kept). */
export function mapChildren(expr: Expr, f: (child: Expr) => Expr): Expr {
  switch (expr.kind) {
    case 'Number':
    case 'Boolean':
    case 'Var':
      return expr;
    case 'List':
      return { ...expr, elements: expr.elements.map(f) };
    case 'Lambda':
      return { ...expr, body: f(expr.body) };
    case 'App':
      return { ...expr, fn: f(expr.fn), arg: f(expr.arg) };
    case 'Let':
      return { ...expr, value: f(expr.value), body: f(expr.body) };
    case 'If':
      return { ...expr, cond: f(expr.cond), thenBranch: f(expr.thenBranch), elseBranch: f(expr.elseBranch) };
    case 'Binary':
      return { ...expr, left: f(expr.left), right: f(expr.right) };
    case 'Unary':
      return { ...expr, operand: f(expr.operand) };
  }
}


/** Every identifier appearing in `expr`, bound or free. */
export function allNames(expr: Expr, into: Set<string> = new Set()): Set<string> {
  if (expr.kind === 'Var') into.add(expr.name);
  if (expr.kind === 'Lambda') into.add(expr.param);
  if (expr.kind === 'Let') into.add(expr.name);
  for (const child of children(expr)) allNames(child, into);
  return into;
}



/** Variables that occur free in `expr` (needed for capture-avoiding substitution). */
export function freeVariables(expr: Expr): ReadonlySet<string> {
  return synthesize(expr, freeCache, (node, kids) => {
    switch (node.kind) {
      case 'Var':
        return new Set([node.name]);
      case 'Lambda':
        return without(kids[0]!, node.param);
      case 'Let':
        // `let` is non-recursive: the bound name is not in scope inside `value`.
        return union([kids[0]!, without(kids[1]!, node.name)]);
      default:
        return union(kids);
    }
  });
}

const EMPTY: ReadonlySet<string> = new Set();

function without(set: ReadonlySet<string>, name: string): ReadonlySet<string> {
  if (!set.has(name)) return set;
  const copy = new Set(set);
  copy.delete(name);
  return copy;
}

function union(sets: ReadonlyArray<ReadonlySet<string>>): ReadonlySet<string> {
  const nonEmpty = sets.filter((x) => x.size > 0);
  if (nonEmpty.length === 0) return EMPTY;
  if (nonEmpty.length === 1) return nonEmpty[0]!; // share: sets are never mutated
  return new Set(nonEmpty.flatMap((x) => [...x]));
}

// ---- memoised bottom-up attributes ------------------------------------------
//
// Nodes are immutable and the reducer shares unchanged sub-trees between
// steps, so per-node results can be cached safely. The traversal is iterative,
// so these are also safe on trees far deeper than the call stack allows.

const freeCache = new WeakMap<Expr, ReadonlySet<string>>();
const sizeCache = new WeakMap<Expr, number>();
const depthCache = new WeakMap<Expr, number>();
const maxIdCache = new WeakMap<Expr, NodeId>();

function synthesize<T>(root: Expr, cache: WeakMap<Expr, T>, combine: (node: Expr, kids: T[]) => T): T {
  const cached = cache.get(root);
  if (cached !== undefined) return cached;
  const stack: Array<[Expr, boolean]> = [[root, false]];
  while (stack.length > 0) {
    const [node, expanded] = stack.pop()!;
    if (cache.has(node)) continue;
    const kids = children(node);
    if (!expanded) {
      stack.push([node, true]);
      for (const kid of kids) if (!cache.has(kid)) stack.push([kid, false]);
    } else {
      cache.set(node, combine(node, kids.map((kid) => cache.get(kid)!)));
    }
  }
  return cache.get(root)!;
}

export function countNodes(expr: Expr): number {
  return synthesize(expr, sizeCache, (_, kids) => kids.reduce((sum, n) => sum + n, 1));
}

/** Height of the tree (a leaf has depth 1). Safe on arbitrarily deep trees. */
export function exprDepth(expr: Expr): number {
  return synthesize(expr, depthCache, (_, kids) => 1 + kids.reduce((max, d) => Math.max(max, d), 0));
}

export function maxNodeId(expr: Expr): NodeId {
  return synthesize(expr, maxIdCache, (node, kids) => kids.reduce((max, id) => Math.max(max, id), node.id));
}
