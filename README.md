# Vektor Flow

**Designed by Viktor Jonsson.**

**VKF automatically applies ordinary typed functions across compatible parts of structured data while preserving shape and metadata.**

Vektor Flow (VKF) is an experimental language for compact native programs,
structured data, mathematics, and eventually visual applications.

> [!WARNING]
> VKF 0.1.2 is an unsupported experimental preview. It has bugs, incomplete
> diagnostics, and unstable APIs and syntax. Do not use it for production or
> run untrusted VKF programs.
>
> The intended visual system is not native yet. `ui`, `physics`, and `symbolic`
> are deliberately absent from this release rather than using compatibility
> fallbacks.

## Why VKF Is Different

### Ordinary Functions Apply Structurally

<!-- readme-example: core/25-structural-compatibility.vkf -->
```vkf
double(value:int) -> int:
    value * 2

point: (name:"origin", enabled:true, x:2, y:3)
result: double(point)

:: result
```

`double` accepts `int`, so VKF recursively transforms `x` and `y`. The
incompatible `str` and `bit` metadata remains unchanged. This is a general
language rule—not a special feature of `math` or `+`.

This convenience can also surprise: incompatible fields are intentionally
preserved instead of producing an error. Use a container-typed parameter when
the whole container must match exactly. The [language guide](docs/language-guide.md#4-automatic-element-wise-function-application)
defines the compatibility rules.

### Named Axes Express Tensor Intent

<!-- readme-example: core/42-axes.vkf -->
```vkf
matrix: [1, 2, 3]->i * [1, 2, 3]->j
diagonal: [1, 2, 3]->i * [4, 5, 6]->i
tensor: [1, 2]->i * [3, 4]->j * [5, 6]->k

:: matrix
:: diagonal
:: tensor
```

Matching axes compute element-wise. Distinct axes form outer products, and
additional distinct axes preserve tensor rank.

## Install VKF 0.1.2

Download the [0.1.2 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.2).

| Platform | Recommended download | Installation |
| --- | --- | --- |
| Windows x64 | `vektor-flow-windows-x64-setup.exe` | Run it; optionally add VKF to `PATH`. |
| Linux x64 (Debian/Ubuntu) | `vektor-flow-linux-x64.deb` | `sudo apt install ./vektor-flow-linux-x64.deb` |
| macOS Apple Silicon | `vektor-flow-macos-arm64.pkg` | Open it and follow the installer. |

Portable `.zip` and `.tar.gz` archives are on the same release page. Linux and
macOS archives include a per-user `install.sh`; do not run it with `sudo`.

Open a new terminal:

```bash
vkf -e ':: "hello, world"'
```

The installed compiler directly emits PE, ELF, or Mach-O executables. Compiling
and running a VKF program requires no Python, C++ compiler, assembler, or
separate linker.

### Commands

| Command | Result |
| --- | --- |
| `vkf program.vkf` | Build beside the source if changed, then run. |
| `vkf program.vkf -o app` | Build or reuse the named executable, then run. |
| `vkf -b program.vkf` | Build only. |
| `vkf -b program.vkf -o app` | Build only with an explicit output name. |
| `vkf -e ':: 2 + 2'` | Evaluate inline source. |
| `vkf -t tests.vkf` | Run native tests in a file or directory. |
| `vkf -v` | Print the compiler release version. |

`-b` is build, `-e` is evaluate, `-t` is test, `-v` is version, and `-o` names the executable.
Passing a `.vkf` file is the run command; there is no `-r`. A fingerprint of
source, imports, target, compiler, and output choice allows unchanged programs
to reuse their executable.

## Performance Evidence—And Its Limits

The 0.1.2 release compiles every documented program 100 times from fresh paths
and executes it 100 times in fresh operating-system processes on Windows x64,
Linux x64, and macOS ARM64. Reports record every sample, exact output, source
hash, compiler hash, and machine conditions. The 10-million-operation container
case keeps its workload fixed even when timings change.

<!-- readme-platform-evidence:start -->
Fresh 0.1.2 release measurements will replace this line before publication.
<!-- readme-platform-evidence:end -->

These absolute timings prove reproducibility and expose regressions. They do
**not** prove that VKF is generally faster than C, Rust, Zig, Go, Julia, or
Python.

### Reproducible Language Comparison

Rows marked **matched** use the same algorithm. Rows marked **idiomatic** let
each ecosystem use its normal optimized route: NumPy/SciPy for Python and
linear algebra for Julia where appropriate. VKF is the only code displayed;
every other implementation is linked exactly. Tool versions, source hashes,
work counts, output parity, compile models, and 100-run dispersion are retained.

<!-- readme-comparison-evidence:start -->
Fresh 0.1.2 seven-language release measurements will replace this line before publication.
<!-- readme-comparison-evidence:end -->

The [comparative benchmark laboratory](benchmarks/core-comparison/README.md)
contains reproduction commands and interpretation limits. Results are narrow
evidence, not a universal speed ranking.

Exact 100-run output and compile/runtime tables for all documented programs are
in the [full language guide](docs/language-guide.md). They are generated only
when all three reports match the current version, compiler hashes, and exact
source hashes.

## Status And Native Scope

The 0.1.2 native release includes `math`, `stat`, `random`, `time`, `io`,
`collections`, `errors`, `system`, `process`, and `regex`. Only fully native,
verified libraries ship. `physics`, `ui`, and `symbolic` remain future work.

The release gate currently contains **296 VKF tests** plus 59 documented-program
checks. Final Windows/Linux/macOS pass counts and timing evidence are inserted
only from the exact tagged release compilers.

## Punctuation At A Glance

| Syntax | Meaning |
| --- | --- |
| `:: value` | Print a value. |
| `::: value` | Print a labelled value. |
| `condition?` / `condition?>` | Conditional / loop while true. |
| `value??` / `value??>` | Match / repeated match. |
| `error!` / `expression!?` | Raise a typed error / catch errors. |
| `@:` / `@` | Return a value / return `null`. |
| `@>` / `@|` | Continue / break. |
| `: .module` | Spill a module into the current scope. |

`!` is never factorial. Only error types and error values may be raised.

## Safety

The compiler refuses to overwrite an unrecognized existing file or a
symbolic-link output. Installers reject unsafe roots, non-VKF installation
folders, and unrelated existing `vkf` commands.

VKF programs still run with the current user's permissions. `io` can modify
files and `process` can launch programs. `process.run` passes an exact argument
vector; `process.shell` invokes a platform shell and must be treated as unsafe.

## 0.1.2 Changes

0.1.2 closes these gaps from 0.1.1:

- `name: value` only declares; duplicate declarations in one scope are errors;
- `.name: value` only updates an existing reachable binding;
- compound updates require the dot, such as `.name +: value`;
- declarations and updates are value-returning expressions;
- parameters count as existing declarations and may only be updated with dot syntax;
- structural compound arithmetic updates compatible leaves and preserves incompatible metadata;
- `: .errors` exposes bare error types, `Error!` raises a default error, and ordinary values such as `2!` are rejected;
- `vkf -t` verifies exact expected compile failures as well as successful tests;
- `vkf -v` identifies the embedded compiler release, and proof rejects package/compiler version mismatches;
- every documented program has source-hash-bound exact output and three-platform 100-run timing evidence.

See the [complete release history and packaging contract](RELEASES.md).

## Documentation

- [Full numbered language guide](docs/language-guide.md)
- [Installation and source builds](INSTALL.md)
- [Testing guide](TESTING.md)
- [Release process and artifact contract](RELEASES.md)
- [Issue tracker](https://github.com/svenviktorjonsson/vektor-flow/issues)

## Development History

The language was designed by Viktor Jonsson, and the implementation has been
completely vibe coded. That history is disclosed here rather than presented as
a quality guarantee. Trust should come from readable source, reproducible
tests, exact artifacts and hashes, independent review, and clearly stated
limitations.
