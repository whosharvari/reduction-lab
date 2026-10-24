/**
 * View models for the list visualisations, derived only from real data:
 * the current AST snapshot, the recorded history, and reducer step metadata.
 * Nothing here advances on a timer or guesses values.
 */
import {
  isValue,
  nodeAt,
  pathTo,
  type Application,
  type Expr,
  type FoldFocus,
  type HistoryEntry,
  type NodeId,
  type Path,
  type PathSegment,
  type ReductionRule,
  type ReductionStep,
  type TraceOutcome,
} from '../../lang';

export interface Position {
  /** Recorded states; `history[index]` is the current one. */
  readonly history: readonly HistoryEntry[];
  readonly index: number;
  /** The step out of the current state, if one exists. */
  readonly next?: ReductionStep;
  /** Set when the current state is the last one and reduction failed there. */
  readonly failure?: Extract<TraceOutcome, { status: 'error' }>;
}

function segmentEquals(a: PathSegment, b: PathSegment): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a[1] === b[1];
  }
  return a === b;
}

export function startsWith(path: Path, prefix: Path): boolean {
  return prefix.length <= path.length && prefix.every((segment, i) => segmentEquals(segment, path[i]!));
}

/** Which element of the list at `listPath` contains `path`, if any. */
function elementIndexOf(path: Path | undefined, listPath: Path): number | undefined {
  if (!path || !startsWith(path, listPath)) return undefined;
  const segment = path[listPath.length];
  return Array.isArray(segment) ? segment[1] : undefined;
}

// ---- map --------------------------------------------------------------------

export type ElementStatus = 'pending' | 'active' | 'done' | 'error';

export interface MapElementView {
  readonly index: number;
  /** The original input element x_i. */
  readonly input?: Expr;
  /** The element's current expression (absent before the list is expanded). */
  readonly current?: Expr;
  readonly status: ElementStatus;
}

export interface MapView {
  /** `expanding`: the next step is the map rewrite itself. */
  readonly phase: 'expanding' | 'processing' | 'complete';
  readonly fn: Expr;
  readonly listId?: NodeId;
  readonly elements: readonly MapElementView[];
  /** Index of the element the next step will rewrite, if any. */
  readonly activeIndex?: number;
}

/** `map f xs` at `path` in `root`: returns [f, xs]. */
function mapArguments(root: Expr, path: Path): [Expr, Expr] | undefined {
  const redex = nodeAt(root, path);
  if (redex?.kind !== 'App' || redex.fn.kind !== 'App') return undefined;
  return [redex.fn.arg, redex.arg];
}

export function deriveMapView({ history, index, next, failure }: Position): MapView | undefined {
  const current = history[index]!.expr;

  if (next?.rule === 'map') {
    const args = mapArguments(next.before, next.path);
    if (!args) return undefined;
    const [fn, xs] = args;
    const inputs = xs.kind === 'List' ? xs.elements : [];
    return { phase: 'expanding', fn, elements: inputs.map((input, i) => ({ index: i, input, status: 'pending' })) };
  }

  // Map expansions whose lists are still part of the current expression, most recent first.
  // Prefer the innermost one containing the next redex (e.g. the outer list of a nested map
  // once its inner map has finished); otherwise the most recent one.
  const candidates: MapView[] = [];
  let containing: { view: MapView; depth: number } | undefined;
  for (let k = index; k >= 1; k--) {
    const step = history[k]!.step!;
    if (step.rule !== 'map') continue;
    const listPath = pathTo(current, step.replacementId);
    const list = listPath && nodeAt(current, listPath);
    if (!listPath || list?.kind !== 'List') continue;
    const args = mapArguments(step.before, step.path);
    if (!args) continue;
    const [fn, xs] = args;
    const inputs = xs.kind === 'List' ? xs.elements : [];
    // A later fold may consume this list (keeping its id); it is no longer a map result then.
    if (list.elements.length !== inputs.length) continue;

    const activeIndex = elementIndexOf(next?.path, listPath);
    const failedIndex = elementIndexOf(failure?.path, listPath);
    const elements = list.elements.map((element, i): MapElementView => ({
      index: i,
      ...(inputs[i] ? { input: inputs[i] } : {}),
      current: element,
      status: i === failedIndex ? 'error' : i === activeIndex ? 'active' : isValue(element) ? 'done' : 'pending',
    }));
    const complete = elements.every((e) => e.status === 'done');
    const view: MapView = {
      phase: complete ? 'complete' : 'processing',
      fn,
      listId: list.id,
      elements,
      ...(activeIndex !== undefined ? { activeIndex } : {}),
    };
    candidates.push(view);
    const holdsRedex = activeIndex !== undefined || elementIndexOf(failure?.path, listPath) !== undefined;
    if (holdsRedex && (!containing || listPath.length > containing.depth)) containing = { view, depth: listPath.length };
  }
  return containing?.view ?? candidates[0];
}

// ---- fold -------------------------------------------------------------------

export type FoldElementStatus = 'consumed' | 'active' | 'pending';

export interface FoldView {
  readonly phase: FoldFocus['phase'] | 'complete';
  readonly fn: Expr;
  readonly listId: NodeId;
  readonly elements: ReadonlyArray<{ readonly index: number; readonly expr: Expr; readonly status: FoldElementStatus }>;
  readonly activeIndex?: number;
  /** Elements already taken from the list (read from the remaining list in the current AST). */
  readonly consumedCount: number;
  /** The accumulator expression as it stands in the current state. */
  readonly accumulator: Expr;
  /** Accumulator values so far: the initial value, then one per completed combination. */
  readonly timeline: readonly Expr[];
  /** The accumulator change made by the step that produced the current state. */
  readonly lastTransition?: { readonly before: Expr; readonly after: Expr; readonly phase: FoldFocus['phase'] };
}

/** `fold f acc xs` → { fn, acc, xs } when `expr` is a saturated fold application. */
function foldParts(expr: Expr | undefined): { fn: Expr; acc: Expr; xs: Expr } | undefined {
  if (expr?.kind !== 'App' || expr.fn.kind !== 'App' || expr.fn.fn.kind !== 'App') return undefined;
  const head = (expr.fn.fn as Application).fn;
  if (head.kind !== 'Var' || head.name !== 'fold') return undefined;
  return { fn: expr.fn.fn.arg, acc: expr.fn.arg, xs: expr.arg };
}

export function deriveFoldView({ history, index, next }: Position): FoldView | undefined {
  const current = history[index]!.expr;
  const last = history[index]!.step;

  // The fold the next step belongs to; otherwise the most recent one in history.
  let focusStep: ReductionStep | undefined = next?.foldFocus ? next : undefined;
  for (let k = index; !focusStep && k >= 1; k--) {
    if (history[k]!.step!.foldFocus) focusStep = history[k]!.step!;
  }
  if (!focusStep) return undefined;
  const focus = focusStep.foldFocus!;
  const fromNext = focusStep === next;

  const parts = foldParts(nodeAt(focusStep.before, focus.foldPath));
  if (!parts) return undefined;
  const original = focus.original ?? (parts.xs.kind === 'List' ? parts.xs.elements : []);

  // Read progress from the *current* AST when the fold is still there.
  const live = foldParts(nodeAt(current, focus.foldPath));
  const liveForThisFold = live && live.xs.id === focus.listId;
  const remaining = liveForThisFold && live.xs.kind === 'List' ? live.xs.elements.length : 0;
  const consumed = original.length - remaining;

  const finished = !liveForThisFold || (!fromNext && focus.phase === 'finish');
  const activeIndex = finished || focus.phase === 'finish' ? undefined : focus.index;
  const elements = original.map((expr, i) => ({
    index: i,
    expr,
    status: (i === activeIndex ? 'active' : i < consumed ? 'consumed' : 'pending') as FoldElementStatus,
  }));

  const accumulator = liveForThisFold ? live.acc : focus.accumulatorAfter;

  const timeline: Expr[] = [];
  for (let k = 1; k <= index; k++) {
    const ff = history[k]!.step!.foldFocus;
    if (!ff || ff.listId !== focus.listId) continue;
    if (timeline.length === 0) timeline.push(ff.accumulatorBefore);
    if (ff.phase === 'accumulate' && isValue(ff.accumulatorAfter)) timeline.push(ff.accumulatorAfter);
  }
  if (timeline.length === 0) timeline.push(focus.accumulatorBefore);

  const lastFocus = last?.foldFocus;
  return {
    phase: finished ? 'complete' : focus.phase,
    fn: parts.fn,
    listId: focus.listId,
    elements,
    ...(activeIndex !== undefined ? { activeIndex } : {}),
    consumedCount: consumed,
    accumulator,
    timeline,
    ...(lastFocus && lastFocus.listId === focus.listId
      ? { lastTransition: { before: lastFocus.accumulatorBefore, after: lastFocus.accumulatorAfter, phase: lastFocus.phase } }
      : {}),
  };
}

// ---- rule explanations -----------------------------------------------------

export interface RuleInfo {
  readonly name: string;
  readonly symbol: string;
  readonly explanation: string;
}

export const RULES: Readonly<Record<ReductionRule, RuleInfo>> = {
  beta: {
    name: 'β-reduction',
    symbol: 'β',
    explanation:
      'Applying a function replaces every free occurrence of its parameter with the argument value. If an inner binder would capture a free name, it is renamed first.',
  },
  let: {
    name: 'Let substitution',
    symbol: 'let',
    explanation:
      'The bound value is already a value, so it is substituted for the name throughout the body. let is non-recursive: the name is not visible in its own definition.',
  },
  arithmetic: {
    name: 'Arithmetic',
    symbol: '±',
    explanation: 'Both operands are values, so the operation is computed. Division by zero stops reduction with an error.',
  },
  comparison: {
    name: 'Comparison',
    symbol: '≶',
    explanation: 'Both operands are values, so they are compared and replaced by True or False.',
  },
  logic: {
    name: 'Boolean logic',
    symbol: '∧∨',
    explanation:
      'The left operand decides the result when it can (False && …, True || …), so the right side is never evaluated; otherwise the right side is the result.',
  },
  negate: {
    name: 'Negation',
    symbol: '−',
    explanation: 'Unary minus applied to a number value becomes a negative number literal.',
  },
  if: {
    name: 'Conditional',
    symbol: '?',
    explanation: 'The condition is a Boolean value, so the whole if is replaced by the chosen branch. The other branch is discarded unevaluated.',
  },
  map: {
    name: 'Map expansion',
    symbol: 'map',
    explanation:
      'map f [x₁, …, xₙ] expands into the list [f x₁, …, f xₙ]. Each of those applications then reduces in place, left to right.',
  },
  'fold-step': {
    name: 'Fold step',
    symbol: 'fold',
    explanation:
      'The next element is taken from the front of the list and combined with the accumulator: fold f acc [x, …] becomes fold f (f acc x) […].',
  },
  'fold-done': {
    name: 'Fold complete',
    symbol: 'fold',
    explanation: 'The list is empty, so the fold is replaced by its accumulator — the final result.',
  },
};

/** Redex before and its replacement after a step (both real sub-trees). */
export function rewriteOf(step: ReductionStep): { before: Expr; after: Expr } {
  return { before: nodeAt(step.before, step.path)!, after: nodeAt(step.after, step.path)! };
}
