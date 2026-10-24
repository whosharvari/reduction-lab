/**
 * Addressing and persistent replacement of sub-expressions.
 *
 * A `Path` names a position in the tree (e.g. `['fn', 'arg']`, or
 * `['elements', 2]` for the third list element). The reducer uses
 * `replaceAt` to rewrite a redex in place: only nodes on the path are copied,
 * everything else is shared, so a full execution history stays cheap.
 */
import type { Expr } from './ast';

export type PathSegment =
  | 'fn' | 'arg'
  | 'body'
  | 'value'
  | 'cond' | 'thenBranch' | 'elseBranch'
  | 'left' | 'right'
  | 'operand'
  | readonly ['elements', number];

export type Path = readonly PathSegment[];

export function child(expr: Expr, segment: PathSegment): Expr | undefined {
  if (Array.isArray(segment)) {
    return expr.kind === 'List' ? expr.elements[segment[1]] : undefined;
  }
  const value = (expr as unknown as Record<string, unknown>)[segment as string];
  return value && typeof value === 'object' && 'kind' in value ? (value as Expr) : undefined;
}

export function nodeAt(root: Expr, path: Path): Expr | undefined {
  let current: Expr | undefined = root;
  for (const segment of path) {
    if (!current) return undefined;
    current = child(current, segment);
  }
  return current;
}

export function replaceAt(root: Expr, path: Path, replacement: Expr): Expr {
  return replaceFrom(root, path, 0, replacement);
}

/** Index-based so a deep path is not re-sliced at every level (O(depth), not O(depth²)). */
function replaceFrom(root: Expr, path: Path, at: number, replacement: Expr): Expr {
  if (at === path.length) return replacement;
  const head = path[at]!;
  const target = child(root, head);
  if (!target) throw new Error(`Invalid path segment ${JSON.stringify(head)} for ${root.kind} node`);
  const updated = replaceFrom(target, path, at + 1, replacement);
  if (Array.isArray(head)) {
    const list = root as Extract<Expr, { kind: 'List' }>;
    const elements = list.elements.slice();
    elements[head[1]] = updated;
    return { ...list, elements };
  }
  return { ...root, [head as string]: updated } as Expr;
}

/** Find the path to the node with the given id (depth-first, left-to-right). */
export function pathTo(root: Expr, id: number): Path | undefined {
  if (root.id === id) return [];
  for (const segment of childSegments(root)) {
    const sub = pathTo(child(root, segment)!, id);
    if (sub) return [segment, ...sub];
  }
  return undefined;
}

export function childSegments(expr: Expr): PathSegment[] {
  switch (expr.kind) {
    case 'Number':
    case 'Boolean':
    case 'Var':
      return [];
    case 'List':
      return expr.elements.map((_, i) => ['elements', i] as const);
    case 'Lambda':
      return ['body'];
    case 'App':
      return ['fn', 'arg'];
    case 'Let':
      return ['value', 'body'];
    case 'If':
      return ['cond', 'thenBranch', 'elseBranch'];
    case 'Binary':
      return ['left', 'right'];
    case 'Unary':
      return ['operand'];
  }
}
