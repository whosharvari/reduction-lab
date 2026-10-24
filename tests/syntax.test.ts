import { describe, expect, it } from 'vitest';
import {
  freeVariables,
  IdGenerator,
  maxNodeId,
  nodeAt,
  parse,
  pathTo,
  printExpr,
  replaceAt,
  tokenize,
  type Expr,
} from '../src/lang';

/** Strip ids/spans so trees can be compared structurally. */
function shape(expr: Expr): unknown {
  return JSON.parse(JSON.stringify(expr, (key, value) => (key === 'id' || key === 'span' ? undefined : value)));
}

describe('tokenizer', () => {
  it('produces typed tokens with spans', () => {
    const tokens = tokenize('\\x -> x * 2.5');
    expect(tokens.map((t) => t.type)).toEqual(['\\', 'ident', '->', 'ident', '*', 'number', 'eof']);
    expect(tokens[5]).toMatchObject({ text: '2.5', span: { start: 10, end: 13, line: 1, column: 11 } });
  });

  it('recognises keywords, multi-character operators and comments', () => {
    const types = tokenize('let in if then else True False == /= != <= >= && || -- comment\n<').map((t) => t.type);
    expect(types).toEqual(['let', 'in', 'if', 'then', 'else', 'True', 'False', '==', '/=', '/=', '<=', '>=', '&&', '||', '<', 'eof']);
  });

  it("allows primes and underscores in identifiers", () => {
    expect(tokenize("x' my_var x2")[0]).toMatchObject({ type: 'ident', text: "x'" });
    expect(tokenize("x' my_var x2").map((t) => t.text)).toEqual(["x'", 'my_var', 'x2', '']);
  });
});

describe('parser', () => {
  it('builds the expected tree for precedence', () => {
    expect(shape(parse('1 + 2 * 3'))).toEqual({
      kind: 'Binary',
      op: '+',
      left: { kind: 'Number', value: 1 },
      right: { kind: 'Binary', op: '*', left: { kind: 'Number', value: 2 }, right: { kind: 'Number', value: 3 } },
    });
  });

  it('application binds tighter than operators and is left-associative', () => {
    expect(printExpr(parse('f x y + g z'))).toBe('f x y + g z');
    const tree = parse('f x y') as Extract<Expr, { kind: 'App' }>;
    expect(tree.kind).toBe('App');
    expect(tree.fn.kind).toBe('App');
  });

  it('lambda bodies extend as far right as possible', () => {
    const tree = parse('\\x -> x + 1');
    expect(tree.kind).toBe('Lambda');
    expect(shape(parse('\\a b -> a'))).toEqual({
      kind: 'Lambda',
      param: 'a',
      body: { kind: 'Lambda', param: 'b', body: { kind: 'Var', name: 'a' } },
    });
  });

  it('desugars let-bound functions to lambdas', () => {
    expect(shape(parse('let f x = x in f'))).toEqual(shape(parse('let f = \\x -> x in f')));
  });

  it('assigns unique node ids and accurate spans', () => {
    const source = 'map (\\x -> x) [10, 20]';
    const tree = parse(source);
    const ids: number[] = [];
    const walk = (e: Expr) => {
      ids.push(e.id);
      expect(source.slice(e.span.start, e.span.end).length).toBeGreaterThan(0);
      Object.values(e).forEach((v) => {
        if (Array.isArray(v)) v.forEach((c) => c && typeof c === 'object' && 'kind' in c && walk(c));
        else if (v && typeof v === 'object' && 'kind' in v) walk(v as Expr);
      });
    };
    walk(tree);
    expect(new Set(ids).size).toBe(ids.length);
    const list = (tree as Extract<Expr, { kind: 'App' }>).arg;
    expect(source.slice(list.span.start, list.span.end)).toBe('[10, 20]');
  });

  it('can continue an id sequence', () => {
    const ids = new IdGenerator(100);
    expect(parse('1', { ids }).id).toBe(100);
    expect(parse('2', { ids }).id).toBe(101);
  });

  it('produces JSON-serialisable trees', () => {
    const tree = parse('let x = [1, 2] in map (\\y -> y) x');
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});

describe('printer', () => {
  it.each([
    '1 + 2 * 3',
    '(1 + 2) * 3',
    '10 - (4 - 3)',
    '10 - 4 - 3',
    'f (g x) y',
    '(\\x -> x * 2) 5',
    'map (\\x -> x * 2) [1, 2, 3]',
    'fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]',
    'let x = 10 in x + 2',
    '1 + (\\x -> x)',
    '-(-x)',
    '-f x',
    'f (-1)',
    'a && b || c',
    'a && (b || c)',
    '(1 < 2) == True',
    'if a then b else c',
    '(if a then b else c) + 1',
    '[]',
  ])('round-trips %s', (source) => {
    const printed = printExpr(parse(source));
    expect(printed).toBe(source);
    expect(shape(parse(printed))).toEqual(shape(parse(source)));
  });

  it('drops redundant parentheses', () => {
    expect(printExpr(parse('((1)) + (2 * (3))'))).toBe('1 + 2 * 3');
  });
});

describe('AST utilities for the reducer', () => {
  it('freeVariables respects lambda and let binders', () => {
    expect([...freeVariables(parse('\\x -> x + y'))]).toEqual(['y']);
    expect([...freeVariables(parse('let x = x in x + z'))].sort()).toEqual(['x', 'z']);
    expect([...freeVariables(parse('map (\\x -> x) xs'))].sort()).toEqual(['map', 'xs']);
  });

  it('nodeAt / pathTo / replaceAt address and rewrite sub-trees persistently', () => {
    const tree = parse('map (\\x -> x * 2) [1, 2, 3]');
    const path = [['elements', 1]] as const;
    const listPath = ['arg', ...path] as const;
    const two = nodeAt(tree, listPath)!;
    expect(two).toMatchObject({ kind: 'Number', value: 2 });
    expect(pathTo(tree, two.id)).toEqual(listPath);

    const ids = new IdGenerator();
    ids.reserveAbove(tree);
    const replacement: Expr = { kind: 'Number', id: ids.next(), span: two.span, value: 20 };
    const updated = replaceAt(tree, listPath, replacement);

    expect(printExpr(updated)).toBe('map (\\x -> x * 2) [1, 20, 3]');
    expect(printExpr(tree)).toBe('map (\\x -> x * 2) [1, 2, 3]'); // original untouched
    expect(replacement.id).toBeGreaterThan(maxNodeId(tree));
    // Untouched subtrees are shared, not copied.
    expect((updated as Extract<Expr, { kind: 'App' }>).fn).toBe((tree as Extract<Expr, { kind: 'App' }>).fn);
  });

  it('replaceAt rejects invalid paths', () => {
    expect(() => replaceAt(parse('1 + 2'), ['fn'], parse('3'))).toThrow(/Invalid path/);
  });
});
