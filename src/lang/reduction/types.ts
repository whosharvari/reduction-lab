/**
 * Contract for the small-step reduction engine (implemented in Phase 2).
 *
 * Nothing in this file performs reduction. It fixes the data shapes that the
 * engine produces and the UI consumes, so the two can be built independently.
 *
 * Planned semantics (call-by-value, leftmost-innermost, substitution-based):
 *  - The engine rewrites the *AST itself*, never an opaque environment, so every
 *    state is printable source (`printExpr`) and highlightable by node id.
 *  - Each `step` finds the next redex in evaluation order (the same order the
 *    big-step evaluator uses) and replaces it via `replaceAt`.
 *  - `map f [x1..xn]` rewrites once to `[f x1, ..., f xn]`; the list's elements
 *    then reduce left to right, and `listFocus` reports which index is changing.
 *  - `fold f z (x:xs)` rewrites to `fold f (f z x) xs`, so the accumulator is
 *    visible as an ordinary sub-expression between steps; `fold f z []` -> `z`.
 *  - Correctness check: for every program, reducing to a normal form must agree
 *    with `evaluate` (same value, or same error kind).
 */
import type { Expr, NodeId } from '../ast';
import type { LangError } from '../errors';
import type { Path } from '../paths';

export type ReductionRule =
  | 'beta'          // (\x -> body) v           ->  body[x := v]
  | 'let'           // let x = v in body          ->  body[x := v]
  | 'arithmetic'    // 2 + 3                       ->  5
  | 'comparison'    // 2 < 3                       ->  True
  | 'logic'         // True && e                   ->  e
  | 'negate'        // -(3)                        ->  -3
  | 'if'            // if True then a else b       ->  a
  | 'map'           // map f [x1..xn]             ->  [f x1, ..., f xn]
  | 'fold-step'     // fold f z [x, ...xs]         ->  fold f (f z x) [...xs]
  | 'fold-done';    // fold f z []                 ->  z

/** Which list element a step is updating, for the "current element" highlight. */
export interface ListFocus {
  /** Path to the List node in the expression *after* the step. */
  readonly listPath: Path;
  readonly listId: NodeId;
  readonly index: number;
}

export interface ReductionStep {
  readonly rule: ReductionRule;
  /** Human-readable explanation, e.g. "Apply \x -> x * 2 to 1". */
  readonly description: string;
  readonly before: Expr;
  readonly after: Expr;
  /** Location of the redex in `before` (and of its replacement in `after`). */
  readonly path: Path;
  readonly redexId: NodeId;
  readonly replacementId: NodeId;
  readonly listFocus?: ListFocus;
}

export type StepResult =
  | { readonly status: 'step'; readonly step: ReductionStep }
  /** `expr` is already a value; no further reduction is possible. */
  | { readonly status: 'done'; readonly expr: Expr }
  | { readonly status: 'error'; readonly expr: Expr; readonly error: LangError };

export interface Reducer {
  /** Perform exactly one semantic reduction step. Pure: never mutates `expr`. */
  step(expr: Expr): StepResult;
}

/** Full execution history, suitable for a timeline/scrubber UI. */
export interface ReductionTrace {
  readonly initial: Expr;
  readonly steps: readonly ReductionStep[];
  readonly outcome: StepResult & { status: 'done' | 'error' };
}
