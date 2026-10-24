/**
 * Built-in functions. Each is curried: `map f` is a partially applied builtin
 * value, and the implementation runs only once all `arity` arguments arrive.
 */
import { Environment } from './environment';
import { typeError, type Span } from './errors';
import { formatValue, isFunction, list, typeName, type BuiltinValue, type Value } from './values';

export interface BuiltinContext {
  /** Apply a function value to one argument (closures or builtins). */
  apply(fn: Value, arg: Value): Value;
  /** Span of the application that supplied the final argument. */
  readonly span: Span;
}

export interface BuiltinDefinition {
  readonly name: string;
  readonly arity: number;
  readonly signature: string;
  readonly description: string;
  readonly impl: (args: readonly Value[], ctx: BuiltinContext) => Value;
}

function describeValue(value: Value): string {
  return `${typeName(value)} ${formatValue(value)}`;
}

function expectFunction(builtin: string, position: string, value: Value, span: Span): void {
  if (!isFunction(value)) {
    throw typeError(`${builtin} expects a function as its ${position} argument, but got ${describeValue(value)}`, span);
  }
}

function expectList(builtin: string, position: string, value: Value, span: Span): readonly Value[] {
  if (value.kind !== 'list') {
    throw typeError(`${builtin} expects a list as its ${position} argument, but got ${describeValue(value)}`, span);
  }
  return value.elements;
}

export const BUILTINS: Readonly<Record<string, BuiltinDefinition>> = {
  map: {
    name: 'map',
    arity: 2,
    signature: 'map f [x1, ..., xn]',
    description: 'Apply f to every element: [f x1, ..., f xn].',
    impl([f, xs], ctx) {
      expectFunction('map', 'first', f!, ctx.span);
      const elements = expectList('map', 'second', xs!, ctx.span);
      return list(elements.map((x) => ctx.apply(f!, x)));
    },
  },
  fold: {
    name: 'fold',
    arity: 3,
    signature: 'fold f initial [x1, ..., xn]',
    description: 'Left fold with a curried step function: f (... (f (f initial x1) x2) ...) xn.',
    impl([f, initial, xs], ctx) {
      expectFunction('fold', 'first', f!, ctx.span);
      const elements = expectList('fold', 'third', xs!, ctx.span);
      let acc = initial!;
      for (const x of elements) acc = ctx.apply(ctx.apply(f!, acc), x);
      return acc;
    },
  },
};

export function builtinValue(name: string): BuiltinValue {
  const def = BUILTINS[name];
  if (!def) throw new Error(`Unknown builtin '${name}'`);
  return { kind: 'builtin', name: def.name, arity: def.arity, args: [] };
}

/** The root environment every program is evaluated in. */
export function createGlobalEnvironment(): Environment {
  return Environment.from(Object.keys(BUILTINS).map((name) => [name, builtinValue(name)] as const));
}
