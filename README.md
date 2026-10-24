# Reduction Lab

> Every expression has a story. Watch it unfold.

Reduction Lab is a browser playground for a small Haskell-like functional language, built
for the Syntax Error 2026 Functional Programming Track. You write an expression, then step
through its evaluation **one real reduction at a time**. You can watch lambdas get applied,
`let` bindings get substituted, `map` expand into per-element work, and `fold` thread its
accumulator through a list. Each change is rewritten in place and highlighted.

Every state on screen comes from the interpreter's small-step reducer. Nothing is
pre-recorded, and the frontend never fakes a step.

## Why step-by-step reduction?

Functional programs are evaluated by **rewriting expressions**: a function call is replaced
by its body with the argument substituted in, an operator by its result, and so on. A REPL
only shows the final answer, which hides the process people most need to understand:

- **Evaluation order.** Here it's strict and left to right: the argument is computed before the call.
- **Substitution.** This includes how variable capture is avoided.
- **Higher-order functions.** How `map` and `fold` actually walk a list.

Seeing each rewrite, with the exact sub-expression that changed, turns these abstract rules
into something you can watch.

## Problem-statement requirements

| Requirement | Where it lives |
|---|---|
| Numbers and lists | Number and list literals, arithmetic and comparisons (`src/lang/parser.ts`, `evaluator.ts`) |
| `let` expressions | `let x = e in body`, plus `let f x = …` sugar. The `let` rule substitutes the bound value |
| Functions | Lambdas (`\x -> …`, curried), application, closures with lexical scope |
| `map` and `fold` | Built-ins. `fold f initial list` is a left fold, accumulator first |
| One-step-at-a-time reduction | `SmallStepReducer.step` performs exactly one rewrite. **Next step** calls it once |
| In-place expression rewriting | Each step replaces one sub-tree of the AST. The UI shows the new expression with the rewritten region marked |
| Highlight the list element being updated | `listFocus` metadata, shown as a dashed outline in the expression and an *active* cell in the map/fold views |

## Quick start

Requires **Node.js 22.22+ or 24.15+**; it was developed on Node 24.16. (`npm run dev`/`build`
alone work on Node 20.19+, but the test suite needs the newer versions because of jsdom.)
Everything runs locally, with no accounts, API keys or network access after `npm install`.

```sh
npm install
npm run dev        # open http://localhost:5173
npm test           # Vitest: engine tests (Node) + UI tests (jsdom)
npm run typecheck  # TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run eval -- "map (\x -> x * 2) [1, 2, 3]"                # evaluate from the command line
npm run eval -- --steps "fold (\acc x -> acc + x) 0 [1, 2]"  # print every reduction step
```

A guided 4-minute walkthrough is in [`docs/DEMO.md`](docs/DEMO.md).

## Try it

Paste any of these into the editor, then press `⌘/Ctrl + ↵` and step with `→`:

```haskell
(\x -> x * 2) 5                                    -- 10, in 2 steps
let x = 10 in x + 2                                -- 12
map (\x -> x * 2) [1, 2, 3]                        -- [2, 4, 6]
fold (\acc -> \x -> acc + x) 0 [1, 2, 3]           -- 6; accumulator 0 → 1 → 3 → 6
fold (\acc x -> acc + x) 0 (map (\x -> x * x) [1, 2, 3])   -- 14: map first, then fold
let k = 3 in let scale = \x -> x * k in map scale [1, 2, 3]  -- [3, 6, 9]: a closure
(\f -> \map -> f [1, 2]) (map (\n -> n * 3)) 0     -- [3, 6]: watch \map become \map'
map (\x -> 10 / x) [5, 2, 0]                       -- RuntimeError: Division by zero
```

## Using the stepper

| Control | Shortcut | What it does |
|---------|----------|--------------|
| **Next step** | `→` | Performs exactly one reduction with the real reducer |
| **Previous** | `←` | Restores the previous recorded snapshot (nothing is "undone") |
| **Play / Pause** | | Steps automatically, about 1.5 steps a second |
| **Run to end / Stop** | `End` | Reduces to a value or an error in time-boxed batches; becomes **Stop** while running |
| **Reset** | `Home` | Returns to the initial expression and keeps the recorded history |
| **Restart** | `⌘/Ctrl + ↵` in the editor | Discards the history and starts again from the editor's code |
| **History** entry | | Jumps to any recorded state |
| **Examples** | | Load a built-in program into a fresh history |

Arrow and Home/End shortcuts are ignored while you type in the editor.

Editing the code doesn't disturb the current run. The stepper keeps showing the last loaded
program until you press Restart, or Run to end, which loads the edited code first. Run to
end is disabled while the edited code has a syntax error, so a valid history is never thrown away.

### What you see

- **Current expression.** The real intermediate expression, syntax-coloured.
  - Amber: the redex the next step will rewrite.
  - Green: what the previous step produced.
  - Dashed outline: the list element being updated.
  - Red: where reduction got stuck.

  Highlighting is resolved from AST node ids, never from text search, so identical
  sub-expressions are never confused.
- **Latest rewrite.** The expression before the last step, with its redex marked, and the
  redex → replacement pair.
- **Visualise → Lists.**
  - *map*: each element's original input and current expression, marked pending,
    processing, done or failed.
  - *fold*: the original list (consumed, active and pending elements) in left-fold
    order. Also the live accumulator, the change the last step made to it, and the
    accumulator values so far.
- **Visualise → Syntax tree.** A compact AST with the redex and replacement marked.
- **Inspector.** The rule (β-reduction, let substitution, arithmetic, map expansion, fold
  step, …) with a plain-language explanation. It also shows the reducer's own description,
  the redex and its replacement, and list/fold metadata. At the end it shows the final value or error.

**Built-in examples:** Map · Fold · Lambda application · Let binding · Nested arithmetic ·
Conditional · Nested (higher-order) application · Map-then-fold pipeline · Closures ·
Runtime error. Each one has a short explanation of its concept. A test checks that each
produces its expected result in both engines and in the UI.

## The language

```haskell
42  3.5  -7                               -- numbers (IEEE doubles)
True && 1 < 2                             -- booleans, comparisons (== /= < <= > >=), && ||
[1, 2 + 3, 4]                             -- lists (possibly nested or empty)
\x -> x * 2                               -- lambda;  \acc x -> e  is sugar for  \acc -> \x -> e
(\x -> x * 2) 5                           -- application (left-associative, binds tightest)
let x = 10 in x + 2                       -- let;  let double x = x * 2 in …  defines a function
if x > 0 then x else -x                   -- conditional (else is required)
map f list                                -- built-in
fold f initial list                       -- built-in left fold: f acc x
-- comment to end of line
```

- **Evaluation:** strict (call-by-value) and left to right; `&&`, `||` and `if` short-circuit.
- **Scoping:** lexical; functions capture where they're defined. `let` is non-recursive.
- **Values:** `map f` and `fold f z` are partial applications, and therefore values.

The grammar, precedence table, small-step rules, number display and error kinds are in
[`docs/LANGUAGE.md`](docs/LANGUAGE.md).

## Architecture

```
src/lang/                 UI-independent language engine (no React imports)
  lexer.ts, parser.ts     source → tokens → AST (node ids + source spans), with nesting limits
  ast.ts, paths.ts        immutable AST, addressing, persistent replaceAt, cached tree metrics
  printer.ts              AST → source, plus node-id → text ranges for highlighting
  evaluator.ts            big-step reference semantics (environments and closures)
  reduction/
    reducer.ts            one semantic rewrite per step (findRedex + contract)
    substitution.ts       capture-avoiding substitution with alpha-renaming
    history.ts            ExecutionController: next / previous / reset / goTo / runToCompletion, limits
    trace.ts, types.ts    one-shot traces; step metadata types
src/app/                  React UI (Vite)
  useExecution.ts         binds the controller to React: immutable snapshots, batched Run, cancellation
  model/                  syntax/highlight segments; map/fold view models derived from real history
  components/             Editor, Controls, Stage, ListViews, Inspector, HistoryPanel, SyntaxTree
  examples.ts             built-in programs with explanations and expected results
tests/                    engine, reducer, history, view-model, UI, robustness and demo tests
docs/                     LANGUAGE.md, ARCHITECTURE.md, DEMO.md
```

The parser builds an immutable AST. Two engines run on it:

- **Big-step evaluator:** the reference semantics.
- **Small-step reducer:** rewrites the AST one redex at a time, through capture-avoiding
  substitution. Every intermediate state is valid source.

The `ExecutionController` records each state as a snapshot with step metadata: the rule,
the redex path, and the list and fold focus. The React UI only renders those snapshots and
never computes a reduction itself.

Tests check that the two engines agree on a hand-written corpus and on 800 seeded random
programs.

```ts
import { ExecutionController, printExpr } from './src/lang';

const run = ExecutionController.fromSource('fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]');
run.next();                              // one semantic step
run.current.source;                      // 'fold (\\acc -> \\x -> acc + x) ((\\acc -> \\x -> acc + x) 0 1) [2, 3]'
run.current.step?.foldFocus?.phase;      // 'consume'  (also: index 0, element and accumulator as AST nodes)
run.previous();                          // restores the earlier snapshot
printExpr(run.runToCompletion().expr);   // '6'
```

More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Limits and known limitations

**Safety limits.** Each ends with a clear error, never a crash or a frozen page:

| Limit | Value | Result |
|---|---|---|
| Parser nesting | 300 levels | SyntaxError |
| Syntax-tree depth | 1000 levels | SyntaxError |
| Reduction depth | 1000 levels | RuntimeError |
| Steps per run | 5,000 in the UI (10,000 engine default) | RuntimeError |
| Expression size | 20,000 nodes in the UI (50,000 engine default) | RuntimeError |
| Evaluator recursion | 2000 levels | RuntimeError |

**Limitations:**

- **Language scope:**
  - There's no static type checking: type errors are reported when the offending expression runs.
  - `let` is non-recursive and there's no `letrec`, so loops use `map` and `fold`.
  - The only built-ins are `map` and `fold`.
  - There are no strings or characters.
  - One binding per `let`.
  - No operator sections like `(+ 1)`.
- **Numbers:**
  - Non-integers display at 12 significant digits (`0.1 + 0.2` shows `0.3`).
  - `-0` displays as `0`.
  - Overflowing to `Infinity` (or `NaN`) displays as text that can't be read back as a literal.
- **Performance:**
  - Each step costs time linear in the expression's size, and substitution copies values
    instead of sharing them.
  - Normal programs are instant. An extreme input, such as folding a 1,200-element list
    into a 1000-level nested list, takes tens of seconds, but the page stays responsive
    and can be stopped.
  - States over 2,500 characters drop syntax colouring, though their highlights stay exact.
  - Long lists and histories are windowed in the UI.
- **Fold display.** `fold` consumes its list as it goes (`fold f acc [rest]`). The original
  list and the active index in the fold view come from recorded history.
- **Function values print differently** in the two engines: `<function \y -> x + y>` from
  the evaluator, and `\y -> 1 + y` after substitution.
- **The editor is simple.** It's a textarea with a highlighted overlay and line numbers. There's
  no autocomplete or bracket matching.
- **Phone layout.** On phones the layout stacks into one column, so the stepper sits below
  the editor. The app is best demonstrated on a desktop-width window.
