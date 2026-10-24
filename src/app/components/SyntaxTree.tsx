/** Compact AST view of the current expression, with the next redex outlined. */
import { children, formatNumber, type Expr, type NodeId } from '../../lang';

const MAX_DEPTH = 7;

function label(expr: Expr): string {
  switch (expr.kind) {
    case 'Number': return formatNumber(expr.value);
    case 'Boolean': return expr.value ? 'True' : 'False';
    case 'Var': return expr.name;
    case 'List': return `list [${expr.elements.length}]`;
    case 'Lambda': return `λ${expr.param}`;
    case 'App': return 'apply';
    case 'Let': return `let ${expr.name}`;
    case 'If': return 'if';
    case 'Binary': return expr.op;
    case 'Unary': return 'negate';
  }
}

function Node({ expr, depth, redexId, changedId }: { expr: Expr; depth: number; redexId?: NodeId; changedId?: NodeId }) {
  const kids = children(expr);
  const cls = ['tree-label', `tree-${expr.kind.toLowerCase()}`];
  if (expr.id === redexId) cls.push('m-redex');
  if (expr.id === changedId) cls.push('m-changed');
  return (
    <li>
      <span className={cls.join(' ')}>{label(expr)}</span>
      {kids.length > 0 &&
        (depth >= MAX_DEPTH ? (
          <ul><li><span className="muted">…</span></li></ul>
        ) : (
          <ul>
            {kids.map((kid) => (
              <Node key={kid.id} expr={kid} depth={depth + 1} redexId={redexId} changedId={changedId} />
            ))}
          </ul>
        ))}
    </li>
  );
}

export function SyntaxTree({ expr, redexId, changedId }: { expr: Expr; redexId?: NodeId; changedId?: NodeId }) {
  return (
    <ul className="tree" aria-label="Syntax tree">
      <Node expr={expr} depth={0} redexId={redexId} changedId={changedId} />
    </ul>
  );
}
