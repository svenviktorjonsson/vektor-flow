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
    vkf build-runtime <file>
                             Build parser-only-Python runtime bundle (exe + artifact)
    vkf package-runtime <file>
                             Package runtime bundle directory
                             (exe + artifact + launcher + manifest, or overlay scene bundle for
                              supported native scene sources)
    vkf bench [name ...]     Run curated benchmark examples through interpreter/native paths
    vkf --ui-terminal <file> Run with terminal-attached UI launch behavior
    vkf tokens <file>        Print lexer token stream (diagnostics)
    vkf tokens-native-core <file>
                             Print token stream from the native-core C++ lexer subset
    vkf parse-tokens <file>  Parse a stable token JSON payload and print the AST repr
    vkf parse-native-core <file>
                             Native-core C++ lexer -> token contract -> AST repr
    vkf native-artifact <file>
                             Emit stable lowered program artifact JSON
    vkf -s 'code'           Tokenize an inline snippet
    vkf --help
    vkf --version

``vkf <file>`` lexes, parses, and evaluates the program (emit to stdout, etc.).
"""

from __future__ import annotations

from dataclasses import replace
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import __version__
from .errors import EvalError, LexError, ParseError, VektorFlowError, format_error_diagnostic
from .lexer import tokenize
from .native_frontend import (
    build_native_subset,
    emit_cpp_from_native_subset,
    lex_native_subset_payload,
    parse_native_subset,
)
from .native_program_artifact import emit_native_program_artifact_from_source_file
from .native_runtime_bundle import (
    build_native_runtime_bundle,
    discover_vf_overlay_bundle,
    package_native_runtime_bundle,
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
        print(format_error_diagnostic(exc, source_text=source), file=sys.stderr)
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
        print(format_error_diagnostic(exc, source_text=source), file=sys.stderr)
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
    """Package and launch a native runtime bundle for ``path``."""
    try:
        bundle = _package_native_run_bundle(path)
        _launch_native_run_bundle(bundle)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError) as exc:
        print(format_error_diagnostic(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def cmd_run_python(path: Path) -> int:
    """Parse and execute a ``.vkf`` file through the interpreter."""
    try:
        from .interpreter import run_file

        run_file(path)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError) as exc:
        print(format_error_diagnostic(exc), file=sys.stderr)
        return 1
    return 0


def cmd_parse_tokens(payload: str) -> int:
    try:
        module = parse_token_stream_json(payload)
    except ValueError as exc:
        print(f"error: invalid token stream payload: {exc}", file=sys.stderr)
        return 1
    except ParseError as exc:
        print(format_error_diagnostic(exc), file=sys.stderr)
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
        print(format_error_diagnostic(exc, source_text=source), file=sys.stderr)
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
        print(format_error_diagnostic(exc), file=sys.stderr)
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


def _native_run_root() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "vektor-flow" / "native-runs"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _looks_like_ui_source(path: Path) -> bool:
    source = path.read_text(encoding="utf-8")
    return bool(
        re.search(
            r"(^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*\.ui\b|"
            r"\bui\.(display|widgets|Frame|set_mode)\b|"
            r"\badd_frame\b",
            source,
        )
    )


def _clean_stale_native_run_dirs(root: Path, *, keep: set[Path], max_dirs: int = 8) -> None:
    resolved_keep = {p.resolve() for p in keep}
    candidates = [p for p in root.iterdir() if p.is_dir() and p.resolve() not in resolved_keep]
    for broken in list(candidates):
        overlay_dir = broken / "overlay"
        manifest_path = broken / "runtime-bundle-manifest.json"
        if overlay_dir.is_dir() and (
            not manifest_path.is_file() or not (overlay_dir / "vf-overlay.exe").is_file()
        ):
            shutil.rmtree(broken, ignore_errors=True)
            candidates.remove(broken)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in candidates[max_dirs:]:
        shutil.rmtree(stale, ignore_errors=True)


def _validate_launchable_native_run_bundle(bundle) -> None:
    if bundle.overlay_bundle_dir is not None:
        overlay_dir = bundle.overlay_bundle_dir
        overlay_exe = overlay_dir / "vf-overlay.exe"
        if not overlay_exe.is_file():
            raise FileNotFoundError(f"packaged overlay bundle missing executable: {overlay_exe}")
        if bundle.overlay_page_rel:
            overlay_page = overlay_dir / "web" / Path(bundle.overlay_page_rel)
            if not overlay_page.is_file():
                raise FileNotFoundError(f"packaged overlay bundle missing scene page: {overlay_page}")
    if bundle.executable_path is not None and not bundle.executable_path.is_file():
        raise FileNotFoundError(f"packaged runtime bundle missing executable: {bundle.executable_path}")
    if bundle.overlay_bundle_dir is None and bundle.executable_path is None:
        raise RuntimeError("native bundle produced no launchable binaries")


def _relocate_native_run_bundle(bundle, target: Path):
    source_dir = bundle.bundle_dir

    def relocated(path: Path | None) -> Path | None:
        if path is None:
            return None
        try:
            return target / path.relative_to(source_dir)
        except ValueError:
            return path

    return replace(
        bundle,
        bundle_dir=target,
        executable_path=relocated(bundle.executable_path),
        artifact_path=relocated(bundle.artifact_path),
        launcher_path=relocated(bundle.launcher_path),
        manifest_path=relocated(bundle.manifest_path),
        overlay_bundle_dir=relocated(bundle.overlay_bundle_dir),
        overlay_launcher_path=relocated(bundle.overlay_launcher_path),
    )


def _package_native_run_bundle(path: Path):
    needs_overlay = _looks_like_ui_source(path)
    run_root = _native_run_root()
    _clean_stale_native_run_dirs(run_root, keep=set())
    staging = Path(tempfile.mkdtemp(prefix=f".{path.stem}-staging-", dir=run_root))
    target = run_root / staging.name.replace(f".{path.stem}-staging-", f"{path.stem}-", 1)
    try:
        overlay_dir = discover_vf_overlay_bundle() if needs_overlay else None
        staged_bundle = package_native_runtime_bundle(path, staging, overlay_bundle_dir=overlay_dir)
        _validate_launchable_native_run_bundle(staged_bundle)
        staging.replace(target)
        bundle = _relocate_native_run_bundle(staged_bundle, target)
        _validate_launchable_native_run_bundle(bundle)
        _clean_stale_native_run_dirs(run_root, keep={target})
        return bundle
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(target, ignore_errors=True)
        raise


def _terminate_existing_overlay_processes() -> None:
    if os.name != "nt":
        return
    subprocess.run(
        ["taskkill", "/IM", "vf-overlay.exe", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def _native_launch_popen(args: list[str], *, cwd: str):
    kwargs: dict[str, object] = {"cwd": cwd}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        kwargs["close_fds"] = True
    return subprocess.Popen(args, **kwargs)


def _launch_native_run_bundle(bundle) -> None:
    _validate_launchable_native_run_bundle(bundle)
    launched = 0
    if bundle.overlay_bundle_dir is not None:
        overlay_exe = bundle.overlay_bundle_dir / "vf-overlay.exe"
        _terminate_existing_overlay_processes()
        overlay_args = [str(overlay_exe)]
        if bundle.overlay_page_rel:
            overlay_args.append(bundle.overlay_page_rel)
        overlay_proc = _native_launch_popen(overlay_args, cwd=str(bundle.overlay_bundle_dir))
        launched += 1
        if overlay_proc.poll() not in (None,):
            raise RuntimeError("native overlay exited immediately after launch")
    if bundle.executable_path is not None:
        runtime_exe = bundle.executable_path
        runtime_proc = _native_launch_popen([str(runtime_exe)], cwd=str(bundle.bundle_dir))
        launched += 1
        if runtime_proc.poll() not in (None,):
            raise RuntimeError("native runtime executable exited immediately after launch")
    if launched == 0:
        raise RuntimeError(
            "native bundle produced no launchable binaries; expected overlay scene page or runtime executable"
        )


def cmd_native_artifact(path: Path, out_path: Path | None) -> int:
    try:
        payload = emit_native_program_artifact_from_source_file(path)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError, ValueError) as exc:
        if isinstance(exc, VektorFlowError):
            print(format_error_diagnostic(exc, source_text=source), file=sys.stderr)
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if out_path is not None:
        out_path.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


def cmd_build_runtime(path: Path, out_path: Path | None) -> int:
    try:
        target = out_path.resolve() if out_path is not None else path.with_suffix(".exe").resolve()
        bundle = build_native_runtime_bundle(path, target)
        print(bundle.executable_path)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def cmd_package_runtime(
    path: Path,
    out_path: Path | None,
    *,
    include_overlay: bool = False,
    overlay_bundle_dir: Path | None = None,
) -> int:
    try:
        target = out_path.resolve() if out_path is not None else path.with_name(path.stem + "-runtime-bundle").resolve()
        overlay_dir = overlay_bundle_dir
        if include_overlay and overlay_dir is None:
            overlay_dir = discover_vf_overlay_bundle()
        bundle = package_native_runtime_bundle(path, target, overlay_bundle_dir=overlay_dir)
        print(bundle.bundle_dir)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
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
            "  vkf cpp-native-core <file>\n"
            "                       Emit C++ through the native-core lexer/token-stream frontend\n"
            "  vkf build <file>     Build a standalone native executable for the supported subset\n"
            "  vkf build-native-core <file>\n"
            "                       Build through the native-core lexer/token-stream frontend\n"
            "  vkf build-runtime <file>\n"
            "                       Build parser-only-Python runtime bundle (exe + artifact)\n"
            "  vkf package-runtime <file>\n"
            "                       Package runtime bundle directory\n"
            "                       (exe + artifact + launcher + manifest, or overlay scene bundle\n"
            "                       for supported native scene sources)\n"
            "                       add --with-overlay to include native overlay bundle\n"
            "                       add --overlay-bundle DIR to use an explicit overlay bundle\n"
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
            "  vkf native-artifact <file>\n"
            "                       Emit stable lowered program artifact JSON\n"
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
        return cmd_tokens(argv[1], "<cli>", compact=compact, json_output=False)

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

    if argv[0] == "build-runtime":
        out_path: Path | None = None
        args = argv[1:]
        if not args:
            print("error: vkf build-runtime <file>", file=sys.stderr)
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
        return cmd_build_runtime(path, out_path)

    if argv[0] == "package-runtime":
        out_path: Path | None = None
        overlay_bundle_dir: Path | None = None
        include_overlay = False
        args = argv[1:]
        if not args:
            print("error: vkf package-runtime <file>", file=sys.stderr)
            return 1
        if "-o" in args:
            oi = args.index("-o")
            if oi + 1 >= len(args):
                print("error: -o requires a path", file=sys.stderr)
                return 1
            out_path = Path(args[oi + 1])
            del args[oi : oi + 2]
        if "--with-overlay" in args:
            include_overlay = True
            args.remove("--with-overlay")
        if "--overlay-bundle" in args:
            oi = args.index("--overlay-bundle")
            if oi + 1 >= len(args):
                print("error: --overlay-bundle requires a path", file=sys.stderr)
                return 1
            overlay_bundle_dir = Path(args[oi + 1])
            include_overlay = True
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
        return cmd_package_runtime(
            path,
            out_path,
            include_overlay=include_overlay,
            overlay_bundle_dir=overlay_bundle_dir,
        )

    if argv[0] == "native-artifact":
        out_path: Path | None = None
        args = argv[1:]
        if not args:
            print("error: vkf native-artifact <file>", file=sys.stderr)
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
        return cmd_native_artifact(path, out_path)

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
