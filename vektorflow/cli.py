"""Command-line interface for Vektor Flow.

Usage
-----
    vkf <file>               Run a .vkf file (``a`` → ``a.vkf`` if needed)
    vkf cpp <file>           Emit C++ for the currently supported native subset
    vkf cpp-native-core <file>
                             Emit C++ through the native-core lexer/token-stream frontend
    vkf build <file>         Build a standalone native executable for the supported subset
    vkf build-native-core <file>
                             Build through the native-core lexer/token-stream frontend
    vkf bench [name ...]     Run curated benchmark examples through interpreter/native paths
    vkf --ui-terminal <file> Run with terminal-attached UI launch behavior
    vkf tokens <file>        Print lexer token stream (diagnostics)
    vkf tokens-native-core <file>
                             Print token stream from the native-core C++ lexer subset
    vkf parse-tokens <file>  Parse a stable token JSON payload and print the AST repr
    vkf parse-native-core <file>
                             Native-core C++ lexer -> token contract -> AST repr
    vkf -s 'code'           Tokenize an inline snippet
    vkf -e 'code'           Execute an inline snippet
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
from .native_frontend import (
    build_native_subset,
    emit_cpp_from_native_subset,
    lex_native_subset_payload,
    parse_native_subset,
)
from .parser import parse_token_stream_json
from .token_stream import tokens_from_json, tokens_to_json
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


def cmd_tokens(source: str, filename: str, *, compact: bool, json_output: bool = False) -> int:
    try:
        toks = tokenize(source, filename=filename)
    except VektorFlowError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if json_output:
        print(tokens_to_json(toks))
        return 0

    for t in toks:
        if compact and t.kind in (NEWLINE, INDENT, DEDENT, EOF):
            continue
        print(
            _format_token_line(t.kind, t.value, t.location.line, t.location.column)
        )
    return 0


def cmd_tokens_native_core(
    source: str | None,
    filename: str,
    *,
    compact: bool,
    json_output: bool = False,
    filename_label: str | None = None,
) -> int:
    try:
        payload = lex_native_subset_payload(
            source,
            filename,
            subset="native_core",
            filename_label=filename_label,
        )
    except VektorFlowError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if json_output:
        print(payload, end="" if payload.endswith("\n") else "\n")
        return 0

    try:
        toks = tokens_from_json(payload)
    except ValueError as exc:
        print(f"error: invalid native token stream payload: {exc}", file=sys.stderr)
        return 1

    for t in toks:
        if compact and t.kind in (NEWLINE, INDENT, DEDENT, EOF):
            continue
        print(_format_token_line(t.kind, t.value, t.location.line, t.location.column))
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


def cmd_eval(source: str, *, filename: str = "<cli>") -> int:
    try:
        from .interpreter import Interpreter
        from .parser import parse_module

        module = parse_module(source, filename=filename)
        Interpreter(Path(filename)).run_module(module)
    except (LexError, ParseError, EvalError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def cmd_parse_tokens(payload: str) -> int:
    try:
        module = parse_token_stream_json(payload)
    except ValueError as exc:
        print(f"error: invalid token stream payload: {exc}", file=sys.stderr)
        return 1
    except ParseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(repr(module))
    return 0


def cmd_parse_native_core(source: str | None, filename: str, *, filename_label: str | None = None) -> int:
    try:
        module = parse_native_subset(
            source,
            filename,
            subset="native_core",
            filename_label=filename_label,
        )
    except VektorFlowError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(repr(module))
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


def cmd_cpp_native_core(
    source: str | None,
    filename: str,
    *,
    out_path: Path | None,
    filename_label: str | None = None,
) -> int:
    try:
        cpp_source = emit_cpp_from_native_subset(
            source,
            filename,
            subset="native_core",
            filename_label=filename_label,
        )
    except OSError as exc:
        print(f"error: cannot read {filename}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if out_path is not None:
        out_path.write_text(cpp_source, encoding="utf-8")
    else:
        print(cpp_source, end="")
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


def cmd_build_native_core(
    source: str | None,
    filename: str,
    *,
    out_path: Path | None,
    filename_label: str | None = None,
) -> int:
    try:
        target_base = Path(filename)
        target = out_path.resolve() if out_path is not None else target_base.with_suffix(".exe").resolve()
        built = build_native_subset(
            source,
            filename,
            out_path=target,
            subset="native_core",
            filename_label=filename_label,
        )
        print(built)
    except OSError as exc:
        print(f"error: cannot read {filename}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError, ValueError) as exc:
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
            "usage: vkf <file> | vkf cpp <file> | vkf bench [name ...] | vkf tokens <file> | vkf -s <snippet> | vkf -e <snippet>\n"
            "       (omit .vkf: `vkf hello` finds `hello.vkf`)",
            file=sys.stderr,
        )
        return 0

    if argv[0] in ("-h", "--help"):
        print(
            "Vektor Flow — vkf\n\n"
            "  vkf <file>           Run a .vkf file (extension optional)\n"
            "  vkf cpp <file>       Emit C++ for the supported native subset\n"
            "  vkf cpp-native-core <file>\n"
            "                       Emit C++ through the native-core lexer/token-stream frontend\n"
            "  vkf build <file>     Build a standalone native executable for the supported subset\n"
            "  vkf build-native-core <file>\n"
            "                       Build through the native-core lexer/token-stream frontend\n"
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
            "                       add --json for a stable token-stream payload\n"
            "  vkf tokens-native-core <file>\n"
            "                       Print tokens from the native-core C++ lexer subset\n"
            "                       add --json for a stable token-stream payload\n"
            "  vkf parse-tokens <file>\n"
            "                       Parse a stable token JSON payload and print the AST repr\n"
            "  vkf parse-native-core <file>\n"
            "                       Native-core C++ lexer -> token contract -> AST repr\n"
            "  vkf -s/--source STR  Tokenize a snippet\n"
            "  vkf -e/--eval STR    Execute a snippet\n"
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
        return cmd_tokens(argv[1], "<cli>", compact=compact, json_output=False)

    if argv[0] in ("-e", "--eval"):
        if len(argv) < 2:
            print("error: -e requires a snippet", file=sys.stderr)
            return 1
        return cmd_eval(argv[1], filename="<cli>")

    if argv[0] == "tokens":
        if len(argv) < 2:
            print("error: vkf tokens <file>", file=sys.stderr)
            return 1
        compact = "--compact" in argv
        json_output = "--json" in argv
        path_arg = next(a for a in argv[1:] if not a.startswith("-"))
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        source = path.read_text(encoding="utf-8")
        return cmd_tokens(source, filename=str(path), compact=compact, json_output=json_output)

    if argv[0] == "tokens-native-core":
        if len(argv) < 2:
            print("error: vkf tokens-native-core <file|->", file=sys.stderr)
            return 1
        compact = "--compact" in argv
        json_output = "--json" in argv
        path_arg = next((a for a in argv[1:] if a == "-" or not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing file path", file=sys.stderr)
            return 1
        if path_arg == "-":
            return cmd_tokens_native_core(
                sys.stdin.read(),
                "<stdin>",
                compact=compact,
                json_output=json_output,
                filename_label="<stdin>",
            )
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        return cmd_tokens_native_core(
            None,
            str(path),
            compact=compact,
            json_output=json_output,
            filename_label=path.as_posix(),
        )

    if argv[0] == "parse-tokens":
        if len(argv) < 2:
            print("error: vkf parse-tokens <file|->", file=sys.stderr)
            return 1
        path_arg = next((a for a in argv[1:] if a == "-" or not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing token payload path", file=sys.stderr)
            return 1
        if path_arg == "-":
            payload = sys.stdin.read()
            return cmd_parse_tokens(payload)
        path = Path(path_arg)
        try:
            payload = path.read_text(encoding="utf-8")
        except OSError as exc:
            print(f"error: cannot read {path}: {exc}", file=sys.stderr)
            return 1
        return cmd_parse_tokens(payload)

    if argv[0] == "parse-native-core":
        if len(argv) < 2:
            print("error: vkf parse-native-core <file|->", file=sys.stderr)
            return 1
        path_arg = next((a for a in argv[1:] if a == "-" or not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing file path", file=sys.stderr)
            return 1
        if path_arg == "-":
            return cmd_parse_native_core(
                sys.stdin.read(),
                "<stdin>",
                filename_label="<stdin>",
            )
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        return cmd_parse_native_core(
            None,
            str(path),
            filename_label=path.as_posix(),
        )

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

    if argv[0] == "cpp-native-core":
        out_path: Path | None = None
        args = argv[1:]
        if not args:
            print("error: vkf cpp-native-core <file|->", file=sys.stderr)
            return 1
        if "-o" in args:
            oi = args.index("-o")
            if oi + 1 >= len(args):
                print("error: -o requires a path", file=sys.stderr)
                return 1
            out_path = Path(args[oi + 1])
            del args[oi : oi + 2]
        path_arg = next((a for a in args if a == "-" or not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing file path", file=sys.stderr)
            return 1
        if path_arg == "-":
            return cmd_cpp_native_core(
                sys.stdin.read(),
                "<stdin>",
                out_path=out_path,
                filename_label="<stdin>",
            )
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        return cmd_cpp_native_core(
            None,
            str(path),
            out_path=out_path,
            filename_label=path.as_posix(),
        )

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

    if argv[0] == "build-native-core":
        out_path: Path | None = None
        args = argv[1:]
        if not args:
            print("error: vkf build-native-core <file|->", file=sys.stderr)
            return 1
        if "-o" in args:
            oi = args.index("-o")
            if oi + 1 >= len(args):
                print("error: -o requires a path", file=sys.stderr)
                return 1
            out_path = Path(args[oi + 1])
            del args[oi : oi + 2]
        path_arg = next((a for a in args if a == "-" or not a.startswith("-")), None)
        if path_arg is None:
            print("error: missing file path", file=sys.stderr)
            return 1
        if path_arg == "-":
            if out_path is None:
                print("error: vkf build-native-core - requires -o <path>", file=sys.stderr)
                return 1
            return cmd_build_native_core(
                sys.stdin.read(),
                str(out_path),
                out_path=out_path,
                filename_label="<stdin>",
            )
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        return cmd_build_native_core(
            None,
            str(path),
            out_path=out_path,
            filename_label=path.as_posix(),
        )

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
