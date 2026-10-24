/**
 * Seeded random program generators for differential testing (no extra dependencies).
 *
 * Variable names deliberately include `map`, `fold` and primed names so that
 * shadowing of builtins and alpha-renamed binders (`x'`) are exercised.
 */

/** mulberry32: small, fast, deterministic PRNG. */
export function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const literal = (r: () => number) => `(${Math.floor(r() * 9) - 2})`; // parenthesised: `--` would start a comment

const UNTYPED_NAMES = ['x', 'y', 'z', 'map', "x'"];

/** Arbitrary (often ill-typed) programs: exercises error paths and evaluation order. */
export function untypedProgram(r: () => number, depth = 5, scope: readonly string[] = []): string {
  if (depth <= 0 || r() < 0.2) {
    const leaves: Array<() => string> = [
      () => literal(r),
      () => pick(r, ['True', 'False']),
      () => (scope.length ? pick(r, scope) : '1'),
      () => '[]',
    ];
    if (r() < 0.03) leaves.push(() => 'unboundName');
    return pick(r, leaves)();
  }
  const g = (s: readonly string[] = scope) => untypedProgram(r, depth - 1, s);
  const name = pick(r, UNTYPED_NAMES);
  const forms: Array<() => string> = [
    () => `(${g()} ${pick(r, ['+', '-', '*', '/', '<', '==', '&&', '||'])} ${g()})`,
    () => `(-${g()})`,
    () => `(if ${g()} then ${g()} else ${g()})`,
    () => `(let ${name} = ${g()} in ${g([...scope, name])})`,
    () => `(\\${name} -> ${g([...scope, name])})`,
    () => `(${g()} ${g()})`,
    () => `[${g()}, ${g()}]`,
    () => `(map ${g()} ${g()})`,
    () => `(fold ${g()} ${g()} ${g()})`,
    () => `((\\${name} -> ${g([...scope, name])}) ${g()})`,
  ];
  return pick(r, forms)();
}

const TYPED_NAMES = ['x', 'y', 'acc', 'map', 'fold', "x'", 'k'];

interface Scope {
  readonly nums: readonly string[];
  readonly fns: readonly string[];
}

const bindNum = (s: Scope, ...names: string[]): Scope => ({
  nums: [...s.nums.filter((n) => !names.includes(n)), ...names],
  fns: s.fns.filter((f) => !names.includes(f)),
});
const bindFn = (s: Scope, name: string): Scope => ({
  fns: [...s.fns.filter((f) => f !== name), name],
  nums: s.nums.filter((n) => n !== name),
});

/** Mostly well-typed numeric programs: exercises successful map/fold/closure/capture paths. */
export function typedProgram(r: () => number, depth = 4): string {
  const empty: Scope = { nums: [], fns: [] };
  return r() < 0.3 ? list(r, empty, depth) : num(r, empty, depth);
}

function num(r: () => number, s: Scope, d: number): string {
  if (d <= 0 || r() < 0.15) return s.nums.length && r() < 0.5 ? pick(r, s.nums) : literal(r);
  const name = pick(r, TYPED_NAMES);
  const choices = s.fns.length ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 6, 7];
  switch (pick(r, choices)) {
    case 0:
      return `(${num(r, s, d - 1)} ${pick(r, ['+', '-', '*'])} ${num(r, s, d - 1)})`;
    case 1:
      return `(if ${num(r, s, d - 1)} < ${num(r, s, d - 1)} && True then ${num(r, s, d - 1)} else ${num(r, s, d - 1)})`;
    case 2:
      return `(let ${name} = ${num(r, s, d - 1)} in ${num(r, bindNum(s, name), d - 1)})`;
    case 3:
      return `(${fn(r, s, d - 1)} ${num(r, s, d - 1)})`;
    case 4:
      return `(fold (\\${name} -> \\z -> ${num(r, bindNum(s, name, 'z'), d - 2)}) ${num(r, s, d - 1)} ${list(r, s, d - 1)})`;
    case 5:
      return `(${pick(r, s.fns)} ${num(r, s, d - 1)})`;
    case 6:
      return `(let ${name} = ${fn(r, s, d - 1)} in ${num(r, bindFn(s, name), d - 1)})`;
    default:
      return `(-${num(r, s, d - 1)})`;
  }
}

function fn(r: () => number, s: Scope, d: number): string {
  if (s.fns.length && r() < 0.3) return pick(r, s.fns);
  const name = pick(r, TYPED_NAMES);
  // The body may mention outer names: closures and capture-avoidance get exercised.
  return `(\\${name} -> ${num(r, bindNum(s, name), d)})`;
}

function list(r: () => number, s: Scope, d: number): string {
  const xs = Array.from({ length: Math.floor(r() * 4) }, () => num(r, s, d - 1));
  return r() < 0.4 ? `(map ${fn(r, s, d - 1)} [${xs.join(', ')}])` : `[${xs.join(', ')}]`;
}
