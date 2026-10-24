/**
 * Public API of the Reduction Lab language. The UI imports only from here.
 *
 *   source --tokenize--> tokens --parse--> Expr --evaluate--> Value
 *                                            \--step--> Expr --step--> ... --> value (small-step)
 */
import type { Expr } from './ast';
import { createGlobalEnvironment } from './builtins';
import type { Environment } from './environment';
import { isLangError, LangError } from './errors';
import { evaluate, type EvalOptions } from './evaluator';
import { parse } from './parser';
import { traceReduction, type TraceOptions } from './reduction/trace';
export {
  ExecutionController,
  type ExecutionOptions,
  type ExecutionSnapshot,
  type ExecutionStatus,
  type HistoryEntry,
} from './reduction/history';
import type { ReductionTrace } from './reduction/types';
import { formatValue, type Value } from './values';

export * from './ast';
export * from './errors';
export { tokenize, type Token, type TokenType } from './lexer';
export { parse, MAX_NESTING, MAX_TREE_DEPTH, type ParseOptions } from './parser';
export { evaluate, DEFAULT_MAX_DEPTH, type EvalOptions } from './evaluator';
export { Environment } from './environment';
export { BUILTINS, createGlobalEnvironment, type BuiltinDefinition } from './builtins';
export * from './values';
export { printExpr, printWithRanges, type PrintedExpr, type TextRange } from './printer';
export * from './paths';
export type * from './reduction/types';
export { SmallStepReducer, isValue } from './reduction/reducer';
export { substitute, cloneWithFreshIds } from './reduction/substitution';
export {
  traceReduction,
  stateAt,
  states,
  finalExpr,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_NODES,
  type TraceOptions,
} from './reduction/trace';

/** Parse and evaluate in one call; throws `LangError` on failure. */
export function run(source: string, env: Environment = createGlobalEnvironment(), options?: EvalOptions): Value {
  return evaluate(parse(source), env, options);
}

export type InterpretResult =
  | { readonly ok: true; readonly ast: Expr; readonly value: Value; readonly display: string }
  | { readonly ok: false; readonly ast?: Expr; readonly error: LangError };

/** Non-throwing variant for the UI: reports which stage failed via `ast` presence. */
export function interpret(source: string, options?: EvalOptions): InterpretResult {
  let ast: Expr | undefined;
  try {
    ast = parse(source);
    const value = evaluate(ast, createGlobalEnvironment(), options);
    return { ok: true, ast, value, display: formatValue(value) };
  } catch (error) {
    if (isLangError(error)) return ast ? { ok: false, ast, error } : { ok: false, error };
    throw error;
  }
}

/** Parse `source` and record its full small-step reduction. Throws `LangError` only for syntax errors. */
export function trace(source: string, options?: TraceOptions): ReductionTrace {
  return traceReduction(parse(source), options);
}
