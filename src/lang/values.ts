/**
 * Runtime values produced by the evaluator.
 */
import type { Expr } from './ast';
import type { Environment } from './environment';
import { formatNumber, printExpr } from './printer';

export { formatNumber };

export interface NumberValue {
  readonly kind: 'number';
  readonly value: number;
}

export interface BooleanValue {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface ListValue {
  readonly kind: 'list';
  readonly elements: readonly Value[];
}

/** A user lambda together with the environment it was defined in. */
export interface ClosureValue {
  readonly kind: 'closure';
  readonly param: string;
  readonly body: Expr;
  readonly env: Environment;
}

/** A built-in function, possibly partially applied (`args.length < arity`). */
export interface BuiltinValue {
  readonly kind: 'builtin';
  readonly name: string;
  readonly arity: number;
  readonly args: readonly Value[];
}

export type Value = NumberValue | BooleanValue | ListValue | ClosureValue | BuiltinValue;
export type FunctionValue = ClosureValue | BuiltinValue;

export const num = (value: number): NumberValue => ({ kind: 'number', value });
export const bool = (value: boolean): BooleanValue => ({ kind: 'boolean', value });
export const list = (elements: readonly Value[]): ListValue => ({ kind: 'list', elements });

export function isFunction(value: Value): value is FunctionValue {
  return value.kind === 'closure' || value.kind === 'builtin';
}

/** User-facing type name used in error messages. */
export function typeName(value: Value): string {
  return isFunction(value) ? 'function' : value.kind;
}

/** Render a value as the user would write it (functions get a descriptive placeholder). */
export function formatValue(value: Value): string {
  switch (value.kind) {
    case 'number':
      return formatNumber(value.value);
    case 'boolean':
      return value.value ? 'True' : 'False';
    case 'list':
      return `[${value.elements.map(formatValue).join(', ')}]`;
    case 'closure':
      return `<function \\${value.param} -> ${printExpr(value.body)}>`;
    case 'builtin':
      return value.args.length === 0
        ? `<builtin ${value.name}>`
        : `<builtin ${value.name} ${value.args.map(formatArg).join(' ')}>`;
  }
}

function formatArg(value: Value): string {
  const text = formatValue(value);
  return value.kind === 'number' && value.value < 0 ? `(${text})` : text;
}

/** Plain JS data for numbers, booleans and lists (handy for tests and the UI). */
export function toJS(value: Value): unknown {
  switch (value.kind) {
    case 'number':
    case 'boolean':
      return value.value;
    case 'list':
      return value.elements.map(toJS);
    default:
      return formatValue(value);
  }
}
