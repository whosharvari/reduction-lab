/**
 * One-shot execution history: run the reducer to a value (or error) and record every step.
 * For interactive stepping use `ExecutionController` (history.ts), which this wraps.
 */
import type { Expr } from '../ast';
import { ExecutionController, type ExecutionOptions } from './history';
import type { ReductionTrace } from './types';

export type TraceOptions = ExecutionOptions;
export { DEFAULT_MAX_NODES, DEFAULT_MAX_STEPS } from './history';

export function traceReduction(initial: Expr, options: TraceOptions = {}): ReductionTrace {
  return new ExecutionController(initial, options).trace();
}

/** Expression after `index` steps (0 = initial). Clamped to the available range. */
export function stateAt(trace: ReductionTrace, index: number): Expr {
  const clamped = Math.max(0, Math.min(index, trace.steps.length));
  return clamped === 0 ? trace.initial : trace.steps[clamped - 1]!.after;
}

/** Every state in order: initial, after step 1, …, final. */
export function states(trace: ReductionTrace): Expr[] {
  return [trace.initial, ...trace.steps.map((s) => s.after)];
}

/** The final expression of a trace (a value when `outcome.status === 'done'`). */
export function finalExpr(trace: ReductionTrace): Expr {
  return trace.outcome.expr;
}
