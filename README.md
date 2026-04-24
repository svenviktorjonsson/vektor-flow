# Vektor Flow

A mathematical visualization and computational language.

**Status:** Reference interpreter in Python (language surface matches this document; not fast). Once the semantics stabilize, the backend will be replaced with a fast VM or native compiler.

File extension: `.vkf`.

## Installation

Install into the active Python environment so the **`vkf`** command is on your PATH (same folder as `python`, e.g. Windows **Scripts**, Unix **bin**):

```bash
# Editable (recommended while developing)
pip install -e .[dev]

# One-off global install from a clone (same machine, any directory after this)
pip install .

# Isolated “app” install (installs only vkf + deps into its own env)
pipx install .
```

Then run **`vkf`** from any directory (pass a path to your `.vkf` file).

## Running

```bash
# Run a file (extension optional: `hello` → `hello.vkf` in the same directory)
vkf examples/hello.vkf
vkf examples/hello
vkf examples/branching.vkf

# Lexer diagnostics
vkf tokens examples/hello.vkf

# Inline snippet
vkf -s '"hi" ::'

# Same as `vkf` if the package is installed
python -m vektorflow --version
```

### Standard library (`:.math`)

**`:.math`** **pours** the **`math`** stdlib namespace into the current scope (see *Bindings (`:`)* and *Modules*). Same idea for **`:.capture`**, **`:.collections`**, **`:.io`**, etc. In Python you can resolve the same dict with:

```python
from vektorflow.stdlib import resolve_stdlib
m = resolve_stdlib("math")
m["sin"](0.0)   # 0.0
m["lg"](100.0)  # log10, i.e. 2.0
m["lg2"](8.0)   # log2, i.e. 3.0
m["ln"](2.7)    # natural log
m["log"](8.0, 2.0)  # log base 2 of 8 → 3.0
m["sqrt"](9.0)
m["abs"](-3)         # scalar absolute value
m["abs"]([3.0, 4.0]) # Euclidean norm (1D vector only)
```

Included names: **sin, cos, tan, sinh, cosh, tanh, asin, acos, atan, atan2, asinh, acosh, atanh**, **exp, ln, lg** (log10), **lg2** (log2), **log(x, y)** (log base *y* of *x*), **sqrt**, **abs** (delegates to scalar `abs` / 1D vector norm), plus **pi, e, tau**.

**`:.capture`** exposes **`capture.regex`**, **`capture.groups`** (see *Capturing data from text* under Modules). **`resolve_stdlib("capture")`** in Python returns the same namespace.

**Python tooling:** `vektorflow.use_resolve.resolve_use_path(base_dir, "lib/helpers")` implements optional **`.vkf`** for the same paths as **`.lib.helpers`** on disk (see *Modules*).

### Built-ins (always in scope)

These are bound by the interpreter (no **`:.…`** import needed):

- **`take(n, seq)`** — first `n` values from a **vector**, a lazy **`[a..]`** range, **tuple**, **`collections.list`** linked list, or other iterable (not str/bytes/dict/multiset). Returns a **tuple**.
- **`to_list(n, seq)`** — materialize prefix into a Python **`list`** (host type only; **`[…]`** in source remains a **vector**).
- **`to_multiset(n, seq)`** — multiset built from that prefix (counts follow duplicates).

Use them to **materialize** infinite or lazy generators into concrete collections when you choose.

### Multisets

Literals use **`{value:count, …}`** — each **value** has a **non-negative integer multiplicity** (not comma-separated elements). For two multisets *A*, *B*, **missing keys count as multiplicity 0**. Regular operators:

| Op | Meaning |
| -- | ------- |
| `+` | multiset union (sum counts) |
| `-` | multiset difference |
| `*` | intersection (min of counts per key) |
| `/` | symmetric difference (disjoint union of A\\\\B and B\\\\A) |

`vektorflow.runtime.cartesian_binary` remains for Python callers that need the Cartesian product of pairs; it is not the default for `+` / `-` / `*` / `/` in `.vkf`.

### Absolute value `|x|` (mini expression helper)

A small expression evaluator (`vektorflow.expr.eval_expression`) parses **`|expr|`** as absolute value / vector norm (same rules as **`abs`** above). It is for tests and early integration until the full `.vkf` parser exists.

### VS Code (syntax, run button, terminal)

1. **Install the extension** from this repo: **Developer: Install Extension from Location…** and select the **`vscode`** folder (the one that contains `package.json`). **Do not** use `code --install-extension ./vscode` — that only accepts Marketplace IDs.

2. Open the **vektor-flow** project folder (or any folder where you use `.vkf` files). Open a **`.vkf`** file — the language mode should be **Vektor Flow**.

3. **Run the program** (output goes to the **integrated Terminal**):
   - **Play** (▶) in the **editor title bar** (top right) — command **Run Vektor Flow File** — or **Command Palette** → **Run Vektor Flow File**. This runs `python -m vektorflow.cli` on the current file in a new terminal named **Vektor Flow**.
   - Or use **Run and Debug** (**F5**) with the workspace config **vkf: run current file** (needs the **Python** extension and an interpreter where **`vektorflow`** is installed).
   - Or **Terminal → Run Task…** → **vkf: run current file** (same CLI as above).

**Settings:** **Vektor Flow: Python Path** (`vektorflow.pythonPath`) — defaults to `python`; set it to your venv’s interpreter if `vektorflow` is not on the default PATH.

**Development:** open the `vscode` folder and press **F5** (“Run Extension”) to launch an **Extension Development Host** window.

**Optional CLI install:** in `vscode/` run `npm install -g @vscode/vsce && vsce package` and `code --install-extension .\vektorflow-0.0.2.vsix` (version from `package.json`).

The repo includes **`.vscode/`** for this workspace:

- **`launch.json`** — **F5** / **Run and Debug** runs **`python -m vektorflow.cli`** on `${file}` in the **integrated terminal**.
- **`tasks.json`** — **vkf: run current file** and **vkf: tokens (current file)**.

**Is `vkf` “global”?** Only if the Python you used for `pip install -e .` is the one on your PATH and its **Scripts** folder (Windows) is on PATH. Otherwise use **`python -m vektorflow.cli`** from the same environment, or activate your venv first.

### UI host (`web/vf-ui`)

Floating **panel = frame** chrome is **`VfFrame`** in **`web/vf-ui/`**; scene types in **`vektorflow/ui/`**. On **Windows**, the shell is **`vf-overlay.exe`** — WebView2 with **DirectComposition** (typical WebView2 overlay style). Build **`native/VfOverlay/`** then **`.\scripts\run-vf-ui.ps1`**, or the first `add_frame` can launch the built **`vf-overlay.exe`** (see **`vektorflow.ui.launch`**). See **`web/vf-ui/README.md`** and **`native/VfOverlay/README.md`**.

## Language at a glance

**Terminology:** **`[ … ]`** values are **vectors**. The surface language does **not** call that shape a *list* — **list** is reserved for Python’s **`list`** (e.g. **`to_list`**) and for the **`collections.list`** **linked-list** constructor (`VFLinkedList`), not for **`[…]`**.

### Emit (`::`)

```
"hello, world" ::           # prints to stdout
```

**Leading** **`:: expr`** prints **`expr`** to **stdout**. **Leading** **`::: expr`** is sugar for a **line-oriented** print (same as **`:: (expr & "\n")`**). Those are **not** stdin reads.

**`@:: expr`** returns from the innermost function **and** prints the value (like **`::`** at statement level). The lexer treats **`@::`** as **one** token so it is never split into **`@:`** and **`::`**.

To write text to a file, use the stdlib **`io.write_text(path, text)`** (after **`:.io`** or **`io : .io`** so **`io`** is in scope).

### Reading from stdin

There are **three** ways to bring **one line** from standard input into the program (same newline stripping: no trailing `\r\n` in the stored value):

| Form | Where the line goes |
| ---- | ------------------- |
| **`name ::`** | **Trailing** **`::`** after a simple **name** — read into **`name`**, no prompt. |
| **`name :::`** | **Trailing** **`:::`** after a simple **name** — print **`name: `**, then read into **`name`**. |
| **`>> expr`** | **Leading** **`>>`** with **nothing** to the left of **`>>`** — read into **`$`**, then evaluate **`expr`** (same **`$`** rules as **`left >> expr`**; see *Pipes and the `$` sigil*). |

**Two styles:** bind into a **named variable** (**`name ::`** / **`name :::`**), or bind into the pipe placeholder **`$`** (**`>> …`**). There is **no** walrus operator; use **`name :::`** when you want a prompt before input.

**Also:** **`f(x) ::`** / **`f(x) :::`** reads the **function body** as one line from stdin (see parser). That is not the same as **`name ::`** at top level.

**`::` in value positions:** **`::`** cannot appear **inside** a tuple **`( … )`**, vector **`[ … ]`**, struct field value, multiset element, or **function call argument** — the parser reports an error. **Statement-level** print is fine: **`(1, 2) ::`**, **`f(3) ::`**, or bind then print.

### Bindings (`:`)

```
x : 42
f(x, y) : x^2 + y^2
```

`:` defines; `=` is the equality relation:

```
(3 = 2 + 1) ::              # true
(2 = 4) ::                  # false
```

If you are used to **`=`** for assignment from other languages, use **`:`** here — **only** **`:`** binds a name; **`=`** is never assignment.

**Reading `:` — right into left:** Usually **`RHS → LHS`**: the **right** side moves into the **left** binding target.

- **`name : expr`** — **`expr`** goes into **`name`** (definition / bind).

**Pour into scope — `:…` (colon on the left):** One form for **everything** you want to **pour** into the **current** (module / top-level) **scope**: **`:a`**, **`:.path`** (load a **`.vkf`** / folder / stdlib module — see *Modules*), **`:v`** where **`v`** is a **vector**, … The **`:`** comes **before** the value — **“pour this into scope”** — **not** **`a:`** (that pattern is **only** for **unpack** inside **`[a:]`**, *Axis tags*).

| Kind | What **`:x`** does |
| ---- | ------------------ |
| **Struct** | Each **field name** becomes a **binding** in scope (**values copied** on spill, same copy story as struct updates elsewhere). |
| **Module** (path **`.m`**) | Load module; **exported names** pour into scope (see *Modules*). **`:.m`** into current scope; **`a : .m`** binds the module namespace to **`a`**. |
| **Vector** | **Elements** pour into scope **in order** — **positional** spill (same **idea** as **tuple** of the same length: **one** binding per slot). **Exact** names for each slot (e.g. **`_0`**, **`_1`**, …) follow the lexer / grammar once fixed. |
| **Tuple** | Same as **vector** of that **length**: **positional** pour. |
| **Anything else** | **Spill as-is**: the value is **made available** in that scope the way a **single** binding would (no field or element **decomposition**). |

```
a : (x: 3, y: 4)
:a              # pour struct into scope → `x` and `y` in scope
x + y ::

v : [1, 2, 3]
:v              # pour vector into scope → positional bindings for each element (order 0, 1, …)
```

**Do not confuse** with **`[a:]`** — inside **`[]`**, **`a:`** means **unpack** **`a`**’s **elements** **into a new vector** literal, **not** pour into **outer** scope.

**Bind patterns:** On the **left** of **`:`**, **`container.(i, j, …)`** with **identifiers only** inside **`( … )`** introduces **new names** bound from the **right-hand** value (tuple or **vector**). **R-value** uses of **`.(expr)`** still evaluate the index expressions.

**Concatenation:** **`&`** is the dedicated **concatenation** operator (it is not used for anything else). It **appends** **strings**, **tuples**, and **vectors** end-to-end; **merges** two **structs** (fields from the left, then the right — duplicate keys take the **right**); on **multisets** it behaves like **`+`** (union of counts). For **vectors**, remember **`+`** is **element-wise** (same length); use **`&`** to splice. If **one operand is a string** and the other is **not**, **`&`** **stringifies** the non-string side (same rule as **`+`**), so **`expr & "\n"`** works for **`::: expr`** with any printable value. **Sugar:** **`(:(a,b),:(c,d))`** spreads each piece into one flat tuple **`(a,b,c,d)`** (same idea as tuple literals with **`:expr`** spreads).

**Constructors and `@::`:** A **type-shaped** header **`Name(x:num, y:num):`** with an **empty** body defines a **struct constructor** **`Name`**. Inside a function, **`@:: expr`** returns **`expr`** from the callable **and** prints it (one lexer token **`@::`**, so it never splits into **`@:`** + **`::`**). Combine with **operator overloads** and **`display(value: T):`** for full control over construction and printing.

### Blocks — tab indent, last expression returns

```
f(x, y) :
	t : x^2
	t + y^2
```

Rule: any indented block returns its **last row** by default.  
Use **`@:`** only for an **early** return before the last row.

The same rule applies to multiline parenthesized blocks:

```
(
  this
  can
  be done
)
```

The block value is the last line (`be done` in this example), unless an earlier `@:` is used.

### Conditionals And Switch

Use the two forms consistently:

- **`?`** = if-style conditional
- **`??`** + **`=>`** = switch dispatch

**If / else style (`?`)**:

```
x > 3?
  :: "gt"
  :: "le"
```

**Switch style (`??` with `=>`)**:

```
event.get()??
  ui.MOUSE_MOVE => on_mouse_move(e)
  ui.MOUSE_DOWN => on_mouse_down(e)
  ui.MOUSE_UP => on_mouse_up(e)
  _ => @:
```

The key rule is simple: **do not use `?` arm syntax as switch-case**.  
If you are dispatching over event kinds or enum-like values, use **`??`** and **`=>`**.

For switch expressions, if you omit a default arm and no case matches, the result is **`null`**:

```
expr??
  A => one
  B => two
```

Within each `=>` branch, the branch result is the **last line** in that branch body, unless an earlier **`@:`** is used to return before the end of the branch.

Also, the single-form conditional expression:

```
expr? this
```

returns **`this`** when `expr` is true-like, otherwise **`null`**.

### Containers

| Literal            | Meaning                 |
| ------------------ | ----------------------- |
| `(1, 2, 3)`        | tuple                   |
| `(1..5)`           | tuple of 1..5 inclusive (step +1 or −1 so both ends are included; `..5` ⇒ `0..5`) |
| `[1, 2, 3]`        | vector                  |
| `[1..5]`           | vector of 1..5          |
| `[3:4, 5:2]`       | vector with repeats — same as `[3, 3, 3, 3, 5, 5]` (`value : count` per slot) |
| `[:m]`             | multiset **`m`** spilled into a vector (multiplicity preserved: each copy is its own element) |
| `a..` / `..`       | **lazy** infinite iterator from `a` or `0` (cannot use `a..` inside `[ ]`) |
| `{1:1, 2:1, 3:1}`  | multiset (value → count; axis tags for outer / broadcast shapes) |
| `(a: 4, b: 5)`     | struct                  |

These are **not interchangeable** — the shape you choose fixes **how values are indexed, merged, and typed** later (operator dispatch, interfaces, reach-in, pipe, …).

| Kind | Syntax | What it is |
| ---- | ------ | ---------- |
| **Tuple** | `(1, 2, 3)`, `(1..5)` | **Positional** — elements are **only** by index (0, 1, …). No field names. Range forms materialize to a tuple of numbers. |
| **Struct (record)** | `(x: 1, y: 2)` or type-only `(x:num, y:num)` | **Named fields** — keys are identifiers; access with **`.x`**, **`.y`**. Same **paren** syntax as tuples, but **`name:`** makes it a **record**, not a positional tuple. (Other languages call this a *struct* or *named record*; it is **not** the same thing as a plain tuple.) |
| **Vector** | `[1, 2, 3]`, `[1..5]`, `[3:4, 5:2]` | **Bracket** sequence — ordered, **`[]`** only (not a “list” in the language; that word is for Python / **`collections.list`**). Inside **`[]`**, **`expr : count`** repeats **`expr`** **`count`** times (non-negative integer), e.g. **`[3:4, 5:2]`** is **`[3, 3, 3, 3, 5, 5]`**. Homogeneous **vector** shape for element-wise ops and pipe. |
| **Multiset** | `{value:count, …}` | Bag / multiplicity — see *Multisets*. |
| **Hash map** | **`:.collections`** then **`map(x:3, y:4)`** | Mutable key–value map (stdlib); **not** a struct — see *`collections` (stdlib)*. |

**Vectors vs host lists:** **`[ … ]`** is always called a **vector** in docs and on the language surface. The reference interpreter stores vectors as Python **`list`** internally; **`to_list`** exposes a **Python** `list` for interop. The **`list(...)`** **callable** from **`:.collections`** builds a **linked list** (`VFLinkedList`), which is also **not** a vector.

**Why the distinction matters later:** **tuples** vs **structs** differ in **whether positions or names are part of the type** (structural matching on field names vs arity-only for tuples). **Vectors** vs **tuples** differ in **syntax and intended use** (`[]` vs `()`, element-wise algebra vs fixed positional bundles). Keeping these concepts separate now avoids painting the type system into a corner when you add richer **`:`** types, overloads, and APIs.

**Tuple vs vector vs multiset for ranges:** finite `a..b` materializes to a **tuple** of ints; `[]` flattens a single finite range into a **vector**. **`a..` with no end** is a lazy iterator (not allowed inside `[ ]`). `()` is tuple-shaped, `[]` is vector-shaped, `{}` is multiset-shaped. Multisets are **sorted**; order uses `<` / `=` on elements (see below).

**Vectors:** The **only** surface syntax for homogeneous sequences is **`[ … ]`**. A trailing **`_`**, **`_i`**, **`_ij`**, … is **not** part of the core language story — use **`[]`** for vectors; the interpreter may still attach optional axis metadata for advanced tensor-style ops.

**Inside `[ ]`:** **`expr : count`** repeats **`expr`** **`count`** times; **`[a:]`** unpacks **`a`**; **`[:m]`** expands a **multiset** **`m`** into a flat vector with **multiplicity preserved** (each copy is its own element).

### `collections` (stdlib)

After **`:.collections`** (spill stdlib **collections** into scope) or **`c : .collections`** then **`c.map`**, …:

- **`map(x:3, y:4)`** — mutable hash map (**`VMap`**). Initialization uses **keyword-style** pairs **`name: value`** in the call. **`map()`** is empty. Read with **`.field`** or **`.(expr)`**; assign with **`a.field : v`** or **`a.(key) : v`** (same bind syntax as structs, but the value is **not** a struct).
- **`list(2, 3, 4)`** — **doubly linked list** (`VFLinkedList`) with those elements in order.
- **`list(2)`** — one node containing **`2`** (not “two” as length).
- **`list(x)`** when **`x`** is a single **iterable** — one element wrapping that whole iterable (often a **vector**); use **`list(:x)`** to **spread** **`x`** into the **linked list** (**`:expr`** is a spread argument in call position).

**Reading `a:` (inside `[ ]` only):** The **`:`** after **`a`** means **unpack** **`a`** into the brackets. **Scope** spill is **`:a`**, **not** **`a:`** (see *Bindings (`:`)* — **pour into** vs **unpack into `[]`**).

**Index access** on **vectors** and **multisets** uses **`.`** — **`.(expression)`**, **`.$identifier`**, or **`v.N`** where the lexer allows.

Structs are immutable (copy-on-write rebind):

```
a : ()
a.x : 3
a.type : "cool"
```

### Types (type-only structs; no `interface` keyword)

Names like **`Point`** or **`Vec`** in this document are **only examples** of interfaces you might define — they are **not** keywords, builtins, or a fixed standard library. Any identifier can name a type record the same way.

There are no classes — only **structs**. A **named type** is a struct whose fields carry **only types** (no values), written right after `:`:

```
Point:(x:num,y:num)
```

Spacing is flexible; e.g. `Point : (x : num, y : num)` is the same idea. The RHS is **type-only**; that’s what constrains parameters in operator definitions and elsewhere.

**Values** use the same shape with **values** or expressions:

```
p : (x: 1, y: 2)
```

**Redefining operators (binary and unary):** any built-in operator can be given a meaning for your types. Write the **operator symbol**, then **parameters in parentheses** (with optional type annotations), then `:` and the body — same idea as a function, but the name position is an operator.

**Binary** — two parameters:

```
<(a:Point, b:Point): a.x < b.x
+(a:Point, b:Point): (x:a.x+b.x, y:a.y+b.y)
```

**Unary** — one parameter:

```
-(v1:Vec): (x:-v1.x,y:-v1.y)
```

Here `Vec` would be a type-only struct (e.g. `Vec:(x:num,y:num)`). Unary forms work for operators like `-`, `+` (if you define unary `+`), `~`, etc., using the same `op(param:Type):` pattern.

If you omit type annotations, the body still works for any value with the needed fields (**structural typing**):

```
<(a, b): a.x < b.x
```

**Default struct ordering:** if `<` is not defined for a struct, order is **lexicographic by field declaration order** (“smaller wins” at the first differing field). That order **sorts multisets** and drives ordered iteration.

**Multisets:** elements are stored in **sorted** order per `<` on the element type; `=` identifies the same key for counts.

**Field names vs keywords:** after `.`, names like `type` are always field names.

### Modules — everything is a struct

```
# a.vkf
f(x, y) : x^2 + y^2
```

```
# b.vkf
funcs : .a
funcs.f(2, 3) ::
```

**Surface syntax:** **`:.m`** **pours** a module’s **exported names** (bindings whose names do not start with **`_`**) into the **current scope**. **`a : .m`** loads the same module and binds its namespace to **`a`**, so you qualify (**`a.f`**, …). Segments after **`.`** are path pieces: **`.a`** resolves **`a.vkf`** next to the importing file; **`.lib.helpers`** → **`lib/helpers.vkf`**. **Omitting `.vkf`:** if there is no extension and **`name.vkf`** exists, that file is used. **Folders** load as a nested struct of files/subfolders; use **`:.folder`** to pour or **`pkg : .folder`** to bind. Resolution is **relative to the importing file’s directory** (see `vektorflow.use_resolve` in Python). Stdlib names (**`math`**, **`capture`**, **`collections`**, **`io`**, …) resolve when the path is a single segment and no file matches.

**Inside** **`[]`**, **`[a:]`** is **unpack** into a **vector** literal (*Axis tags*) — not a module load.

```
:.a
f(2, 3) ::
```

**Examples on disk:** `examples/nested/` (file import without `.vkf`), `examples/folder_repo/` (folder-as-package with `pkg/mod.vkf`).

### Overloading `::` (display) for a type

You can define how **`::`** formats a value of type `T` when it appears before `::`:

```
display(value: Point): "($value.x.2f, $value.y.2f)"
```

Then `p::` uses that template (with string interpolation) instead of the default `to_string`. Multiple overloads dispatch on `T` the same way as other operators. The body is an expression that **evaluates to the string (or bytes) to print** — the final `::` on a line is still “print this expression”; the overload defines **what** gets printed for that type.

### Capturing data from text

**Natural phrasing** (“capture 10 and 20 from this”) is easiest if **“this”** is a **variable** holding the text, and the **pattern** is explicit. The stdlib **`capture`** module (via **`:.capture`**) provides:

- **`regex(source, pattern)`** (stdlib name **`regex`**) — Python `re.search`; **named groups** `(?P<a>…)` become struct fields, e.g. `a: 10, b: 20` after you bind the result to a struct.
- **`groups(source, pattern)`** — returns numbered groups as a tuple.

Example (conceptual — exact bind syntax comes with the full evaluator):

```
text : "values are 10 and 20"
nums : regex(text, "values are (?P<a>\\d+) and (?P<b>\\d+)")
# nums.a, nums.b as strings; convert with as_num(...) later
```

A future sugar form could map `"capture $a and $b from this"` to a regex template, but the **robust** base is: **one string `source`**, **one regex `pattern`** with named captures, then bind to a struct or tuple. That stays predictable and debuggable.

### Pipes and the `$` sigil

`$` is the implicit/anonymous binding — current pipe element, lambda parameter, or the most recently bound lambda in the flow.

**Pipe left-hand side:** for **vector** (`[…]`), **tuple**, **string**, **set**, **frozenset**, or **multiset** (`{…}`), **`$`** is each element (each character for strings, each occurrence for multisets); the right-hand side runs once per step; the result keeps the **same kind** — vector, tuple, string (each step’s text joined end-to-end, same idea as **`&`** on strings), set, frozenset, or `Multiset`. For **any other value** (a number, struct, lazy range, etc.), **`$`** is that **whole value once** — a scalar is a **single** step, not a length-1 tuple (no implicit `(x)` wrapper).

**Print a pipe:** use **`::`** at the **start** of the statement (**`:: expr`**). A **trailing** **`::`** after an arbitrary **`expr`** is **not** print — it is only the forms **`name ::`** / **`name :::`** (stdin into **`name`**).

```
:: [1..5] >> $^2            # vector: [1, 4, 9, 16, 25]
:: (1..5) >> $^2           # tuple:  (1, 4, 9, 16, 25)
:: 4 >> $^2                # 16 — one step, $ is 4

:: ($(x): x^2)(3)          # 9 — anonymous lambda applied
```

**Console input** (**`>> expr`**): a **leading** **`>>`** (nothing on the left) reads **one line** from standard input into **`$`**, then evaluates **`expr`** — same **`$`** binding as **`value >> expr`**, but the value comes from stdin (terminal or redirect). See *Reading from stdin* for how this fits next to **`name ::`** / **`name :::`**.

```
:: >> $                     # echo one typed line
:: >> ( $ & "!" )           # read line, append "!", print
```

Use **`>> ( … )`** when the right-hand side needs an inner pipe: **`:: >> ( a >> b )`** reads stdin, then runs the nested pipe (still wrapped in **`:: …`** if you want it printed).

**Absolute value** uses **`|expr|`** only — **`|`** is not the pipe operator (pipe is **`>>`**).

### String interpolation and formatting

Inside **double-quoted** strings, `$` starts an interpolation (decoded when the string is evaluated for display / printing):

| Form | Meaning |
| ---- | ------- |
| `$name` | Value of variable `name` |
| `$name.fmt` | Same value, formatted with a **printf-style** suffix (e.g. `$pi.4f`, `$n.2e`) |
| `$a.b.fmt` | Field `b` of struct `a`, then format (greedy: whole chain is one interpolation target) |
| `$(expr)` or `$(expr).fmt` | Interpolate an arbitrary expression; use this when greedy `.` would be wrong |

Escape a literal dollar as `\\$` in the string source.

Example:

```
a : 4.2345
"printing $a.2f" ::        # printing 4.23
```

### Structs (immutable values)

- **Structs are immutable by definition** (runtime: field updates **replace** the struct with a shallow copy; other bindings that still pointed at the old value are unchanged).
- **`p : ()`** creates an empty struct (a dict-backed record).  
- **`p.fieldName : value`** sets a field: **any identifier** after `.` is a **field name** (not numeric reach-in).  
- Read with **`p.field`** — same key as **`p."field"`** when the name is that string (no separate “string field” mode). Use **`p.("field")`** when the key comes from an expression, or **`p.("x", "y")`** for multiple keys.
- **Name vs value as key (structs / paren reach-in):** **`p.i`** uses the **identifier** `i` as the **field** or **element** key (reach-in). To use the **value** of `i` as the key (e.g. numeric index), write **`p.$i`** or **`p.(i)`**. For an arbitrary expression as the key, **`p.(expr)`** and **`p.$(expr)`** mean the same thing. **On the left of `:`**, **`p.(i, j) : (u, v)`** treats **`i`** and **`j`** as **new names** bound from the right-hand side (pattern), not as expressions to evaluate first.

### Types, interfaces, and one `:` for types and values

The language uses the same **`:`** for **binding a name to a type shape** and **binding a name to a value**. Examples of the intended surface syntax:

| Form | Role |
| ---- | ---- |
| `Point : (x:num, y:num)` | **Interface / type** — example name `Point` plus a type-only record (`num` etc. are the primitive type names in play). |
| `Ftype : num -> num` | **Function type** — arrow `->` is only for types (not expressions). If a name starts with an uppercase letter, the parser tries a type RHS first; if that fails (e.g. `S : {1:1,2:1}` as multiset), it parses a normal value expression. |
| `Ftype : (num, num) -> num` | **Function type** — tuple domain (positional). |
| `Ftype : (x:num, y:num) -> num` | **Function type** — record-shaped domain (named parameters in the type). |
| `p : (x:1, y:2)` | **Instance** — struct literal (values). |
| `x : num`, `s : str`, `b : bool` | **Default primitives** — `0`, `""`, boolean false. |

**Operator overloading** (specified): define the operator as a function whose name is the symbol and whose parameters carry types:

```text
+(a:Point, b:Point): (x:a.x+b.x, y:a.y+b.y)
```

Dispatch is by the declared parameter types (`Point`, …), with **structural** matching when a value is untagged (struct literal with the right fields). The reference interpreter supports **named type shapes**, **struct literals**, **typed parameters**, **operator definitions** (`+`, `<`, `/\`, …), **unary** `-(a):` / `~(a):`, **`display` overloads** `display(value: T): …` for **`::`** output, **string** `$a.2f` **interpolation**, **default struct ordering** for `<` / `<=` / `==`, **`[1..5]`** vector range expansion, **lambdas** `($(x): x^2)`, and **`operator(...)`** calls (e.g. `+(2, 3)`).

There is **no** C-style ternary **`cond ? a : b`** — the second **`:`** would fight **`:`** as **bind / pour / `header : body`**. Use **`?`** for if-style conditionals and **`??` + `=>`** for switch-style dispatch.

### Operators

- Arithmetic: `+ - * / ^ %` — on **two vectors** of the same length, `+ - * /` are **element-wise** (see *Vectors vs multisets*).
- Concatenation: **`&`** — **`a & b`** appends **strings**, **tuples**, and **vectors**; **merges** **structs** by field; on **multisets** is the same as **`+`** (union). Overload with **`&(a:T, b:T): …`** when needed.
- Relations: `=  !=  <  <=  >  >=`
- Logical: `/\` (and), `\/` (or), `><` (xor), `~` (not) — `><` is boolean exclusive-or
- Pipe: `>>` — **`left >> right`** sends **`left`** into **`$`** on **`right`**; **`>> right`** alone reads **one stdin line** into **`$`** (console input). **`|expr|`** is absolute value / norm only (single `|` is not pipe).
- **Reach-in with `.`:** `a.(i, j, ...)` or **`a.N`** (integer literal, no parentheses) — e.g. `a.1`, `a.2 : 2`. Nested: `m.1.(0)` or `m.(1).(0)`; **`m.1.0` is not two indices** (the lexer reads `1.0` as one float). Field keys: **`a.x`** or **`a."x"`** (same). **`a.$x`** is **`a.(x)`** (key = value of `x`); **`a.$(expr)`** is the same as **`a.(expr)`**. **Structs, tuples, and named tuples** use **`.`** + identifier to **reach in**. On the **left** of **`:`**, **`.(i, j)`** with **identifiers only** is a **pattern** (unpack / parallel bind); on the **right** of **`:`** in expressions, **`.(i)`** still evaluates **`i`**. **`[` `]`** are only **vector** literals; **implicit multiplication** applies before a vector (`2 [1, 2]` or `2 * [1, 2]`).
- Names: letters, digits, underscore (`row_1`, `myVar`).

#### Vectors vs multisets

On **two vectors** of the **same length**, `+ - * /` are **element-wise** when shapes match. To **concatenate** two vectors **without** zipping, use **`&`**. On **two multisets**, they use **multiplicity** (see *Multisets* above); **`&`** and **`+`** both mean **union** on multisets. There are no special `(op)` or `{op}` tokens.

Square brackets `[]` are only for **vector** literals (not indexing). Comments use `#`.

## Phase 1 scope

- [x] Lexer
- [x] Parser (reference `.vkf` surface documented in this README)
- [x] Tree-walking evaluator (same)
- [x] Runtime helpers: multisets + Cartesian binary op, `abs`/norm
- [x] Stdlib **`math`**, **`capture`** (`resolve_stdlib(...)` from Python; **`:.name`** in `.vkf`)
- [x] **`.path` / string path resolution** with optional `.vkf` — `vektorflow.use_resolve`
- [x] Mini expression parser (`|x|`, math calls) — `vektorflow.expr`
- [x] Module system (**`:.path`** / **`a : .path`** loads `.vkf` / folders; types and operator overloads merge into importer)
- [x] Examples: `examples/nested/`, `examples/folder_repo/`
- [x] CLI (`vkf`, `vkf tokens`, optional `.vkf` suffix)
- [x] VS Code syntax highlighting + run command / F5 / tasks (see `vscode/` and `.vscode/`)
- [ ] REPL
- [ ] Visualization hooks

## Phase 2+

- [x] Typed interfaces (`Point : (x:num, y:num)`), struct literals `(x:1, y:2)` with the same `:` shape
- [x] Operator overloads (`+(a:Point, b:Point): …`, `and(a, b): …`, `not(x): …`, `display(value: Point): …`) with dispatch by type tags and structural fallback; `+(2, 3)`-style calls
- [x] String interpolation, `display` formatting for `::`, default struct comparison, vector `[a..b]` range, `$(x):` lambdas
- Stabilize spec + full test suite
- Replace tree-walking evaluator with bytecode VM or native compile (LLVM / Rust backend)
- Visualization and plotting
