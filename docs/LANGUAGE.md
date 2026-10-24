# Reduction Lab language specification (v0.1)

A small, strict, dynamically checked, Haskell-flavoured expression language.
A program is a single expression.

## Values

| Type     | Examples                         | Notes |
|----------|----------------------------------|-------|
| number   | `0`, `42`, `3.25`                | IEEE-754 doubles. No exponent syntax. Negative numbers are written with unary `-`. |
| boolean  | `True`, `False`                  | |
| list     | `[]`, `[1, 2, 3]`, `[[1], []]`   | Heterogeneous lists are allowed (no static types). |
| function | `\x -> x + 1`, `map`, `map f`    | User lambdas (closures) and curried built-ins, including partial applications. |

## Lexical syntax

- Whitespace (including newlines) only separates tokens.
- Comments: `--` to end of line.
- Identifiers: `[A-Za-z_][A-Za-z0-9_']*`, except the keywords
  `let in if then else True False`.
- Numbers: `digits` or `digits.digits`. `2x` is an error (not `2 x`).
- Symbols: `\ -> ( ) [ ] , = + - * / == /= != < <= > >= && ||`.
  `!=` is accepted as an alias for `/=`.

## Grammar

```
program     ::= expr EOF
expr        ::= or
or          ::= and ( '||' or )?
and         ::= compare ( '&&' and )?
compare     ::= additive ( ('=='|'/='|'<'|'<='|'>'|'>=') additive )?
additive    ::= term ( ('+'|'-') term )*
term        ::= unary ( ('*'|'/') unary )*
unary       ::= '-' unary | prefix | application
prefix      ::= 'let' IDENT IDENT* '=' expr 'in' expr
              | '\' IDENT+ '->' expr
              | 'if' expr 'then' expr 'else' expr
application ::= atom atom*
atom        ::= NUMBER | 'True' | 'False' | IDENT
              | '(' expr ')'
              | '[' ( expr ( ',' expr )* )? ']'
```

## Precedence and associativity (loosest to tightest)

| Level | Construct                         | Associativity |
|-------|-----------------------------------|---------------|
| 0     | `let … in`, `\x -> …`, `if … then … else` | extend as far right as possible |
| 1     | `\|\|`                            | right |
| 2     | `&&`                              | right |
| 3     | `== /= < <= > >=`                 | none (`a < b < c` is a syntax error) |
| 4     | `+ -`                             | left |
| 5     | `* /`                             | left |
| 6     | unary `-`                         | prefix |
| 7     | function application `f x y`      | left (`(f x) y`) |

Consequences:
- `f x + 1` is `(f x) + 1`. `f -1` is `f - 1`; write `f (-1)`.
- `\x -> x + 1` is `\x -> (x + 1)`; `1 + \x -> x` is `1 + (\x -> x)`.
- `-2 * 3` is `(-2) * 3`, and `- f x` is `-(f x)`.

## Syntactic sugar

| Sugar                        | Meaning |
|------------------------------|---------|
| `\a b c -> e`                | `\a -> \b -> \c -> e` |
| `let f a b = e in body`      | `let f = \a -> \b -> e in body` |
| `( e )`                      | `e` (parentheses only group; they create no AST node) |

Parameter names within one lambda or `let` definition must be distinct.

## Scoping

- Lexical (static) scoping. A lambda captures the environment where it is
  *written*, not where it is called:
  `let x = 1 in let f = \y -> x + y in let x = 100 in f 10` evaluates to `11`.
- Inner bindings shadow outer ones for the extent of their scope only.
- `let` is **non-recursive**: in `let x = e in b`, `x` is in scope in `b` but
  not in `e`. `let x = x + 1 in x` refers to an outer `x`.
- The built-ins `map` and `fold` live in the outermost scope and may be shadowed.

## Evaluation order

Strict, call-by-value, left to right:
- `f a`: evaluate `f`, then `a`, then apply.
- `a op b` (arithmetic/comparison): evaluate `a`, then `b`.
- `a && b`, `a || b`: evaluate `a`; evaluate `b` only if needed.
- `if c then t else e`: evaluate `c`, then only the chosen branch.
- `[e1, …, en]`: evaluate elements left to right.
- `let x = e in b`: evaluate `e`, bind, then evaluate `b`.

## Numbers

Numbers are IEEE-754 doubles. How results print:

- **No exponent notation for finite values.** Every finite result is written in a form the
  lexer can read back.
  - Integers print exactly: `1e24` prints as `999999999999999983222784`, its exact double value.
  - Non-integers print to 12 significant digits, so `0.1 + 0.2` shows `0.3`. Tiny values
    are written out in full (`0.0000001`). Re-reading a printed non-integer gives that
    displayed value.
- **`-0` prints as `0`.** The language can't tell them apart: `0 == -0` is `True`, and
  dividing by either is an error.
- **`Infinity` and `NaN`** can only come from overflow (e.g. repeated multiplication), and
  `NaN` from operations like `Infinity - Infinity`. They print as `Infinity` / `NaN`, which
  have no literal syntax (re-read, they would be variable names). `NaN == NaN` is `False`.

## Operators

- `+ - * /` take numbers. `/` is real division (`7 / 2` is `3.5`).
- `< <= > >=` take numbers.
- `== /=` are structural over numbers, booleans and lists. Comparing values
  of different types (e.g. `1 == True`) or comparing functions is a TypeError.
- `&& ||` take booleans.

## Built-ins

| Name   | Usage                    | Result |
|--------|--------------------------|--------|
| `map`  | `map f [x1, …, xn]`      | `[f x1, …, f xn]` |
| `fold` | `fold f initial [x1, …, xn]` | `f (… (f (f initial x1) x2) …) xn` |

`fold` is a **left fold**. Its step function is curried and takes the
accumulator first, then the element: `fold (\acc -> \x -> acc + x) 0 [1, 2, 3]`
evaluates `((0 + 1) + 2) + 3 = 6`. `fold f z []` is `z`.

Both are curried: `map f` and `fold f z` are function values.

## Small-step semantics

The reducer (`src/lang/reduction/`) rewrites the expression one redex at a time. It visits
redexes in the evaluation order above, and every intermediate state is valid source.

| Rule        | Rewrite |
|-------------|---------|
| `beta`      | `(\x -> e) v` → `e[x := v]` |
| `let`       | `let x = v in e` → `e[x := v]` |
| `arithmetic`| `2 + 3` → `5` (`/` by `0` is a RuntimeError) |
| `comparison`| `2 < 3` → `True`; `[1] == [1]` → `True` |
| `logic`     | `False && e` → `False`, `True && b` → `b` (same for `\|\|`) |
| `negate`    | `-3` (unary minus applied to `3`) → the literal `-3` |
| `if`        | `if True then a else b` → `a` |
| `map`       | `map f [x1, …, xn]` → `[f x1, …, f xn]` |
| `fold-step` | `fold f z [x, …xs]` → `fold f (f z x) […xs]` |
| `fold-done` | `fold f z []` → `z` |

Here `v` is a value: a number, boolean, lambda, list of values, built-in name, or
built-in applied to fewer arguments than it needs (e.g. `map f`).
Substitution avoids name capture. If a binder would capture a free name of the
substituted value, the binder is renamed with primes (`\map -> …` becomes `\map' -> …`).
After `map`, the list's elements reduce left to right, and each step reports which
element index is changing.

The reducer gives the same result as the big-step evaluator: the same value, or an error of the same kind.
Error messages can differ in detail (for example, how a function value is printed).

## Errors

Every error has a kind, a message, and (when known) a source span (offsets plus line and column).

| Kind           | Raised when | Example |
|----------------|-------------|---------|
| `SyntaxError`  | Bad character, unexpected token, unclosed bracket, empty program, duplicate parameter, chained comparison, nesting deeper than 300 levels, or a syntax tree deeper than 1000 levels | `(1 + 2`, `1 < 2 < 3` |
| `NameError`    | A variable is evaluated but not bound in scope. Suggests a close match. | `mapp f xs` gives `Did you mean 'map'?` |
| `TypeError`    | Applying a non-function; operator or built-in given the wrong kind of value; non-boolean `if` condition | `5 3`, `1 + True`, `map 5 [1]` |
| `RuntimeError` | Division by zero; evaluation deeper than the depth limit (default 2000); reduction longer than 10,000 steps, larger than 50,000 nodes, or deeper than 1000 levels | `1 / 0`, `(\x -> x x) (\x -> x x)` |

Errors are raised when the offending expression is *evaluated*. An unused
undefined variable inside a lambda body that never runs is not an error.
Evaluation stops at the first error.
