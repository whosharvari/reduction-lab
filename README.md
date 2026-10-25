# Reduction Lab

> Every expression has a story. Watch it unfold.

Reduction Lab is a browser-based, step-by-step interpreter for a small Haskell-like
functional language. Instead of printing only the final value, it shows the expression
being rewritten one reduction at a time, with the redex, the list element being updated
and the fold accumulator highlighted.

It is a submission for the Syntax Error 2026 Functional Programming Track, Problem
Statement 1 (a tiny Haskell-like interpreter): numbers, lists, `let`, functions, `map`
and `fold`, with one-step-at-a-time reduction and in-place expression rewriting.

Every state shown in the UI is produced by the interpreter's small-step reducer. The
frontend does not generate or animate steps of its own.

## Demo

A guided walkthrough of about four minutes is in [`docs/DEMO.md`](docs/DEMO.md). Every
program and result in it is checked by `tests/demo.test.ts`.

The repository contains no screenshots, recordings or hosted deployment. To see the
application, follow [Installation and usage](#installation-and-usage).

## Motivation

A REPL returns a value and hides the process that produced it. In a functional language
that process is rewriting: a call becomes the function body with the argument
substituted, an operator becomes its result. Three things are hard to see from the final
answer alone:

- **Evaluation order.** Here it is strict and left to right.
- **Substitution**, including how variable capture is avoided.
- **`map` and `fold`.** How they walk a list, and how the accumulator changes.

Showing each intermediate expression makes these visible. This is the motivation for the
project. No user study was done, and no educational outcome is claimed.

## Features

- **Language** (specified in [`docs/LANGUAGE.md`](docs/LANGUAGE.md)): numbers, booleans,
  possibly nested lists, lambdas (multi-parameter sugar is curried), application, `let`
  (including `let f x = …`), `if`, comparison and boolean operators, and the built-ins
  `map` and `fold`. Evaluation is strict, scoping is lexical, and there is no static
  type checking.
- **Stepper:** Next step, Previous, Play/Pause, Run to end, Reset and Restart, plus
  History entries you can jump to.
- **Current expression**, rewritten in place:
  - Amber marks the redex the next step will rewrite.
  - Blue marks what the previous step produced.
  - A dashed line marks the list element being updated.
  - Red marks where reduction got stuck.
  - Highlights are resolved from AST node ids, never by text search.
- **Reduction spotlight:** the rule applied, the redex → replacement pair and a
  one-line explanation built from facts the reducer recorded for that step.
- **Visualise → Lists:**
  - `map`: each element's input and current expression, marked pending, processing, done
    or failed.
  - `fold`: consumed, active and pending elements, the live accumulator and the
    accumulator values so far.
- **Visualise → Syntax tree:** the current AST as a connected tree with the next redex
  and the last result marked.
- **Inspector:** the rule, a plain-language explanation and, at the end, the final value
  or error.
- **Errors:** syntax, name, type and runtime errors with source locations. A live syntax
  error appears under the editor without discarding the current run.
- **Ten built-in examples**, each with a one-line explanation.
- **Keyboard shortcuts:** `→` next, `←` previous, `Home` reset, `End` run to end,
  `⌘/Ctrl + ↵` load the code in the editor. Arrow and Home/End keys are ignored while
  the editor has focus.

## How evaluation works

```
source ─▶ lexer ─▶ parser ─▶ AST ─┬─▶ evaluator (big-step, reference semantics)
                                  └─▶ reducer (small-step) ─▶ ExecutionController ─▶ React UI
```

1. **Parsing** (`parse: string → Expr`) is pure and fails only with `SyntaxError`. The
   AST is immutable, with a unique id and a source span on every node.
2. **One reduction.** `SmallStepReducer.step` finds the next redex in strict
   left-to-right order (`findRedex`) and performs one rewrite (`contract`): β-reduction,
   `let`, arithmetic, `map` expansion, `fold` step and so on. The result records the rule,
   the redex path and the old and new node ids.
3. **History.** `ExecutionController` stores each state as a snapshot. `next()`
   computes a new step only when the cursor passes the end of the recorded history.
   `previous()`, `reset()` and `goTo()` move the cursor to an existing snapshot, so
   nothing is recomputed or reversed.
4. **Rendering.** The UI prints a snapshot's AST back to source, and highlights ranges
   from node ids.

How the two list built-ins work:

- **`map f [x₁ … xₙ]`** is first rewritten to `[f x₁, …, f xₙ]`. Each application then
  reduces left to right. The step's `listFocus` names the element being changed.
- **`fold f z [x, …]`** is rewritten to `fold f (f z x) […]`: the accumulator is the
  first argument of `f`. Steps inside the accumulator expression follow, until `fold f z []`
  becomes `z`. The step's `foldFocus` records the phase and the accumulator before and
  after. The controller adds the active index and the original list, which the AST
  alone no longer holds.

The big-step evaluator and the small-step reducer are independent implementations of
the same semantics. Tests assert that they agree. Details are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Technical decisions and trade-offs

| Decision | What the code does | Trade-off |
|---|---|---|
| Engine separate from UI | `src/lang/` has no React imports. `src/app/` imports it only through `src/lang/index.ts`. | The reducer is testable without a DOM. The UI has to derive its view models from recorded step metadata. |
| Substitution-based reduction | The reducer rewrites the AST, so every intermediate state is printable source. The evaluator is environment-based. | Two engines to keep consistent, and each step costs time linear in expression size. Substitution copies values instead of sharing them. |
| Capture-avoiding substitution | A binder that would capture a free variable is alpha-renamed (for example `\map` becomes `\map'`). | Renamed binders show up in the displayed expressions. |
| Node ids, spans and persistent updates | Nodes are plain objects. `replaceAt` copies only the path spine and shares the rest. | Keeping every step of a trace is cheap. Ids are never reissued within a reducer, so they are stable keys for highlighting. |
| Snapshot history | Navigation restores recorded snapshots. | History memory grows with the number of steps, so steps and size are capped. |
| Resource limits | Parser nesting, tree depth, step count, node count and evaluator depth are all bounded (see [Limitations](#limitations-and-scope)). | Some valid but very large programs end with an error. |
| Strict, non-recursive language | Call-by-value, left to right, and `let` is not recursive. | There is no recursion. Loops use `map` and `fold`. |

## Important engineering considerations

The repository records the following concerns through code and tests. It does not
record the debugging history behind them. The one exception is commit `02a3370`
("harden parser, reducer and UI against edge cases"), whose accompanying
`tests/robustness.test.ts` describes itself as regression tests for bugs found. The
individual bugs are not documented.

- **Variable capture.**
  - *Problem:* naive substitution can bind a free variable.
  - *Approach:* `reduction/substitution.ts` alpha-renames binders. `tests/semantics.test.ts`
    covers the case.
  - *Consequence:* the displayed expression can differ from the source by a renamed
    binder.
- **Two engines must agree.**
  - *Problem:* the reducer could drift from the intended semantics.
  - *Approach:* the evaluator is the reference. Tests compare it with the reducer on a
    hand-written corpus (`tests/corpus.ts`) and on 800 seeded random programs (400
    untyped and 400 well-typed).
  - *Consequence:* the guarantee covers only the sampled programs.
- **Deep input and runaway reduction.**
  - *Problem:* recursive code over deeply nested input can overflow the JavaScript stack,
    and reductions can grow or run forever.
  - *Approach:* parse and tree depth limits, evaluator depth and controller step and
    node limits, each ending in a `SyntaxError` or `RuntimeError`. Tests cover inputs
    just inside and just outside the limits.
  - *Consequence:* the limits are fixed numbers, not derived from the machine.
- **Visualisation fed by real steps.**
  - *Problem:* after `fold` consumes elements, the original list and the active index are
    not in the current AST.
  - *Approach:* step metadata (`listFocus`, `foldFocus`) plus controller bookkeeping.
    `tests/visualization.test.ts` checks the derived views.
  - *Consequence:* the fold view depends on recorded history.
- **Stale timers.** Play and Run to end are cancelled as soon as any other action
  happens, and the controller is only mutated in event handlers, never during render.
  `tests/app-robustness.test.tsx` has tests for timers and rapid input.

## Testing and verification

```sh
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build
```

The suite has 15 files under `tests/`:

| Area | Files |
|---|---|
| Lexer, parser, printer | `syntax.test.ts` |
| Evaluator and semantics | `evaluator.test.ts`, `semantics.test.ts` |
| Reducer: per-step results, trace invariants, agreement with the evaluator | `reducer.test.ts`, `integration.test.ts` |
| History and navigation, limits | `history.test.ts` |
| Error kinds and messages | `errors.test.ts` |
| Limits, deep input, number display, randomized differential tests | `robustness.test.ts` |
| View models: map/fold, tree, spotlight | `visualization.test.ts`, `tree.test.tsx`, `spotlight.test.tsx` |
| UI rendered in jsdom | `app.test.tsx`, `app-robustness.test.tsx` |
| Examples and `docs/DEMO.md` | `examples.test.ts`, `demo.test.ts` |

At the time of writing, a run on Node 24.16.0 / npm 11.13.0 gave: `npm run typecheck`
passed, `npm test` passed (15 files, 580 tests) and `npm run build` succeeded. That
run is a point-in-time result; rerun the commands to confirm.

Coverage is not measured. The UI tests run in jsdom, so layout, responsiveness,
accessibility and cross-browser behaviour are not covered by automated tests.

## Limitations and scope

The language is a small Haskell-flavoured subset, not Haskell. There is no static type
checking (type errors appear when the offending expression runs), no recursion, only
the built-ins `map` and `fold`, no strings or characters, one binding per `let`, and no
operator sections like `(+ 1)`.

| Limit | Value | Result |
|---|---|---|
| Parser nesting | 300 levels | SyntaxError |
| Syntax-tree depth | 1000 levels | SyntaxError |
| Reduction depth | 1000 levels | RuntimeError |
| Steps per run | 5,000 in the UI (10,000 engine default) | RuntimeError |
| Expression size | 20,000 nodes in the UI (50,000 engine default) | RuntimeError |
| Evaluator recursion | 2000 levels | RuntimeError |

- **Numbers** are IEEE doubles. Non-integers display at 12 significant digits (`0.1 + 0.2`
  shows `0.3`), `-0` displays as `0`, and `Infinity` or `NaN` print as text that cannot
  be read back as a literal.
- **Function values** print as `<function \y -> x + y>` from the evaluator and as
  `\y -> 1 + y` after substitution.
- **Performance** has not been benchmarked. Each step is linear in expression size, so
  very large inputs can be slow. Run to end is time-boxed in batches and can be stopped.
- **Display:** states over 2,500 characters drop syntax colouring (highlights stay exact),
  and long lists and histories are windowed.
- **Editor:** a textarea with a highlighted overlay and line numbers, with no
  autocomplete or bracket matching.
- **Layout:** `docs/DEMO.md` assumes a window of at least 1280px (three columns). Below
  that the layout collapses to fewer columns, and a one-column layout is defined for
  narrow screens. Narrow layouts have not been verified by tests.
- **Not verified:** operating systems and browsers other than the ones used in
  development, and Node versions other than 24.16.0.

## Tech stack

| Technology | Role |
|---|---|
| TypeScript | All source, strict mode |
| React 19 | UI |
| Vite 8 with `@vitejs/plugin-react` | Dev server and production build |
| Vitest 5, Testing Library, jsdom | Engine tests (Node) and UI tests (jsdom) |
| tsx | Runs `scripts/eval.ts` |

## Installation and usage

Requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (the `engines` field in
`package.json`, set by jsdom). Nothing needs an account, API key or network access after
`npm install`.

```sh
npm install
npm run dev        # open http://localhost:5173
npm run typecheck  # TypeScript, no emit
npm test           # Vitest
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run eval -- "map (\x -> x * 2) [1, 2, 3]"                # evaluate from the command line
npm run eval -- --steps "fold (\acc x -> acc + x) 0 [1, 2]"  # print every reduction step
```

To use the app:

1. Pick one of the examples, or type a program in the editor.
2. Press `⌘/Ctrl + ↵` in the editor, or **Restart**, to load edited code.
3. Press **Next step** (or `→`) to perform one reduction. **Previous** (`←`) restores the
   earlier state. **Run to end** finishes the program, and any History entry jumps to
   that state.

Editing the code does not disturb the current run. The stepper keeps showing the last
loaded program until you press Restart, or Run to end, which loads the edited code first.
Run to end is disabled while the edited code has a syntax error.

Some programs to try, with their results:

```haskell
(\x -> x * 2) 5                                    -- 10, in 2 steps
let x = 10 in x + 2                                -- 12
map (\x -> x * 2) [1, 2, 3]                        -- [2, 4, 6]
fold (\acc -> \x -> acc + x) 0 [1, 2, 3]           -- 6; accumulator 0 → 1 → 3 → 6
let k = 3 in let scale = \x -> x * k in map scale [1, 2, 3]  -- [3, 6, 9]: a closure
(\f -> \map -> f [1, 2]) (map (\n -> n * 3)) 0     -- [3, 6]: watch \map become \map'
map (\x -> 10 / x) [5, 2, 0]                       -- RuntimeError: Division by zero
```

The engine can also be used without the UI:

```ts
import { ExecutionController, printExpr } from './src/lang';

const run = ExecutionController.fromSource('fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]');
run.next();                              // one semantic step
run.current.source;                      // 'fold (\\acc -> \\x -> acc + x) ((\\acc -> \\x -> acc + x) 0 1) [2, 3]'
run.current.step?.foldFocus?.phase;      // 'consume'
run.previous();                          // restores the earlier snapshot
printExpr(run.runToCompletion().expr);   // '6'
```

## Repository structure

```
src/lang/        Language engine, with no UI dependencies
  lexer.ts, parser.ts, ast.ts, paths.ts, printer.ts
  evaluator.ts, environment.ts, values.ts, builtins.ts, errors.ts
  reduction/     reducer, substitution, history (ExecutionController), trace, types
src/app/         React UI
  useExecution.ts, examples.ts, styles.css
  model/         highlight, visualization, tree and spotlight view models
  components/    Editor, Controls, Stage, Spotlight, ListViews, Inspector,
                 HistoryPanel, SyntaxTree, CodeView
tests/           Vitest suites (engine, view-model and UI)
scripts/eval.ts  Command-line evaluator behind `npm run eval`
docs/            LANGUAGE.md, ARCHITECTURE.md, DEMO.md
```

## License

The repository contains no license file, so no license is granted by it.
Third-party packages are listed in `package.json` and `package-lock.json` and keep their
own licenses.
