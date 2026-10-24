# Reduction Lab

A browser playground for a small Haskell-like functional language, built for
the Syntax Error 2026 Functional Programming Track. The goal: write an
expression, then watch it reduce one step at a time, with lists, functions and
accumulators visibly rewritten in place.

**Status: Phase 1 of 5.** The language engine (tokenizer, parser, evaluator,
built-ins, errors) is complete and tested, and the AST and interfaces for the
small-step reducer are in place. The UI is currently a minimal evaluate box.
Step-by-step reduction and visualisation are not implemented yet.

## Setup

Requires Node.js 20+ (developed on Node 24). Everything runs locally; no API keys or network access are needed at runtime.

```sh
npm install
npm run dev        # start the playground at http://localhost:5173
npm test           # run the test suite (Vitest)
npm run typecheck  # TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run eval -- "map (\x -> x * 2) [1, 2, 3]"   # evaluate from the command line (add --ast to dump the tree)
```

## Language at a glance

```haskell
42                                    -- numbers
True && 1 < 2                         -- booleans, comparisons
[1, 2 + 3, 4]                         -- lists
\x -> x * 2                           -- lambda
(\x -> x * 2) 5                       -- application            ⇒ 10
\acc x -> acc + x                     -- sugar for \acc -> \x -> acc + x
let x = 10 in x + 2                   -- let                    ⇒ 12
let double x = x * 2 in double 4      -- function binding sugar ⇒ 8
if x > 0 then x else -x               -- conditional
map (\x -> x * 2) [1, 2, 3]           -- ⇒ [2, 4, 6]
fold (\acc -> \x -> acc + x) 0 [1, 2, 3]   -- left fold      ⇒ 6
```

`fold f initial list` is a left fold. `f` takes the accumulator first, then the element.

See [`docs/LANGUAGE.md`](docs/LANGUAGE.md) for the full grammar, precedence table,
scoping and evaluation-order rules, and error kinds.

## Architecture

```
src/lang/          UI-independent interpreter
  lexer.ts         source → tokens (with spans)
  parser.ts        recursive descent → AST (with ids + spans)
  ast.ts           node types, IdGenerator, freeVariables
  printer.ts       AST → source (minimal parens, round-trips)
  paths.ts         addressing / persistent in-place replacement of sub-trees
  environment.ts   immutable lexical environments
  values.ts        runtime values + formatting
  builtins.ts      map, fold (curried)
  evaluator.ts     big-step reference semantics
  errors.ts        structured LangError (SyntaxError | NameError | TypeError | RuntimeError)
  reduction/types.ts  contract for the Phase 2 small-step reducer
  index.ts         public API (parse, evaluate, run, interpret)
src/app/           React UI (Vite)
scripts/eval.ts    CLI runner
tests/             Vitest suites (parsed programs end to end)
docs/              language spec + architecture notes
```

The reference evaluator is environment-based and big-step. The upcoming reducer is
substitution-based and works on the AST, so every intermediate state is
genuine source code. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Known limitations

- No small-step reduction yet (Phase 2). The UI shows only the final value.
- `let` is non-recursive and there is no `letrec`, so there is no general recursion.
  Loops are expressed with `map`/`fold`.
- No static type checking. Type errors are detected at runtime, when the
  offending expression is evaluated.
- Only `map` and `fold` are built in (no `filter`, `head`, `length`, ranges, strings, …).
- Numbers are JS doubles. There is no exponent literal syntax, and very large values
  can print as `1e+21`, which the lexer cannot read back.
- One binding per `let`. Write `let a = 1 in let b = 2 in …`.
- No operator sections (`(+ 1)`) or operators as functions (`(+)`).
- Evaluation depth is capped (default 2000 nested evaluations) to stop runaway recursion.
