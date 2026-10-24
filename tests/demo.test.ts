/**
 * Locks down every program and expected result quoted in docs/DEMO.md, so the
 * demo script cannot silently drift from what the engine actually does.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/app/examples';
import { EXECUTION_LIMITS } from '../src/app/useExecution';
import { ExecutionController, formatValue, LangError, parse, printExpr, run } from '../src/lang';

function trace(source: string) {
  const c = ExecutionController.fromSource(source, EXECUTION_LIMITS);
  const outcome = c.runToCompletion();
  return { c, outcome, states: c.history.map((e) => e.source), rules: c.history.slice(1).map((e) => e.step!.rule) };
}

const example = (id: string) => {
  const found = EXAMPLES.find((e) => e.id === id);
  if (!found) throw new Error(`missing example ${id}`);
  return found;
};

describe('docs/DEMO.md', () => {
  it('1. nested arithmetic reduces one operation per step', () => {
    const { states, outcome } = trace(example('arithmetic').source);
    expect(example('arithmetic').source).toBe('(2 + 3) * (10 - 4) / 2');
    expect(states).toEqual(['(2 + 3) * (10 - 4) / 2', '5 * (10 - 4) / 2', '5 * 6 / 2', '30 / 2', '15']);
    expect(outcome.status === 'done' && printExpr(outcome.expr)).toBe('15');
  });

  it('2a. lambda application: let substitution then β-reduction', () => {
    const { states, rules } = trace(example('twice').source);
    expect(states).toEqual([
      'let twice = \\f -> \\x -> f (f x) in twice (\\n -> n + 3) 10',
      '(\\f -> \\x -> f (f x)) (\\n -> n + 3) 10',
      '(\\x -> (\\n -> n + 3) ((\\n -> n + 3) x)) 10',
      '(\\n -> n + 3) ((\\n -> n + 3) 10)',
      '(\\n -> n + 3) (10 + 3)',
      '(\\n -> n + 3) 13',
      '13 + 3',
      '16',
    ]);
    expect(rules).toEqual(['let', 'beta', 'beta', 'beta', 'arithmetic', 'beta', 'arithmetic']);
  });

  it('2b. capture-avoiding substitution renames the binder', () => {
    const { states, outcome } = trace('(\\f -> \\map -> f [1, 2]) (map (\\n -> n * 3)) 0');
    expect(states[1]).toBe("(\\map' -> map (\\n -> n * 3) [1, 2]) 0");
    expect(outcome.status === 'done' && printExpr(outcome.expr)).toBe('[3, 6]');
  });

  it('3. map: expansion, then one element at a time', () => {
    const { c, states } = trace(example('map').source);
    expect(states[1]).toBe('[(\\x -> x * 2) 1, (\\x -> x * 2) 2, (\\x -> x * 2) 3]');
    expect(states.at(-1)).toBe('[2, 4, 6]');
    expect(states).toHaveLength(8); // 7 steps
    expect(c.history.slice(1).map((e) => e.step!.listFocus?.index)).toEqual([undefined, 0, 0, 1, 1, 2, 2]);
  });

  it('4. fold: the accumulator goes 0 → 1 → 3 → 6 over 13 steps', () => {
    const { c, states } = trace(example('fold').source);
    expect(states).toHaveLength(14);
    expect(states[5]).toBe('fold (\\acc -> \\x -> acc + x) ((\\acc -> \\x -> acc + x) 1 2) [3]');
    expect(c.history[5]!.step!.foldFocus).toMatchObject({ phase: 'consume', index: 1 });
    const accumulatorValues = [0, 4, 8, 12].map((i) => states[i]!.match(/^fold \(.+?\) (\d+) \[/)![1]);
    expect(accumulatorValues).toEqual(['0', '1', '3', '6']);
    expect(states.at(-1)).toBe('6');
  });

  it('5. map-then-fold: the map finishes (step 7) before the fold starts (step 8)', () => {
    const { states, rules } = trace(example('pipeline').source);
    expect(states[7]).toBe('fold (\\acc -> \\x -> acc + x) 0 [1, 4, 9]');
    expect(rules[7]).toBe('fold-step'); // step 8
    expect(rules.slice(0, 7)).not.toContain('fold-step');
    expect(states).toHaveLength(21); // 20 steps
    expect(states.at(-1)).toBe('14');
  });

  it('7a. runtime error: reduction stops at the stuck redex', () => {
    const { states, outcome } = trace(example('error').source);
    expect(example('error').source).toBe('map (\\x -> 10 / x) [5, 2, 0]');
    expect(states.at(-1)).toBe('[2, 5, 10 / 0]');
    expect(states).toHaveLength(7); // stops at step 6
    expect(outcome.status === 'error' && `${outcome.error.kind}: ${outcome.error.message}`).toBe('RuntimeError: Division by zero');
    expect(outcome.status === 'error' && outcome.listFocus?.index).toBe(2);
  });

  it('7b. malformed programs give positioned syntax errors', () => {
    const errorOf = (source: string) => {
      try {
        parse(source);
      } catch (error) {
        return (error as LangError).format(source);
      }
      throw new Error('expected a syntax error');
    };
    expect(errorOf('map (\\x -> x * ) [1, 2]')).toBe(
      "SyntaxError at 1:16: Expected an expression, but found ')'\n1 | map (\\x -> x * ) [1, 2]\n  |                ^",
    );
    expect(errorOf('map \\x -> x * 2 [1, 2, 3]').split('\n')[0]).toBe(
      "SyntaxError at 1:5: Unexpected '\\' after the end of the expression. To pass a lambda as an argument, wrap it in parentheses",
    );
  });

  it('every quoted result agrees with the big-step evaluator', () => {
    for (const id of ['arithmetic', 'twice', 'map', 'fold', 'pipeline']) {
      const { outcome } = trace(example(id).source);
      expect(outcome.status === 'done' && printExpr(outcome.expr)).toBe(formatValue(run(example(id).source)));
    }
  });
});
