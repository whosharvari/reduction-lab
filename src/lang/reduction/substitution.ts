/**
 * Capture-avoiding substitution on the AST.
 *
 * `substitute(body, x, v)` computes body[x := v]: every *free* occurrence of
 * `x` in `body` is replaced by `v`. If a binder inside `body` would capture a
 * free variable of `v`, that binder is renamed first (alpha-conversion) to a
 * primed name such as `y'`, which is still valid source syntax.
 */
import { allNames, freeVariables, mapChildren, type Expr, type IdGenerator } from '../ast';

/** Deep copy with fresh node ids (spans kept), so a tree never contains duplicate ids. */
export function cloneWithFreshIds(expr: Expr, ids: IdGenerator): Expr {
  return { ...mapChildren(expr, (child) => cloneWithFreshIds(child, ids)), id: ids.next() } as Expr;
}

/** Rename free occurrences of `from` to `to`. Requires `to` not to occur anywhere in `expr`. */
function renameFree(expr: Expr, from: string, to: string): Expr {
  switch (expr.kind) {
    case 'Var':
      return expr.name === from ? { ...expr, name: to } : expr;
    case 'Lambda':
      return expr.param === from ? expr : { ...expr, body: renameFree(expr.body, from, to) };
    case 'Let':
      return {
        ...expr,
        value: renameFree(expr.value, from, to),
        body: expr.name === from ? expr.body : renameFree(expr.body, from, to),
      };
    default:
      return mapChildren(expr, (child) => renameFree(child, from, to));
  }
}

function freshName(base: string, avoid: ReadonlySet<string>): string {
  let candidate = `${base}'`;
  while (avoid.has(candidate)) candidate += "'";
  return candidate;
}

/** What a substitution actually did; filled in when passed to `substitute` (observation only). */
export interface SubstitutionStats {
  occurrences: number;
  readonly renamed: Array<readonly [string, string]>;
}

export function substitute(body: Expr, name: string, value: Expr, ids: IdGenerator, stats?: SubstitutionStats): Expr {
  const valueFree = freeVariables(value);
  let firstUse = true;
  // The first occurrence reuses `value` itself (it has left its old position);
  // later occurrences are copies with fresh ids.
  const occurrence = (): Expr => {
    if (stats) stats.occurrences += 1;
    if (firstUse) {
      firstUse = false;
      return value;
    }
    return cloneWithFreshIds(value, ids);
  };

  /** Substitute under a binder named `binder`, renaming it if it would capture. */
  const underBinder = (binder: string, scope: Expr, rebuild: (binder: string, scope: Expr) => Expr): Expr => {
    if (binder === name || !freeVariables(scope).has(name)) return rebuild(binder, scope);
    if (valueFree.has(binder)) {
      const avoid = allNames(scope, new Set(valueFree)).add(name);
      const renamed = freshName(binder, avoid);
      stats?.renamed.push([binder, renamed]);
      return rebuild(renamed, go(renameFree(scope, binder, renamed)));
    }
    return rebuild(binder, go(scope));
  };

  const go = (expr: Expr): Expr => {
    switch (expr.kind) {
      case 'Var':
        return expr.name === name ? occurrence() : expr;
      case 'Lambda':
        return underBinder(expr.param, expr.body, (param, body) => ({ ...expr, param, body }));
      case 'Let': {
        const letValue = go(expr.value); // non-recursive: `value` is outside the binder
        return underBinder(expr.name, expr.body, (letName, letBody) => ({ ...expr, name: letName, value: letValue, body: letBody }));
      }
      default:
        return mapChildren(expr, go);
    }
  };

  return go(body);
}
