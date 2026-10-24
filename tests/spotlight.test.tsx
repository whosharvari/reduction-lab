// @vitest-environment jsdom
/** Reduction Spotlight: derived from real step metadata, located by node id, in step with the syntax tree. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { EXAMPLES } from '../src/app/examples';
import { deriveSpotlight, partsToText, type SpotlightView } from '../src/app/model/spotlight';
import { deriveTreeView, type TreeNode } from '../src/app/model/tree';
import { ExecutionController, IdGenerator, parse, printExpr, substitute, type Expr, type ExecutionSnapshot } from '../src/lang';

function snapAt(source: string, index: number): ExecutionSnapshot {
  const c = ExecutionController.fromSource(source);
  c.goTo(index);
  return c.snapshot();
}

type StepView = Extract<SpotlightView, { kind: 'step' }>;

function stepAt(source: string, index: number): StepView {
  const view = deriveSpotlight(snapAt(source, index));
  if (view.kind !== 'step') throw new Error(`expected a step at ${index}, got ${view.kind}`);
  return view;
}

const text = (v: StepView) => partsToText(v.explanation);
const example = (title: string) => EXAMPLES.find((e) => e.title === title)!.source;

function treeIds(node: TreeNode, mark: 'redex' | 'changed' | 'error', out: number[] = []): number[] {
  if (node.marks.includes(mark)) out.push(node.id);
  for (const kid of node.children) treeIds(kid, mark, out);
  return out;
}

describe('deriveSpotlight: rules, fragments and explanations', () => {
  it('beta reduction: the redex, its replacement, and the substitution that happened', () => {
    const v = stepAt('(\\x -> x * 2) 3', 1);
    expect(v.rule).toBe('beta');
    expect(v.name).toBe('β-reduction');
    expect(printExpr(v.redex)).toBe('(\\x -> x * 2) 3');
    expect(printExpr(v.replacement)).toBe('3 * 2');
    expect(text(v)).toBe('Each free x in the lambda body is replaced by the argument 3 (1 occurrence).');
    expect(text(stepAt('(\\x -> x + x) 4', 1))).toMatch(/\(2 occurrences\)/);
  });

  it('beta reduction: an unused parameter discards the argument, and capture-avoiding renames are reported', () => {
    expect(text(stepAt('(\\x -> 5) 3', 1))).toBe('x does not occur in the lambda body, so the argument 3 is discarded.');
    const renamed = stepAt("(\\x -> \\y -> x) (\\z -> y)", 1);
    expect(printExpr(renamed.replacement)).toBe("\\y' -> \\z -> y");
    expect(text(renamed)).toMatch(/The inner binder y was renamed to y' so it cannot capture/);
  });

  it('arithmetic: before and after fragments are the real sub-expressions', () => {
    const v = stepAt('1 + 2 * 3', 1);
    expect(v.rule).toBe('arithmetic');
    expect(printExpr(v.redex)).toBe('2 * 3');
    expect(printExpr(v.replacement)).toBe('6');
    expect(printExpr(v.context)).toBe('1 + 2 * 3');
    expect(text(v)).toBe('2 * 3 is computed from two numbers, giving 6.');
    expect(text(stepAt('3 < 4', 1))).toBe('3 < 4 compares two values, giving True.');
    expect(text(stepAt('-(2 + 1)', 2))).toBe('Unary minus turns 3 into the number -3.');
  });

  it('let substitution names the bound variable and value', () => {
    const v = stepAt(example('Let binding'), 1);
    expect(v.rule).toBe('let');
    expect(v.name).toBe('Let substitution');
    expect(text(v)).toBe('Each free x in the body is replaced by the bound value 10 (1 occurrence).');
  });

  it('conditional: identifies the branch actually kept', () => {
    const then = stepAt('if 1 < 2 then 10 else 20', 2);
    expect(then.rule).toBe('if');
    expect(printExpr(then.replacement)).toBe('10');
    expect(text(then)).toBe('The condition is True, so the then branch 10 remains; 20 is discarded unevaluated.');
    const otherwise = stepAt('if False then 1 + 1 else 2 * 3', 1);
    expect(printExpr(otherwise.replacement)).toBe('2 * 3');
    expect(text(otherwise)).toBe('The condition is False, so the else branch 2 * 3 remains; 1 + 1 is discarded unevaluated.');
  });

  it('boolean logic distinguishes short-circuiting from taking the right operand', () => {
    expect(text(stepAt('False && 1 / 0 == 1', 1))).toMatch(/decides && on its own, so the right side is dropped without being evaluated/);
    expect(text(stepAt('True && False', 1))).toBe('The left operand True does not decide &&, so the result is the right operand False.');
  });

  it('map and fold steps use their real rule and values', () => {
    const map = stepAt(example('Map'), 1);
    expect(map.name).toBe('Map expansion');
    expect(text(map)).toBe('map expands into a list of 3 applications of \\x -> x * 2, one per element; they reduce left to right in the next steps.');

    const fold = stepAt(example('Fold'), 1);
    expect(fold.name).toBe('Fold step');
    expect(text(fold)).toBe('The front element 1 is combined with the accumulator 0 by the folding function; 2 elements remain to fold.');

    const c = ExecutionController.fromSource(example('Fold'));
    c.goTo(Number.MAX_SAFE_INTEGER);
    const last = deriveSpotlight(c.snapshot()) as StepView;
    expect(last.name).toBe('Fold complete');
    expect(text(last)).toBe('The list is empty, so the fold is replaced by its accumulator 6.');
    expect(last.completes).toBe(true);
    expect(text(stepAt('map (\\x -> x) []', 1))).toBe('map over the empty list gives [].');
  });

  it('never confuses identical sub-expressions in different branches', () => {
    const src = '(1 + 1) * (1 + 1)';
    const initial = snapAt(src, 0).current.expr as Extract<Expr, { kind: 'Binary' }>;
    const first = stepAt(src, 1);
    expect(first.redexId).toBe(initial.left.id);
    expect(first.redexId).not.toBe(initial.right.id);
    expect(printExpr(first.context)).toBe(src);
    const second = stepAt(src, 2);
    expect(second.redexId).toBe(initial.right.id);
    expect(printExpr(second.context)).toBe('2 * (1 + 1)');
  });
});

describe('deriveSpotlight: states without a step', () => {
  it('the initial state has no stale explanation, only the upcoming redex', () => {
    const c = ExecutionController.fromSource(example('Map'));
    c.goTo(3);
    c.goTo(0);
    const snap = c.snapshot();
    const view = deriveSpotlight(snap);
    expect(view.kind).toBe('idle');
    if (view.kind !== 'idle') return;
    expect(view.next?.redexId).toBe(snap.next!.redexId);
    expect(view.next?.name).toBe('Map expansion');
    expect('explanation' in view).toBe(false);
  });

  it('a program that is already a value says so', () => {
    expect(deriveSpotlight(snapAt('42', 0))).toEqual({ kind: 'idle', alreadyValue: true });
  });

  it('a runtime error is shown as stuck, not as a successful reduction', () => {
    const c = ExecutionController.fromSource(example('Runtime error'));
    c.goTo(Number.MAX_SAFE_INTEGER);
    const view = deriveSpotlight(c.snapshot());
    expect(view.kind).toBe('error');
    if (view.kind !== 'error') return;
    expect(view.errorKind).toBe('RuntimeError');
    expect(view.message).toMatch(/Division by zero/);
    expect(printExpr(view.stuck!)).toBe('10 / 0');
    expect(view.stuckLabel).toBe('/');
    expect(view.lastStep?.name).toBe('β-reduction');
    // Stuck on the very first state: no previous step to mention.
    const immediate = deriveSpotlight(snapAt('1 / 0', 0));
    expect(immediate.kind === 'error' && immediate.lastStep).toBeFalsy();
  });
});

describe('spotlight and syntax tree agree', () => {
  it('for every state of every example, they mark the same redex, replacement and stuck node', () => {
    for (const ex of EXAMPLES) {
      const c = ExecutionController.fromSource(ex.source);
      c.goTo(Number.MAX_SAFE_INTEGER);
      const end = c.snapshot().index;
      for (let i = 0; i <= end; i++) {
        c.goTo(i);
        const snap = c.snapshot();
        const spot = deriveSpotlight(snap);
        const tree = deriveTreeView(snap).root;
        const where = `${ex.title} state ${i}`;
        if (spot.kind === 'step') {
          expect(treeIds(tree, 'changed'), where).toEqual([spot.replacementId]);
          expect(spot.redexId, where).toBe(snap.current.step!.redexId);
        } else if (spot.kind === 'idle') {
          expect(treeIds(tree, 'changed'), where).toEqual([]);
          expect(treeIds(tree, 'redex'), where).toEqual(spot.next ? [spot.next.redexId] : []);
        } else {
          expect(treeIds(tree, 'error'), where).toEqual(spot.stuckId !== undefined ? [spot.stuckId] : []);
        }
      }
    }
  });
});

describe('the reducer is unchanged by the new metadata', () => {
  it('substitution returns the same tree whether or not stats are collected', () => {
    for (const src of ['\\y -> x + y', "\\x -> x", '\\y -> \\z -> x y z', 'let y = x in y']) {
      const body = parse(src);
      const value = parse('\\z -> y');
      const a = substitute(body, 'x', value, new IdGenerator(1000));
      const b = substitute(body, 'x', value, new IdGenerator(1000), { occurrences: 0, renamed: [] });
      expect(b).toEqual(a);
    }
  });
});

describe('Reduction spotlight panel', () => {
  afterEach(cleanup);

  const panel = () => screen.getByRole('region', { name: 'Reduction spotlight' });
  const next = () => fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
  const counter = () => screen.getByLabelText('Step counter').textContent?.replace(/\s+/g, ' ').trim();
  const chooseExample = (title: string) =>
    fireEvent.click(screen.getAllByRole('button').find((b) => b.querySelector('.example-title')?.textContent === title)!);

  it('follows Next, Previous, Reset and Run to end', () => {
    render(<App />);
    expect(within(panel()).getByLabelText('No step applied yet').textContent).toMatch(/First up: Map expansion/);
    expect(within(panel()).queryByLabelText('Latest rewrite')).toBeNull();

    next();
    expect(within(panel()).getByLabelText('Latest rewrite').textContent).toMatch(/Map expansion/);
    next();
    expect(within(panel()).getByLabelText('Latest rewrite').textContent).toMatch(/β-reduction.*Each free x in the lambda body is replaced by the argument 1/);

    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(within(panel()).getByLabelText('Latest rewrite').textContent).toMatch(/Map expansion/);

    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: /^Reset/ }));
    expect(within(panel()).queryByLabelText('Latest rewrite')).toBeNull();
    expect(within(panel()).getByLabelText('No step applied yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Run to end/ }));
    expect(within(panel()).getByLabelText('Latest rewrite').textContent).toMatch(/That was the final step/);
  });

  it('shows a stuck state for a runtime error, with no before/after pair', () => {
    render(<App />);
    chooseExample('Runtime error');
    fireEvent.click(screen.getByRole('button', { name: /Run to end/ }));
    const stuck = within(panel()).getByLabelText('Stuck reduction');
    expect(stuck.textContent).toMatch(/No reduction possible/);
    expect(stuck.textContent).toMatch(/RuntimeError: Division by zero/);
    expect(within(panel()).queryByLabelText('Latest rewrite')).toBeNull();
    expect(within(stuck).getByLabelText('Stuck redex').textContent).toBe('10 / 0');
  });

  it('the spotlight tree badge and the tree highlight the same node; switching tabs keeps the step', () => {
    render(<App />);
    next();
    next();
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    const tree = screen.getByRole('list', { name: 'Syntax tree' });
    const badge = panel().querySelector('.spotlight-tree .tree-label')!;
    const node = tree.querySelector('.tree-label.m-changed')!;
    expect(node.textContent).toBe(badge.textContent);
    // Same mark classes, so the same colour: here `1 * 2` was just produced and also reduces next.
    expect([...badge.classList].filter((c) => c.startsWith('m-')).sort()).toEqual(['m-changed', 'm-redex']);
    expect([...node.classList].filter((c) => c.startsWith('m-')).sort()).toEqual(['m-changed', 'm-redex']);

    const before = panel().textContent;
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    expect(counter()).toMatch(/^Step 2/);
    expect(panel().textContent).toBe(before);
  });
});
