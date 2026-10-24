# Architecture

```
            ┌──────────┐   Token[]   ┌──────────┐    Expr     ┌────────────┐   Value
 source ──▶ │  lexer   │ ──────────▶ │  parser  │ ──────────▶ │ evaluator  │ ───────▶
            └──────────┘             └──────────┘      │      └────────────┘
                                                       │      ┌────────────┐   ReductionStep[]
                                                       └────▶ │  reducer   │ ───────▶  (Phase 2)
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
| `printer.ts` | AST back to source with minimal parentheses (round-trips through the parser) |
| `paths.ts` | `Path` addressing; `nodeAt`, `pathTo`, persistent `replaceAt` |
| `environment.ts` | Immutable linked-frame lexical environments |
| `values.ts` | Runtime values (number, boolean, list, closure, builtin) and formatting |
| `builtins.ts` | `map`, `fold`; curried built-in protocol; global environment |
| `evaluator.ts` | Big-step reference semantics; depth guard; shared `arithmetic`/`valuesEqual` |
| `reduction/types.ts` | Contract for the Phase 2 small-step engine (types only) |
| `index.ts` | Public API: `parse`, `evaluate`, `run`, `interpret`, re-exports |

## The three boundaries

1. **Parsing** (`parse: string -> Expr`). This step is pure and fails only with
   `SyntaxError`. It knows nothing about values or scope.
2. **Evaluation** (`evaluate: Expr -> Value`). This is big-step and environment-based,
   and it is fast. It is the *reference semantics*: it defines what a program means.
   Closures pair a lambda body with its captured `Environment`.
3. **Reduction** (`Reducer.step: Expr -> StepResult`, Phase 2). This is small-step and
   substitution-based. It operates on the **AST**, not on runtime values, so that
   every intermediate state is real, printable, highlightable code. One call
   performs one semantic rewrite (beta, let, arithmetic, map, fold-step, …)
   at a path, using `replaceAt`, and reports the rule, the path, the old and new
   node ids, and, for list operations, which element index is changing.

Invariant to test in Phase 2: reducing any program to a normal form gives the
same result as `evaluate` (equal value, or the same error kind).

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
