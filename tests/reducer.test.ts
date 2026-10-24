import { describe, expect, it } from 'vitest';
import {
  children,
  evaluate,
  IdGenerator,
  isLangError,
  isValue,
  nodeAt,
  parse,
  printExpr,
  printWithRanges,
  SmallStepReducer,
  stateAt,
  states,
  substitute,
  trace,
  traceReduction,
  type Expr,
  type ReductionTrace,
  type Value,
} from '../src/lang';
import { CORPUS } from './corpus';

/** Printed form of every state in a trace: initial, after step 1, ... */
const printedStates = (t: ReductionTrace) => states(t).map(printExpr);

function valueShape(value: Value): unknown {
  switch (value.kind) {
    case 'number':
    case 'boolean':
      return value.value;
    case 'list':
      return value.elements.map(valueShape);
    default:
      return 'function';
  }
}

function exprShape(expr: Expr): unknown {
  switch (expr.kind) {
    case 'Number':
    case 'Boolean':
      return expr.value;
    case 'List':
      return expr.elements.map(exprShape);
    default:
      return 'function';
  }
}

function allIds(expr: Expr, into: number[] = []): number[] {
  into.push(expr.id);
  for (const child of children(expr)) allIds(child, into);
  return into;
}

describe('representative programs, step by step', () => {
  it('(\\x -> x * 2) 5', () => {
    expect(printedStates(trace('(\\x -> x * 2) 5'))).toEqual(['(\\x -> x * 2) 5', '5 * 2', '10']);
  });

  it('let x = 10 in x + 2', () => {
    const t = trace('let x = 10 in x + 2');
    expect(printedStates(t)).toEqual(['let x = 10 in x + 2', '10 + 2', '12']);
    expect(t.steps.map((s) => s.rule)).toEqual(['let', 'arithmetic']);
  });

  it('map rewrites the list in place and reduces elements left to right', () => {
    const t = trace('map (\\x -> x * 2) [1, 2, 3]');
    expect(printedStates(t)).toEqual([
      'map (\\x -> x * 2) [1, 2, 3]',
      '[(\\x -> x * 2) 1, (\\x -> x * 2) 2, (\\x -> x * 2) 3]',
      '[1 * 2, (\\x -> x * 2) 2, (\\x -> x * 2) 3]',
      '[2, (\\x -> x * 2) 2, (\\x -> x * 2) 3]',
      '[2, 2 * 2, (\\x -> x * 2) 3]',
      '[2, 4, (\\x -> x * 2) 3]',
      '[2, 4, 3 * 2]',
      '[2, 4, 6]',
    ]);
    expect(t.steps.map((s) => s.rule)).toEqual(['map', 'beta', 'arithmetic', 'beta', 'arithmetic', 'beta', 'arithmetic']);
    // The element currently being updated:
    expect(t.steps.map((s) => s.listFocus?.index)).toEqual([undefined, 0, 0, 1, 1, 2, 2]);
    // The list keeps its identity while its elements change.
    const listIds = new Set(t.steps.slice(1).map((s) => s.listFocus!.listId));
    expect(listIds.size).toBe(1);
    expect(t.outcome.status).toBe('done');
  });

  it('fold threads a visible accumulator through the list', () => {
    const t = trace('fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]');
    const f = '(\\acc -> \\x -> acc + x)';
    expect(printedStates(t)).toEqual([
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
    ]);
    expect(t.steps.filter((s) => s.rule === 'fold-step')).toHaveLength(3);
    expect(t.steps.at(-1)!.rule).toBe('fold-done');
  });
});

describe('agreement with the big-step evaluator', () => {
  it.each(CORPUS)('%s', (source) => {
    const ast = parse(source);
    let expected: { value: unknown } | { error: string };
    try {
      expected = { value: valueShape(evaluate(ast)) };
    } catch (error) {
      if (!isLangError(error)) throw error;
      expected = { error: error.kind };
    }
    const t = traceReduction(ast);
    const actual =
      t.outcome.status === 'done' ? { value: exprShape(t.outcome.expr) } : { error: t.outcome.error.kind };
    expect(actual).toEqual(expected);
    if (t.outcome.status === 'done') expect(isValue(t.outcome.expr)).toBe(true);
  });
});

describe('trace invariants (checked on every step of every corpus program)', () => {
  const traces = CORPUS.map((source) => [source, trace(source, { maxSteps: 500 })] as const);

  it.each(traces)('%s', (_source, t) => {
    for (const [i, step] of t.steps.entries()) {
      // Each step is one rewrite at `path`: the redex is there before, the replacement after.
      expect(nodeAt(step.before, step.path)!.id).toBe(step.redexId);
      expect(nodeAt(step.after, step.path)!.id).toBe(step.replacementId);
      // Consecutive states chain together.
      expect(step.before).toBe(stateAt(t, i));
      // Every state is valid source that re-parses to the same printed form.
      const printed = printExpr(step.after);
      expect(printExpr(parse(printed))).toBe(printed);
      // Node ids are unique within a state.
      const ids = allIds(step.after);
      expect(new Set(ids).size).toBe(ids.length);
      // Focus points at a real list element.
      if (step.listFocus) {
        const list = nodeAt(step.before, step.listFocus.listPath)!;
        expect(list.kind).toBe('List');
        expect(list.id).toBe(step.listFocus.listId);
      }
    }
    // Traces are plain data.
    expect(() => JSON.stringify(t)).not.toThrow();
  });

  it('never mutates earlier states', () => {
    const ast = parse('map (\\x -> x + 1) [1, 2]');
    const snapshot = JSON.stringify(ast);
    traceReduction(ast);
    expect(JSON.stringify(ast)).toBe(snapshot);
  });
});

describe('reduction rules', () => {
  it('values take zero steps', () => {
    for (const source of ['42', 'True', '[1, [2]]', '\\x -> 1 / 0', 'map', 'map (\\x -> x)', 'fold (\\a -> a) 0']) {
      const t = trace(source);
      expect(t.steps, source).toHaveLength(0);
      expect(t.outcome.status).toBe('done');
    }
  });

  it('a negative literal is one negate step', () => {
    expect(trace('-3').steps.map((s) => s.rule)).toEqual(['negate']);
  });

  it('call-by-value: the argument is reduced before beta', () => {
    expect(printedStates(trace('(\\x -> x + x) (1 + 2)'))).toEqual(['(\\x -> x + x) (1 + 2)', '(\\x -> x + x) 3', '3 + 3', '6']);
  });

  it('left to right: function before argument, left operand before right', () => {
    expect(printedStates(trace('(1 + 1) * (2 + 2)'))).toEqual(['(1 + 1) * (2 + 2)', '2 * (2 + 2)', '2 * 4', '8']);
  });

  it('&& and || short-circuit without reducing the right side', () => {
    expect(printedStates(trace('False && 1 / 0 == 1'))).toEqual(['False && 1 / 0 == 1', 'False']);
    expect(printedStates(trace('True && 1 < 2'))).toEqual(['True && 1 < 2', 'True && True', 'True']);
  });

  it('if reduces only the chosen branch', () => {
    expect(printedStates(trace('if 1 > 2 then 1 / 0 else 7'))).toEqual(['if 1 > 2 then 1 / 0 else 7', 'if False then 1 / 0 else 7', '7']);
  });

  it('respects shadowing during substitution', () => {
    expect(printedStates(trace('(\\x -> \\x -> x) 1 2'))).toEqual(['(\\x -> \\x -> x) 1 2', '(\\x -> x) 2', '2']);
    expect(printedStates(trace('let x = 1 in let x = 2 in x'))).toEqual(['let x = 1 in let x = 2 in x', 'let x = 2 in x', '2']);
  });

  it('let is non-recursive: the value of an inner let sees the outer binding', () => {
    expect(printedStates(trace('let x = 5 in let x = x + 1 in x'))).toEqual([
      'let x = 5 in let x = x + 1 in x',
      'let x = 5 + 1 in x',
      'let x = 6 in x',
      '6',
    ]);
  });

  it('lexical scoping falls out of substitution', () => {
    const t = trace('let x = 1 in let f = \\y -> x + y in let x = 100 in f 10');
    expect(printedStates(t)[1]).toBe('let f = \\y -> 1 + y in let x = 100 in f 10');
    expect(printExpr(t.outcome.expr)).toBe('11');
  });

  it('renames a binder instead of capturing a free builtin name', () => {
    const t = trace('(\\f -> \\map -> f [1]) (map (\\x -> x + 1)) 0');
    expect(printedStates(t)[1]).toBe("(\\map' -> map (\\x -> x + 1) [1]) 0");
    expect(printExpr(t.outcome.expr)).toBe('[2]');
  });

  it('builtins can be shadowed', () => {
    expect(printedStates(trace('let map = 3 in map + 1'))).toEqual(['let map = 3 in map + 1', '3 + 1', '4']);
  });

  it('map over [] and fold over [] each take a single step', () => {
    expect(trace('map (\\x -> x) []').steps.map((s) => s.rule)).toEqual(['map']);
    expect(printedStates(trace('fold (\\a -> \\x -> a) 9 []'))).toEqual(['fold (\\a -> \\x -> a) 9 []', '9']);
  });

  it('nested lists focus on the innermost list being updated', () => {
    const t = trace('[1, [2, 3 + 4]]');
    expect(t.steps).toHaveLength(1);
    const focus = t.steps[0]!.listFocus!;
    expect(focus.index).toBe(1);
    expect(printExpr(nodeAt(t.steps[0]!.before, focus.listPath)!)).toBe('[2, 3 + 4]');
  });
});

describe('capture-avoiding substitution', () => {
  const sub = (body: string, name: string, value: string) => {
    const b = parse(body);
    const ids = new IdGenerator();
    ids.reserveAbove(b);
    const v = parse(value, { ids });
    ids.reserveAbove(v);
    return printExpr(substitute(b, name, v, ids));
  };

  it('replaces free occurrences only', () => {
    expect(sub('x + (\\x -> x) x', 'x', '5')).toBe('5 + (\\x -> x) 5');
    expect(sub('let x = x in x', 'x', '1')).toBe('let x = 1 in x');
  });

  it('renames binders that would capture', () => {
    expect(sub('\\y -> x + y', 'x', 'y')).toBe("\\y' -> y + y'");
    expect(sub("\\y -> \\y' -> x + y + y'", 'x', 'y')).toBe("\\y'' -> \\y' -> y + y'' + y'");
    expect(sub('let y = 1 in x + y', 'x', 'y * 2')).toBe("let y' = 1 in y * 2 + y'");
  });

  it('does not rename when there is nothing to substitute under the binder', () => {
    expect(sub('\\y -> y', 'x', 'y')).toBe('\\y -> y');
  });

  it('gives each copy of the substituted value fresh ids', () => {
    const b = parse('[x, x, x]');
    const ids = new IdGenerator();
    ids.reserveAbove(b);
    const v = parse('\\z -> z', { ids });
    ids.reserveAbove(v);
    const result = substitute(b, 'x', v, ids);
    const idList = allIds(result);
    expect(new Set(idList).size).toBe(idList.length);
  });
});

describe('errors during reduction', () => {
  it('stops at the stuck redex and reports where it is', () => {
    const t = trace('map (\\x -> 10 / x) [2, 0]');
    expect(t.outcome.status).toBe('error');
    if (t.outcome.status !== 'error') return;
    expect(t.outcome.error.kind).toBe('RuntimeError');
    expect(t.outcome.error.message).toBe('Division by zero');
    expect(printExpr(t.outcome.expr)).toBe('[5, 10 / 0]');
    expect(printExpr(nodeAt(t.outcome.expr, t.outcome.path!)!)).toBe('10 / 0');
    expect(t.outcome.listFocus?.index).toBe(1);
  });

  it('reports undefined variables with a suggestion', () => {
    const t = trace('mapp (\\x -> x) [1]');
    expect(t.outcome.status === 'error' && t.outcome.error.message).toMatch(/Undefined variable 'mapp'. Did you mean 'map'\?/);
  });

  it('reports invalid applications', () => {
    const t = trace('(\\x -> x) 5 3');
    expect(printedStates(t)).toEqual(['(\\x -> x) 5 3', '5 3']);
    expect(t.outcome.status === 'error' && t.outcome.error.message).toMatch(/Cannot apply number 5/);
  });

  it('a single step on a stuck expression returns an error result, not an exception', () => {
    const result = new SmallStepReducer().step(parse('1 + True'));
    expect(result.status).toBe('error');
  });

  it('stops infinite loops at the step limit', () => {
    const t = trace('(\\x -> x x) (\\x -> x x)', { maxSteps: 50 });
    expect(t.steps).toHaveLength(50);
    expect(t.outcome.status === 'error' && t.outcome.error.message).toMatch(/did not finish within 50 steps/);
  });

  it('stops runaway growth at the node limit', () => {
    const t = trace('(\\f -> f (f (f (f (f (f [1]))))) ) (\\x -> [x, x])', { maxNodes: 40 });
    expect(t.outcome.status === 'error' && t.outcome.error.message).toMatch(/grew beyond 40 nodes/);
  });
});

describe('printWithRanges', () => {
  it('locates every node in the printed text', () => {
    const t = trace('map (\\x -> x * 2) [1, 2, 3]');
    for (const step of t.steps) {
      const { text, ranges } = printWithRanges(step.before);
      const range = ranges.get(step.redexId)!;
      expect(text.slice(range.start, range.end)).toBe(printExpr(nodeAt(step.before, step.path)!));
    }
  });

  it('excludes parentheses from a node range', () => {
    const ast = parse('(1 + 2) * 3');
    const { text, ranges } = printWithRanges(ast);
    const left = (ast as Extract<Expr, { kind: 'Binary' }>).left;
    const r = ranges.get(left.id)!;
    expect(text.slice(r.start, r.end)).toBe('1 + 2');
  });
});
