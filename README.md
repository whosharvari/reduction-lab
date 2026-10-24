# Reduction Lab

> Every expression has a story. Watch it unfold.

Reduction Lab is a browser playground for a small Haskell-like functional language,
built for the Syntax Error 2026 Functional Programming Track. You write an expression,
then step through its evaluation **one real reduction at a time**. You can watch
lambdas get applied, `let` bindings get substituted, `map` expand into per-element
work, and `fold` thread its accumulator through a list. Each change is rewritten in
place and highlighted.

Every state on screen comes from the interpreter's small-step reducer. Nothing is
pre-recorded or animated by the frontend.

**Status: Phase 3 of 5.** These parts are built and tested: the interpreter, the
small-step reducer, the execution-history controller, and the interactive visual frontend.

## Quick start

Requires Node.js 20+ (developed on Node 24). Everything runs locally, with no accounts, API keys or network access.

```sh
npm install
npm run dev        # open http://localhost:5173
npm test           # Vitest: engine tests (Node) + UI tests (jsdom)
npm run typecheck  # TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run eval -- "map (\x -> x * 2) [1, 2, 3]"            # evaluate from the command line
npm run eval -- --steps "fold (\acc x -> acc + x) 0 [1, 2]"  # print every reduction step
```

## Using the stepper

| Control | Shortcut | What it does |
|---------|----------|--------------|
| **Next step** | `→` | Performs exactly one reduction with the real reducer |
| **Previous** | `←` | Restores the previous recorded snapshot (nothing is "undone") |
| **Play / Pause** | | Steps automatically at a readable pace |
| **Run to end** | `End` | Reduces to a value or an error, in time-boxed batches so the UI stays responsive |
| **Reset** | `Home` | Returns to the initial expression and keeps the recorded history |
| **Restart** | `⌘/Ctrl + ↵` in the editor | Discards the history and starts again from the editor's code |
| **History** entry | | Jumps to any recorded state |

Arrow-key shortcuts are ignored while you type in the editor. Editing the code doesn't
disturb the current run. The stepper keeps showing the last loaded program until you
press Restart (or Run to end, which loads the edited code first).

### What you see

- **Current expression.** The real intermediate expression, syntax-coloured.
  - Amber: the redex the next step will rewrite.
  - Green: what the previous step produced.
  - Dashed outline: the list element being updated.
  - Red: where reduction got stuck.

  All highlighting is resolved from AST node ids, never from text search, so
  identical sub-expressions are never confused.
- **Latest rewrite.** The expression before the last step, with its redex marked,
  and the redex → replacement pair.
- **Visualise → Lists.**
  - *map*: each element's original input and current expression, marked
    pending, processing, done or failed.
  - *fold*: the original list, with consumed, active and pending elements in
    left-fold order. Also the live accumulator, the change the last step made to it,
    and the accumulator values so far.
- **Visualise → Syntax tree.** A compact AST with the redex and replacement marked.
- **Inspector.** The rule (β-reduction, let substitution, arithmetic, map expansion,
  fold step, …) with a plain-language explanation. It also shows the reducer's own
  description, the redex and its replacement, and list/fold metadata. At the end it
  shows the final value or error.

### Built-in examples

Map · Fold · Lambda application · Let binding · Nested arithmetic · Conditional ·
Nested (higher-order) application · Map-then-fold pipeline · Closures · Runtime error.
Each one comes with a short explanation of its concept. A test checks that each
produces its expected result in both engines.

## The language

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

Evaluation is strict (call-by-value) and left to right. `fold f initial list` is a left
fold whose step function takes the accumulator first. See [`docs/LANGUAGE.md`](docs/LANGUAGE.md)
for the grammar, precedence, scoping, the small-step rules, and error kinds.

## Architecture

```
src/lang/                 UI-independent language engine (no React imports)
  lexer.ts, parser.ts     source → tokens → AST (node ids + source spans)
  ast.ts, paths.ts        immutable AST, addressing, persistent replaceAt
  printer.ts              AST → source, plus node-id → text ranges for highlighting
  evaluator.ts            big-step reference semantics
  reduction/
    reducer.ts            one semantic rewrite per step (findRedex + contract)
    substitution.ts       capture-avoiding substitution with alpha-renaming
    history.ts            ExecutionController: next / previous / reset / goTo / runToCompletion
    trace.ts, types.ts    one-shot traces; step metadata types
src/app/                  React UI
  useExecution.ts         binds ExecutionController to React (immutable snapshots, batched runs, cancellation)
  model/highlight.ts      lexer-based syntax colours + node-id highlight segments
  model/visualization.ts  map/fold view models derived from the AST, history and step metadata
  components/             Editor, Controls, Stage, ListViews, Inspector, HistoryPanel, SyntaxTree
  examples.ts             example programs with explanations and expected results
tests/                    engine, reducer, history, view-model and UI tests
docs/                     LANGUAGE.md, ARCHITECTURE.md
```

The UI never computes a reduction itself. `useExecution` mutates the controller only
inside event handlers and timers. It then publishes an immutable snapshot (the current
state, the next step, the outcome, and a copy of the history) for React to render. The
map and fold views are pure functions of that snapshot. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```ts
import { ExecutionController } from './src/lang';

const run = ExecutionController.fromSource('fold (\\acc -> \\x -> acc + x) 0 [1, 2, 3]', { maxSteps: 1000 });
run.next();                  // one semantic step
run.current.source;          // 'fold (\\acc -> \\x -> acc + x) ((\\acc -> \\x -> acc + x) 0 1) [2, 3]'
run.current.step?.foldFocus; // { phase: 'consume', index: 0, element: 1, accumulatorBefore: 0, … }
run.previous();              // restores the earlier snapshot
run.runToCompletion();       // { status: 'done', expr: 6 }, bounded by maxSteps
```

## Known limitations

- **Limits.**
  - The parser rejects nesting deeper than 300 levels, and syntax trees deeper than
    1000 levels, with a SyntaxError.
  - A reduction stops with a RuntimeError past 1000 levels of depth. It also stops past
    5,000 steps or 20,000 nodes in the UI (10,000 and 50,000 in the engine).
  - **Run to end** becomes **Stop** while it runs.
- **Large expressions.** States longer than 2,500 characters drop syntax colouring, but
  their redex and element highlights stay exact. Inspector and rewrite previews are
  clipped. Each step costs time linear in the expression's size, so a pathological
  program (for example, folding a 1,200-element list into a 1000-level nested list)
  takes tens of seconds. The UI stays responsive while it runs.
- **History windowing.** The History panel shows 150 states either side of the current
  one in long traces. The controller still holds all of them.
- **The editor is simple.** It's a textarea with a highlighted overlay and line numbers.
  There's no autocomplete, bracket matching, or undo beyond the browser's own.
- **Phone layout.** On phones the layout stacks into a single column (examples, editor,
  controls, expression, visualisations, inspector, history), so the stepper sits below
  the editor.
- **Substitution copies values.** The reducer copies substituted values instead of
  sharing them, so programs that duplicate large values grow quickly.
- **Fold consumes its list** (`fold f acc [rest]`). The original list and the active
  index come from the history metadata, not from the expression.
- **Function values print differently** in the two engines (`<function \y -> x + y>`
  from the evaluator, `\y -> 1 + y` after substitution).
- **Language limits:**
  - `let` is non-recursive and there is no `letrec`, so loops are written with
    `map`/`fold`.
  - There's no static type checking.
  - Only `map` and `fold` are built in.
  - One binding per `let`.
  - No operator sections.
  - Numbers are JS doubles with no exponent syntax.
