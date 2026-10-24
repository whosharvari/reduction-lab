/**
 * The four representative programs, end to end: source -> small-step history
 * -> final value, checked against the big-step evaluator.
 */
import { describe, expect, it } from 'vitest';
import { ExecutionController, formatValue, printExpr, run } from '../src/lang';

const f = '(\\acc -> \\x -> acc + x)';

const PROGRAMS: ReadonlyArray<{ source: string; expected: string; states: string[] }> = [
  {
    source: '(\\x -> x * 2) 5',
    expected: '10',
    states: ['(\\x -> x * 2) 5', '5 * 2', '10'],
  },
  {
    source: 'let x = 10 in x + 2',
    expected: '12',
    states: ['let x = 10 in x + 2', '10 + 2', '12'],
  },
  {
    source: 'map (\\x -> x * 2) [1, 2, 3]',
    expected: '[2, 4, 6]',
    states: [
      'map (\\x -> x * 2) [1, 2, 3]',
      '[(\\x -> x * 2) 1, (\\x -> x * 2) 2, (\\x -> x * 2) 3]',
      '[1 * 2, (\\x -> x * 2) 2, (\\x -> x * 2) 3]',
      '[2, (\\x -> x * 2) 2, (\\x -> x * 2) 3]',
      '[2, 2 * 2, (\\x -> x * 2) 3]',
      '[2, 4, (\\x -> x * 2) 3]',
      '[2, 4, 3 * 2]',
      '[2, 4, 6]',
    ],
  },
  {
    source: `fold ${f} 0 [1, 2, 3]`,
    expected: '6',
    states: [
      `fold ${f} 0 [1, 2, 3]`,
      `fold ${f} (${f} 0 1) [2, 3]`,
      `fold ${f} ((\\x -> 0 + x) 1) [2, 3]`,
      `fold ${f} (0 + 1) [2, 3]`,
      `fold ${f} 1 [2, 3]`,
      `fold ${f} (${f} 1 2) [3]`,
      `fold ${f} ((\\x -> 1 + x) 2) [3]`,
      `fold ${f} (1 + 2) [3]`,
      `fold ${f} 3 [3]`,
      `fold ${f} (${f} 3 3) []`,
      `fold ${f} ((\\x -> 3 + x) 3) []`,
      `fold ${f} (3 + 3) []`,
      `fold ${f} 6 []`,
      '6',
    ],
  },
];

describe.each(PROGRAMS)('$source', ({ source, expected, states }) => {
  it(`reduces step by step to ${expected}`, () => {
    const c = ExecutionController.fromSource(source);
    const outcome = c.runToCompletion();
    expect(outcome.status).toBe('done');
    expect(c.history.map((e) => e.source)).toEqual(states);
    expect(printExpr(outcome.expr)).toBe(expected);
  });

  it('agrees with the big-step evaluator', () => {
    const outcome = ExecutionController.fromSource(source).runToCompletion();
    expect(printExpr(outcome.expr)).toBe(formatValue(run(source)));
  });

  it('can be replayed backwards to the initial state', () => {
    const c = ExecutionController.fromSource(source);
    c.runToCompletion();
    const backwards: string[] = [c.current.source];
    while (c.previous()) backwards.push(c.current.source);
    expect(backwards).toEqual([...states].reverse());
  });
});
