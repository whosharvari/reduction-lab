# Reduction Lab demo script (about 4 minutes)

Every program and expected output below is checked by `tests/demo.test.ts` against the
real interpreter, so this script can't drift from what the app does.

**Setup:** `npm install && npm run dev`, then open http://localhost:5173 in a desktop
browser window at least 1280px wide (three-column layout).

**Stepping:** use the **Next step** button or `→`.
- Arrow keys are ignored while the editor has focus, so click anywhere outside the editor first.
- `←` steps back, `Home` resets to step 0, and `End` runs to the end.

**Highlights:** amber marks what reduces next, blue what the last step produced, a
dashed line above the list element being updated, and red where reduction got stuck.

---

### 0. Opening (≈15 s)

**Show:** the page as it first loads. The *Map* example is preloaded, and the intro banner
explains that each Next step performs one real reduction.

**Say:** "Everything on screen comes from the interpreter's small-step reducer. Nothing
is pre-recorded. Each click rewrites the expression by exactly one semantic rule."

### 1. Evaluation order: nested arithmetic (≈30 s)

**Do:** click the **Nested arithmetic** example, then press `→` four times.

```haskell
(2 + 3) * (10 - 4) / 2
```

| Step | Expression | Rule |
|---|---|---|
| 0 | `(2 + 3) * (10 - 4) / 2` | start |
| 1 | `5 * (10 - 4) / 2` | arithmetic |
| 2 | `5 * 6 / 2` | arithmetic |
| 3 | `30 / 2` | arithmetic |
| 4 | `15` | arithmetic (Complete) |

**Concept:** strict, left-to-right evaluation. An operator fires only when both
operands are values. The Inspector names each rule and explains it.

### 2. Functions and substitution (≈45 s)

**Do:** click the **Nested application** example and step through all 7 steps.

```haskell
let twice = \f -> \x -> f (f x) in
twice (\n -> n + 3) 10
```

| Step | Expression | Rule |
|---|---|---|
| 1 | `(\f -> \x -> f (f x)) (\n -> n + 3) 10` | let substitution |
| 2 | `(\x -> (\n -> n + 3) ((\n -> n + 3) x)) 10` | β-reduction (f := the lambda) |
| 3 | `(\n -> n + 3) ((\n -> n + 3) 10)` | β-reduction (x := 10) |
| 4 | `(\n -> n + 3) (10 + 3)` | β-reduction |
| 5 | `(\n -> n + 3) 13` | arithmetic: the argument is evaluated *before* the call |
| 6 | `13 + 3` | β-reduction |
| 7 | `16` | arithmetic |

**Concept:** `let` substitution, β-reduction, higher-order functions, and call-by-value
(step 5 reduces the argument first).

**Optional, capture avoidance (≈20 s):** type this into the editor, press `⌘/Ctrl+↵`,
then press `→` once.

```haskell
(\f -> \map -> f [1, 2]) (map (\n -> n * 3)) 0
```

Step 1 is `(\map' -> map (\n -> n * 3) [1, 2]) 0`. The inner binder is renamed to
`map'` so that the substituted `map` still refers to the built-in. The final value is `[3, 6]`.

### 3. `map`: transforming list elements (≈40 s)

**Do:** click the **Map** example. Press `→` once, then point at **Visualise → Lists**.
Keep stepping to the end.

```haskell
map (\x -> x * 2) [1, 2, 3]
```

- **Step 1** (map expansion): `[(\x -> x * 2) 1, (\x -> x * 2) 2, (\x -> x * 2) 3]`.
  The list cells show each original input. Element 0 is *processing*, and the others are *pending*.
- **Steps 2–7:** each element gets a β-reduction and then an arithmetic step, left to
  right. The active element moves 0 → 0 → 1 → 1 → 2 → 2, and finished elements turn *done*.
- **Step 7:** `[2, 4, 6]` (Complete).

**Concept:** `map f [x₁…xₙ]` rewrites in place to `[f x₁ … f xₙ]`, then each application
reduces. Point out the dashed line above the list element being updated in the main expression.

### 4. `fold`: watching the accumulator (≈40 s)

**Do:** click the **Fold** example. Press `→` five times, pause, then press `End`.

```haskell
fold (\acc -> \x -> acc + x) 0 [1, 2, 3]
```

- **Step 1** (fold step): `fold (\acc -> \x -> acc + x) ((\acc -> \x -> acc + x) 0 1) [2, 3]`.
  Element 1 enters the accumulator.
- **Step 5:** element 0 is *consumed*, element 1 (value `2`) is *active*, and element 2 is
  *pending*. The accumulator panel shows the expression being computed, and the
  accumulator history reads `0 → 1`.
- **`End`:** Complete after 13 steps. The final value is `6`, and the accumulator history
  reads `0 → 1 → 3 → 6`.

**Concept:** a left fold. `fold f acc [x, …]` becomes `fold f (f acc x) […]`, so each
element is folded into the running accumulator, accumulator first.

### 5. Composition: map, then fold (≈30 s)

**Do:** click the **Map, then fold** example and press `End`. Then click History entry
**7**, followed by entry **8**.

```haskell
fold (\acc -> \x -> acc + x) 0
  (map (\x -> x * x) [1, 2, 3])
```

- **Entry 7:** `fold (\acc -> \x -> acc + x) 0 [1, 4, 9]`. The inner `map` has finished:
  the map view shows every element *done*, and the fold view appears with element 0 about to be consumed.
- **Entry 8:** the first fold step. The map view disappears; only the fold view remains.
- **Final:** `14` after 20 steps.

**Concept:** call-by-value. The argument list is fully evaluated before `fold` consumes it.

### 6. Navigation and history (≈20 s)

**Do:** on the same program, press `←` a few times, click any History entry, then press `Home`.

**Expect:** Previous restores the earlier recorded snapshot, and the expression, Inspector
and visualisation all change together. Clicking History jumps to that state. `Home` returns
to step 0 and keeps the history.

**Concept:** every state is a real AST snapshot. Going back restores it; nothing is
"un-substituted".

### 7. Errors are handled gracefully (≈40 s)

**Runtime error.** Click the **Runtime error** example and press `End`.

```haskell
map (\x -> 10 / x) [5, 2, 0]
```

- Reduction stops at step 6 on `[2, 5, 10 / 0]`, with the status **Stopped: error**.
- The banner reads **RuntimeError** Division by zero, the stuck `10 / 0` is marked red,
  and list element 2 shows *failed*.
- **Previous** still works: step back to show how it got there.

**Syntax error.** Click into the editor and change the code to:

```haskell
map (\x -> x * ) [1, 2]
```

- A live error appears under the editor without stopping the current run:
  `SyntaxError at 1:16: Expected an expression, but found ')'`. Line 1's number turns red,
  and the offending `)` is marked.
- **Run to end** is disabled while the edited code doesn't parse, so the current run is kept.

Optionally, show the error hint for a common mistake: `map \x -> x * 2 [1, 2, 3]` reports
"To pass a lambda as an argument, wrap it in parentheses".

**Close:** click **Reset to example** to restore the editor.

---

## If something goes wrong live

- **Keys don't respond:** the editor has focus. Click on the expression area, or use the buttons.
- **Want a clean slate:** click any example. It loads a fresh history and stops any playback.
- **A run takes a while:** **Run to end** becomes **Stop** while it runs.
