/**
 * Focused small-step semantics and UI metadata. (Broader rule coverage and the
 * evaluator-agreement corpus live in reducer.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import {
  ExecutionController,
  IdGenerator,
  nodeAt,
  parse,
  printExpr,
  SmallStepReducer,
  substitute,
  type ReductionStep,
} from '../src/lang';

const p = printExpr;

/** Every step of the program, annotated by the execution history. */
function stepsOf(source: string): ReductionStep[] {
  const c = ExecutionController.fromSource(source);
  c.runToCompletion();
  return c.history.slice(1).map((e) => e.step!);
}

const statesOf = (source: string) => {
  const c = ExecutionController.fromSource(source);
  c.runToCompletion();
  return c.history.map((e) => e.source);
};

describe('single steps', () => {
  it('one arithmetic step rewrites only the redex', () => {
    const before = parse('2 + 3');
    const result = new SmallStepReducer().step(before);
    expect(result.status).toBe('step');
    if (result.status !== 'step') return;
    const { step } = result;
    expect(p(step.after)).toBe('5');
    expect(step.rule).toBe('arithmetic');
    expect(step.description).toBe('2 + 3 = 5');
    expect(step.redexId).toBe(before.id);
    expect(step.path).toEqual([]);
    expect(step.completes).toBe(true);
    expect(p(before)).toBe('2 + 3'); // input untouched
  });

  it('nested arithmetic reduces innermost-leftmost first, one operation per step', () => {
    expect(statesOf('1 + 2 * 3 - 4 / 2')).toEqual(['1 + 2 * 3 - 4 / 2', '1 + 6 - 4 / 2', '7 - 4 / 2', '7 - 2', '5']);
    expect(statesOf('(2 + 3) * (4 - (1 + 1))')).toEqual([
      '(2 + 3) * (4 - (1 + 1))',
      '5 * (4 - (1 + 1))',
      '5 * (4 - 2)',
      '5 * 2',
      '10',
    ]);
  });

  it('completes is true only on the last step', () => {
    expect(stepsOf('(1 + 1) * 2').map((s) => s.completes)).toEqual([false, true]);
  });

  it('nodes outside the redex keep their ids', () => {
    const before = parse('(1 + 2) * x');
    const result = new SmallStepReducer().step(before);
    if (result.status !== 'step') throw new Error('expected a step');
    const right = (before as Extract<typeof before, { kind: 'Binary' }>).right;
    expect(nodeAt(result.step.after, ['right'])).toBe(right);
    expect(result.step.after.id).toBe(before.id);
  });
});

describe('function application and beta reduction', () => {
  it('reduces the function, then the argument, then substitutes', () => {
    expect(statesOf('(if True then \\x -> x + 1 else \\x -> x) (2 * 3)')).toEqual([
      '(if True then \\x -> x + 1 else \\x -> x) (2 * 3)',
      '(\\x -> x + 1) (2 * 3)',
      '(\\x -> x + 1) 6',
      '6 + 1',
      '7',
    ]);
  });

  it('substitutes every free occurrence of the parameter', () => {
    expect(statesOf('(\\x -> [x, x * x]) 3')).toEqual(['(\\x -> [x, x * x]) 3', '[3, 3 * 3]', '[3, 9]']);
  });

  it('nested lambdas are curried one argument per beta step', () => {
    expect(statesOf('(\\a -> \\b -> \\c -> a - b - c) 10 2 3')).toEqual([
      '(\\a -> \\b -> \\c -> a - b - c) 10 2 3',
      '(\\b -> \\c -> 10 - b - c) 2 3',
      '(\\c -> 10 - 2 - c) 3',
      '10 - 2 - 3',
      '8 - 3',
      '5',
    ]);
  });

  it('inner binders shadow outer ones during substitution', () => {
    expect(statesOf('(\\x -> (\\x -> x * 10) (x + 1)) 1')).toEqual([
      '(\\x -> (\\x -> x * 10) (x + 1)) 1',
      '(\\x -> x * 10) (1 + 1)',
      '(\\x -> x * 10) 2',
      '2 * 10',
      '20',
    ]);
  });

  it('alpha-renames to avoid capturing a free variable', () => {
    // Open term: `y` is free in the value; substituting it under `\y` would capture it.
    const body = parse('\\y -> x + y');
    const ids = new IdGenerator();
    ids.reserveAbove(body);
    const value = parse('y', { ids });
    ids.reserveAbove(value);
    expect(p(substitute(body, 'x', value, ids))).toBe("\\y' -> y + y'");
    // (Under call-by-value an unbound `y` argument is itself a NameError, not a value.)
    const stuck = new SmallStepReducer().step(parse('(\\x -> \\y -> x + y) y'));
    expect(stuck.status === 'error' && stuck.error.kind).toBe('NameError');
    // In a closed program, capture can only involve free builtin names.
    expect(statesOf('(\\g -> \\map -> g [1, 2]) (map (\\n -> n * 3)) 0').slice(0, 2)).toEqual([
      '(\\g -> \\map -> g [1, 2]) (map (\\n -> n * 3)) 0',
      "(\\map' -> map (\\n -> n * 3) [1, 2]) 0",
    ]);
    expect(statesOf('(\\g -> \\map -> g [1, 2]) (map (\\n -> n * 3)) 0').at(-1)).toBe('[3, 6]');
  });

  it('closures see their defining scope (lexical scoping)', () => {
    const final = statesOf('let k = 2 in let f = \\x -> x * k in let k = 100 in f 5').at(-1);
    expect(final).toBe('10');
  });
});

describe('let, conditionals and booleans', () => {
  it('let reduces its value first, then substitutes', () => {
    expect(statesOf('let x = 2 + 3 in x * x')).toEqual(['let x = 2 + 3 in x * x', 'let x = 5 in x * x', '5 * 5', '25']);
  });

  it('nested lets substitute outer to inner', () => {
    expect(statesOf('let a = 1 in let b = a + 1 in a + b')).toEqual([
      'let a = 1 in let b = a + 1 in a + b',
      'let b = 1 + 1 in 1 + b',
      'let b = 2 in 1 + b',
      '1 + 2',
      '3',
    ]);
  });

  it('if reduces its condition, then selects a branch', () => {
    expect(statesOf('if 2 > 1 && 1 > 0 then 1 else 0')).toEqual([
      'if 2 > 1 && 1 > 0 then 1 else 0',
      'if True && 1 > 0 then 1 else 0',
      'if True && True then 1 else 0',
      'if True then 1 else 0',
      '1',
    ]);
  });

  it('|| short-circuits on True and && on False', () => {
    expect(statesOf('True || 1 / 0 > 1')).toEqual(['True || 1 / 0 > 1', 'True']);
    expect(statesOf('1 > 2 && undefinedName')).toEqual(['1 > 2 && undefinedName', 'False && undefinedName', 'False']);
    expect(statesOf('False || 3 == 3')).toEqual(['False || 3 == 3', 'False || True', 'True']);
  });
});

describe('map', () => {
  it('empty list: one step to []', () => {
    const steps = stepsOf('map (\\x -> x * 2) []');
    expect(steps.map((s) => [s.rule, p(s.after)])).toEqual([['map', '[]']]);
    expect(steps[0]!.completes).toBe(true);
  });

  it('single element', () => {
    expect(statesOf('map (\\x -> x + 1) [41]')).toEqual(['map (\\x -> x + 1) [41]', '[(\\x -> x + 1) 41]', '[41 + 1]', '[42]']);
  });

  it('multiple elements: active element, input, and before/after expressions', () => {
    const steps = stepsOf('map (\\x -> x * 10) [1, 2]');
    const meta = steps.map((s) =>
      s.listFocus
        ? {
            index: s.listFocus.index,
            input: p(s.listFocus.origin!.input),
            fn: p(s.listFocus.origin!.fn),
            before: p(s.listFocus.elementBefore),
            after: p(s.listFocus.elementAfter!),
          }
        : s.rule,
    );
    expect(meta).toEqual([
      'map',
      { index: 0, input: '1', fn: '\\x -> x * 10', before: '(\\x -> x * 10) 1', after: '1 * 10' },
      { index: 0, input: '1', fn: '\\x -> x * 10', before: '1 * 10', after: '10' },
      { index: 1, input: '2', fn: '\\x -> x * 10', before: '(\\x -> x * 10) 2', after: '2 * 10' },
      { index: 1, input: '2', fn: '\\x -> x * 10', before: '2 * 10', after: '20' },
    ]);
  });

  it('the focused element path points into the list in both snapshots', () => {
    for (const step of stepsOf('map (\\x -> x - 1) [5, 6, 7]').slice(1)) {
      const focus = step.listFocus!;
      const path = [...focus.listPath, ['elements', focus.index] as const];
      expect(nodeAt(step.before, path)).toBe(focus.elementBefore);
      expect(nodeAt(step.after, path)).toBe(focus.elementAfter);
      expect(nodeAt(step.after, focus.listPath)!.id).toBe(focus.listId);
    }
  });

  it('a literal list (not produced by map) has focus but no map origin', () => {
    const [step] = stepsOf('[1 + 1, 2]');
    expect(step!.listFocus!.index).toBe(0);
    expect(step!.listFocus!.origin).toBeUndefined();
  });

  it('elements that are already values are skipped without a step', () => {
    expect(statesOf('map (\\x -> x) [1, 2]')).toEqual(['map (\\x -> x) [1, 2]', '[(\\x -> x) 1, (\\x -> x) 2]', '[1, (\\x -> x) 2]', '[1, 2]']);
  });
});

describe('fold', () => {
  const f = '(\\acc -> \\x -> acc + x)';

  it('empty list: one step to the initial value', () => {
    const steps = stepsOf(`fold ${f} 7 []`);
    expect(steps.map((s) => [s.rule, p(s.after)])).toEqual([['fold-done', '7']]);
    expect(steps[0]!.foldFocus).toMatchObject({ phase: 'finish' });
    expect(p(steps[0]!.foldFocus!.accumulatorAfter)).toBe('7');
  });

  it('single element', () => {
    expect(statesOf(`fold ${f} 10 [5]`)).toEqual([
      `fold ${f} 10 [5]`,
      `fold ${f} (${f} 10 5) []`,
      `fold ${f} ((\\x -> 10 + x) 5) []`,
      `fold ${f} (10 + 5) []`,
      `fold ${f} 15 []`,
      '15',
    ]);
  });

  it('multiple elements: phases, active element index and accumulator updates', () => {
    const steps = stepsOf(`fold ${f} 0 [4, 5]`);
    const meta = steps.map((s) => {
      const ff = s.foldFocus!;
      return [ff.phase, ff.index, p(ff.accumulatorBefore), p(ff.accumulatorAfter), ff.element && p(ff.element)];
    });
    expect(meta).toEqual([
      ['consume', 0, '0', `${f} 0 4`, '4'],
      ['accumulate', 0, `${f} 0 4`, '(\\x -> 0 + x) 4', undefined],
      ['accumulate', 0, '(\\x -> 0 + x) 4', '0 + 4', undefined],
      ['accumulate', 0, '0 + 4', '4', undefined],
      ['consume', 1, '4', `${f} 4 5`, '5'],
      ['accumulate', 1, `${f} 4 5`, '(\\x -> 4 + x) 5', undefined],
      ['accumulate', 1, '(\\x -> 4 + x) 5', '4 + 5', undefined],
      ['accumulate', 1, '4 + 5', '9', undefined],
      ['finish', undefined, '9', '9', undefined],
    ]);
    // The original list stays available for highlighting, and the list id is stable.
    expect(new Set(steps.map((s) => s.foldFocus!.original!.map(p).join()))).toEqual(new Set(['4,5']));
    expect(new Set(steps.map((s) => s.foldFocus!.listId)).size).toBe(1);
  });

  it('accumulator and list paths point at the right sub-expressions', () => {
    for (const step of stepsOf(`fold ${f} 0 [1, 2, 3]`)) {
      const ff = step.foldFocus!;
      expect(nodeAt(step.after, ff.accumulatorPath)).toBe(ff.accumulatorAfter);
      if (ff.listPath) expect(nodeAt(step.after, ff.listPath)!.kind).toBe('List');
    }
  });

  it('uses the left-fold convention (accumulator first)', () => {
    expect(statesOf('fold (\\acc -> \\x -> acc - x) 10 [1, 2]').at(-1)).toBe('7');
    expect(statesOf('fold (\\acc -> \\x -> [acc, x]) [] [1, 2]').at(-1)).toBe('[[[], 1], 2]');
  });

  it('a fold nested in a map element reports both foci', () => {
    const steps = stepsOf('map (fold (\\a -> \\b -> a + b) 0) [[1]]');
    const inner = steps.find((s) => s.rule === 'fold-step')!;
    expect(inner.listFocus!.index).toBe(0);
    expect(inner.foldFocus!.phase).toBe('consume');
    expect(statesOf('map (fold (\\a -> \\b -> a + b) 0) [[1]]').at(-1)).toBe('[1]');
  });
});

describe('errors', () => {
  it('undefined variable', () => {
    const c = ExecutionController.fromSource('let x = 1 in x + y');
    const outcome = c.runToCompletion();
    expect(c.history.map((e) => e.source)).toEqual(['let x = 1 in x + y', '1 + y']);
    expect(outcome.status === 'error' && outcome.error.kind).toBe('NameError');
  });

  it('applying a non-function', () => {
    const outcome = ExecutionController.fromSource('(\\x -> x 1) 2').runToCompletion();
    expect(outcome.status === 'error' && outcome.error.message).toMatch(/Cannot apply number 2/);
  });

  it('map on a non-list, fold with a non-function', () => {
    const a = ExecutionController.fromSource('map (\\x -> x) 3').runToCompletion();
    expect(a.status === 'error' && a.error.kind).toBe('TypeError');
    const b = ExecutionController.fromSource('fold 0 0 [1]').runToCompletion();
    expect(b.status === 'error' && b.error.message).toMatch(/fold expects a function/);
  });

  it('a failing map element reports which element failed', () => {
    const c = ExecutionController.fromSource('map (\\x -> 6 / x) [3, 0, 1]');
    const outcome = c.runToCompletion();
    expect(c.current.source).toBe('[2, 6 / 0, (\\x -> 6 / x) 1]');
    expect(outcome.status === 'error' && outcome.listFocus?.index).toBe(1);
  });
});
