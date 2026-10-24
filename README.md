# Reduction Lab

A browser playground for a small Haskell-like functional language, built for
the Syntax Error 2026 Functional Programming Track. The goal: write an
expression, then watch it reduce one step at a time, with lists, functions and
accumulators visibly rewritten in place.

**Status: Phase 2 of 5.** The language engine (tokenizer, parser, evaluator,
built-ins, errors), the small-step reducer, and a navigable execution history
controller are built and tested. The UI is still a basic step viewer. The full
visual frontend is Phase 3.

## Setup

Requires Node.js 20+ (developed on Node 24). Everything runs locally; no API keys or network access are needed at runtime.

```sh
npm install
npm run dev        # start the playground at http://localhost:5173
npm test           # run the test suite (Vitest)
npm run typecheck  # TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run eval -- "map (\x -> x * 2) [1, 2, 3]"   # evaluate from the command line
npm run eval -- --steps "fold (\acc x -> acc + x) 0 [1, 2]"   # print every reduction step (--ast dumps the tree)
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
  reduction/        small-step engine
    reducer.ts       one semantic rewrite per step (findRedex + contract)
    substitution.ts  capture-avoiding substitution
    history.ts       ExecutionController: next / previous / reset / goTo / runToCompletion
    trace.ts         one-shot traces (traceReduction, stateAt, states)
    types.ts         step / trace data shapes
  index.ts         public API (parse, evaluate, run, interpret)
src/app/           React UI (Vite)
scripts/eval.ts    CLI runner
tests/             Vitest suites (parsed programs end to end)
docs/              language spec + architecture notes
```

The reference evaluator is environment-based and big-step. The reducer is
substitution-based and works on the AST, so every intermediate state is
genuine source code. A test checks that the two agree on every program in `tests/corpus.ts`.

```
map (\x -> x * 2) [1, 2, 3]
[(\x -> x * 2) 1, (\x -> x * 2) 2, (\x -> x * 2) 3]    map
[1 * 2, (\x -> x * 2) 2, (\x -> x * 2) 3]               beta        element 0
[2, (\x -> x * 2) 2, (\x -> x * 2) 3]                   arithmetic  element 0
...
[2, 4, 6]
```

Stepping from code:

```ts
import { ExecutionController } from './src/lang';

const run = ExecutionController.fromSource('fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]', { maxSteps: 1000 });
run.next();                 // one semantic step
run.current.source;         // 'fold (\\acc -> \\x -> acc + x) ((\\acc -> \\x -> acc + x) 0 1) [2, 3]'
run.current.step?.foldFocus; // { phase: 'consume', index: 0, element: 1, accumulatorBefore: 0, … }
run.previous();             // restores the earlier snapshot
run.runToCompletion();      // { status: 'done', expr: 6 }, bounded by maxSteps
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Known limitations

- The step view is functional but basic: no animation, no tree view, and no
  accumulator panel for `fold` yet.
- The reducer copies substituted values instead of sharing them, so programs that
  duplicate large values grow quickly. A node limit (50,000) and a step limit (10,000) stop runaway cases.
- `fold` consumes its list (`fold f acc [rest]`). The original list and the active
  index come from history metadata (`foldFocus.original`/`index`), not from the expression.
- Map-input and fold-index metadata need the history (`ExecutionController`). A lone
  `SmallStepReducer.step` call has no memory, so it reports only structural focus.
- Function values print differently in the two engines (`<function \y -> x + y>`
  from the evaluator, `\y -> 1 + y` after substitution).
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
