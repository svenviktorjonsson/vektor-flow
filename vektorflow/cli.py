"""Command-line interface for Vektor Flow.

Usage
-----
    vkf <file>               Run a .vkf file (``a`` → ``a.vkf`` if needed)
    vkf cpp <file>           Emit C++ for the currently supported native subset
    vkf build <file>         Build a standalone native executable for the supported subset
    vkf bench [name ...]     Run curated benchmark examples through interpreter/native paths
    vkf --ui-terminal <file> Run with terminal-attached UI launch behavior
    vkf tokens <file>        Print lexer token stream (diagnostics)
    vkf -s 'code'           Tokenize an inline snippet
    vkf --help
    vkf --version

``vkf <file>`` lexes, parses, and evaluates the program (emit to stdout, etc.).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from . import __version__
from .errors import EvalError, LexError, ParseError, VektorFlowError
from .lexer import tokenize
from .tokens import DEDENT, EOF, INDENT, NEWLINE


def _format_token_line(kind: str, value: object, line: int, col: int) -> str:
    if value is None or value == "":
        payload = ""
    else:
        payload = repr(value)
    return f"{line:>4}:{col:<4} {kind:<12} {payload}"


def resolve_vkf_path(arg: str) -> Path:
    """Resolve ``a`` → ``a.vkf`` when the bare path is missing but ``.vkf`` exists."""
    p = Path(arg)
    if p.is_file():
        return p.resolve()
    if p.suffix == "":
        with_vkf = p.with_suffix(".vkf")
        if with_vkf.is_file():
            return with_vkf.resolve()
    if p.suffix.lower() == ".vkf" and p.is_file():
        return p.resolve()
    raise FileNotFoundError(arg)


def cmd_tokens(source: str, filename: str, *, compact: bool) -> int:
    try:
        toks = tokenize(source, filename=filename)
    except VektorFlowError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    for t in toks:
        if compact and t.kind in (NEWLINE, INDENT, DEDENT, EOF):
            continue
        print(
            _format_token_line(t.kind, t.value, t.location.line, t.location.column)
        )
    return 0


def cmd_run(path: Path) -> int:
    """Parse and execute a ``.vkf`` file."""
    try:
        from .interpreter import run_file

        run_file(path)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def cmd_cpp(path: Path, out_path: Path | None) -> int:
    try:
        from .cpp_backend import emit_cpp_from_source_file

        source = emit_cpp_from_source_file(path)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if out_path is not None:
        out_path.write_text(source, encoding="utf-8")
    else:
        print(source, end="")
    return 0


def cmd_build(path: Path, out_path: Path | None) -> int:
    try:
        from .cpp_backend import compile_cpp_source, emit_cpp_from_source_file

        source = emit_cpp_from_source_file(path)
        target = out_path.resolve() if out_path is not None else path.with_suffix(".exe").resolve()
        exe_name = target.stem
        out_dir = target.parent
        built = compile_cpp_source(source, out_dir, exe_name=exe_name)
        if built.resolve() != target:
            built.replace(target)
        print(target)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def cmd_bench(patterns: list[str], list_only: bool = False) -> int:
    from .benchmarks import (
        load_benchmark_baseline,
        format_benchmark_json,
        format_benchmark_list_json,
        format_benchmark_report,
        list_benchmarks,
        run_benchmark,
        save_benchmark_baseline,
        select_benchmarks,
    )

    json_output = False
    samples = 1
    native_runs = 1
    native_warmups: int | None = None
    save_baseline: Path | None = None
    compare_baseline: Path | None = None
    filtered: list[str] = []
    i = 0
    while i < len(patterns):
        arg = patterns[i]
        if arg == "--json":
            json_output = True
            i += 1
            continue
        if arg == "--samples":
            if i + 1 >= len(patterns):
                print("error: --samples requires an integer value", file=sys.stderr)
                return 1
            try:
                samples = int(patterns[i + 1])
            except ValueError:
                print("error: --samples requires an integer value", file=sys.stderr)
                return 1
            if samples < 1:
                print("error: --samples must be >= 1", file=sys.stderr)
                return 1
            i += 2
            continue
        if arg == "--native-runs":
            if i + 1 >= len(patterns):
                print("error: --native-runs requires an integer value", file=sys.stderr)
                return 1
            try:
                native_runs = int(patterns[i + 1])
            except ValueError:
                print("error: --native-runs requires an integer value", file=sys.stderr)
                return 1
            if native_runs < 1:
                print("error: --native-runs must be >= 1", file=sys.stderr)
                return 1
            i += 2
            continue
        if arg == "--native-warmups":
            if i + 1 >= len(patterns):
                print("error: --native-warmups requires an integer value", file=sys.stderr)
                return 1
            try:
                native_warmups = int(patterns[i + 1])
            except ValueError:
                print("error: --native-warmups requires an integer value", file=sys.stderr)
                return 1
            if native_warmups < 0:
                print("error: --native-warmups must be >= 0", file=sys.stderr)
                return 1
            i += 2
            continue
        if arg == "--save-baseline":
            if i + 1 >= len(patterns):
                print("error: --save-baseline requires a path", file=sys.stderr)
                return 1
            save_baseline = Path(patterns[i + 1])
            i += 2
            continue
        if arg == "--compare-baseline":
            if i + 1 >= len(patterns):
                print("error: --compare-baseline requires a path", file=sys.stderr)
                return 1
            compare_baseline = Path(patterns[i + 1])
            i += 2
            continue
        filtered.append(arg)
        i += 1
    patterns = filtered
    if list_only:
        cases = list_benchmarks()
        if json_output:
            print(format_benchmark_list_json(cases))
            return 0
        for case in cases:
            native = "native" if case.native_supported else "interp-only"
            print(f"{case.name}\t{native}\t{case.rel_path}\t{case.description}")
        return 0

    cases = select_benchmarks(patterns)
    if not cases:
        print("error: no benchmarks matched", file=sys.stderr)
        return 1
    results = [run_benchmark(case, samples=samples, native_runs=native_runs, native_warmups=native_warmups) for case in cases]
    baseline_payload = None
    if compare_baseline is not None:
        try:
            baseline_payload = load_benchmark_baseline(compare_baseline)
        except OSError as exc:
            print(f"error: cannot read baseline {compare_baseline}: {exc}", file=sys.stderr)
            return 1
        except ValueError as exc:
            print(f"error: invalid baseline {compare_baseline}: {exc}", file=sys.stderr)
            return 1
    if save_baseline is not None:
        try:
            save_benchmark_baseline(results, save_baseline)
        except OSError as exc:
            print(f"error: cannot write baseline {save_baseline}: {exc}", file=sys.stderr)
            return 1
    if json_output:
        print(format_benchmark_json(results, baseline=baseline_payload))
    else:
        print(format_benchmark_report(results, baseline=baseline_payload))
    return 0 if all(r.ok for r in results) else 1


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    if not argv:
        print(
            "usage: vkf <file> | vkf cpp <file> | vkf bench [name ...] | vkf tokens <file> | vkf -s <snippet>\n"
            "       (omit .vkf: `vkf hello` finds `hello.vkf`)",
            file=sys.stderr,
        )
        return 0

    if argv[0] in ("-h", "--help"):
        print(
            "Vektor Flow — vkf\n\n"
            "  vkf <file>           Run a .vkf file (extension optional)\n"
            "  vkf cpp <file>       Emit C++ for the supported native subset\n"
            "  vkf build <file>     Build a standalone native executable for the supported subset\n"
            "  vkf bench [name ...] Run curated benchmark examples\n"
            "                       add --json for machine-readable output\n"
            "                       add --samples N for median-of-N timing\n"
            "                       add --native-runs N for compile-once/run-many timing\n"
            "                       add --native-warmups N to discard cold native runs\n"
            "                       add --save-baseline FILE to save a JSON baseline\n"
            "                       add --compare-baseline FILE to compare against one\n"
            "  vkf --ui-terminal <file>\n"
            "                       Run with terminal-attached UI launch behavior\n"
            "  vkf tokens <file>    Print lexer tokens\n"
            "  vkf -s/--source STR  Tokenize a snippet\n"
            "  --version            Show version\n",
            end="",
        )
        return 0

    if argv[0] == "--version":
        print(f"vkf {__version__}")
        return 0

    if argv[0] in ("-s", "--source"):
        if len(argv) < 2:
            print("error: -s requires a snippet", file=sys.stderr)
            return 1
        compact = "--compact" in argv
        return cmd_tokens(argv[1], "<cli>", compact=compact)

    if argv[0] == "tokens":
        if len(argv) < 2:
            print("error: vkf tokens <file>", file=sys.stderr)
            return 1
        compact = "--compact" in argv
        path_arg = next(a for a in argv[1:] if not a.startswith("-"))
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        source = path.read_text(encoding="utf-8")
        return cmd_tokens(source, filename=str(path), compact=compact)

    if argv[0] == "cpp":
        out_path: Path | None = None
        args = argv[1:]
        if not args:
            print("error: vkf cpp <file>", file=sys.stderr)
            return 1
        if "-o" in args:
            oi = args.index("-o")
            if oi + 1 >= len(args):
                print("error: -o requires a path", file=sys.stderr)
                return 1
            out_path = Path(args[oi + 1])
            del args[oi : oi + 2]
        path_arg = next((a for a in args if not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing file path", file=sys.stderr)
            return 1
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        return cmd_cpp(path, out_path)

    if argv[0] == "build":
        out_path: Path | None = None
        args = argv[1:]
        if not args:
            print("error: vkf build <file>", file=sys.stderr)
            return 1
        if "-o" in args:
            oi = args.index("-o")
            if oi + 1 >= len(args):
                print("error: -o requires a path", file=sys.stderr)
                return 1
            out_path = Path(args[oi + 1])
            del args[oi : oi + 2]
        path_arg = next((a for a in args if not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing file path", file=sys.stderr)
            return 1
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        return cmd_build(path, out_path)

    if argv[0] == "bench":
        args = argv[1:]
        list_only = False
        if "--list" in args:
            list_only = True
            args = [a for a in args if a != "--list"]
        known_flags = {
            "--json",
            "--samples",
            "--native-runs",
            "--native-warmups",
            "--save-baseline",
            "--compare-baseline",
        }
        if any(a.startswith("-") and a not in known_flags for a in args):
            bad = next(a for a in args if a.startswith("-"))
            print(f"error: unknown option {bad!r}", file=sys.stderr)
            return 1
        return cmd_bench(args, list_only=list_only)

    # Default: run
    run_args = list(argv)
    use_ui_terminal = False
    if "--ui-terminal" in run_args:
        use_ui_terminal = True
        run_args = [a for a in run_args if a != "--ui-terminal"]
    if not run_args:
        print("error: missing file path", file=sys.stderr)
        return 1
    if len(run_args) != 1:
        extras = ", ".join(repr(a) for a in run_args[1:])
        print(f"error: unexpected argument(s): {extras}", file=sys.stderr)
        return 1

    path_arg = run_args[0]
    if path_arg.startswith("-"):
        print(f"error: unknown option {path_arg!r}", file=sys.stderr)
        return 1

    try:
        path = resolve_vkf_path(path_arg)
    except FileNotFoundError:
        print(
            f"error: file not found: {path_arg!r} "
            f"(tried {path_arg!r} and {Path(path_arg).with_suffix('.vkf')!r})",
            file=sys.stderr,
        )
        return 1

    if use_ui_terminal:
        os.environ["VF_UI_TERMINAL"] = "1"

    return cmd_run(path)


def vkf_entry() -> None:
    """Console script target for ``vkf`` (see ``[project.scripts]`` in ``pyproject.toml``)."""
    raise SystemExit(main())


if __name__ == "__main__":
    raise SystemExit(main())
