/**
 * Execution history: a framework-independent controller for stepping through
 * a reduction forwards and backwards.
 *
 * Every state is a real AST snapshot. Going backwards just moves the cursor to
 * an earlier snapshot; nothing is "un-substituted". Steps are computed lazily,
 * one at a time, when the cursor first moves past the end of the known
 * history, and are bounded by `maxSteps` / `maxNodes` so a diverging program
 * can never freeze the caller.
 */
import { countNodes, exprDepth, type Application, type Expr, type NodeId } from '../ast';
import { runtimeError } from '../errors';
import { parse } from '../parser';
import { nodeAt, type Path } from '../paths';
import { printExpr } from '../printer';
import { isValue, SmallStepReducer } from './reducer';
import type { Reducer, ReductionStep, ReductionTrace, TraceOutcome } from './types';

export interface ExecutionOptions {
  /** Stop with a RuntimeError instead of taking step number `maxSteps + 1`. */
  readonly maxSteps?: number;
  /** Stop with a RuntimeError once the expression grows beyond this many nodes. */
  readonly maxNodes?: number;
  /** Stop with a RuntimeError once the expression tree grows deeper than this. */
  readonly maxDepth?: number;
}

export const DEFAULT_MAX_STEPS = 10_000;
export const DEFAULT_MAX_NODES = 50_000;
export const DEFAULT_MAX_TREE_DEPTH = 1000;

const tooDeep = (expr: Expr) =>
  runtimeError('The expression became too deeply nested to reduce safely', expr.span);

export interface HistoryEntry {
  /** 0 for the initial state, n after n steps. */
  readonly index: number;
  readonly expr: Expr;
  /** `expr` rendered by the printer: real, re-parseable source. */
  readonly source: string;
  /** The step that produced this state (absent for the initial state). */
  readonly step?: ReductionStep;
}

/**
 * - `running`: more steps may follow the current state.
 * - `done`:    the current state is the final value.
 * - `error`:   the current state is the last one; reduction failed from here.
 */
export type ExecutionStatus = 'running' | 'done' | 'error';

/** Immutable view of the controller, convenient for UI state. */
export interface ExecutionSnapshot {
  readonly index: number;
  /** Number of steps known so far (the whole trace once `finished`). */
  readonly knownSteps: number;
  /** True once the end of the trace (value or error) has been discovered. */
  readonly finished: boolean;
  readonly status: ExecutionStatus;
  readonly current: HistoryEntry;
  /** The step that leads out of the current state, if already computed. */
  readonly next?: ReductionStep;
  readonly outcome?: TraceOutcome;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/**
 * Remembers where lists came from so steps can carry `MapOrigin` and fold
 * element indexes. Keyed by node id; ids are never reissued within one reducer.
 */
class OriginTracker {
  private readonly mapped = new Map<NodeId, { fn: Expr; inputs: readonly Expr[] }>();
  private readonly folded = new Map<NodeId, readonly Expr[]>();

  annotate(step: ReductionStep): ReductionStep {
    let annotated = step;

    if (step.rule === 'map') {
      const [fn, xs] = mapArgs(step);
      if (xs.kind === 'List') this.mapped.set(step.replacementId, { fn, inputs: xs.elements });
    }

    const list = step.listFocus;
    const mapOrigin = list && this.mapped.get(list.listId);
    if (list && mapOrigin) {
      const input = mapOrigin.inputs[list.index];
      if (input) annotated = { ...annotated, listFocus: { ...list, origin: { operation: 'map', fn: mapOrigin.fn, input } } };
    }

    const fold = step.foldFocus;
    if (fold) {
      if (fold.phase === 'consume' && !this.folded.has(fold.listId)) {
        // First element consumed: the list in `before` is the original list.
        const xs = foldList(step.before, fold.foldPath);
        if (xs) this.folded.set(fold.listId, xs);
      }
      const original = this.folded.get(fold.listId);
      if (original) {
        const remaining = fold.listPath ? foldList(step.after, fold.foldPath)?.length ?? 0 : 0;
        const index =
          fold.phase === 'finish' ? undefined : original.length - remaining - 1; // the element most recently consumed
        annotated = {
          ...annotated,
          foldFocus: { ...fold, original, ...(index !== undefined && index >= 0 ? { index } : {}) },
        };
      }
    }
    return annotated;
  }
}

/** `map f xs` at the redex: returns [f, xs]. */
function mapArgs(step: ReductionStep): [Expr, Expr] {
  const redex = nodeAt(step.before, step.path) as Application;
  return [(redex.fn as Application).arg, redex.arg];
}

/** Elements of the list argument of the fold at `foldPath`, if it is a literal list. */
function foldList(root: Expr, foldPath: Path): readonly Expr[] | undefined {
  const fold = nodeAt(root, foldPath);
  const xs = fold?.kind === 'App' ? fold.arg : undefined;
  return xs?.kind === 'List' ? xs.elements : undefined;
}

export class ExecutionController {
  private readonly entries: HistoryEntry[];
  private cursor = 0;
  private terminal: TraceOutcome | undefined;
  private readonly reducer: Reducer;
  private readonly origins = new OriginTracker();
  private readonly maxSteps: number;
  private readonly maxNodes: number;
  private readonly maxDepth: number;

  constructor(initial: Expr, options: ExecutionOptions = {}) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_TREE_DEPTH;
    this.reducer = new SmallStepReducer();
    if (exprDepth(initial) > this.maxDepth) {
      this.entries = [{ index: 0, expr: initial, source: '' }];
      this.terminal = { status: 'error', expr: initial, error: tooDeep(initial) };
      return;
    }
    this.entries = [{ index: 0, expr: initial, source: printExpr(initial) }];
    if (isValue(initial)) this.terminal = { status: 'done', expr: initial };
  }

  /** Parse `source` and start a controller (throws `LangError` on syntax errors). */
  static fromSource(source: string, options?: ExecutionOptions): ExecutionController {
    return new ExecutionController(parse(source), options);
  }

  // ---- inspection ----------------------------------------------------------

  get index(): number {
    return this.cursor;
  }

  get current(): HistoryEntry {
    return this.entries[this.cursor]!;
  }

  get initial(): HistoryEntry {
    return this.entries[0]!;
  }

  /** Every state discovered so far, in order. */
  get history(): readonly HistoryEntry[] {
    return this.entries;
  }

  /** Steps discovered so far. Equals the total once `finished`. */
  get knownSteps(): number {
    return this.entries.length - 1;
  }

  get finished(): boolean {
    return this.terminal !== undefined;
  }

  /** How reduction ended (`undefined` while the end has not been reached yet). */
  get outcome(): TraceOutcome | undefined {
    return this.terminal;
  }

  get atEnd(): boolean {
    return this.finished && this.cursor === this.entries.length - 1;
  }

  get status(): ExecutionStatus {
    return this.atEnd ? this.terminal!.status : 'running';
  }

  get canGoBack(): boolean {
    return this.cursor > 0;
  }

  get canGoForward(): boolean {
    return !this.atEnd;
  }

  /** The step that leads out of the current state (computes it if needed, without moving). */
  peek(): ReductionStep | undefined {
    this.discover(this.cursor + 1);
    return this.entries[this.cursor + 1]?.step;
  }

  snapshot(): ExecutionSnapshot {
    const next = this.peek();
    return {
      index: this.cursor,
      knownSteps: this.knownSteps,
      finished: this.finished,
      status: this.status,
      current: this.current,
      ...(next ? { next } : {}),
      ...(this.terminal ? { outcome: this.terminal } : {}),
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
    };
  }

  // ---- navigation ----------------------------------------------------------

  /** Advance one step. Returns false (and stays put) at the end of the trace. */
  next(): boolean {
    this.discover(this.cursor + 1);
    if (this.cursor + 1 >= this.entries.length) return false;
    this.cursor++;
    return true;
  }

  /** Go back one step by restoring the previous snapshot. */
  previous(): boolean {
    if (this.cursor === 0) return false;
    this.cursor--;
    return true;
  }

  /** Return to the initial state. Discovered history is kept. */
  reset(): void {
    this.cursor = 0;
  }

  /** Jump to state `index` (clamped), discovering steps as needed. */
  goTo(index: number): HistoryEntry {
    if (Number.isNaN(index)) return this.current;
    const target = Math.max(0, Math.floor(index));
    this.discover(target);
    this.cursor = Math.min(target, this.entries.length - 1);
    return this.current;
  }

  /** Reduce until a value, an error, or a limit is reached; the cursor moves to the last state. */
  runToCompletion(): TraceOutcome {
    this.discover(Number.POSITIVE_INFINITY);
    this.cursor = this.entries.length - 1;
    return this.terminal!;
  }

  /** The full trace (runs to completion first, without moving the cursor). */
  trace(): ReductionTrace {
    this.discover(Number.POSITIVE_INFINITY);
    return { initial: this.entries[0]!.expr, steps: this.entries.slice(1).map((e) => e.step!), outcome: this.terminal! };
  }

  // ---- discovery -----------------------------------------------------------

  /** Compute steps until state `index` exists or the trace ends. */
  private discover(index: number): void {
    while (this.entries.length <= index && !this.terminal) this.extend();
  }

  private extend(): void {
    const last = this.entries.at(-1)!;
    try {
      this.extendFrom(last);
    } catch (error) {
      // Last-resort guard: a stack overflow must end the trace, not crash the caller.
      if (!(error instanceof RangeError)) throw error;
      this.terminal = { status: 'error', expr: last.expr, error: tooDeep(last.expr) };
    }
  }

  private extendFrom(last: HistoryEntry): void {
    const result = this.reducer.step(last.expr);
    if (result.status !== 'step') {
      this.terminal = result;
      return;
    }
    if (this.knownSteps >= this.maxSteps) {
      this.terminal = {
        status: 'error',
        expr: last.expr,
        error: runtimeError(`Reduction did not finish within ${this.maxSteps} steps (possible infinite loop)`, last.expr.span),
      };
      return;
    }
    if (exprDepth(result.step.after) > this.maxDepth) {
      // Not recorded: deeper trees risk overflowing the printer and the renderer.
      this.terminal = {
        status: 'error',
        expr: last.expr,
        error: runtimeError(`The expression grew deeper than ${this.maxDepth} levels`, last.expr.span),
      };
      return;
    }
    const step = this.origins.annotate(result.step);
    this.entries.push({ index: this.entries.length, expr: step.after, source: printExpr(step.after), step });
    if (step.completes) {
      this.terminal = { status: 'done', expr: step.after };
    } else if (countNodes(step.after) > this.maxNodes) {
      this.terminal = {
        status: 'error',
        expr: step.after,
        error: runtimeError(`The expression grew beyond ${this.maxNodes} nodes`, step.after.span),
      };
    }
  }
}
