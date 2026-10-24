import { describe, expect, it } from 'vitest';
import { buildSegments, tokenClasses } from '../src/app/model/highlight';
import { deriveFoldView, deriveMapView, RULES, type Position } from '../src/app/model/visualization';
import { ExecutionController, parse, printExpr, printWithRanges, type Expr } from '../src/lang';

const p = printExpr;

/** Controller positioned at `index`, as a view-model Position. */
function positionAt(source: string, index: number): Position {
  const c = ExecutionController.fromSource(source);
  c.goTo(index);
  const snap = c.snapshot();
  const failure = snap.status === 'error' && snap.outcome?.status === 'error' ? snap.outcome : undefined;
  return { history: c.history.slice(), index: snap.index, ...(snap.next ? { next: snap.next } : {}), ...(failure ? { failure } : {}) };
}

describe('deriveMapView', () => {
  const src = 'map (\\x -> x * 2) [1, 2, 3]';

  it('before expansion shows the inputs as pending', () => {
    const view = deriveMapView(positionAt(src, 0))!;
    expect(view.phase).toBe('expanding');
    expect(p(view.fn)).toBe('\\x -> x * 2');
    expect(view.elements.map((e) => [p(e.input!), e.status])).toEqual([
      ['1', 'pending'],
      ['2', 'pending'],
      ['3', 'pending'],
    ]);
  });

  it('tracks the active element, its input and current expression at every state', () => {
    const statuses = [1, 2, 3, 4, 5, 6, 7].map((i) => {
      const view = deriveMapView(positionAt(src, i))!;
      return [view.activeIndex, view.elements.map((e) => e.status[0]).join(''), view.elements.map((e) => p(e.current!)).join(' | ')];
    });
    expect(statuses).toEqual([
      [0, 'app', '(\\x -> x * 2) 1 | (\\x -> x * 2) 2 | (\\x -> x * 2) 3'],
      [0, 'app', '1 * 2 | (\\x -> x * 2) 2 | (\\x -> x * 2) 3'],
      [1, 'dap', '2 | (\\x -> x * 2) 2 | (\\x -> x * 2) 3'],
      [1, 'dap', '2 | 2 * 2 | (\\x -> x * 2) 3'],
      [2, 'dda', '2 | 4 | (\\x -> x * 2) 3'],
      [2, 'dda', '2 | 4 | 3 * 2'],
      [undefined, 'ddd', '2 | 4 | 6'],
    ]);
    const done = deriveMapView(positionAt(src, 7))!;
    expect(done.phase).toBe('complete');
    expect(done.elements.map((e) => p(e.input!))).toEqual(['1', '2', '3']);
  });

  it('marks the element that failed', () => {
    const c = ExecutionController.fromSource('map (\\x -> 10 / x) [5, 0]');
    c.runToCompletion();
    const view = deriveMapView(positionAt('map (\\x -> 10 / x) [5, 0]', c.index))!;
    expect(view.elements.map((e) => e.status)).toEqual(['done', 'error']);
  });

  it('is absent for programs without map', () => {
    expect(deriveMapView(positionAt('(1 + 2) * 3', 1))).toBeUndefined();
  });

  it('stops describing a mapped list once a fold starts consuming it', () => {
    const pipeline = 'fold (\\a -> \\x -> a + x) 0 (map (\\x -> x) [1, 2])';
    const c = ExecutionController.fromSource(pipeline);
    c.runToCompletion();
    const firstFold = c.history.findIndex((e) => e.step?.rule === 'fold-step');
    expect(deriveMapView(positionAt(pipeline, firstFold - 1))?.phase).toBe('complete');
    expect(deriveMapView(positionAt(pipeline, firstFold))).toBeUndefined();
  });
});

describe('deriveFoldView', () => {
  const src = 'fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]';

  it('starts with all elements pending except the one about to be consumed', () => {
    const view = deriveFoldView(positionAt(src, 0))!;
    expect(view.phase).toBe('consume');
    expect(view.elements.map((e) => e.status)).toEqual(['active', 'pending', 'pending']);
    expect(p(view.accumulator)).toBe('0');
    expect(view.timeline.map(p)).toEqual(['0']);
    expect(view.consumedCount).toBe(0);
  });

  it('counts the element being combined as consumed', () => {
    const view = deriveFoldView(positionAt(src, 2))!; // fold f ((\x -> 0 + x) 1) [2, 3]
    expect(view.phase).toBe('accumulate');
    expect(view.activeIndex).toBe(0);
    expect(view.consumedCount).toBe(1);
  });

  it('derives progress and accumulator from the real history', () => {
    const c = ExecutionController.fromSource(src);
    c.runToCompletion();
    for (let i = 0; i <= c.knownSteps; i++) {
      const pos = positionAt(src, i);
      const view = deriveFoldView(pos)!;
      const meta = pos.next?.foldFocus;
      // The active element always matches the reducer's own fold metadata.
      if (meta && meta.phase !== 'finish') expect(view.activeIndex).toBe(meta.index);
      // The accumulator shown is the sub-expression actually in the current AST.
      if (meta) expect(view.accumulator).toBe(meta.accumulatorBefore);
    }
    // Timeline only contains accumulator values that occurred in history.
    expect(deriveFoldView(positionAt(src, 4))!.timeline.map(p)).toEqual(['0', '1']);
    expect(deriveFoldView(positionAt(src, 8))!.timeline.map(p)).toEqual(['0', '1', '3']);
    const done = deriveFoldView(positionAt(src, c.knownSteps))!;
    expect(done.phase).toBe('complete');
    expect(done.timeline.map(p)).toEqual(['0', '1', '3', '6']);
    expect(done.elements.map((e) => e.status)).toEqual(['consumed', 'consumed', 'consumed']);
  });

  it('reports the accumulator transition made by the last step', () => {
    const view = deriveFoldView(positionAt(src, 4))!; // after 0 + 1 = 1
    expect(view.lastTransition && [p(view.lastTransition.before), p(view.lastTransition.after)]).toEqual(['0 + 1', '1']);
    // Element 0 is folded in; element 1 is the next to be consumed.
    expect(view.elements.map((e) => e.status)).toEqual(['consumed', 'active', 'pending']);
  });

  it('handles empty and single-element lists', () => {
    const empty = deriveFoldView(positionAt('fold (\\a -> \\x -> a) 9 []', 0))!;
    expect(empty.elements).toEqual([]);
    expect(empty.phase).toBe('finish');
    const single = deriveFoldView(positionAt('fold (\\a -> \\x -> a + x) 1 [5]', 4))!;
    expect(p(single.accumulator)).toBe('6');
    expect(single.elements.map((e) => e.status)).toEqual(['consumed']);
  });
});

describe('highlighting', () => {
  it('marks a node by id, not by matching text', () => {
    // Both list elements print as `1 + 1`; only the second one should be marked.
    const ast = parse('[1 + 1, 1 + 1]') as Extract<Expr, { kind: 'List' }>;
    const { text, ranges } = printWithRanges(ast);
    const segments = buildSegments(text, ranges, [[ast.elements[1]!.id, 'redex']]);
    const marked = segments.filter((s) => s.marks.includes('redex')).map((s) => s.text).join('');
    expect(marked).toBe('1 + 1');
    const firstMarked = segments.findIndex((s) => s.marks.includes('redex'));
    expect(segments.slice(0, firstMarked).map((s) => s.text).join('')).toBe('[1 + 1, ');
  });

  it('colours tokens with the real lexer, including comments', () => {
    const classes = tokenClasses('let x = 1 -- note');
    expect(classes[0]).toBe('kw');
    expect(classes[4]).toBe('ident');
    expect(classes[8]).toBe('num');
    expect(classes[12]).toBe('comment');
  });

  it('survives source that does not lex', () => {
    expect(() => tokenClasses('1 $ 2')).not.toThrow();
  });

  it('has an explanation for every reduction rule', () => {
    for (const info of Object.values(RULES)) expect(info.explanation.length).toBeGreaterThan(30);
  });
});
