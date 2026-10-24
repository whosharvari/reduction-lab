/**
 * Abstract syntax tree.
 *
 * Design constraints (they matter for the small-step engine in Phase 2):
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

export function maxNodeId(expr: Expr): NodeId {
  return children(expr).reduce((max, child) => Math.max(max, maxNodeId(child)), expr.id);
}

/** Variables that occur free in `expr` (needed for capture-avoiding substitution). */
export function freeVariables(expr: Expr): Set<string> {
  const free = new Set<string>();
  const walk = (e: Expr, bound: ReadonlySet<string>): void => {
    switch (e.kind) {
      case 'Var':
        if (!bound.has(e.name)) free.add(e.name);
        return;
      case 'Lambda':
        walk(e.body, new Set(bound).add(e.param));
        return;
      case 'Let':
        // `let` is non-recursive: the bound name is not in scope inside `value`.
        walk(e.value, bound);
        walk(e.body, new Set(bound).add(e.name));
        return;
      default:
        for (const child of children(e)) walk(child, bound);
    }
  };
  walk(expr, new Set());
  return free;
}
