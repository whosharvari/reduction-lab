/**
 * Data shapes produced by the small-step reducer (`reducer.ts`) and consumed
 * by the UI. Everything here is plain data and JSON-serialisable.
 *
 * Semantics (call-by-value, left-to-right, substitution-based):
 *  - The reducer rewrites the *AST itself*, never an opaque environment, so every
 *    state is printable source (`printExpr`) and highlightable by node id.
 *  - Each `step` finds the next redex in evaluation order (the same order the
 *    big-step evaluator uses) and replaces it in place via `replaceAt`.
 *  - `map f [x1..xn]` rewrites once to `[f x1, ..., f xn]`; the list's elements
 *    then reduce left to right, and `listFocus` reports which index is changing.
 *  - `fold f z [x, ...xs]` rewrites to `fold f (f z x) [...xs]`, so the
 *    accumulator is an ordinary sub-expression between steps; `fold f z []` -> `z`.
 *  - Invariant (tested): reducing to a value agrees with `evaluate` — same value,
 *    or the same error kind.
 */
import type { BinaryOperator, Expr, NodeId } from '../ast';
import type { LangError } from '../errors';
import type { Path } from '../paths';

export type ReductionRule =
  | 'beta'          // (\x -> body) v           ->  body[x := v]
  | 'let'           // let x = v in body          ->  body[x := v]
  | 'arithmetic'    // 2 + 3                       ->  5
  | 'comparison'    // 2 < 3                       ->  True
  | 'logic'         // False && e -> False;  True && b -> b
  | 'negate'        // -3 (Unary)                  ->  -3 (Number)
  | 'if'            // if True then a else b       ->  a
  | 'map'           // map f [x1..xn]             ->  [f x1, ..., f xn]
  | 'fold-step'     // fold f z [x, ...xs]         ->  fold f (f z x) [...xs]
  | 'fold-done';    // fold f z []                 ->  z

/** For a list produced by `map`: where the element being updated came from. */
export interface MapOrigin {
  readonly operation: 'map';
  /** The mapped function, as it appeared in `map f xs`. */
  readonly fn: Expr;
  /** The input element `x_i` of the original list. */
  readonly input: Expr;
}

/** Which list element a step is updating, for the "current element" highlight. */
export interface ListFocus {
  /** Path to the List node (identical in `before` and `after`). */
  readonly listPath: Path;
  readonly listId: NodeId;
  readonly index: number;
  /** The element's expression before this step. */
  readonly elementBefore: Expr;
  /** The element's expression after this step (absent when the step failed). */
  readonly elementAfter?: Expr;
  /** Filled in by the execution history when the list was produced by `map`. */
  readonly origin?: MapOrigin;
}

/**
 * Progress of a `fold`. The fold expression `fold f acc rest` lives at `foldPath`;
 * its accumulator at `accumulatorPath` and its remaining list at `listPath`
 * (all paths valid in `after`; for `finish` only `foldPath`/`accumulatorPath`).
 */
export interface FoldFocus {
  /**
   * consume:    fold f z [x, ...xs] -> fold f (f z x) xs  — element x enters the accumulator
   * accumulate: a step inside the accumulator expression     — the combination is being computed
   * finish:     fold f z [] -> z                              — z is the result
   */
  readonly phase: 'consume' | 'accumulate' | 'finish';
  readonly foldPath: Path;
  readonly accumulatorPath: Path;
  readonly listPath?: Path;
  /** Id of the list being folded; stable across all steps of one fold. */
  readonly listId: NodeId;
  /** Accumulator expression before / after this step. */
  readonly accumulatorBefore: Expr;
  readonly accumulatorAfter: Expr;
  /** consume: the element being combined. */
  readonly element?: Expr;
  /** Filled in by the execution history: index of the active element in the original list. */
  readonly index?: number;
  /** Filled in by the execution history: the list as it was before folding started. */
  readonly original?: readonly Expr[];
}

/**
 * Structured facts about a contraction, recorded by the reducer while it performs
 * the rewrite, so the UI can explain a step without parsing `description`.
 */
export type StepDetail =
  /** beta / let: `name` := `value` in the body. */
  | {
      readonly kind: 'substitution';
      readonly name: string;
      readonly value: Expr;
      /** Free occurrences of `name` that were replaced (0: the value is discarded). */
      readonly occurrences: number;
      /** Binders renamed to avoid capturing a free variable of `value`, as [from, to]. */
      readonly renamed: readonly (readonly [string, string])[];
    }
  /** arithmetic / comparison / negate: operands are values, `result` is computed. */
  | { readonly kind: 'operation'; readonly op: BinaryOperator | 'negate'; readonly operands: readonly Expr[]; readonly result: Expr }
  /** logic: `shortCircuit` when the left operand alone decided the result. */
  | { readonly kind: 'logic'; readonly op: '&&' | '||'; readonly left: Expr; readonly shortCircuit: boolean; readonly result: Expr }
  /** if: which branch was kept and which was discarded unevaluated. */
  | { readonly kind: 'branch'; readonly condition: boolean; readonly kept: Expr; readonly discarded: Expr }
  /** map: one application of `fn` per element of the input list. */
  | { readonly kind: 'map'; readonly fn: Expr; readonly count: number }
  /** fold-step / fold-done: `element` absent when the list was empty. */
  | { readonly kind: 'fold'; readonly fn: Expr; readonly accumulator: Expr; readonly element?: Expr; readonly remaining: number };

export interface ReductionStep {
  readonly rule: ReductionRule;
  /** Human-readable explanation, e.g. "Apply \x -> x * 2 to 1". */
  readonly description: string;
  /** Structured facts behind `description` (see `StepDetail`). */
  readonly detail: StepDetail;
  readonly before: Expr;
  readonly after: Expr;
  /** Location of the redex in `before` (and of its replacement in `after`). */
  readonly path: Path;
  readonly redexId: NodeId;
  readonly replacementId: NodeId;
  /** True when `after` is a value, i.e. this was the last step. */
  readonly completes: boolean;
  /** Innermost list whose element contains the redex, if any. */
  readonly listFocus?: ListFocus;
  /** Innermost fold this step belongs to, if any. */
  readonly foldFocus?: FoldFocus;
}

export type StepResult =
  | { readonly status: 'step'; readonly step: ReductionStep }
  /** `expr` is already a value; no further reduction is possible. */
  | { readonly status: 'done'; readonly expr: Expr }
  /** The next redex cannot be contracted; `path` locates it in `expr` when known. */
  | { readonly status: 'error'; readonly expr: Expr; readonly error: LangError; readonly path?: Path; readonly listFocus?: ListFocus };

export interface Reducer {
  /** Perform exactly one semantic reduction step. Pure: never mutates `expr`. */
  step(expr: Expr): StepResult;
}

export type TraceOutcome = Extract<StepResult, { status: 'done' | 'error' }>;

/** Full execution history, suitable for a timeline/scrubber UI. */
export interface ReductionTrace {
  readonly initial: Expr;
  readonly steps: readonly ReductionStep[];
  readonly outcome: TraceOutcome;
}
