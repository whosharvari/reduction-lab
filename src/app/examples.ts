export interface Example {
  readonly id: string;
  readonly title: string;
  /** The concept the example demonstrates, as a short tag. */
  readonly concept: string;
  readonly explanation: string;
  readonly source: string;
  /** Final value as printed by the interpreter (verified in tests/examples.test.ts). */
  readonly expected: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'map',
    title: 'Map',
    concept: 'map',
    explanation:
      'map expands into one function application per element; each application then reduces in place, left to right.',
    source: 'map (\\x -> x * 2) [1, 2, 3]',
    expected: '[2, 4, 6]',
  },
  {
    id: 'fold',
    title: 'Fold',
    concept: 'fold',
    explanation:
      'A left fold feeds each element into the accumulator: fold f acc [x, …] becomes fold f (f acc x) […].',
    source: 'fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]',
    expected: '6',
  },
  {
    id: 'lambda',
    title: 'Lambda application',
    concept: 'β-reduction',
    explanation: 'Applying a lambda substitutes the argument for its parameter in the body.',
    source: '(\\x -> x * 2) 5',
    expected: '10',
  },
  {
    id: 'let',
    title: 'Let binding',
    concept: 'let',
    explanation: 'let evaluates its value, then substitutes it for the name throughout the body.',
    source: 'let x = 10 in x + 2',
    expected: '12',
  },
  {
    id: 'arithmetic',
    title: 'Nested arithmetic',
    concept: 'evaluation order',
    explanation: 'Operands reduce left to right; an operator fires only once both of its operands are values.',
    source: '(2 + 3) * (10 - 4) / 2',
    expected: '15',
  },
  {
    id: 'conditional',
    title: 'Conditional',
    concept: 'if / &&',
    explanation:
      'The condition reduces first. && short-circuits, and only the chosen branch is ever evaluated.',
    source: 'let n = 7 in\nif n > 5 && n < 10 then n * 2 else 0',
    expected: '14',
  },
  {
    id: 'twice',
    title: 'Nested application',
    concept: 'higher-order',
    explanation: 'A function that takes a function: twice applies f to the result of applying f.',
    source: 'let twice = \\f -> \\x -> f (f x) in\ntwice (\\n -> n + 3) 10',
    expected: '16',
  },
  {
    id: 'pipeline',
    title: 'Map, then fold',
    concept: 'composition',
    explanation: 'Call-by-value: the inner map finishes producing its list before fold starts consuming it.',
    source: 'fold (\\acc -> \\x -> acc + x) 0\n  (map (\\x -> x * x) [1, 2, 3])',
    expected: '14',
  },
  {
    id: 'closure',
    title: 'Closures',
    concept: 'lexical scope',
    explanation: 'scale captures k = 3 where it is defined; substitution makes that capture visible.',
    source: 'let k = 3 in\nlet scale = \\x -> x * k in\nmap scale [1, 2, 3]',
    expected: '[3, 6, 9]',
  },
  {
    id: 'error',
    title: 'Runtime error',
    concept: 'errors',
    explanation: 'Reduction stops at the exact redex that cannot proceed — here, dividing by zero.',
    source: 'map (\\x -> 10 / x) [5, 2, 0]',
    expected: 'RuntimeError',
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
