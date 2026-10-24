// @vitest-environment jsdom
/** Syntax-tree view model: identity across steps comes from AST ids, never from printed text. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { EXAMPLES } from '../src/app/examples';
import { deriveTreeView, TREE_MAX_DEPTH, type TreeNode, type TreeView } from '../src/app/model/tree';
import { children, ExecutionController, type Expr, type NodeId } from '../src/lang';

function viewAt(source: string, index: number): TreeView {
  const c = ExecutionController.fromSource(source);
  c.goTo(index);
  return deriveTreeView(c.snapshot());
}

function walk(node: TreeNode, visit: (n: TreeNode, parent?: TreeNode) => void, parent?: TreeNode): void {
  visit(node, parent);
  for (const kid of node.children) walk(kid, visit, node);
}

function find(view: TreeView, pred: (n: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = [];
  walk(view.root, (n) => pred(n) && out.push(n));
  return out;
}

function idsOf(expr: Expr, into = new Set<NodeId>()): Set<NodeId> {
  into.add(expr.id);
  for (const kid of children(expr)) idsOf(kid, into);
  return into;
}

describe('deriveTreeView', () => {
  it('mirrors the AST exactly: same ids, same parent-child structure', () => {
    const c = ExecutionController.fromSource('let f = \\x -> x * 2 in f (1 + 2)');
    const view = deriveTreeView(c.snapshot());
    const check = (node: TreeNode, expr: Expr) => {
      expect(node.id).toBe(expr.id);
      expect(node.children.map((k) => k.id)).toEqual(children(expr).map((k) => k.id));
      node.children.forEach((k, i) => check(k, children(expr)[i]!));
    };
    check(view.root, c.snapshot().current.expr);
  });

  it('keeps unaffected nodes when a sub-expression is rewritten', () => {
    // 1 + 2 * 3  ->  1 + 6: the root and `1` survive; only `6` is new.
    const before = viewAt('1 + 2 * 3', 0);
    const after = viewAt('1 + 2 * 3', 1);
    expect(after.root.id).toBe(before.root.id);
    expect(after.root.children[0]!.id).toBe(before.root.children[0]!.id);
    const six = after.root.children[1]!;
    expect(six.label).toBe('6');
    expect(six.isNew).toBe(true);
    expect(six.marks).toContain('changed');
    expect(after.root.isNew || after.root.children[0]!.isNew).toBe(false);
    expect(after.root.inChanged).toBe(false);
  });

  it('tracks identity through substitution: the argument node is moved, not recreated', () => {
    // (\x -> x + 1) 5  ->  5 + 1
    const before = viewAt('(\\x -> x + 1) 5', 0);
    const after = viewAt('(\\x -> x + 1) 5', 1);
    const argId = before.root.children[1]!.id; // the `5`
    const bodyId = before.root.children[0]!.children[0]!.id; // `x + 1`
    expect(after.root.id).toBe(bodyId);
    expect(after.root.marks).toContain('changed');
    expect(after.root.children[0]!.id).toBe(argId);
    expect(find(after, (n) => n.isNew)).toEqual([]); // nothing was created, only moved
  });

  it('does not confuse identical text in different branches', () => {
    // (1 + 1) * (1 + 1): the left copy reduces first; the right copy keeps its ids and stays unmarked.
    const before = viewAt('(1 + 1) * (1 + 1)', 0);
    const after = viewAt('(1 + 1) * (1 + 1)', 1);
    const right = before.root.children[1]!;
    expect(before.root.children[0]!.marks).toContain('redex');
    expect(right.marks).toEqual([]);
    const rightAfter = after.root.children[1]!;
    expect(rightAfter.id).toBe(right.id);
    expect(rightAfter.children.map((k) => k.id)).toEqual(right.children.map((k) => k.id));
    expect(rightAfter.isNew).toBe(false);
    expect(rightAfter.marks).toEqual(['redex']); // the next redex, not the rewritten one
    expect(after.root.children[0]!.marks).toEqual(['changed']);
  });

  it('for every step of every example: nodes outside the produced subtree existed before, and isNew means "absent before"', () => {
    for (const example of EXAMPLES) {
      const c = ExecutionController.fromSource(example.source);
      c.goTo(Number.MAX_SAFE_INTEGER);
      for (let i = 1; i <= c.snapshot().index; i++) {
        c.goTo(i);
        const snap = c.snapshot();
        const before = idsOf(snap.current.step!.before);
        const view = deriveTreeView(snap);
        walk(view.root, (n) => {
          expect(n.isNew, `${example.title} step ${i}`).toBe(!before.has(n.id));
          if (!n.inChanged) expect(before.has(n.id), `${example.title} step ${i}`).toBe(true);
        });
        expect(find(view, (n) => n.marks.includes('changed')).map((n) => n.id)).toEqual([snap.current.step!.replacementId]);
        if (snap.next) expect(find(view, (n) => n.marks.includes('redex')).map((n) => n.id)).toEqual([snap.next.redexId]);
      }
    }
  });

  it('stepping back and forth gives the same tree for the same state', () => {
    const src = EXAMPLES.find((e) => e.title === 'Fold')!.source;
    const c = ExecutionController.fromSource(src);
    c.goTo(4);
    const first = deriveTreeView(c.snapshot());
    c.goTo(7);
    c.goTo(0);
    c.goTo(4);
    expect(deriveTreeView(c.snapshot())).toEqual(first);
    c.goTo(0);
    const initial = deriveTreeView(c.snapshot());
    expect(initial.hasChange).toBe(false);
    expect(find(initial, (n) => n.isNew || n.inChanged)).toEqual([]);
  });

  it('marks the stuck node on a runtime error', () => {
    const src = EXAMPLES.find((e) => e.title === 'Runtime error')!.source;
    const c = ExecutionController.fromSource(src);
    c.goTo(Number.MAX_SAFE_INTEGER);
    const view = deriveTreeView(c.snapshot());
    const stuck = find(view, (n) => n.marks.includes('error'));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.label).toBe('/');
    expect(view.hasError).toBe(true);
    expect(view.hasRedex).toBe(false);
  });

  it('summarises trees deeper than the budget instead of dropping nodes silently', () => {
    const depth = TREE_MAX_DEPTH + 10;
    const src = `${'('.repeat(depth)}1${' + 1)'.repeat(depth)}`;
    const view = viewAt(src, 0);
    expect(view.truncated).toBe(true);
    let shown = 0;
    let hidden = 0;
    walk(view.root, (n) => { shown += 1; hidden += n.hidden; });
    expect(shown + hidden).toBe(idsOf(ExecutionController.fromSource(src).snapshot().current.expr).size);
  });

  it('gives each node a readable label and a detail with its role and source', () => {
    const view = viewAt('if 1 < 2 then [1, 2] else map (\\x -> x) []', 0);
    expect(view.root.label).toBe('if');
    expect(view.root.children.map((k) => k.detail.split(' · ')[0])).toEqual(['condition', 'then', 'else']);
    expect(view.root.children[1]!.label).toBe('list · 2');
    expect(view.root.children[0]!.detail).toBe('condition · operator: 1 < 2');
    expect(find(view, (n) => n.label === 'map')[0]!.builtin).toBe(true);
  });
});

describe('Syntax tree panel', () => {
  afterEach(cleanup);

  const treeTab = () => screen.getAllByRole('tab')[1]!;
  const listTab = () => screen.getAllByRole('tab')[0]!;
  const counter = () => screen.getByLabelText('Step counter').textContent?.replace(/\s+/g, ' ').trim();
  const labels = () => [...screen.getByRole('list', { name: 'Syntax tree' }).querySelectorAll('.tree-label')].map((l) => l.textContent);

  it('follows Next, Previous and Reset, and switching tabs never changes the step', () => {
    render(<App />);
    fireEvent.click(treeTab());
    const initial = labels();
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    const atTwo = labels();
    expect(atTwo).not.toEqual(initial);
    expect(counter()).toMatch(/^Step 2/);

    fireEvent.click(listTab());
    fireEvent.click(treeTab());
    expect(counter()).toMatch(/^Step 2/);
    expect(labels()).toEqual(atTwo);

    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    expect(labels()).toEqual(atTwo);

    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: /^Reset/ }));
    expect(labels()).toEqual(initial);
    expect(screen.getByRole('list', { name: 'Syntax tree' }).querySelector('.m-changed')).toBeNull();
  });

  it('keeps the DOM nodes of unaffected subtrees across a step', () => {
    render(<App />);
    fireEvent.click(treeTab());
    // After `map` expands, the list's later elements are untouched while element 0 reduces.
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    const tree = screen.getByRole('list', { name: 'Syntax tree' });
    const lastElement = tree.querySelector(':scope > li > ul > li:last-child')!;
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    expect(tree.querySelector(':scope > li > ul > li:last-child')).toBe(lastElement);
    expect(within(tree).getAllByText('apply').length).toBeGreaterThan(0);
  });
});
