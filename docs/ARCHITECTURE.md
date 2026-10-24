# Architecture

```
            ┌──────────┐   Token[]   ┌──────────┐    Expr     ┌────────────┐   Value
 source ──▶ │  lexer   │ ──────────▶ │  parser  │ ──────────▶ │ evaluator  │ ───────▶
            └──────────┘             └──────────┘      │      └────────────┘
                                                       │      ┌────────────┐   ReductionTrace
                                                       └────▶ │  reducer   │ ───────▶  (steps + outcome)
                                                              └────────────┘
```

`src/lang/` has no UI dependencies. `src/app/` (React) imports only from
`src/lang/index.ts`.

| Module | Responsibility |
|--------|----------------|
| `errors.ts` | `LangError` (kind, message, span), code-frame formatting, JSON form |
| `lexer.ts` | Source to tokens with spans; keywords, symbols, comments |
| `ast.ts` | Immutable, JSON-serialisable node types; `IdGenerator`; `children`, `freeVariables` |
| `parser.ts` | Recursive-descent parser implementing the grammar in `LANGUAGE.md`; desugaring |
| `printer.ts` | AST back to source with minimal parentheses (round-trips through the parser); `printWithRanges` maps node ids to text ranges for highlighting |
| `paths.ts` | `Path` addressing; `nodeAt`, `pathTo`, persistent `replaceAt` |
| `environment.ts` | Immutable linked-frame lexical environments |
| `values.ts` | Runtime values (number, boolean, list, closure, builtin) and formatting |
| `builtins.ts` | `map`, `fold`; curried built-in protocol; global environment |
| `evaluator.ts` | Big-step reference semantics; depth guard; shared `arithmetic`/`valuesEqual` |
| `reduction/types.ts` | Step, step-result and trace data shapes |
| `reduction/substitution.ts` | Capture-avoiding substitution; fresh-id cloning |
| `reduction/reducer.ts` | `SmallStepReducer`: `findRedex` (evaluation order) + `contract` (one rule); `isValue` |
| `reduction/history.ts` | `ExecutionController`: lazy, bounded, navigable history of AST snapshots; adds map-origin and fold-index metadata |
| `reduction/trace.ts` | `traceReduction` one-shot trace (wraps the controller); `stateAt`, `states` |
| `index.ts` | Public API: `parse`, `evaluate`, `run`, `interpret`, re-exports |

## The three boundaries

1. **Parsing** (`parse: string -> Expr`). This step is pure and fails only with
   `SyntaxError`. It knows nothing about values or scope.
2. **Evaluation** (`evaluate: Expr -> Value`). This is big-step and environment-based,
   and it is fast. It is the *reference semantics*: it defines what a program means.
   Closures pair a lambda body with its captured `Environment`.
3. **Reduction** (`Reducer.step: Expr -> StepResult`). This is small-step and
   substitution-based. It operates on the **AST**, not on runtime values, so that
   every intermediate state is real, printable, highlightable code. One call
   performs one semantic rewrite (beta, let, arithmetic, map, fold-step, …)
   at a path, using `replaceAt`, and reports the rule, the path, the old and new
   node ids, and, for list operations, which element index is changing.

Invariant, tested over the shared corpus in `tests/corpus.ts`: reducing any program
to a value gives the same result as `evaluate` (an equal value, or the same error kind).
The tests also check on every step that the redex sits at `path` before the step
and the replacement sits there after it, that states re-parse, and that node ids are unique.

### Step metadata

Every `ReductionStep` carries `before`/`after` snapshots, the redex `path`,
`redexId`/`replacementId`, the `rule`, a `description`, and `completes` (true when `after` is a value).
Two optional fields support the visualisation:

- **`listFocus`**: the innermost list element that contains the redex. It has `index`, `listPath`/`listId`,
  and `elementBefore`/`elementAfter`. If `map` produced the list, the history also adds
  `origin: { fn, input }`, the mapped function and the original input element.
- **`foldFocus`**: the innermost `fold` whose step this is. It has a `phase`:
  - `consume`: `fold f z [x, …]` becomes `fold f (f z x) […]`
  - `accumulate`: a step inside the accumulator expression
  - `finish`: `fold f z []` becomes `z`

  It also has `foldPath`, `accumulatorPath`, `listPath`, `accumulatorBefore`/`accumulatorAfter`,
  and `element` (when consuming). The history adds `index`, the active element's position in
  the original list, and `original`, the list before folding started.

The reducer computes everything it can from `before` and `after` alone, so a single
`step` call is self-contained. Only the history knows where a list *came from*. It tracks
this in an id-keyed registry, which is safe because ids are never reissued.

### Execution controller

`ExecutionController` (`history.ts`) has no React dependency. It is the API the UI drives:

| Member | Behaviour |
|--------|-----------|
| `new ExecutionController(expr, { maxSteps, maxNodes })` / `fromSource(src)` | Initial state only. Nothing is computed yet. |
| `next()` | Advance one step. A step is computed the first time the cursor passes the end of the known history. |
| `previous()`, `reset()`, `goTo(i)` | Move the cursor to an existing snapshot. Nothing is recomputed or reversed. |
| `runToCompletion()` | Discover the rest of the trace (bounded by the limits) and move to the end. |
| `peek()` | The step out of the current state, without moving. |
| `index`, `knownSteps`, `history`, `current` | Cursor and recorded snapshots (`{ index, expr, source, step }`). |
| `status`, `finished`, `outcome` | `running` / `done` / `error`. `outcome` holds the final value or a `LangError`. |
| `snapshot()` | Plain object of all the above for UI state. |

Limits: taking step `maxSteps + 1` (default 10,000) ends the trace with a RuntimeError,
and so does growing past `maxNodes` (default 50,000). A program that needs exactly
`maxSteps` steps still completes.

### Node identity across steps

- The nodes that make up a redex disappear. Its replacement either reuses an existing
  subtree (the lambda body after beta, the chosen `if` branch, the list after `fold-step`)
  or is a new node with a fresh id (computed numbers and booleans, new applications).
- The first substituted copy of an argument keeps its ids. Later copies get fresh ids.
- A `SmallStepReducer` instance never reissues an id, so the UI can safely use ids as
  React keys or animation identities across a whole trace.

## Decisions

- **Plain-object AST with ids and spans.** Nodes can be serialised (history,
  workers, snapshots) and diffed. Ids let the UI animate "the same node"
  across steps. Spans map back to the editor.
- **Single-parameter lambdas.** Multi-parameter syntax is desugared, so beta
  reduction has exactly one shape.
- **Parentheses produce no node.** The printer re-inserts the parentheses that
  are needed, so rewritten expressions stay valid source.
- **Persistent updates.** `replaceAt` copies only the spine of the path and shares
  the rest, so keeping every step of a long trace is cheap.
- **Curried built-ins.** A built-in is a value `{name, arity, args}` that
  collects arguments until saturated. This keeps `map f` first-class and gives
  the reducer an obvious redex shape (`map f xs` with both arguments values).
- **Strict, left-to-right.** The order is simple to explain and to visualise, and the big-step
  and small-step engines can follow the same order.
- **Non-recursive `let`.** The semantics stay simple for substitution. Recursion
  (e.g. `letrec`) can be added later without changing existing programs.

## Frontend (`src/app/`)

- **`useExecution`** owns one `ExecutionController` per loaded program. It changes the
  controller only in event handlers and timers, then publishes an immutable
  `ExecutionView` (`snapshot()` plus a copy of `history`). It never touches the
  controller during render, so React Strict Mode double-rendering can't cause extra steps.
  - *Run to end* advances in batches of about 12 ms, with `setTimeout(0)` between them.
  - *Play* steps every 650 ms.
  - A cancellation token stops either one as soon as any other action happens.
  - Parse errors are caught before a controller is created.
- **`model/highlight.ts`** gets syntax colours from the real lexer and highlight
  marks from `printWithRanges`, keyed by node id.
- **`model/visualization.ts`** builds the map and fold view models:
  - Map: the element statuses come from `isValue` on the elements in the current AST,
    the active element from the next step's path, and the inputs from the recorded
    `map` step.
  - Fold: progress comes from the remaining list in the current AST, the active index
    from `foldFocus`, and the accumulator timeline from the recorded steps.

  No state advances on a timer.
- **Components:** `Editor` (a textarea over a highlighted `<pre>`), `Controls`, `Stage`
  (current expression plus latest rewrite), `ListViews` (map/fold), `Inspector`,
  `HistoryPanel` (windowed, click to jump), and `SyntaxTree`.
