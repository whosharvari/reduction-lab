/**
 * View model for the Reduction Spotlight: what the last step changed and why.
 *
 * Everything comes from the real reducer: the rule and `detail` it recorded
 * while contracting, and the redex / replacement located by `step.path` in the
 * step's own `before` / `after` trees (ids, never text search). Nothing here
 * reduces anything.
 */
import { nodeAt, printExpr, type Expr, type ExecutionSnapshot, type NodeId, type ReductionRule, type ReductionStep } from '../../lang';
import { treeLabel } from './tree';
import { RULES, rewriteOf } from './visualization';

/** Explanation text: plain strings interleaved with inline code. */
export type Part = string | { readonly code: string };

interface RuleRef {
  readonly rule: ReductionRule;
  readonly name: string;
  readonly symbol: string;
}

export type SpotlightView =
  /** No step has been applied to reach this state (the initial state). */
  | {
      readonly kind: 'idle';
      /** The redex the first step will contract, if there is one. */
      readonly next?: RuleRef & { readonly redex: Expr; readonly redexId: NodeId; readonly treeLabel: string };
      readonly alreadyValue: boolean;
    }
  /** The step that produced the current state. */
  | (RuleRef & {
      readonly kind: 'step';
      readonly index: number;
      /** The whole expression before the step, for context. */
      readonly context: Expr;
      readonly redex: Expr;
      readonly redexId: NodeId;
      readonly replacement: Expr;
      readonly replacementId: NodeId;
      /** Label of the replacement's node in the syntax tree. */
      readonly treeLabel: string;
      readonly explanation: readonly Part[];
      /** This step produced the final value. */
      readonly completes: boolean;
      /** The replacement is itself the next redex (the tree then shows it amber). */
      readonly replacementIsNext: boolean;
    })
  /** Reduction is stuck in the current state: no step happened from here. */
  | {
      readonly kind: 'error';
      readonly errorKind: string;
      readonly message: string;
      readonly context: Expr;
      readonly stuck?: Expr;
      readonly stuckId?: NodeId;
      readonly stuckLabel?: string;
      readonly lastStep?: RuleRef & { readonly index: number };
    };

const MAX_CODE = 60;

function code(expr: Expr): Part {
  const text = printExpr(expr);
  return { code: text.length > MAX_CODE ? `${text.slice(0, MAX_CODE - 1)}…` : text };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ruleRef(rule: ReductionRule): RuleRef {
  return { rule, name: RULES[rule].name, symbol: RULES[rule].symbol };
}

/** One or two sentences built from the step's recorded facts. */
export function explainStep(step: ReductionStep): Part[] {
  const d = step.detail;
  switch (d.kind) {
    case 'substitution': {
      const beta = step.rule === 'beta';
      const where = beta ? 'the lambda body' : 'the body';
      const what = beta ? 'the argument' : 'the bound value';
      const parts: Part[] =
        d.occurrences === 0
          ? [{ code: d.name }, ` does not occur in ${where}, so ${what} `, code(d.value), ' is discarded.']
          : ['Each free ', { code: d.name }, ` in ${where} is replaced by ${what} `, code(d.value), ` (${plural(d.occurrences, 'occurrence')}).`];
      for (const [from, to] of d.renamed) {
        parts.push(' The inner binder ', { code: from }, ' was renamed to ', { code: to }, ' so it cannot capture a free variable of the value.');
      }
      return parts;
    }
    case 'operation': {
      if (d.op === 'negate') return ['Unary minus turns ', code(d.operands[0]!), ' into the number ', code(d.result), '.'];
      const verb = step.rule === 'arithmetic' ? 'is computed from two numbers' : 'compares two values';
      return [code(rewriteOf(step).before), ` ${verb}, giving `, code(d.result), '.'];
    }
    case 'logic':
      return d.shortCircuit
        ? ['The left operand ', code(d.left), ` decides ${d.op} on its own, so the right side is dropped without being evaluated.`]
        : ['The left operand ', code(d.left), ` does not decide ${d.op}, so the result is the right operand `, code(d.result), '.'];
    case 'branch':
      return [
        'The condition is ', { code: d.condition ? 'True' : 'False' },
        `, so the ${d.condition ? 'then' : 'else'} branch `, code(d.kept),
        ' remains; ', code(d.discarded), ' is discarded unevaluated.',
      ];
    case 'map':
      return d.count === 0
        ? ['map over the empty list gives ', { code: '[]' }, '.']
        : ['map expands into a list of ', plural(d.count, 'application'), ' of ', code(d.fn), ', one per element; they reduce left to right in the next steps.'];
    case 'fold':
      return d.element === undefined
        ? ['The list is empty, so the fold is replaced by its accumulator ', code(d.accumulator), '.']
        : [
            'The front element ', code(d.element), ' is combined with the accumulator ', code(d.accumulator),
            ` by the folding function; ${plural(d.remaining, 'element')} remain${d.remaining === 1 ? 's' : ''} to fold.`,
          ];
  }
}

export function deriveSpotlight(snapshot: ExecutionSnapshot): SpotlightView {
  const { current, next } = snapshot;
  const step = current.step;
  const failure = snapshot.status === 'error' && snapshot.outcome?.status === 'error' ? snapshot.outcome : undefined;

  if (failure) {
    const stuck = failure.path && nodeAt(current.expr, failure.path);
    return {
      kind: 'error',
      errorKind: failure.error.kind,
      message: failure.error.message,
      context: current.expr,
      ...(stuck ? { stuck, stuckId: stuck.id, stuckLabel: treeLabel(stuck) } : {}),
      ...(step ? { lastStep: { ...ruleRef(step.rule), index: current.index } } : {}),
    };
  }

  if (!step) {
    const redex = next && nodeAt(next.before, next.path);
    return {
      kind: 'idle',
      alreadyValue: snapshot.status === 'done',
      ...(next && redex ? { next: { ...ruleRef(next.rule), redex, redexId: next.redexId, treeLabel: treeLabel(redex) } } : {}),
    };
  }

  const { before, after } = rewriteOf(step);
  return {
    kind: 'step',
    ...ruleRef(step.rule),
    index: current.index,
    context: step.before,
    redex: before,
    redexId: step.redexId,
    replacement: after,
    replacementId: step.replacementId,
    treeLabel: treeLabel(after),
    explanation: explainStep(step),
    completes: step.completes,
    replacementIsNext: next?.redexId === step.replacementId,
  };
}

/** Plain-text rendering of an explanation (tests, aria). */
export function partsToText(parts: readonly Part[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.code)).join('');
}
