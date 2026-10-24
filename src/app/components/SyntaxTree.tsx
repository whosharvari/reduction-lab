/**
 * The current expression as one connected tree. Nodes are keyed by AST id, so a
 * step only re-renders the path to the redex and the subtree it produced;
 * everything else keeps its DOM node and its place.
 */
import { useMemo } from 'react';
import type { ExecutionSnapshot } from '../../lang';
import { deriveTreeView, type TreeNode } from '../model/tree';

const MARK_TEXT = { redex: 'reduces next', changed: 'produced by the last step', error: 'stuck here' } as const;

function TreeItem({ node }: { node: TreeNode }) {
  const cls = ['tree-label', `tree-${node.kind.toLowerCase()}`, ...node.marks.map((m) => `m-${m}`)];
  if (node.builtin) cls.push('tree-builtin');
  if (node.isNew) cls.push('is-new');
  const state = [...node.marks.map((m) => MARK_TEXT[m]), ...(node.isNew ? ['new'] : [])].join(', ');
  return (
    <li className={node.inChanged ? 'in-changed' : undefined}>
      <span className={cls.join(' ')} title={node.detail}>
        {node.label}
      </span>
      <span className="sr-only">
        {' '}— {node.detail}
        {state && ` (${state})`}
      </span>
      {(node.children.length > 0 || node.hidden > 0) && (
        <ul>
          {node.children.map((kid) => (
            <TreeItem key={kid.id} node={kid} />
          ))}
          {node.hidden > 0 && <li className="tree-more muted">… {node.hidden} more node{node.hidden === 1 ? '' : 's'}</li>}
        </ul>
      )}
    </li>
  );
}

export function SyntaxTree({ snapshot }: { readonly snapshot: ExecutionSnapshot }) {
  const view = useMemo(() => deriveTreeView(snapshot), [snapshot]);
  return (
    <div className="tree-view">
      <ul className="tree" aria-label="Syntax tree">
        <TreeItem node={view.root} />
      </ul>
      <ul className="legend tree-legend" aria-label="Syntax tree legend">
        {view.hasRedex && <li><span className="swatch swatch-redex" />reduces next</li>}
        {view.hasChange && <li><span className="swatch swatch-branch" />produced by the last step</li>}
        {view.hasNew && <li><span className="swatch swatch-new" />new node; other nodes kept their identity</li>}
        {view.hasError && <li><span className="swatch swatch-error" />stuck here</li>}
      </ul>
      {view.truncated && <p className="muted tree-note">Very large tree: deep or trailing parts are summarised as “… more nodes”.</p>}
    </div>
  );
}
