# Vektor Flow

A mathematical visualization and computational language.

Use `vkf` to run `.vkf` programs.

File extension: `.vkf`

## Try Out Vektor Flow

Vektor Flow is a compact, keyword-light language for math, data, geometry, UI,
and computational experiments.

The feel is roughly:

- more compact than Python
- more expression-oriented than C++
- designed so values, shapes, and structure are easy to reach into directly

## Do This To Get Started

Choose the package for your OS, extract it, run `vkf`, then optionally install
the VS Code extension.

### Platform support

| Platform | UI modes today | Recommended path |
| --- | --- | --- |
| Windows | `overlay`, `browser`, `headless` | Full beta |
| macOS | `browser`, `headless` | Portable beta |
| Linux | `browser`, `headless` | Portable beta |

Windows is the only platform with the native transparent overlay host today.

## Hello World

### Windows

1. Download and extract the Windows package.
2. In PowerShell inside the extracted folder, run:

```powershell
.\vkf.exe -e ':: "hello, world"'
.\vkf.exe .\samples\hello.vkf
.\vkf.exe .\samples\core_language_tour.vkf
```

Expected first output:

```text
hello, world
```

### macOS / Linux

1. Download and extract the package for your OS.
2. In a shell inside the extracted folder, run:

```bash
./vkf -e ':: "hello, world"'
./vkf ./samples/hello.vkf
./vkf ./samples/core_language_tour.vkf
```

Expected first output:

```text
hello, world
```

## Core Ideas

### Compact, keyword-free style

Vektor Flow tries to stay small and dense.

- expressions do more of the work
- punctuation carries more structure
- many operations are direct instead of wrapped in long keyword forms

Example:

```vkf
a: 7
b: 5
:: "a + b = $(a + b)"
:: "a * b = $(a * b)"
```

### Reaching in

It should feel easy to reach into values:

```vkf
pair.0
person.name
grid.2.4
```

You can work directly with fields, tuple positions, vector entries, and nested
structure without a lot of ceremony.

Example:

```vkf
person: ()
person.name: "Ada"
person.score: 42
person.tags: ["math", "logic", "code"]

:: person.name
:: person.tags.0
```

### Spilling

Vektor Flow supports “spilling” ideas where structured values can be expanded
or unpacked naturally into the surrounding expression flow instead of always
needing verbose temporary setup.

That is part of why the language can stay compact while still working well for
mathy and structured data code.

Example:

```vkf
pair: ("left", "right")
:: pair.0
:: pair.1
```

### Shapes and structure matter

The language does not treat vectors, tuples, records, multisets, and typed
shapes as afterthoughts.

Examples:

```vkf
[num:n]
(x:num, y:num)
{1:1, 2:3}
value.
```

The goal is to make structure visible and usable, not hidden behind a lot of
library glue.

Example:

```vkf
join_scale(x:[num:n], y:[num:m], s:num) -> [num:n+m]:
  (x & y) * s

a2: [1,2]
b3: [3,4,5]
joined: join_scale(a2, b3, 2)
:: joined
:: joined.
```

### A blend of C++ and Python, but not a copy of either

The project borrows useful instincts from both:

- from Python:
  - interactive workflow
  - readable data access
  - quick iteration
- from C++:
  - explicit shapes and lowerable/native execution paths
  - tighter control over runtime/package output

But the surface language is its own thing: more symbolic, more structural, and
more compact than either.

## VS Code

To get Vektor Flow syntax highlighting, commands, and diagnostics in VS Code:

1. Install the bundled `.vsix` from the package, or install the extension from
   `vscode/`.
2. Point the extension at your packaged `vkf`.

### Windows setting

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

### macOS / Linux setting

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

3. Open `samples/hello.vkf`.
4. Run `Run Vektor Flow File`.

You should now get:

- `.vkf` syntax highlighting
- run / parse / build commands
- compiler-backed diagnostics

Example file to open once the extension is installed:

```vkf
math: .math

hyp2(x:num, y:num) -> num:
  x^2 + y^2

point: (x:3, y:4)

:: "hyp2 = $(hyp2(point.x, point.y))"
:: point.
:: math.sqrt(81)
```

Extension guide:

- [vscode/README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\vscode\README.md)

## Need More Detail?

- install guide:
  - [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)
- tester guide:
  - [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)
- release layout:
  - [RELEASES.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\RELEASES.md)
- macOS/Linux maintainer bring-up:
  - [BUNDLE_BRINGUP.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\BUNDLE_BRINGUP.md)

## Try These First

```bash
vkf examples/hello.vkf
vkf examples/branching.vkf
vkf examples/core_language_tour.vkf
```

For current packaged-native work:

```bash
vkf package examples/benchmarks/scalar_control.vkf -o dist/scalar-control
vkf package-native-core examples/native_core/hello_native.vkf -o dist/hello-native
```

## Packaging And Native Compiler Progress

The current standalone and packaging work is tracked in:

- [NATIVE_CORE.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\NATIVE_CORE.md)
- [INSTALL.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\INSTALL.md)
- [RELEASES.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\RELEASES.md)
- [examples/native_core/README.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\examples\native_core\README.md)

Important current distinction:

- `vkf build` produces a native executable for the supported subset
- `vkf package` and `vkf package-native-core` produce a native package directory
- Python is still used to produce those packages today
- the produced packaged executables do not require Python at runtime

Current package shape includes:

- built native executable
- emitted C++ source
- `vektorflow-package.json`
- `README.txt`
- `run.bat`
- `run.sh`
- `smoke-test.bat`
- `smoke-test.sh`

The package manifest now carries the runnable contract, launcher information, install hints, and codegen/build lineage so callers do not have to guess how to execute the package.

## UI Host Status

Current UI host modes:

- `overlay`
- `browser`
- `headless`

Current platform truth:

- `overlay` is Windows-only today
- `browser` is the portable bridge for macOS and Linux
- `headless` is the no-host mode

So the cross-platform release strategy is:

- Windows ships the native overlay host
- macOS and Linux ship the same language/runtime with browser-mode UI
- future native overlay hosts for macOS and Linux can plug into the same display/event contract

## Standard Library Notes

Most stdlib areas are not blocked on Windows-only native code.

Important examples:

- `math`, `collections`, `errors`, `stat`: general runtime/library work
- `io`: mostly portable by design, with host seams for file and time behavior
- `ui`: the main host/platform-specific stdlib area

That means the major cross-platform native-host effort is the UI host, not the rest of the stdlib surface.

## Community Feedback

The best feedback right now is:

- install friction on each platform
- `vkf` command behavior on packaged builds
- VS Code extension setup friction
- browser-mode UI issues on macOS/Linux
- overlay issues on Windows
- compiler/runtime bugs from real `.vkf` programs

When reporting a bug, include:

- platform
- whether you used a packaged build or a source build
- the `.vkf` file or minimal snippet
- package manifest if the bug is package/runtime related

For a fuller tester checklist, use:

- [TESTING.md](C:\Users\viktor.jonsson\Documents\Codex\2026-04-24-c-dev-vektor-flow-cleanfix-and\vektor-flow-orch-fresh\TESTING.md)

## Contributor Path

If you want to build from source today:

### Windows

```powershell
.\build.ps1
```

That script:

- installs the Python package
- builds the Windows overlay host
- runs tests

### macOS / Linux

```bash
pip install -e .[dev]
python -m vektorflow --version
```

If you are building tester bundles from source:

- Windows:
  - `.\scripts\build-release-bundle.ps1`
- macOS / Linux:
  - `./scripts/build-release-bundle.sh`

Verify before sharing:

- `python scripts/verify_release_bundle.py dist/releases/<channel>`

### Useful developer commands

```bash
vkf bench --list
vkf bench
vkf tokens examples/hello.vkf --json
vkf package examples/benchmarks/scalar_control.vkf -o dist/scalar-control
vkf package-native-core examples/native_core/hello_native.vkf -o dist/hello-native
```
