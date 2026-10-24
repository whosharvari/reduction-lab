/**
 * Public API of the Reduction Lab language. The UI imports only from here.
 *
 *   source --tokenize--> tokens --parse--> Expr --evaluate--> Value
 *                                            \--(Phase 2) reduce, one step at a time
 */
import type { Expr } from './ast';
import { createGlobalEnvironment } from './builtins';
import type { Environment } from './environment';
import { isLangError, LangError } from './errors';
import { evaluate, type EvalOptions } from './evaluator';
import { parse } from './parser';
import { formatValue, type Value } from './values';

export * from './ast';
export * from './errors';
export { tokenize, type Token, type TokenType } from './lexer';
export { parse, type ParseOptions } from './parser';
export { evaluate, DEFAULT_MAX_DEPTH, type EvalOptions } from './evaluator';
export { Environment } from './environment';
export { BUILTINS, createGlobalEnvironment, type BuiltinDefinition } from './builtins';
export * from './values';
export { printExpr } from './printer';
export * from './paths';
export type * from './reduction/types';

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
