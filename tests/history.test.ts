import { describe, expect, it } from 'vitest';
import { ExecutionController, LangError, parse, printExpr, traceReduction } from '../src/lang';

const sourceOf = (c: ExecutionController) => c.current.source;

describe('ExecutionController navigation', () => {
  const program = '(1 + 2) * (3 + 4)';
  // 0: (1 + 2) * (3 + 4)   1: 3 * (3 + 4)   2: 3 * 7   3: 21

  it('starts at the initial state with nothing computed yet', () => {
    const c = ExecutionController.fromSource(program);
    expect(c.index).toBe(0);
    expect(sourceOf(c)).toBe(program);
    expect(c.current.step).toBeUndefined();
    expect(c.knownSteps).toBe(0);
    expect(c.finished).toBe(false);
    expect(c.status).toBe('running');
    expect(c.canGoBack).toBe(false);
    expect(c.canGoForward).toBe(true);
  });

  it('next() takes exactly one step at a time', () => {
    const c = ExecutionController.fromSource(program);
    expect(c.next()).toBe(true);
    expect(sourceOf(c)).toBe('3 * (3 + 4)');
    expect(c.current.step!.rule).toBe('arithmetic');
    expect(c.knownSteps).toBe(1);
    expect(c.next()).toBe(true);
    expect(sourceOf(c)).toBe('3 * 7');
    expect(c.next()).toBe(true);
    expect(sourceOf(c)).toBe('21');
    expect(c.status).toBe('done');
    expect(c.finished).toBe(true);
    expect(c.canGoForward).toBe(false);
    expect(c.next()).toBe(false);
    expect(c.index).toBe(3);
  });

  it('previous() restores the earlier snapshot object itself', () => {
    const c = ExecutionController.fromSource(program);
    c.next();
    const afterOne = c.current;
    c.next();
    expect(c.previous()).toBe(true);
    expect(c.current).toBe(afterOne);
    expect(c.current.expr).toBe(afterOne.expr);
    expect(c.previous()).toBe(true);
    expect(c.index).toBe(0);
    expect(c.previous()).toBe(false);
  });

  it('going forward again replays recorded steps instead of recomputing them', () => {
    const c = ExecutionController.fromSource(program);
    c.next();
    c.next();
    const recorded = c.current;
    c.previous();
    c.next();
    expect(c.current).toBe(recorded);
    expect(c.knownSteps).toBe(2);
  });

  it('reset() returns to the initial state but keeps the discovered history', () => {
    const c = ExecutionController.fromSource(program);
    c.runToCompletion();
    c.reset();
    expect(c.index).toBe(0);
    expect(sourceOf(c)).toBe(program);
    expect(c.knownSteps).toBe(3);
    expect(c.status).toBe('running');
  });

  it('runToCompletion() moves to the final state and reports the outcome', () => {
    const c = ExecutionController.fromSource(program);
    const outcome = c.runToCompletion();
    expect(outcome.status).toBe('done');
    expect(printExpr(outcome.expr)).toBe('21');
    expect(c.index).toBe(3);
    expect(c.history.map((e) => e.source)).toEqual([program, '3 * (3 + 4)', '3 * 7', '21']);
    expect(c.history.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it('goTo() jumps, discovering steps lazily and clamping at the end', () => {
    const c = ExecutionController.fromSource(program);
    expect(c.goTo(2).source).toBe('3 * 7');
    expect(c.knownSteps).toBe(2);
    expect(c.goTo(99).source).toBe('21');
    expect(c.goTo(-5).index).toBe(0);
  });

  it('peek() shows the next step without moving', () => {
    const c = ExecutionController.fromSource(program);
    const next = c.peek()!;
    expect(next.description).toBe('1 + 2 = 3');
    expect(c.index).toBe(0);
    c.runToCompletion();
    expect(c.peek()).toBeUndefined();
  });

  it('snapshot() is a plain description of the current position', () => {
    const c = ExecutionController.fromSource(program);
    c.next();
    const snap = c.snapshot();
    expect(snap).toMatchObject({ index: 1, knownSteps: 2, finished: false, status: 'running', canGoBack: true, canGoForward: true });
    expect(snap.current.source).toBe('3 * (3 + 4)');
    expect(snap.next!.description).toBe('3 + 4 = 7');
  });

  it('a program that is already a value is finished with zero steps', () => {
    const c = ExecutionController.fromSource('[1, 2]');
    expect(c.finished).toBe(true);
    expect(c.status).toBe('done');
    expect(c.next()).toBe(false);
    expect(c.runToCompletion().status).toBe('done');
    expect(c.knownSteps).toBe(0);
  });

  it('fromSource() reports syntax errors as LangError', () => {
    expect(() => ExecutionController.fromSource('(1 +')).toThrow(LangError);
  });

  it('agrees with traceReduction', () => {
    const ast = parse('map (\\x -> x + 1) [1, 2]');
    const c = new ExecutionController(ast);
    c.runToCompletion();
    const t = traceReduction(ast);
    expect(c.history.slice(1).map((e) => e.source)).toEqual(t.steps.map((s) => printExpr(s.after)));
  });
});

describe('ExecutionController errors and limits', () => {
  it('stops at a stuck state with a structured error', () => {
    const c = ExecutionController.fromSource('(\\x -> 10 / x) (2 - 2)');
    const outcome = c.runToCompletion();
    expect(c.history.map((e) => e.source)).toEqual(['(\\x -> 10 / x) (2 - 2)', '(\\x -> 10 / x) 0', '10 / 0']);
    expect(outcome.status).toBe('error');
    expect(c.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.error.kind).toBe('RuntimeError');
      expect(outcome.error.message).toBe('Division by zero');
      expect(outcome.expr).toBe(c.current.expr);
    }
    // Stepping back out of an error state works like any other state.
    expect(c.previous()).toBe(true);
    expect(c.status).toBe('running');
  });

  it('an error in the very first step leaves only the initial state', () => {
    const c = ExecutionController.fromSource('5 3');
    expect(c.next()).toBe(false);
    expect(c.status).toBe('error');
    expect(c.outcome?.status === 'error' && c.outcome.error.kind).toBe('TypeError');
  });

  it('stops divergent programs at maxSteps without hanging', () => {
    const c = ExecutionController.fromSource('(\\x -> x x) (\\x -> x x)', { maxSteps: 25 });
    const outcome = c.runToCompletion();
    expect(c.knownSteps).toBe(25);
    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' && outcome.error.message).toMatch(/did not finish within 25 steps/);
    expect(outcome.status === 'error' && outcome.error.kind).toBe('RuntimeError');
  });

  it('a program needing exactly maxSteps steps still completes', () => {
    const c = ExecutionController.fromSource('(1 + 2) * (3 + 4)', { maxSteps: 3 });
    expect(c.runToCompletion().status).toBe('done');
    const tooFew = ExecutionController.fromSource('(1 + 2) * (3 + 4)', { maxSteps: 2 });
    expect(tooFew.runToCompletion().status).toBe('error');
    expect(tooFew.knownSteps).toBe(2);
  });

  it('stops expressions that grow beyond maxNodes', () => {
    const c = ExecutionController.fromSource('(\\f -> f (f (f (f (f [1]))))) (\\x -> [x, x])', { maxNodes: 30 });
    const outcome = c.runToCompletion();
    expect(outcome.status === 'error' && outcome.error.message).toMatch(/grew beyond 30 nodes/);
  });

  it('runToCompletion is bounded even with the default limit', () => {
    const started = Date.now();
    const outcome = ExecutionController.fromSource('(\\x -> x x) (\\x -> x x)').runToCompletion();
    expect(outcome.status).toBe('error');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
