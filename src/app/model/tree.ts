/**
 * View model for the syntax-tree panel.
 *
 * Identity comes from the reducer, not from text: `replaceAt` copies only the
 * nodes on the path to the redex (keeping their ids) and shares every other
 * subtree, and substitution keeps the ids of the lambda body and of the first
 * copy of the argument. So "the same node" across a step is simply "the same
 * id", and a node is *new* exactly when its id did not exist in `step.before`.
 */
import {
  BUILTINS,
  children,
  formatNumber,
  nodeAt,
  printWithRanges,
  type Expr,
  type ExecutionSnapshot,
  type NodeId,
} from '../../lang';

/** Deeper or larger trees are cut off with an explicit "… more" marker instead of freezing the page. */
export const TREE_MAX_DEPTH = 48;
export const TREE_MAX_NODES = 1500;
const DETAIL_CHARS = 120;

export type TreeMark = 'redex' | 'changed' | 'error';

export interface TreeNode {
  readonly id: NodeId;
  readonly kind: Expr['kind'];
  /** Short visible label, e.g. `apply`, `λx`, `+`, `list · 3`. */
  readonly label: string;
  /** Hover / screen-reader detail: role in the parent, node kind and source. */
  readonly detail: string;
  readonly builtin: boolean;
  readonly marks: readonly TreeMark[];
  /** Inside the subtree the last step produced (including its root). */
  readonly inChanged: boolean;
  /** Created by the last step: its id did not exist before that step. */
  readonly isNew: boolean;
  readonly children: readonly TreeNode[];
  /** Children (with their subtrees) not shown because of the depth or node budget. */
  readonly hidden: number;
}

export interface TreeView {
  readonly root: TreeNode;
  readonly truncated: boolean;
  /** Which marks appear among the visible nodes (drives the legend). */
  readonly hasRedex: boolean;
  readonly hasChange: boolean;
  readonly hasNew: boolean;
  readonly hasError: boolean;
}

const KIND_NAMES: Record<Expr['kind'], string> = {
  Number: 'number',
  Boolean: 'boolean',
  List: 'list',
  Var: 'variable',
  Lambda: 'lambda',
  App: 'application',
  Let: 'let binding',
  If: 'conditional',
  Binary: 'operator',
  Unary: 'negation',
};

export function treeLabel(expr: Expr): string {
  switch (expr.kind) {
    case 'Number': return formatNumber(expr.value);
    case 'Boolean': return expr.value ? 'True' : 'False';
    case 'Var': return expr.name;
    case 'List': return `list · ${expr.elements.length}`;
    case 'Lambda': return `λ${expr.param}`;
    case 'App': return 'apply';
    case 'Let': return `let ${expr.name}`;
    case 'If': return 'if';
    case 'Binary': return expr.op;
    case 'Unary': return 'negate';
  }
}

/** The role each child plays in its parent, in `children()` order. */
function childRoles(expr: Expr): readonly string[] {
  switch (expr.kind) {
    case 'List': return expr.elements.map((_, i) => `element ${i}`);
    case 'Lambda': return ['body'];
    case 'App': return ['function', 'argument'];
    case 'Let': return ['value', 'body'];
    case 'If': return ['condition', 'then', 'else'];
    case 'Binary': return ['left', 'right'];
    case 'Unary': return ['operand'];
    default: return [];
  }
}

function collectIds(expr: Expr, into: Set<NodeId>): Set<NodeId> {
  into.add(expr.id);
  for (const kid of children(expr)) collectIds(kid, into);
  return into;
}

function countNodes(expr: Expr): number {
  let n = 1;
  for (const kid of children(expr)) n += countNodes(kid);
  return n;
}

/** The node's own source, cut from one print of the whole tree (printing every subtree separately is quadratic). */
function sourceOf(text: string, range: { start: number; end: number } | undefined): string {
  if (!range) return '';
  return range.end - range.start > DETAIL_CHARS ? `${text.slice(range.start, range.start + DETAIL_CHARS - 1)}…` : text.slice(range.start, range.end);
}

export function deriveTreeView(snapshot: ExecutionSnapshot): TreeView {
  const { current, next } = snapshot;
  const step = current.step;
  const failure = snapshot.status === 'error' && snapshot.outcome?.status === 'error' ? snapshot.outcome : undefined;
  const errorId = failure?.path ? nodeAt(current.expr, failure.path)?.id : undefined;
  const changedId = step?.replacementId;
  const before = step ? collectIds(step.before, new Set()) : undefined;
  const printed = printWithRanges(current.expr);

  let budget = TREE_MAX_NODES;
  let truncated = false;
  let hasNew = false;
  const seen = new Set<TreeMark>();

  const build = (expr: Expr, depth: number, role: string | undefined, inChanged: boolean): TreeNode => {
    budget -= 1;
    const changedHere = inChanged || expr.id === changedId;
    const marks: TreeMark[] = [];
    if (expr.id === changedId) marks.push('changed');
    if (expr.id === next?.redexId) marks.push('redex');
    if (expr.id === errorId) marks.push('error');
    for (const m of marks) seen.add(m);
    const isNew = before !== undefined && !before.has(expr.id);
    if (isNew) hasNew = true;

    const kids = children(expr);
    const roles = childRoles(expr);
    const shown: TreeNode[] = [];
    let hidden = 0;
    kids.forEach((kid, i) => {
      if (depth + 1 >= TREE_MAX_DEPTH || budget <= 0) hidden += countNodes(kid);
      else shown.push(build(kid, depth + 1, roles[i], changedHere));
    });
    if (hidden > 0) truncated = true;

    const detail = `${role ? `${role} · ` : ''}${KIND_NAMES[expr.kind]}: ${sourceOf(printed.text, printed.ranges.get(expr.id))}`;
    return {
      id: expr.id,
      kind: expr.kind,
      label: treeLabel(expr),
      detail,
      builtin: expr.kind === 'Var' && expr.name in BUILTINS,
      marks,
      inChanged: changedHere,
      isNew,
      children: shown,
      hidden,
    };
  };

  const root = build(current.expr, 0, undefined, false);
  return { root, truncated, hasRedex: seen.has('redex'), hasChange: seen.has('changed'), hasNew, hasError: seen.has('error') };
}
