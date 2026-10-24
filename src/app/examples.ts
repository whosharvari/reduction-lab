export interface Example {
  readonly label: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  { label: 'Lambda', source: '(\\x -> x * 2) 5' },
  { label: 'Let', source: 'let x = 10 in x + 2' },
  { label: 'Map', source: 'map (\\x -> x * 2) [1, 2, 3]' },
  { label: 'Fold', source: 'fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]' },
  { label: 'Closures', source: 'let k = 3 in\nlet scale = \\x -> x * k in\nmap scale [1, 2, 3]' },
  { label: 'Error', source: 'map (\\x -> 10 / x) [2, 1, 0]' },
];
