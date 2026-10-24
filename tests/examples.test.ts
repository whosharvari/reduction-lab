import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/app/examples';
import { ExecutionController, formatValue, isLangError, parse, printExpr, run } from '../src/lang';
import { EXECUTION_LIMITS } from '../src/app/useExecution';

describe('UI examples', () => {
  it('include the required concepts', () => {
    const sources = EXAMPLES.map((e) => e.source);
    expect(sources).toEqual(
      expect.arrayContaining([
        '(\\x -> x * 2) 5',
        'let x = 10 in x + 2',
        'map (\\x -> x * 2) [1, 2, 3]',
        'fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]',
      ]),
    );
    expect(EXAMPLES.map((e) => e.id)).toEqual(expect.arrayContaining(['arithmetic', 'conditional', 'twice']));
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
  });

  it.each(EXAMPLES)('$title parses and produces $expected', (example) => {
    expect(() => parse(example.source)).not.toThrow();
    expect(example.explanation.length).toBeGreaterThan(20);

    // Big-step evaluator
    let evaluated: string;
    try {
      evaluated = formatValue(run(example.source));
    } catch (error) {
      if (!isLangError(error)) throw error;
      evaluated = error.kind;
    }
    expect(evaluated).toBe(example.expected);

    // Small-step reducer, through the same controller and limits the UI uses
    const outcome = ExecutionController.fromSource(example.source, EXECUTION_LIMITS).runToCompletion();
    const reduced = outcome.status === 'done' ? printExpr(outcome.expr) : outcome.error.kind;
    expect(reduced).toBe(example.expected);
  });
});
