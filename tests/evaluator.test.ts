import { describe, expect, it } from 'vitest';
import { formatValue, interpret, run } from '../src/lang';
import { evalJS } from './helpers';

describe('representative programs from the problem statement', () => {
  it.each([
    ['(\\x -> x * 2) 5', '10'],
    ['let x = 10 in x + 2', '12'],
    ['map (\\x -> x * 2) [1, 2, 3]', '[2, 4, 6]'],
    ['fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]', '6'],
  ])('%s  ==>  %s', (source, expected) => {
    expect(formatValue(run(source))).toBe(expected);
  });
});

describe('arithmetic and precedence', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['2 * 3 + 1', 7],
    ['10 - 4 - 3', 3], // left-associative
    ['100 / 10 / 2', 5], // left-associative
    ['7 / 2', 3.5],
    ['2 * 3 * 4', 24],
    ['-3 + 5', 2],
    ['- 2 * 3', -6],
    ['5 - -2', 7],
    ['1.5 + 2.25', 3.75],
    ['0.1 + 0.2', 0.30000000000000004],
  ])('%s = %s', (source, expected) => {
    expect(evalJS(source)).toBe(expected);
  });

  it('formats floating-point noise away when displaying', () => {
    expect(formatValue(run('0.1 + 0.2'))).toBe('0.3');
  });
});

describe('nested expressions and parentheses', () => {
  it.each([
    ['(1 + 2) * 3', 9],
    ['((((4))))', 4],
    ['2 * (3 + (4 - 1)) / 3', 4],
    ['(10 - (4 - 3))', 9],
    ['-(2 + 3)', -5],
    ['(\\x -> (x + 1) * (x - 1)) 4', 15],
  ])('%s = %s', (source, expected) => {
    expect(evalJS(source)).toBe(expected);
  });
});

describe('booleans, comparisons and conditionals', () => {
  it.each([
    ['1 < 2', true],
    ['2 <= 2', true],
    ['3 > 4', false],
    ['3 >= 4', false],
    ['1 + 1 == 2', true],
    ['1 /= 1', false],
    ['1 != 2', true],
    ['True && False', false],
    ['False || True', true],
    ['1 < 2 && 2 < 3', true],
    ['[1, 2] == [1, 2]', true],
    ['[1, 2] == [1, 3]', false],
    ['if 1 < 2 then 10 else 20', 10],
    ['if False then 1 else if True then 2 else 3', 2],
    ['1 + if True then 1 else 0', 2],
  ])('%s = %s', (source, expected) => {
    expect(evalJS(source)).toBe(expected);
  });

  it('short-circuits && and || (the right side is never evaluated)', () => {
    expect(evalJS('False && (1 / 0 == 1)')).toBe(false);
    expect(evalJS('True || undefinedThing')).toBe(true);
  });

  it('evaluates only the selected branch of if', () => {
    expect(evalJS('if True then 1 else 1 / 0')).toBe(1);
  });
});

describe('lists', () => {
  it.each([
    ['[]', []],
    ['[1, 2, 3]', [1, 2, 3]],
    ['[1 + 1, 2 * 3, -4]', [2, 6, -4]],
    ['[[1, 2], [], [3]]', [[1, 2], [], [3]]],
    ['[True, 1 < 0]', [true, false]],
    ['let xs = [1, 2] in xs', [1, 2]],
  ])('%s', (source, expected) => {
    expect(evalJS(source)).toEqual(expected);
  });

  it('can hold functions', () => {
    expect(formatValue(run('[\\x -> x, map]'))).toBe('[<function \\x -> x>, <builtin map>]');
  });
});

describe('lambdas and application', () => {
  it.each([
    ['(\\x -> x) 42', 42],
    ['(\\x -> \\y -> x - y) 10 3', 7], // application is left-associative
    ['(\\x y -> x - y) 10 3', 7], // multi-parameter sugar
    ['(\\f -> f 3) (\\x -> x * x)', 9], // higher-order
    ['(\\f -> \\x -> f (f x)) (\\n -> n + 1) 0', 2],
    ['let compose = \\f g x -> f (g x) in compose (\\x -> x + 1) (\\x -> x * 2) 5', 11],
  ])('%s = %s', (source, expected) => {
    expect(evalJS(source)).toBe(expected);
  });

  it('partially applies curried lambdas', () => {
    expect(formatValue(run('(\\x -> \\y -> x + y) 1'))).toBe('<function \\y -> x + y>');
    expect(evalJS('let add = \\x y -> x + y in let inc = add 1 in inc 41')).toBe(42);
  });

  it('a lambda value displays as a function', () => {
    expect(formatValue(run('\\x -> x * 2'))).toBe('<function \\x -> x * 2>');
  });
});

describe('let expressions', () => {
  it.each([
    ['let x = 10 in x + 2', 12],
    ['let x = 2 in let y = x * 3 in x + y', 8],
    ['let double x = x * 2 in double 21', 42], // function-binding sugar
    ['let f x y = x * y in f 6 7', 42],
    ['(let x = 3 in x) + (let x = 4 in x)', 7],
    ['let x = 1 + 2 * 3 in x * x', 49],
  ])('%s = %s', (source, expected) => {
    expect(evalJS(source)).toBe(expected);
  });
});

describe('lexical scoping and shadowing', () => {
  it('inner let shadows outer let', () => {
    expect(evalJS('let x = 1 in let x = 2 in x')).toBe(2);
  });

  it('shadowing is scoped: outer binding is visible again outside', () => {
    expect(evalJS('let x = 1 in (let x = 2 in x) + x')).toBe(3);
  });

  it('lambda parameter shadows an outer let', () => {
    expect(evalJS('let x = 1 in (\\x -> x * 10) 5')).toBe(50);
  });

  it('closures capture their defining environment, not the call site', () => {
    expect(evalJS('let x = 1 in let f = \\y -> x + y in let x = 100 in f 10')).toBe(11);
  });

  it('closures returned from functions keep their captured variables', () => {
    expect(evalJS('let makeAdder = \\n -> \\x -> x + n in let add5 = makeAdder 5 in add5 10')).toBe(15);
  });

  it('let is non-recursive: the bound name refers to the outer scope inside its value', () => {
    expect(evalJS('let x = 5 in let x = x + 1 in x')).toBe(6);
  });

  it('builtins can be shadowed', () => {
    expect(evalJS('let map = 3 in map + 1')).toBe(4);
  });

  it('a later binding does not leak into earlier closures', () => {
    expect(evalJS('let f = \\a -> a in let g = \\b -> f b in let f = \\c -> 999 in g 1')).toBe(1);
  });
});

describe('map', () => {
  it.each([
    ['map (\\x -> x * 2) [1, 2, 3]', [2, 4, 6]],
    ['map (\\x -> x + 1) []', []],
    ['map (\\x -> x > 1) [0, 1, 2]', [false, false, true]],
    ['map (\\xs -> map (\\x -> x * 10) xs) [[1], [2, 3]]', [[10], [20, 30]]],
    ['let k = 3 in map (\\x -> x * k) [1, 2]', [3, 6]], // closure over k
    ['map (fold (\\a -> \\b -> a + b) 0) [[1, 2], [3, 4, 5]]', [3, 12]],
  ])('%s', (source, expected) => {
    expect(evalJS(source)).toEqual(expected);
  });

  it('supports partial application', () => {
    expect(formatValue(run('map (\\x -> x)'))).toBe('<builtin map <function \\x -> x>>');
    expect(evalJS('let doubleAll = map (\\x -> x * 2) in doubleAll [5, 6]')).toEqual([10, 12]);
  });

  it('applies the function to each element of the actual list value', () => {
    expect(evalJS('let xs = map (\\x -> x * x) [1, 2, 3] in map (\\y -> y - 1) xs')).toEqual([0, 3, 8]);
  });
});

describe('fold (left fold: fold f initial list, f takes acc then element)', () => {
  it.each([
    ['fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]', 6],
    ['fold (\\acc -> \\x -> acc + x) 100 []', 100],
    ['fold (\\acc x -> acc * x) 1 [1, 2, 3, 4, 5]', 120],
    ['fold (\\acc -> \\x -> acc - x) 10 [1, 2, 3]', 4], // ((10-1)-2)-3: left fold order
    ['fold (\\acc -> \\x -> x - acc) 0 [1, 2, 3]', 2], // 3-(2-(1-0))
    ['fold (\\acc -> \\x -> if x > acc then x else acc) 0 [3, 9, 2]', 9],
  ])('%s = %s', (source, expected) => {
    expect(evalJS(source)).toBe(expected);
  });

  it('can build lists', () => {
    expect(evalJS('fold (\\acc -> \\x -> [acc, x]) [] [1, 2]')).toEqual([[[], 1], 2]);
  });

  it('works with map output', () => {
    expect(evalJS('fold (\\a b -> a + b) 0 (map (\\x -> x * x) [1, 2, 3])')).toBe(14);
  });

  it('folds over a list of functions', () => {
    expect(evalJS('fold (\\acc -> \\f -> f acc) 1 [\\x -> x + 1, \\x -> x * 10]')).toBe(20);
  });
});

describe('interpret() (non-throwing API used by the UI)', () => {
  it('returns the AST and a display string on success', () => {
    const result = interpret('1 + 2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.display).toBe('3');
      expect(result.ast.kind).toBe('Binary');
    }
  });

  it('returns the AST when evaluation (not parsing) fails', () => {
    const result = interpret('1 / 0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ast).toBeDefined();
      expect(result.error.kind).toBe('RuntimeError');
    }
  });

  it('omits the AST when parsing fails', () => {
    const result = interpret('1 +');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ast).toBeUndefined();
  });
});
