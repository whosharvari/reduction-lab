import { describe, expect, it } from 'vitest';
import { LangError, parse, run } from '../src/lang';
import { expectError } from './helpers';

describe('undefined variables (NameError)', () => {
  it('reports the name and its position', () => {
    const error = expectError('1 + y', 'NameError', /Undefined variable 'y'/);
    expect(error.span).toMatchObject({ start: 4, end: 5, line: 1, column: 5 });
  });

  it('suggests a close match', () => {
    expectError('mapp (\\x -> x) [1]', 'NameError', /Did you mean 'map'\?/);
    expectError('let total = 1 in totl', 'NameError', /Did you mean 'total'\?/);
  });

  it('respects scope: a lambda parameter is not visible outside the lambda', () => {
    expectError('(\\x -> x) 1 + x', 'NameError', /'x'/);
  });

  it('respects scope: a let binding is not visible outside its body', () => {
    expectError('(let x = 1 in x) + x', 'NameError');
  });

  it('let is non-recursive', () => {
    expectError('let f = \\n -> f n in f 1', 'NameError', /'f'/);
  });

  it('is raised lazily, only when the variable is actually evaluated', () => {
    expect(run('(\\x -> 1) (\\y -> nope)')).toEqual({ kind: 'number', value: 1 });
  });
});

describe('invalid function applications (TypeError)', () => {
  it.each([
    ['5 3', /Cannot apply number 5/],
    ['True 1', /Cannot apply boolean True/],
    ['[1, 2] 0', /Cannot apply list \[1, 2\]/],
    ['(\\x -> x) 1 2', /Cannot apply number 1/],
    ['let x = 4 in x x', /Cannot apply number 4/],
  ])('%s', (source, message) => {
    expectError(source, 'TypeError', message);
  });

  it('points at the whole application', () => {
    const error = expectError('1 + 5 3', 'TypeError');
    expect(error.span).toMatchObject({ start: 4, end: 7 });
  });

  it('map/fold validate their arguments', () => {
    expectError('map 5 [1]', 'TypeError', /map expects a function as its first argument, but got number 5/);
    expectError('map (\\x -> x) 7', 'TypeError', /map expects a list as its second argument/);
    expectError('fold (\\a -> \\b -> a) 0 True', 'TypeError', /fold expects a list as its third argument/);
    expectError('fold 1 0 [1]', 'TypeError', /fold expects a function/);
  });

  it('a fold step function that takes too few arguments fails when its result is applied', () => {
    expectError('fold (\\acc -> acc) 0 [1]', 'TypeError', /Cannot apply number 0/);
  });
});

describe('other type errors', () => {
  it.each([
    ['1 + True', /Operator '\+' expects numbers, but its right operand is boolean True/],
    ['[1] * 2', /left operand is list \[1\]/],
    ['(\\x -> x) < 1', /Operator '<' expects numbers/],
    ['-True', /Unary '-' expects a number/],
    ['if 1 then 2 else 3', /condition of 'if' must be a boolean/],
    ['1 && True', /Operator '&&' expects booleans/],
    ['1 == True', /Cannot compare number 1 with boolean True/],
    ['(\\x -> x) == (\\x -> x)', /Functions cannot be compared/],
  ])('%s', (source, message) => {
    expectError(source, 'TypeError', message);
  });
});

describe('division by zero (RuntimeError)', () => {
  it.each(['1 / 0', '0 / 0', '10 / (5 - 5)', 'map (\\x -> 10 / x) [2, 1, 0]', 'let z = 0 in fold (\\a -> \\x -> a / x) 1 [z]'])(
    '%s',
    (source) => {
      expectError(source, 'RuntimeError', /Division by zero/);
    },
  );

  it('points at the division expression', () => {
    const error = expectError('1 + 8 / 0', 'RuntimeError');
    expect(error.span).toMatchObject({ start: 4, end: 9 });
  });
});

describe('runaway recursion (RuntimeError)', () => {
  it('the omega combinator is stopped by the depth limit instead of crashing', () => {
    expectError('(\\x -> x x) (\\x -> x x)', 'RuntimeError', /maximum depth|nested too deeply/);
  });

  it('the depth limit is configurable', () => {
    const deep = '(\\f -> f (f (f (f 1)))) (\\x -> x + 1)';
    expect(() => run(deep, undefined, { maxDepth: 3 })).toThrow(LangError);
    expect(run(deep).kind).toBe('number');
  });
});

describe('malformed syntax (SyntaxError)', () => {
  it.each([
    ['', /program is empty/],
    ['   -- only a comment', /program is empty/],
    ['1 +', /Expected an expression, but found end of input/],
    ['(1 + 2', /Expected '\)' to close the '\(' at 1:1/],
    ['1 + 2)', /Unexpected '\)' after the end of the expression/],
    ['[1, 2', /Expected '\]' to close the list/],
    ['[1, , 2]', /Expected an expression, but found ','/],
    ['[1, 2,]', /Expected an expression, but found '\]'/],
    ['let x = 1 x', /Expected 'in'/],
    ['let = 1 in 2', /Expected a variable name after 'let'/],
    ['let x 1 in x', /Expected '='/],
    ['\\ -> 1', /Expected a variable name after '\\'/],
    ['\\x y', /Expected '->'/],
    ['\\x x -> x', /Duplicate parameter 'x'/],
    ['let f x x = x in f', /Duplicate parameter 'x'/],
    ['let f f = 1 in f', /same name as the function/],
    ['\\x y x -> 1', /Duplicate parameter 'x'/],
    ['if True then 1', /every 'if' needs an 'else'/],
    ['()', /Empty parentheses/],
    ['1 < 2 < 3', /cannot be chained/],
    ['2x', /Invalid number literal '2x'/],
    ['1 $ 2', /Unexpected character '\$'/],
    ['x = 3', /Unexpected '='/],
    ['let in = 3 in 1', /Expected a variable name/],
  ])('%j', (source, message) => {
    expectError(source, 'SyntaxError', message);
  });

  it('reports line and column on multi-line input', () => {
    const source = 'let x = 1 in\n  x + * 2';
    let error: LangError | undefined;
    try {
      parse(source);
    } catch (e) {
      error = e as LangError;
    }
    expect(error?.span).toMatchObject({ line: 2, column: 7 });
    expect(error?.format(source)).toBe(
      "SyntaxError at 2:7: Expected an expression, but found '*'\n2 |   x + * 2\n  |       ^",
    );
  });

  it('errors are JSON-serialisable', () => {
    const error = expectError('1 / 0', 'RuntimeError');
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      kind: 'RuntimeError',
      message: 'Division by zero',
      span: { start: 0, end: 5, line: 1, column: 1 },
    });
  });
});
