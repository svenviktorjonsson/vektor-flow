from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import ast, ir
from .cpp_dynamic import (
    DynamicEmitHooks,
    cpp_dynamic_value_supported,
    emit_dynamic_any as _dyn_emit_dynamic_any,
    emit_linked_list_concat as _dyn_emit_linked_list_concat,
    emit_map_attr_access as _dyn_emit_map_attr_access,
    emit_linked_list_coercion as _dyn_emit_linked_list_coercion,
    emit_linked_list_literal as _dyn_emit_linked_list_literal,
    emit_map_coercion as _dyn_emit_map_coercion,
    emit_map_literal as _dyn_emit_map_literal,
    require_cpp_dynamic_value_supported,
)
from .native_intrinsics import NativeIntrinsic, intrinsic_uses_array_stats, intrinsic_uses_array_sum, intrinsic_uses_file_io, resolve_native_intrinsic
from .optimize_ir import eliminate_noop_coercions, optimize_module
from .slot_ir import lower_slots
from .typed_ir import SYMBOLIC_STDLIB_EXPORTS, StdlibFunctionType, StdlibNamespaceType, TypedIRError, annotate_module, TypedModuleInfo


class CppEmitError(Exception):
    pass


LARGE_FIXED_VECTOR_HEAP_THRESHOLD = 65536
SYMBOLIC_MATH_INTRINSIC_NAMES = frozenset({"sin", "cos", "tan", "sec", "cot", "csc", "exp", "ln", "sqrt"})
SYMBOLIC_STAT_RANGE_NAMES = frozenset({"sum", "mean", "median"})


@dataclass(frozen=True)
class CppCompiler:
    kind: str
    path: str


@dataclass(frozen=True)
class CppGeneratedArtifactSpec:
    artifact: str
    path: Path


@dataclass(frozen=True)
class CppGeneratedArtifactFamilyView:
    emitted_cpp: CppGeneratedArtifactSpec
    entry_executable: CppGeneratedArtifactSpec


@dataclass(frozen=True)
class CppBuildCommandSpec:
    executable: str
    flags: tuple[str, ...]
    inputs: tuple[CppGeneratedArtifactSpec, ...]
    outputs: tuple[CppGeneratedArtifactSpec, ...]
    cwd: Path

    @property
    def argv(self) -> tuple[str, ...]:
        return (
            self.executable,
            *self.flags,
            *(str(spec.path) for spec in self.inputs),
            "-o",
            *(str(spec.path) for spec in self.outputs),
        )

    @property
    def args(self) -> tuple[str, ...]:
        return self.argv[1:]


@dataclass(frozen=True)
class CppEmissionSurfaceView:
    source_text: str


@dataclass(frozen=True)
class CppBuildSurfaceView:
    compiler: CppCompiler
    emission: CppEmissionSurfaceView
    generated: CppGeneratedArtifactFamilyView
    compile_command: CppBuildCommandSpec

    @property
    def cpp_path(self) -> Path:
        return self.generated.emitted_cpp.path

    @property
    def executable_path(self) -> Path:
        return self.generated.entry_executable.path

    @property
    def compile_argv(self) -> tuple[str, ...]:
        return self.compile_command.argv


@dataclass(frozen=True)
class NativePackageSpec:
    package_dir: Path
    package_name: str
    entrypoint: str
    subset: str
    source_input: str
    source_label: str
    kind: str = "vektorflow-native-package"
    manifest_name: str = "vektorflow-package.json"
    readme_name: str = "README.txt"
    build_host_python_required: bool = False
    runtime_python_required: bool = False


@dataclass(frozen=True)
class NativePackageResult:
    package_dir: Path
    cpp_path: Path
    executable_path: Path
    manifest_path: Path
    readme_path: Path
    run_bat_path: Path
    run_ps1_path: Path
    run_sh_path: Path
    smoke_bat_path: Path
    smoke_ps1_path: Path
    smoke_sh_path: Path
    compiler: CppCompiler
    manifest: dict[str, Any]

    def package_view(self) -> NativePackageSurfaceView:
        return load_native_package(self.package_dir)

    def manifest_view(self) -> NativePackageManifestView:
        return NativePackageManifestView(
            package_dir=self.package_dir,
            manifest_path=self.manifest_path,
            data=self.manifest,
        )

    @property
    def codegen(self) -> NativePackageCodegenView:
        return self.manifest_view().codegen_view()

    @property
    def artifacts(self) -> NativePackageArtifactSurfaceView:
        return self.manifest_view().artifact_surface_view()

    @property
    def contracts(self) -> NativePackageContractSurfaceView:
        return self.manifest_view().contract_surface_view()


@dataclass(frozen=True)
class NativePackageMode:
    name: str
    subset: str
    entrypoint: str
    build_host_python_required: bool = False


@dataclass(frozen=True)
class NativePackageSource:
    filename: str
    source_input: str
    source_label: str
    package_name: str


@dataclass(frozen=True)
class NativePackageLayout:
    manifest_name: str = "vektorflow-package.json"
    readme_name: str = "README.txt"
    run_bat_name: str = "run.bat"
    run_ps1_name: str = "run.ps1"
    run_sh_name: str = "run.sh"
    smoke_bat_name: str = "smoke-test.bat"
    smoke_ps1_name: str = "smoke-test.ps1"
    smoke_sh_name: str = "smoke-test.sh"


@dataclass(frozen=True)
class NativePackageRunnableSpec:
    artifact: str
    argv: tuple[str, ...]
    path: Path


@dataclass(frozen=True)
class NativePackageRunnableFamilyView:
    preferred: NativePackageRunnableSpec
    fallbacks: tuple[NativePackageRunnableSpec, ...]
    executable_name: str | None = None
    executable_path: Path | None = None


@dataclass(frozen=True)
class NativePackageInstallFamilyView:
    preferred_artifacts: tuple[str, ...]
    preferred_commands: tuple[tuple[str, ...], ...]
    artifacts: tuple[str, ...]
    commands: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class NativePackageExecutionFamilyView:
    preferred: NativePackageRunnableSpec
    fallbacks: tuple[NativePackageRunnableSpec, ...]
    install: NativePackageInstallFamilyView
    target_executable: NativePackageGeneratedArtifactSpec | None = None


@dataclass(frozen=True)
class NativePackageEntrySurfaceView:
    kind: str
    platform: str
    execution: NativePackageExecutionFamilyView
    support_artifact: NativePackageSupportArtifactSpec


@dataclass(frozen=True)
class NativePackageGeneratedArtifactSpec:
    artifact: str
    path: Path


@dataclass(frozen=True)
class NativePackageGeneratedArtifactFamilyView:
    emitted_cpp: NativePackageGeneratedArtifactSpec
    entry_executable: NativePackageGeneratedArtifactSpec
    launch_targets: dict[str, NativePackageGeneratedArtifactSpec]

    def launch_target_for(self, platform: str) -> NativePackageGeneratedArtifactSpec:
        return self.launch_targets[platform]


@dataclass(frozen=True)
class NativePackageBuildCommandSpec:
    executable: str
    flags: tuple[str, ...]
    inputs: tuple[NativePackageGeneratedArtifactSpec, ...]
    outputs: tuple[NativePackageGeneratedArtifactSpec, ...]
    cwd: Path

    @property
    def argv(self) -> tuple[str, ...]:
        return (
            self.executable,
            *self.flags,
            *(str(spec.path.name) for spec in self.inputs),
            "-o",
            *(str(spec.path.name) for spec in self.outputs),
        )

    @property
    def args(self) -> tuple[str, ...]:
        return self.argv[1:]


@dataclass(frozen=True)
class NativePackageCodegenView:
    compiler: CppCompiler
    generated: NativePackageGeneratedArtifactFamilyView
    compile_command: NativePackageBuildCommandSpec

    @property
    def emitted_cpp_path(self) -> Path:
        return self.generated.emitted_cpp.path

    @property
    def entry_executable_path(self) -> Path:
        return self.generated.entry_executable.path

    @property
    def compile_argv(self) -> tuple[str, ...]:
        return self.compile_command.argv

    def launch_executable_path(self, platform: str) -> Path:
        return self.generated.launch_target_for(platform).path


@dataclass(frozen=True)
class NativePackageSupportArtifactSpec:
    artifact: str
    path: Path


@dataclass(frozen=True)
class NativePackageSupportArtifactFamilyView:
    artifacts: dict[str, NativePackageSupportArtifactSpec]

    def artifact_for(self, platform: str) -> NativePackageSupportArtifactSpec:
        return self.artifacts[platform]


@dataclass(frozen=True)
class NativePackageArtifactSurfaceView:
    manifest_path: Path
    readme_path: Path
    launchers: NativePackageSupportArtifactFamilyView
    smoke_tests: NativePackageSupportArtifactFamilyView


@dataclass(frozen=True)
class NativePackageContractSurfaceView:
    subset: str
    entrypoint: str
    source_input: str
    source_label: str
    python_required_to_build: bool
    python_required_to_run: bool
    codegen: NativePackageCodegenView
    artifacts: NativePackageArtifactSurfaceView
    launch_entries: dict[str, NativePackageEntrySurfaceView]
    smoke_test_entries: dict[str, NativePackageEntrySurfaceView]

    def launch_entry(self, platform: str) -> NativePackageEntrySurfaceView:
        return self.launch_entries[platform]

    def smoke_test_entry(self, platform: str) -> NativePackageEntrySurfaceView:
        return self.smoke_test_entries[platform]


@dataclass(frozen=True)
class NativePackageSurfaceView:
    package_dir: Path
    manifest: NativePackageManifestView

    @property
    def manifest_path(self) -> Path:
        return self.manifest.manifest_path

    @property
    def readme_path(self) -> Path:
        return self.package_dir / "README.txt"

    @property
    def cpp_path(self) -> Path:
        return self.codegen.emitted_cpp_path

    @property
    def executable_path(self) -> Path:
        return self.codegen.entry_executable_path

    @property
    def compiler_kind(self) -> str:
        return self.codegen.compiler.kind

    @property
    def compiler_path(self) -> str:
        return self.codegen.compiler.path

    @property
    def codegen(self) -> NativePackageCodegenView:
        return self.manifest.codegen_view()

    @property
    def build(self) -> NativePackageCodegenView:
        return self.codegen

    def launch_family(self, platform: str) -> NativePackageRunnableFamilyView:
        return self.manifest.runnable_family("launch", platform)

    def smoke_test_family(self, platform: str) -> NativePackageRunnableFamilyView:
        return self.manifest.runnable_family("smoke_test", platform)

    def launch_install_family(self, platform: str) -> NativePackageInstallFamilyView:
        return self.manifest.install_family("launch", platform)

    def smoke_test_install_family(self, platform: str) -> NativePackageInstallFamilyView:
        return self.manifest.install_family("smoke_test", platform)

    def execution_family(self, kind: str, platform: str) -> NativePackageExecutionFamilyView:
        return self.manifest.execution_family(kind, platform)

    def launch_execution_family(self, platform: str) -> NativePackageExecutionFamilyView:
        return self.execution_family("launch", platform)

    def smoke_test_execution_family(self, platform: str) -> NativePackageExecutionFamilyView:
        return self.execution_family("smoke_test", platform)

    def entry_surface(self, kind: str, platform: str) -> NativePackageEntrySurfaceView:
        return self.manifest.entry_surface(kind, platform)

    def launch_entry_surface(self, platform: str) -> NativePackageEntrySurfaceView:
        return self.entry_surface("launch", platform)

    def smoke_test_entry_surface(self, platform: str) -> NativePackageEntrySurfaceView:
        return self.entry_surface("smoke_test", platform)

    @property
    def artifacts(self) -> NativePackageArtifactSurfaceView:
        return self.manifest.artifact_surface_view()

    @property
    def contracts(self) -> NativePackageContractSurfaceView:
        return self.manifest.contract_surface_view()


@dataclass(frozen=True)
class NativePackageManifestView:
    package_dir: Path
    manifest_path: Path
    data: dict[str, Any]

    @property
    def subset(self) -> str:
        return str(self.data["subset"])

    @property
    def entrypoint(self) -> str:
        return str(self.data["entrypoint"])

    @property
    def source_input(self) -> str:
        return str(self.data["source"]["input"])

    @property
    def source_label(self) -> str:
        return str(self.data["source"]["label"])

    @property
    def executable_name(self) -> str:
        return str(self.data["artifacts"]["executable"])

    @property
    def python_required_to_build(self) -> bool:
        return bool(self.data["runnable_contract"]["python_required_to_build"])

    @property
    def python_required_to_run(self) -> bool:
        return bool(self.data["runnable_contract"]["python_required_to_run"])

    @property
    def entry_executable_name(self) -> str:
        return str(self.data["runnable_contract"]["entry_executable"])

    def executable_path(self) -> Path:
        return self.package_dir / self.executable_name

    def _runtime_platform(self, platform: str) -> str:
        if platform == "windows_powershell":
            return "windows"
        return platform

    def support_artifact_family(self, kind: str) -> NativePackageSupportArtifactFamilyView:
        return NativePackageSupportArtifactFamilyView(
            artifacts={
                str(platform): NativePackageSupportArtifactSpec(
                    artifact=str(name),
                    path=self.package_dir / str(name),
                )
                for platform, name in self.data["artifacts"][kind].items()
            }
        )

    def artifact_surface_view(self) -> NativePackageArtifactSurfaceView:
        return NativePackageArtifactSurfaceView(
            manifest_path=self.manifest_path,
            readme_path=self.package_dir / "README.txt",
            launchers=self.support_artifact_family("launchers"),
            smoke_tests=self.support_artifact_family("smoke_tests"),
        )

    def contract_surface_view(self) -> NativePackageContractSurfaceView:
        artifacts = self.artifact_surface_view()
        launch_entries = {
            platform: self.entry_surface("launch", platform)
            for platform in artifacts.launchers.artifacts
        }
        smoke_test_entries = {
            platform: self.entry_surface("smoke_test", platform)
            for platform in artifacts.smoke_tests.artifacts
        }
        return NativePackageContractSurfaceView(
            subset=self.subset,
            entrypoint=self.entrypoint,
            source_input=self.source_input,
            source_label=self.source_label,
            python_required_to_build=self.python_required_to_build,
            python_required_to_run=self.python_required_to_run,
            codegen=self.codegen_view(),
            artifacts=artifacts,
            launch_entries=launch_entries,
            smoke_test_entries=smoke_test_entries,
        )

    def codegen_view(self) -> NativePackageCodegenView:
        codegen = self.data["codegen_contract"]
        compiler = CppCompiler(
            kind=str(codegen["compiler"]["kind"]),
            path=str(codegen["compiler"]["path"]),
        )
        generated = NativePackageGeneratedArtifactFamilyView(
            emitted_cpp=NativePackageGeneratedArtifactSpec(
                artifact=str(codegen["emitted_cpp"]),
                path=self.package_dir / str(codegen["emitted_cpp"]),
            ),
            entry_executable=NativePackageGeneratedArtifactSpec(
                artifact=str(codegen["entry_executable"]),
                path=self.package_dir / str(codegen["entry_executable"]),
            ),
            launch_targets={
                str(platform): NativePackageGeneratedArtifactSpec(
                    artifact=str(path),
                    path=self.package_dir / str(path),
                )
                for platform, path in codegen["launch_executables"].items()
            },
        )
        compile = codegen["compile"]
        return NativePackageCodegenView(
            compiler=compiler,
            generated=generated,
            compile_command=NativePackageBuildCommandSpec(
                executable=str(compile["executable"]),
                flags=tuple(str(flag) for flag in compile["flags"]),
                inputs=tuple(
                    NativePackageGeneratedArtifactSpec(
                        artifact=str(artifact),
                        path=self.package_dir / str(artifact),
                    )
                    for artifact in compile["inputs"]
                ),
                outputs=tuple(
                    NativePackageGeneratedArtifactSpec(
                        artifact=str(artifact),
                        path=self.package_dir / str(artifact),
                    )
                    for artifact in compile["outputs"]
                ),
                cwd=self.package_dir,
            ),
        )

    def artifact_path(self, family: str, platform: str) -> Path:
        return self.package_dir / str(self.data["artifacts"][family][platform])

    def launch_executable_name(self, platform: str) -> str:
        return str(self.data["runnable_contract"]["launch"]["executables"][self._runtime_platform(platform)])

    def launch_executable_path(self, platform: str) -> Path:
        return self.package_dir / self.launch_executable_name(platform)

    def preferred_runnable(self, kind: str, platform: str) -> tuple[str, list[str]]:
        entry = self.data["runnable_contract"][kind]["preferred"][self._runtime_platform(platform)]
        return str(entry["artifact"]), list(entry["argv"])

    def fallback_runnables(self, kind: str, platform: str) -> list[tuple[str, list[str]]]:
        entries = self.data["runnable_contract"][kind]["fallbacks"][self._runtime_platform(platform)]
        return [(str(entry["artifact"]), list(entry["argv"])) for entry in entries]

    def preferred_runnable_spec(self, kind: str, platform: str) -> NativePackageRunnableSpec:
        artifact, argv = self.preferred_runnable(kind, platform)
        return NativePackageRunnableSpec(
            artifact=artifact,
            argv=tuple(argv),
            path=self.package_dir / artifact,
        )

    def fallback_runnable_specs(self, kind: str, platform: str) -> list[NativePackageRunnableSpec]:
        return [
            NativePackageRunnableSpec(
                artifact=artifact,
                argv=tuple(argv),
                path=self.package_dir / artifact,
            )
            for artifact, argv in self.fallback_runnables(kind, platform)
        ]

    def runnable_family(self, kind: str, platform: str) -> NativePackageRunnableFamilyView:
        executable_name: str | None = None
        executable_path: Path | None = None
        if kind == "launch":
            executable_name = self.launch_executable_name(platform)
            executable_path = self.launch_executable_path(platform)
        return NativePackageRunnableFamilyView(
            preferred=self.preferred_runnable_spec(kind, platform),
            fallbacks=tuple(self.fallback_runnable_specs(kind, platform)),
            executable_name=executable_name,
            executable_path=executable_path,
        )

    def execution_family(self, kind: str, platform: str) -> NativePackageExecutionFamilyView:
        runtime_platform = self._runtime_platform(platform)
        runnable = self.runnable_family(kind, platform)
        target_executable: NativePackageGeneratedArtifactSpec | None = None
        if kind == "launch":
            target_executable = self.codegen_view().generated.launch_target_for(runtime_platform)
        return NativePackageExecutionFamilyView(
            preferred=runnable.preferred,
            fallbacks=runnable.fallbacks,
            install=self.install_family(kind, platform),
            target_executable=target_executable,
        )

    def entry_surface(self, kind: str, platform: str) -> NativePackageEntrySurfaceView:
        support_family_name = "launchers" if kind == "launch" else "smoke_tests"
        return NativePackageEntrySurfaceView(
            kind=kind,
            platform=platform,
            execution=self.execution_family(kind, platform),
            support_artifact=self.support_artifact_family(support_family_name).artifact_for(platform),
        )

    def install_family(self, kind: str, platform: str) -> NativePackageInstallFamilyView:
        runtime_platform = self._runtime_platform(platform)
        install = self.data["install"]
        preferred_artifacts = tuple(str(value) for value in install["preferred"][kind][runtime_platform])
        preferred_commands = tuple(
            tuple(str(part) for part in command)
            for command in [install["preferred_commands"][kind][runtime_platform]]
        )
        artifacts = tuple(str(value) for value in install[kind][runtime_platform])
        commands = tuple(
            tuple(str(part) for part in command)
            for command in install["commands"][kind][runtime_platform]
        )
        return NativePackageInstallFamilyView(
            preferred_artifacts=preferred_artifacts,
            preferred_commands=preferred_commands,
            artifacts=artifacts,
            commands=commands,
        )

    def preferred_command(self, kind: str, platform: str) -> list[str]:
        return list(self.preferred_runnable_spec(kind, platform).argv)

    def fallback_commands(self, kind: str, platform: str) -> list[list[str]]:
        return [list(spec.argv) for spec in self.fallback_runnable_specs(kind, platform)]

    def preferred_artifact(self, kind: str, platform: str) -> str:
        return self.preferred_runnable_spec(kind, platform).artifact

    def fallback_artifacts(self, kind: str, platform: str) -> list[str]:
        return [spec.artifact for spec in self.fallback_runnable_specs(kind, platform)]


@dataclass
class EmitState:
    struct_defs: dict[str, ast.TypeExpr]
    current_name_map: dict[str, str] | None
    match_counter: int

    def __init__(self) -> None:
        self.struct_defs = {}
        self.current_name_map = None
        self.match_counter = 0


@dataclass(frozen=True)
class PreparedNativeModule:
    module: ir.Module
    typed: TypedModuleInfo
    functions: dict[str, ir.FunctionDef]


@dataclass(frozen=True)
class RuntimeFeatures:
    uses_arrays: bool = False
    uses_fixed_arrays: bool = False
    uses_heap_vectors: bool = False
    uses_array_sum: bool = False
    uses_multisets: bool = False
    uses_dynamic: bool = False
    uses_match: bool = False
    uses_value_format: bool = False
    uses_fixed_array_format: bool = False
    uses_heap_vector_format: bool = False
    uses_array_stats: bool = False
    uses_file_io: bool = False


CPP_STD_CONFLICT_NAMES: set[str] = {"advance"}
REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class ArrayReducePattern:
    vector_name: str
    index_name: str
    acc_name: str
    bound_expr: str


def _annotate_or_raise(module: ir.Module) -> TypedModuleInfo:
    try:
        return annotate_module(module)
    except TypedIRError as exc:
        raise CppEmitError(str(exc)) from exc


def _prepare_native_module(module: ir.Module) -> PreparedNativeModule:
    module = optimize_module(module)
    typed = _annotate_or_raise(module)
    module = lower_slots(module, typed)
    typed = _annotate_or_raise(module)
    module = eliminate_noop_coercions(module, typed)
    typed = _annotate_or_raise(module)
    functions = {stmt.name: stmt for stmt in module.statements if isinstance(stmt, ir.FunctionDef)}
    return PreparedNativeModule(module=module, typed=typed, functions=functions)


def _collect_runtime_features(module: ir.Module, typed: TypedModuleInfo) -> RuntimeFeatures:
    uses_arrays = False
    uses_fixed_arrays = False
    uses_heap_vectors = False
    uses_array_sum = False
    uses_multisets = False
    uses_dynamic = False
    uses_match = False
    uses_value_format = False
    uses_fixed_array_format = False
    uses_heap_vector_format = False
    uses_array_stats = False
    uses_file_io = False

    def require_value_format_for_type(t: Any) -> None:
        nonlocal uses_value_format, uses_fixed_array_format, uses_heap_vector_format
        t = _normalize_type(t)
        if isinstance(t, ast.FixedVectorType):
            uses_value_format = True
            if _fixed_vector_uses_heap(t):
                uses_heap_vector_format = True
            else:
                uses_fixed_array_format = True
            require_value_format_for_type(t.element_type)
            return
        if isinstance(t, ast.TypeExpr):
            uses_value_format = True
            for _, inner in t.fields:
                require_value_format_for_type(inner)
            return
        if isinstance(t, (ast.MultisetType, ast.MapValueType, ast.LinkedListValueType)):
            uses_value_format = True

    def visit_type(t: Any) -> None:
        nonlocal uses_arrays, uses_fixed_arrays, uses_heap_vectors, uses_multisets, uses_dynamic
        t = _normalize_type(t)
        if isinstance(t, ast.FixedVectorType):
            uses_arrays = True
            if _fixed_vector_uses_heap(t):
                uses_heap_vectors = True
            else:
                uses_fixed_arrays = True
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MultisetType):
            uses_multisets = True
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MapValueType):
            uses_dynamic = True
            for _, inner in t.fields:
                visit_type(inner)
            return
        if isinstance(t, ast.LinkedListValueType):
            uses_dynamic = True
            for inner in t.elements:
                visit_type(inner)
            return
        if isinstance(t, ast.TypeExpr):
            require_value_format_for_type(t)
            for _, inner in t.fields:
                visit_type(inner)
            return
        if isinstance(t, ast.TupleTypeExpr):
            for inner in t.elements:
                visit_type(inner)
            return
        if isinstance(t, ast.FuncType):
            visit_type(t.domain)
            visit_type(t.codomain)

    def visit_expr(expr: Any) -> None:
        nonlocal uses_arrays, uses_array_sum, uses_array_stats, uses_file_io
        if isinstance(expr, ir.CallExpr):
            intrinsic = resolve_native_intrinsic(expr.func)
            if intrinsic is not None:
                if intrinsic_uses_array_sum(intrinsic):
                    uses_arrays = True
                    uses_array_sum = True
                if intrinsic_uses_array_stats(intrinsic):
                    uses_arrays = True
                    uses_array_sum = True
                    uses_array_stats = True
                if intrinsic_uses_file_io(intrinsic):
                    uses_file_io = True
            visit_expr(expr.func)
            for arg in expr.args:
                visit_expr(arg)
            return
        if isinstance(expr, ir.CoerceExpr):
            visit_expr(expr.expr)
            return
        if isinstance(expr, ir.BindExpr):
            visit_expr(expr.target)
            visit_expr(expr.value)
            return
        if isinstance(expr, ir.AttrExpr):
            visit_expr(expr.value)
            return
        if isinstance(expr, ir.IndexExpr):
            visit_expr(expr.value)
            for idx in expr.indices:
                visit_expr(idx)
            return
        if isinstance(expr, ir.UnaryExpr):
            visit_expr(expr.operand)
            return
        if isinstance(expr, ir.BinaryExpr):
            visit_expr(expr.left)
            visit_expr(expr.right)
            return
        if isinstance(expr, ir.ListExpr):
            for elem in expr.elements:
                visit_expr(elem)
            return
        if isinstance(expr, ir.MapExpr):
            for _, value in expr.fields:
                visit_expr(value)
            return
        if isinstance(expr, ir.LinkedListExpr):
            for elem in expr.elements:
                visit_expr(elem)
            if expr.spread is not None:
                visit_expr(expr.spread)
            return
        if isinstance(expr, ir.MultisetExpr):
            for value, count in expr.pairs:
                visit_expr(value)
                visit_expr(count)
            return
        if isinstance(expr, ir.StructExpr):
            for _, value in expr.fields:
                visit_expr(value)
            return

    def visit_stmt(stmt: Any) -> None:
        nonlocal uses_match, uses_value_format, uses_fixed_array_format, uses_heap_vector_format
        if isinstance(stmt, ir.TypeDef):
            visit_type(stmt.type_expr)
            return
        if isinstance(stmt, ir.FunctionDef):
            for ptype in stmt.param_types:
                if ptype is not None:
                    visit_type(ptype)
            if stmt.return_type is not None:
                visit_type(stmt.return_type)
            visit_block(stmt.body)
        elif isinstance(stmt, (ir.StoreName, ir.StoreSlot)):
            visit_expr(stmt.value)
        elif isinstance(stmt, ir.IfStmt):
            visit_expr(stmt.condition)
            visit_block(stmt.body)
        elif isinstance(stmt, ir.WhileStmt):
            visit_expr(stmt.condition)
            visit_block(stmt.body)
        elif isinstance(stmt, ir.MatchStmt):
            uses_match = True
            visit_expr(stmt.discriminant)
            for arm in stmt.arms:
                if arm.condition is not None:
                    visit_expr(arm.condition)
                visit_block(arm.body)
        elif isinstance(stmt, ir.PrintStmt):
            visit_expr(stmt.value)
            require_value_format_for_type(typed.expr_types.get(id(stmt.value)))
        elif isinstance(stmt, ir.ExprStmt):
            visit_expr(stmt.expr)
        elif isinstance(stmt, ir.ReturnStmt):
            if stmt.value is not None:
                visit_expr(stmt.value)

    def visit_block(block: ir.Block) -> None:
        for inner in block.statements:
            visit_stmt(inner)

    for expr_type in typed.expr_types.values():
        visit_type(expr_type)
    for stmt in module.statements:
        visit_stmt(stmt)
    return RuntimeFeatures(
        uses_arrays=uses_arrays,
        uses_fixed_arrays=uses_fixed_arrays,
        uses_heap_vectors=uses_heap_vectors,
        uses_array_sum=uses_array_sum,
        uses_multisets=uses_multisets,
        uses_dynamic=uses_dynamic,
        uses_match=uses_match,
        uses_value_format=uses_value_format,
        uses_fixed_array_format=uses_fixed_array_format,
        uses_heap_vector_format=uses_heap_vector_format,
        uses_array_stats=uses_array_stats,
        uses_file_io=uses_file_io,
    )


def _emit_runtime_headers(features: RuntimeFeatures) -> list[str]:
    headers = [
        "#include <cmath>",
        "#include <complex>",
        "#include <cstdio>",
        "#include <cctype>",
        "#include <iostream>",
        "#include <numeric>",
        "#include <stdexcept>",
        "#include <string>",
        "#include <vector>",
    ]
    if features.uses_value_format or features.uses_dynamic:
        headers.insert(0, "#include <sstream>")
    if features.uses_fixed_arrays:
        headers.insert(0, "#include <array>")
    if features.uses_multisets or features.uses_dynamic:
        headers.insert(0, "#include <map>")
    if features.uses_dynamic:
        headers.insert(0, "#include <list>")
        headers.insert(0, "#include <any>")
    if features.uses_multisets or features.uses_array_stats:
        headers.insert(0, "#include <algorithm>")
    if features.uses_file_io:
        headers.insert(0, "#include <fstream>")
    headers.append("")
    return headers


def _emit_symbolic_runtime_support() -> list[str]:
    return [
        '#include "compiler/native/vkf_symbolic.hpp"',
    ]


def _emit_runtime_support(features: RuntimeFeatures) -> list[str]:
    lines = [
        "static std::string vf_format_num(double v) {",
        "    if (std::floor(v) == v) {",
        "        return std::to_string(static_cast<long long>(v));",
        "    }",
        "    char buf[64];",
        "    int n = std::snprintf(buf, sizeof(buf), \"%.15g\", v);",
        "    if (n < 0 || static_cast<std::size_t>(n) >= sizeof(buf)) throw std::runtime_error(\"number formatting failed\");",
        "    return std::string(buf, static_cast<std::size_t>(n));",
        "}",
        "static std::string vf_format_num(const std::complex<double>& v) {",
        "    if (v.imag() == 0.0) return vf_format_num(v.real());",
        "    if (v.real() == 0.0) {",
        "        if (v.imag() == 1.0) return \"i\";",
        "        if (v.imag() == -1.0) return \"-i\";",
        "        return vf_format_num(v.imag()) + std::string(\"i\");",
        "    }",
        "    std::string imag = std::abs(v.imag()) == 1.0 ? std::string(\"i\") : vf_format_num(std::abs(v.imag())) + std::string(\"i\");",
        "    return vf_format_num(v.real()) + (v.imag() >= 0.0 ? \"+\" : \"-\") + imag;",
        "}",
        "struct vf_rational {",
        "    long long n;",
        "    long long d;",
        "};",
        "static vf_rational vf_make_rational(long long n, long long d) {",
        "    if (d == 0) throw std::runtime_error(\"rational denominator must not be 0\");",
        "    if (d < 0) { n = -n; d = -d; }",
        "    long long g = std::gcd(n < 0 ? -n : n, d);",
        "    return vf_rational{n / g, d / g};",
        "}",
        "static vf_rational vf_to_rational(const vf_rational& v) { return v; }",
        "static vf_rational vf_to_rational(long long v) { return vf_make_rational(v, 1); }",
        "static vf_rational vf_to_rational(int v) { return vf_make_rational(static_cast<long long>(v), 1); }",
        "static vf_rational vf_to_rational(bool v) { return vf_make_rational(v ? 1LL : 0LL, 1); }",
        "static vf_rational vf_to_rational(double v) {",
        "    if (std::floor(v) != v) throw std::runtime_error(\"rational: num cast requires an integer-valued real number\");",
        "    return vf_make_rational(static_cast<long long>(v), 1);",
        "}",
        "static vf_rational vf_to_rational(const std::complex<double>& v) {",
        "    if (v.imag() != 0.0) throw std::runtime_error(\"rational: num cast requires a real number\");",
        "    return vf_to_rational(v.real());",
        "}",
        "static vf_rational operator+(const vf_rational& a, const vf_rational& b) { return vf_make_rational(a.n * b.d + b.n * a.d, a.d * b.d); }",
        "static vf_rational operator-(const vf_rational& a, const vf_rational& b) { return vf_make_rational(a.n * b.d - b.n * a.d, a.d * b.d); }",
        "static vf_rational operator-(const vf_rational& a) { return vf_make_rational(-a.n, a.d); }",
        "static vf_rational operator*(const vf_rational& a, const vf_rational& b) { return vf_make_rational(a.n * b.n, a.d * b.d); }",
        "static vf_rational operator/(const vf_rational& a, const vf_rational& b) { return vf_make_rational(a.n * b.d, a.d * b.n); }",
        "static bool operator==(const vf_rational& a, const vf_rational& b) { return a.n == b.n && a.d == b.d; }",
        "static bool operator!=(const vf_rational& a, const vf_rational& b) { return !(a == b); }",
        "static bool operator<(const vf_rational& a, const vf_rational& b) { return a.n * b.d < b.n * a.d; }",
        "static bool operator<=(const vf_rational& a, const vf_rational& b) { return (a < b) || (a == b); }",
        "static bool operator>(const vf_rational& a, const vf_rational& b) { return b < a; }",
        "static bool operator>=(const vf_rational& a, const vf_rational& b) { return (b < a) || (a == b); }",
        "static std::string vf_format_rational(const vf_rational& v) {",
        "    if (v.d == 1) return std::to_string(v.n);",
        "    return std::to_string(v.n) + std::string(\"/\") + std::to_string(v.d);",
        "}",
        "static std::complex<double> vf_to_num(const vf_rational& v) { return std::complex<double>(static_cast<double>(v.n) / static_cast<double>(v.d), 0.0); }",
        *_emit_symbolic_runtime_support(),
    ]
    if features.uses_value_format:
        lines.extend(
            [
                "template <typename T>",
                "static std::string vf_format_value(const T& v) {",
                "    std::ostringstream oss;",
                "    oss << v;",
                "    return oss.str();",
                "}",
                "template <>",
                "inline std::string vf_format_value<bool>(const bool& v) {",
                '    return v ? "true" : "false";',
                "}",
                "template <>",
                "inline std::string vf_format_value<double>(const double& v) {",
                "    return vf_format_num(v);",
                "}",
                "template <>",
                "inline std::string vf_format_value<std::complex<double>>(const std::complex<double>& v) {",
                "    return vf_format_num(v);",
                "}",
                "template <>",
                "inline std::string vf_format_value<vf_rational>(const vf_rational& v) {",
                "    return vf_format_rational(v);",
                "}",
                "template <>",
                "inline std::string vf_format_value<vf_symbolic>(const vf_symbolic& v) {",
                "    return vf_format_symbolic(v);",
                "}",
            ]
        )
    if features.uses_file_io:
        lines.extend(
            [
                "static std::string vf_read_file_bytes(const std::string& path) {",
                "    std::ifstream in(path, std::ios::binary);",
                "    if (!in) {",
                '        throw std::runtime_error("io.read_bytes failed to open: " + path);',
                "    }",
                "    std::ostringstream oss;",
                "    oss << in.rdbuf();",
                "    return oss.str();",
                "}",
                "static std::string vf_read_file_text(const std::string& path) {",
                "    return vf_read_file_bytes(path);",
                "}",
            ]
        )
    if features.uses_match:
        lines.extend(
            [
                "template <typename A, typename B>",
                "static int vf_match_specificity(const A& a, const B& b) {",
                "    return (a == b) ? 0 : -1;",
                "}",
                "static int vf_match_specificity(const long long& exact_code, const long long& pattern_code) {",
                "    const long long base_mask = 0xFFFLL;",
                "    const long long frame_shift = 12LL;",
                "    const long long frame_mask = 0x3FFLL;",
                "    const long long widget_shift = 22LL;",
                "    const long long widget_mask = 0xFFLL;",
                "    const long long mode_shift = 30LL;",
                "    const long long mode_mask = 0x3LL;",
                "    const long long mode_exact = 0LL;",
                "    const long long mode_ui = 1LL;",
                "    const long long mode_frame = 2LL;",
                "    const long long mode_widget = 3LL;",
                "    if (exact_code == pattern_code) return 3;",
                "    const long long pmode = (pattern_code >> mode_shift) & mode_mask;",
                "    if (pmode == mode_exact) return exact_code == pattern_code ? 3 : -1;",
                "    if (pmode == mode_ui) return ((exact_code & base_mask) == (pattern_code & base_mask)) ? 0 : -1;",
                "    if (pmode == mode_frame) {",
                "        const long long em = exact_code & (base_mask | (frame_mask << frame_shift));",
                "        const long long pm = pattern_code & (base_mask | (frame_mask << frame_shift));",
                "        return em == pm ? 1 : -1;",
                "    }",
                "    if (pmode == mode_widget) {",
                "        const long long em = exact_code & (base_mask | (widget_mask << widget_shift));",
                "        const long long pm = pattern_code & (base_mask | (widget_mask << widget_shift));",
                "        return em == pm ? 2 : -1;",
                "    }",
                "    return -1;",
                "}",
            ]
        )
    if features.uses_fixed_array_format:
        lines.extend(
            [
                "template <typename T, std::size_t N>",
                "static std::string vf_format_value(const std::array<T, N>& v) {",
                "    std::ostringstream oss;",
                '    oss << "[";',
                "    auto emit_one = [&](std::size_t i) {",
                '        if (i) oss << ", ";',
                "        oss << vf_format_value(v[i]);",
                "    };",
                "    if constexpr (N <= 24) {",
                "        for (std::size_t i = 0; i < N; ++i) emit_one(i);",
                "    } else {",
                "        for (std::size_t i = 0; i < 3; ++i) emit_one(i);",
                '        oss << ", ...";',
                "        for (std::size_t i = N - 3; i < N; ++i) emit_one(i);",
                "    }",
                '    oss << "]";',
                "    return oss.str();",
                "}",
            ]
        )
    if features.uses_heap_vector_format:
        lines.extend(
            [
                "template <typename T>",
                "static std::string vf_format_value(const std::vector<T>& v) {",
                "    std::ostringstream oss;",
                '    oss << "[";',
                "    auto emit_one = [&](std::size_t i) {",
                '        if (i) oss << ", ";',
                "        oss << vf_format_value(v[i]);",
                "    };",
                "    if (v.size() <= 24) {",
                "        for (std::size_t i = 0; i < v.size(); ++i) emit_one(i);",
                "    } else {",
                "        for (std::size_t i = 0; i < 3; ++i) emit_one(i);",
                '        oss << ", ...";',
                "        for (std::size_t i = v.size() - 3; i < v.size(); ++i) emit_one(i);",
                "    }",
                '    oss << "]";',
                "    return oss.str();",
                "}",
            ]
        )
    if features.uses_multisets:
        lines.extend(
            [
                "template <typename T>",
                "static std::string vf_format_value(const std::map<T, long long>& v) {",
                "    std::ostringstream oss;",
                '    oss << "{";',
                "    bool first = true;",
                "    for (const auto& kv : v) {",
                '        if (!first) oss << ", ";',
                "        first = false;",
                '        oss << vf_format_value(kv.first) << ":" << kv.second;',
                "    }",
                '    oss << "}";',
                "    return oss.str();",
                "}",
            ]
        )
    if features.uses_dynamic:
        lines.extend(
            [
                "static std::string vf_format_any(const std::any& v);",
                "static std::string vf_format_value(const std::map<std::string, std::any>& v) {",
                "    std::ostringstream oss;",
                '    oss << "{";',
                "    bool first = true;",
                "    for (const auto& kv : v) {",
                '        if (!first) oss << ", ";',
                "        first = false;",
                '        oss << kv.first << ":" << vf_format_any(kv.second);',
                "    }",
                '    oss << "}";',
                "    return oss.str();",
                "}",
                "static std::string vf_format_value(const std::list<std::any>& v) {",
                "    std::ostringstream oss;",
                '    oss << "[";',
                "    bool first = true;",
                "    for (const auto& item : v) {",
                '        if (!first) oss << ", ";',
                "        first = false;",
                "        oss << vf_format_any(item);",
                "    }",
                '    oss << "]";',
                "    return oss.str();",
                "}",
                "static std::string vf_format_any(const std::any& v) {",
                "    if (v.type() == typeid(bool)) return vf_format_value(std::any_cast<bool>(v));",
                "    if (v.type() == typeid(long long)) return vf_format_value(std::any_cast<long long>(v));",
                "    if (v.type() == typeid(double)) return vf_format_value(std::any_cast<double>(v));",
                "    if (v.type() == typeid(std::string)) return vf_format_value(std::any_cast<std::string>(v));",
                "    if (v.type() == typeid(std::map<std::string, std::any>)) return vf_format_value(std::any_cast<const std::map<std::string, std::any>&>(v));",
                "    if (v.type() == typeid(std::list<std::any>)) return vf_format_value(std::any_cast<const std::list<std::any>&>(v));",
                "    throw std::runtime_error(\"unsupported dynamic value type\");",
                "}",
            ]
        )
    lines.extend(
        [
            "static std::complex<double> vf_to_num(const std::complex<double>& v) { return v; }",
            "static std::complex<double> vf_to_num(double v) { return std::complex<double>(v, 0.0); }",
            "static std::complex<double> vf_to_num(int v) { return std::complex<double>(static_cast<double>(v), 0.0); }",
            "static std::complex<double> vf_to_num(long long v) { return std::complex<double>(static_cast<double>(v), 0.0); }",
            "static std::complex<double> vf_to_num(bool v) { return std::complex<double>(v ? 1.0 : 0.0, 0.0); }",
            "static double vf_to_real(double v) { return v; }",
            "static double vf_to_real(int v) { return static_cast<double>(v); }",
            "static double vf_to_real(long long v) { return static_cast<double>(v); }",
            "static double vf_to_real(bool v) { return v ? 1.0 : 0.0; }",
            "static double vf_to_real(const vf_rational& v) { return static_cast<double>(v.n) / static_cast<double>(v.d); }",
            "static double vf_to_real(const std::complex<double>& v) {",
            "    if (v.imag() != 0.0) throw std::runtime_error(\"real-valued operation received complex num\");",
            "    return v.real();",
            "}",
            "static long long vf_to_int(int v) { return static_cast<long long>(v); }",
            "static long long vf_to_int(long long v) { return v; }",
            "static long long vf_to_int(bool v) { return v ? 1LL : 0LL; }",
            "static long long vf_to_int(const std::complex<double>& v) {",
            "    if (v.imag() != 0.0 || std::floor(v.real()) != v.real()) throw std::runtime_error(\"int: explicit cast from num requires a real integer-valued number\");",
            "    return static_cast<long long>(v.real());",
            "}",
            "static long long vf_to_int(double v) {",
            "    if (std::floor(v) != v) throw std::runtime_error(\"int cast requires integer-valued number\");",
            "    return static_cast<long long>(v);",
            "}",
            "static bool vf_to_bool(bool v) { return v; }",
            "static bool vf_to_bool(const std::complex<double>& v) { return v.real() != 0.0 || v.imag() != 0.0; }",
            "static std::string vf_to_str(const std::string& v) { return v; }",
            "static std::string vf_to_str(const std::complex<double>& v) { return vf_format_num(v); }",
            "static bool vf_num_lt(const std::complex<double>& a, const std::complex<double>& b) {",
            "    if (a.imag() != 0.0 || b.imag() != 0.0) throw std::runtime_error(\"ordering is only defined for real num values\");",
            "    return a.real() < b.real();",
            "}",
            "static bool vf_num_le(const std::complex<double>& a, const std::complex<double>& b) { return vf_num_lt(a, b) || a == b; }",
            "static bool vf_num_gt(const std::complex<double>& a, const std::complex<double>& b) { return vf_num_lt(b, a); }",
            "static bool vf_num_ge(const std::complex<double>& a, const std::complex<double>& b) { return vf_num_gt(a, b) || a == b; }",
        ]
    )
    if features.uses_fixed_arrays:
        lines.extend(
            [
                "template <typename T, std::size_t N, typename U>",
                "static std::array<T, N> vf_array_cast(const std::array<U, N>& src) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) {",
                "        out[i] = static_cast<T>(src[i]);",
                "    }",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_iota(const T& start, const T& step) {",
                "    std::array<T, N> out{};",
                "    T cur = start;",
                "    for (std::size_t i = 0; i < N; ++i) {",
                "        out[i] = cur;",
                "        cur = static_cast<T>(cur + step);",
                "    }",
                "    return out;",
                "}",
                "template <typename T, std::size_t A, std::size_t B>",
                "static std::array<T, A + B> vf_array_cat(const std::array<T, A>& left, const std::array<T, B>& right) {",
                "    std::array<T, A + B> out{};",
                "    for (std::size_t i = 0; i < A; ++i) out[i] = left[i];",
                "    for (std::size_t i = 0; i < B; ++i) out[A + i] = right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_add(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] + right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_sub(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] - right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_mul(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] * right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_div(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] / right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N, typename S>",
                "static std::array<T, N> vf_array_scale(const std::array<T, N>& arr, const S& scalar) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = arr[i] * static_cast<T>(scalar);",
                "    return out;",
                "}",
            ]
        )
    if features.uses_array_sum and features.uses_fixed_arrays:
        lines.extend(
            [
                "template <typename T, std::size_t N>",
                "static T vf_array_sum(const std::array<T, N>& arr) {",
                "    T out{};",
                "    for (std::size_t i = 0; i < N; ++i) out += arr[i];",
                "    return out;",
                "}",
            ]
        )
    if features.uses_heap_vectors:
        lines.extend(
            [
                "template <typename T>",
                "static std::vector<T> vf_vector_iota(const T& start, const T& step, std::size_t n) {",
                "    std::vector<T> out;",
                "    out.resize(n);",
                "    T cur = start;",
                "    for (std::size_t i = 0; i < n; ++i) {",
                "        out[i] = cur;",
                "        cur = static_cast<T>(cur + step);",
                "    }",
                "    return out;",
                "}",
            ]
        )
    if features.uses_array_sum and features.uses_heap_vectors:
        lines.extend(
            [
                "template <typename T>",
                "static T vf_array_sum(const std::vector<T>& arr) {",
                "    T out{};",
                "    for (std::size_t i = 0; i < arr.size(); ++i) out += arr[i];",
                "    return out;",
                "}",
            ]
        )
    if features.uses_array_stats:
        lines.extend(
            [
                "template <typename T, std::size_t N>",
                "static T vf_array_min(const std::array<T, N>& arr) {",
                "    T out = arr[0];",
                "    for (std::size_t i = 1; i < N; ++i) if (vf_to_real(arr[i]) < vf_to_real(out)) out = arr[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static T vf_array_max(const std::array<T, N>& arr) {",
                "    T out = arr[0];",
                "    for (std::size_t i = 1; i < N; ++i) if (vf_to_real(arr[i]) > vf_to_real(out)) out = arr[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static double vf_array_variance(const std::array<T, N>& arr) {",
                "    double mu = vf_to_real(vf_array_sum(arr)) / static_cast<double>(N);",
                "    double out = 0.0;",
                "    for (std::size_t i = 0; i < N; ++i) {",
                "        double d = vf_to_real(arr[i]) - mu;",
                "        out += d * d;",
                "    }",
                "    return out / static_cast<double>(N);",
                "}",
                "template <typename T, std::size_t N>",
                "static double vf_array_std(const std::array<T, N>& arr) {",
                "    return std::sqrt(vf_array_variance(arr));",
                "}",
                "template <typename T, std::size_t N>",
                "static double vf_array_percentile(const std::array<T, N>& arr, double p) {",
                "    if (!(0.0 <= p && p <= 100.0)) throw std::runtime_error(\"stat.percentile: p must be in [0, 100]\");",
                "    std::array<double, N> sorted{};",
                "    for (std::size_t i = 0; i < N; ++i) sorted[i] = vf_to_real(arr[i]);",
                "    std::sort(sorted.begin(), sorted.end());",
                "    if constexpr (N == 1) return sorted[0];",
                "    double idx = (p / 100.0) * static_cast<double>(N - 1);",
                "    std::size_t lo = static_cast<std::size_t>(idx);",
                "    std::size_t hi = lo + 1;",
                "    if (hi >= N) return sorted[N - 1];",
                "    double frac = idx - static_cast<double>(lo);",
                "    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);",
                "}",
                "template <typename T, std::size_t N>",
                "static double vf_array_median(const std::array<T, N>& arr) {",
                "    return vf_array_percentile(arr, 50.0);",
                "}",
                "template <typename T, std::size_t N>",
                "static double vf_array_iqr(const std::array<T, N>& arr) {",
                "    return vf_array_percentile(arr, 75.0) - vf_array_percentile(arr, 25.0);",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<double, N> vf_array_zscore(const std::array<T, N>& arr) {",
                "    std::array<double, N> out{};",
                "    double s = vf_array_std(arr);",
                "    if (s == 0.0) return out;",
                "    double mu = vf_to_real(vf_array_sum(arr)) / static_cast<double>(N);",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = (vf_to_real(arr[i]) - mu) / s;",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<double, N> vf_array_normalize(const std::array<T, N>& arr) {",
                "    std::array<double, N> out{};",
                "    double lo = vf_to_real(vf_array_min(arr));",
                "    double hi = vf_to_real(vf_array_max(arr));",
                "    if (hi == lo) return out;",
                "    double span = hi - lo;",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = (vf_to_real(arr[i]) - lo) / span;",
                "    return out;",
                "}",
                "template <typename TX, typename TY, std::size_t N>",
                "static double vf_array_covariance(const std::array<TX, N>& xs, const std::array<TY, N>& ys) {",
                "    double mu_x = vf_to_real(vf_array_sum(xs)) / static_cast<double>(N);",
                "    double mu_y = vf_to_real(vf_array_sum(ys)) / static_cast<double>(N);",
                "    double out = 0.0;",
                "    for (std::size_t i = 0; i < N; ++i) out += (vf_to_real(xs[i]) - mu_x) * (vf_to_real(ys[i]) - mu_y);",
                "    return out / static_cast<double>(N);",
                "}",
                "template <typename TX, typename TY, std::size_t N>",
                "static double vf_array_correlation(const std::array<TX, N>& xs, const std::array<TY, N>& ys) {",
                "    double sx = vf_array_std(xs);",
                "    double sy = vf_array_std(ys);",
                "    if (sx == 0.0 || sy == 0.0) return 0.0;",
                "    return vf_array_covariance(xs, ys) / (sx * sy);",
                "}",
            ]
        )
    if features.uses_multisets:
        lines.extend(
            [
                "template <typename T>",
                "static std::map<T, long long> vf_mset_make(std::initializer_list<std::pair<T, long long>> items) {",
                "    std::map<T, long long> out;",
                "    for (const auto& kv : items) {",
                "        if (kv.second > 0) out[kv.first] += kv.second;",
                "    }",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_union(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out = left;",
                "    for (const auto& kv : right) out[kv.first] += kv.second;",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_difference(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out = left;",
                "    for (const auto& kv : right) {",
                "        auto it = out.find(kv.first);",
                "        if (it == out.end()) continue;",
                "        it->second -= kv.second;",
                "        if (it->second <= 0) out.erase(it);",
                "    }",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_floor_div(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out;",
                "    for (const auto& kv : left) {",
                "        auto it = right.find(kv.first);",
                "        if (it == right.end()) continue;",
                "        if (it->second <= 0) continue;",
                "        long long count = kv.second / it->second;",
                "        if (count > 0) out[kv.first] = count;",
                "    }",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_mod(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out;",
                "    for (const auto& kv : left) {",
                "        auto it = right.find(kv.first);",
                "        if (it == right.end()) continue;",
                "        if (it->second <= 0) continue;",
                "        long long count = kv.second % it->second;",
                "        if (count > 0) out[kv.first] = count;",
                "    }",
                "    return out;",
                "}",
            ]
        )
    if features.uses_dynamic:
        lines.extend(
            [
                "static std::map<std::string, std::any> vf_map_make(std::initializer_list<std::pair<std::string, std::any>> items) {",
                "    std::map<std::string, std::any> out;",
                "    for (const auto& kv : items) out.emplace(kv.first, kv.second);",
                "    return out;",
                "}",
                "static std::list<std::any> vf_list_make(std::initializer_list<std::any> items) {",
                "    return std::list<std::any>(items.begin(), items.end());",
                "}",
                "template <typename T, std::size_t N>",
                "static std::list<std::any> vf_list_from_array(const std::array<T, N>& src) {",
                "    std::list<std::any> out;",
                "    for (const auto& item : src) out.emplace_back(item);",
                "    return out;",
                "}",
                "static std::list<std::any> vf_list_cat(const std::list<std::any>& left, const std::list<std::any>& right) {",
                "    std::list<std::any> out = left;",
                "    out.insert(out.end(), right.begin(), right.end());",
                "    return out;",
                "}",
            ]
        )
    lines.append("")
    return lines


def discover_cpp_compiler() -> CppCompiler | None:
    for name in ("clang++", "g++", "cl"):
        path = shutil.which(name)
        if path:
            return CppCompiler(name, path)
    fallback_candidates = (
        ("clang++", Path(r"C:\Program Files\LLVM\bin\clang++.exe")),
        ("clang++", Path(r"C:\Program Files (x86)\LLVM\bin\clang++.exe")),
    )
    for kind, path in fallback_candidates:
        if path.is_file():
            return CppCompiler(kind, str(path))
    return None


def cpp_compile_flags(compiler: CppCompiler) -> list[str]:
    if compiler.kind == "cl":
        raise CppEmitError("cl.exe is not yet supported by the automated compiler runner")
    flags = ["-std=c++20", "-O3", "-I", str(REPO_ROOT)]
    if compiler.kind in {"clang++", "g++"}:
        flags.append("-march=native")
    return flags


def _compile_artifact_stem(exe_name: str, max_length: int = 48) -> str:
    stem = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in exe_name).strip("._-")
    if not stem:
        stem = "vf_program"
    if len(stem) <= max_length:
        return stem
    digest = hashlib.sha1(stem.encode("utf-8")).hexdigest()[:10]
    keep = max_length - len(digest) - 1
    return f"{stem[:keep]}-{digest}"


def planned_cpp_artifacts(out_dir: Path, exe_name: str = "vf_program") -> tuple[CppCompiler, Path, Path]:
    compiler = discover_cpp_compiler()
    if compiler is None:
        raise CppEmitError("no C++ compiler found on PATH")
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact_stem = _compile_artifact_stem(exe_name)
    cpp_path = out_dir / f"{artifact_stem}.cpp"
    exe_path = out_dir / (f"{artifact_stem}.exe" if compiler.kind == "cl" else artifact_stem)
    return compiler, cpp_path, exe_path


def planned_cpp_build_view(out_dir: Path, exe_name: str = "vf_program") -> CppBuildSurfaceView:
    compiler, cpp_path, exe_path = planned_cpp_artifacts(out_dir, exe_name=exe_name)
    emitted_cpp = CppGeneratedArtifactSpec(artifact=cpp_path.name, path=cpp_path)
    entry_executable = CppGeneratedArtifactSpec(artifact=exe_path.name, path=exe_path)
    return CppBuildSurfaceView(
        compiler=compiler,
        emission=CppEmissionSurfaceView(source_text=""),
        generated=CppGeneratedArtifactFamilyView(
            emitted_cpp=emitted_cpp,
            entry_executable=entry_executable,
        ),
        compile_command=CppBuildCommandSpec(
            executable=compiler.path,
            flags=tuple(cpp_compile_flags(compiler)),
            inputs=(emitted_cpp,),
            outputs=(entry_executable,),
            cwd=out_dir,
        ),
    )


def native_package_compile_argv(compiler: CppCompiler, cpp_path: Path, exe_path: Path) -> tuple[str, ...]:
    return (
        compiler.path,
        *cpp_compile_flags(compiler),
        str(cpp_path),
        "-o",
        str(exe_path),
    )


def default_package_name(filename: str) -> str:
    path = Path(filename)
    stem = path.stem if path.suffix else path.name
    return stem or "vf_program"


def package_mode(name: str) -> NativePackageMode:
    if name in {"native_core", "package-native-core"}:
        return NativePackageMode(
            name="native_core",
            subset="native_core",
            entrypoint="package-native-core",
            build_host_python_required=False,
        )
    if name in {"supported_native", "package"}:
        return NativePackageMode(
            name="supported_native",
            subset="supported_native",
            entrypoint="package",
            build_host_python_required=False,
        )
    raise CppEmitError(f"unknown package mode: {name}")


def resolve_package_source(path_arg: str, *, resolved_path: Path | None = None) -> NativePackageSource:
    if path_arg == "-":
        return NativePackageSource(
            filename="<stdin>",
            source_input="<stdin>",
            source_label="<stdin>",
            package_name="stdin",
        )
    if resolved_path is None:
        resolved_path = Path(path_arg)
    canonical = resolved_path.as_posix()
    return NativePackageSource(
        filename=str(resolved_path),
        source_input=canonical,
        source_label=canonical,
        package_name=default_package_name(str(resolved_path)),
    )


def package_layout() -> NativePackageLayout:
    return NativePackageLayout()


def _native_package_readme_text(
    spec: NativePackageSpec,
    executable_name: str,
    cpp_name: str,
    layout: NativePackageLayout,
) -> str:
    return (
        f"Vektor Flow native package: {spec.package_name}\n\n"
        "Contents:\n"
        f"- {executable_name}: standalone executable\n"
        f"- {cpp_name}: emitted C++ used to build the executable\n"
        f"- {layout.manifest_name}: package metadata\n"
        f"- {layout.run_bat_name}: Windows launcher\n"
        f"- {layout.run_ps1_name}: Windows PowerShell launcher\n"
        f"- {layout.run_sh_name}: POSIX launcher\n"
        f"- {layout.smoke_bat_name}: Windows smoke test\n"
        f"- {layout.smoke_ps1_name}: Windows PowerShell smoke test\n"
        f"- {layout.smoke_sh_name}: POSIX smoke test\n\n"
        "Launchers:\n"
        f"- {layout.run_bat_name}: Windows launcher for the packaged executable\n"
        f"- {layout.run_ps1_name}: preferred Windows PowerShell launcher\n"
        f"- {layout.run_sh_name}: POSIX launcher for the packaged executable\n\n"
        "Smoke tests:\n"
        f"- {layout.smoke_bat_name}: runs the packaged program and checks it exits cleanly\n"
        f"- {layout.smoke_ps1_name}: preferred Windows PowerShell smoke test\n"
        f"- {layout.smoke_sh_name}: runs the packaged program and checks it exits cleanly\n\n"
        "Runtime contract:\n"
        "- Python is not required to execute the built program.\n"
        "- This package contract is Python-free to build and run by default.\n"
    )


def _native_package_run_bat_text(executable_name: str) -> str:
    return (
        "@echo off\r\n"
        "setlocal\r\n"
        "set SCRIPT_DIR=%~dp0\r\n"
        f"\"%SCRIPT_DIR%{executable_name}\" %*\r\n"
    )


def _native_package_run_sh_text(executable_name: str) -> str:
    return (
        "#!/usr/bin/env sh\n"
        "set -eu\n"
        "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\n"
        f"\"$SCRIPT_DIR/{executable_name}\" \"$@\"\n"
    )


def _native_package_run_ps1_text(executable_name: str) -> str:
    return (
        "$ErrorActionPreference = 'Stop'\n"
        "$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path\n"
        f"& (Join-Path $scriptDir '{executable_name}') @args\n"
        "exit $LASTEXITCODE\n"
    )


def _native_package_launch_targets(package_dir: Path, built_path: Path, package_name: str) -> tuple[str, str]:
    posix_target = built_path.name
    windows_target = built_path.name if built_path.suffix.lower() == ".exe" else f"{package_name}.exe"
    if windows_target != built_path.name:
        shutil.copyfile(built_path, package_dir / windows_target)
    return windows_target, posix_target


def _native_package_smoke_bat_text(layout: NativePackageLayout) -> str:
    return (
        "@echo off\r\n"
        "setlocal\r\n"
        "call \"%~dp0"
        f"{layout.run_bat_name}"
        "\" %*\r\n"
        "if errorlevel 1 exit /b %errorlevel%\r\n"
    )


def _native_package_smoke_sh_text(layout: NativePackageLayout) -> str:
    return (
        "#!/usr/bin/env sh\n"
        "set -eu\n"
        "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\n"
        f"\"$SCRIPT_DIR/{layout.run_sh_name}\" \"$@\"\n"
    )


def _native_package_smoke_ps1_text(layout: NativePackageLayout) -> str:
    return (
        "$ErrorActionPreference = 'Stop'\n"
        "$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path\n"
        f"& (Join-Path $scriptDir '{layout.run_ps1_name}') @args\n"
        "exit $LASTEXITCODE\n"
    )


def _native_package_runnable_contract(
    executable_name: str,
    windows_target: str,
    posix_target: str,
    layout: NativePackageLayout,
    *,
    python_required_to_build: bool,
    python_required_to_run: bool,
) -> dict[str, Any]:
    launch_windows_ps1 = ["powershell", "-ExecutionPolicy", "Bypass", "-File", layout.run_ps1_name]
    launch_windows_bat = ["cmd", "/c", layout.run_bat_name]
    launch_posix = ["sh", f"./{layout.run_sh_name}"]
    smoke_windows_ps1 = ["powershell", "-ExecutionPolicy", "Bypass", "-File", layout.smoke_ps1_name]
    smoke_windows_bat = ["cmd", "/c", layout.smoke_bat_name]
    smoke_posix = ["sh", f"./{layout.smoke_sh_name}"]
    return {
        "python_required_to_build": python_required_to_build,
        "python_required_to_run": python_required_to_run,
        "default_entrypoint": "vkf.exe" if not python_required_to_build else executable_name,
        "entry_executable": executable_name,
        "launch": {
            "executables": {
                "windows": windows_target,
                "posix": posix_target,
            },
            "preferred": {
                "windows": {
                    "artifact": layout.run_ps1_name,
                    "argv": launch_windows_ps1,
                },
                "posix": {
                    "artifact": layout.run_sh_name,
                    "argv": launch_posix,
                },
            },
            "fallbacks": {
                "windows": [
                    {
                        "artifact": layout.run_ps1_name,
                        "argv": launch_windows_ps1,
                    },
                    {
                        "artifact": layout.run_bat_name,
                        "argv": launch_windows_bat,
                    },
                ],
                "posix": [
                    {
                        "artifact": layout.run_sh_name,
                        "argv": launch_posix,
                    }
                ],
            },
        },
        "smoke_test": {
            "preferred": {
                "windows": {
                    "artifact": layout.smoke_ps1_name,
                    "argv": smoke_windows_ps1,
                },
                "posix": {
                    "artifact": layout.smoke_sh_name,
                    "argv": smoke_posix,
                },
            },
            "fallbacks": {
                "windows": [
                    {
                        "artifact": layout.smoke_ps1_name,
                        "argv": smoke_windows_ps1,
                    },
                    {
                        "artifact": layout.smoke_bat_name,
                        "argv": smoke_windows_bat,
                    },
                ],
                "posix": [
                    {
                        "artifact": layout.smoke_sh_name,
                        "argv": smoke_posix,
                    }
                ],
            },
        },
    }


def _native_package_runtime_contract_from_runnable(runnable_contract: dict[str, Any]) -> dict[str, Any]:
    launch_windows_fallbacks = runnable_contract["launch"]["fallbacks"]["windows"]
    smoke_windows_fallbacks = runnable_contract["smoke_test"]["fallbacks"]["windows"]
    launch_posix_fallbacks = runnable_contract["launch"]["fallbacks"]["posix"]
    smoke_posix_fallbacks = runnable_contract["smoke_test"]["fallbacks"]["posix"]
    return {
        "python_required_to_build": runnable_contract["python_required_to_build"],
        "python_required_to_run": runnable_contract["python_required_to_run"],
        "default_entrypoint": runnable_contract["default_entrypoint"],
        "entry_executable": runnable_contract["entry_executable"],
        "launch_executables": runnable_contract["launch"]["executables"],
        "preferred_launchers": {
            "windows": runnable_contract["launch"]["preferred"]["windows"]["artifact"],
            "posix": runnable_contract["launch"]["preferred"]["posix"]["artifact"],
        },
        "launchers": {
            "windows": launch_windows_fallbacks[1]["artifact"],
            "windows_powershell": launch_windows_fallbacks[0]["artifact"],
            "posix": launch_posix_fallbacks[0]["artifact"],
        },
        "preferred_smoke_tests": {
            "windows": runnable_contract["smoke_test"]["preferred"]["windows"]["artifact"],
            "posix": runnable_contract["smoke_test"]["preferred"]["posix"]["artifact"],
        },
        "smoke_tests": {
            "windows": smoke_windows_fallbacks[1]["artifact"],
            "windows_powershell": smoke_windows_fallbacks[0]["artifact"],
            "posix": smoke_posix_fallbacks[0]["artifact"],
        },
    }


def _native_package_install_contract_from_runnable(runnable_contract: dict[str, Any]) -> dict[str, Any]:
    launch_windows_fallbacks = runnable_contract["launch"]["fallbacks"]["windows"]
    smoke_windows_fallbacks = runnable_contract["smoke_test"]["fallbacks"]["windows"]
    launch_posix_fallbacks = runnable_contract["launch"]["fallbacks"]["posix"]
    smoke_posix_fallbacks = runnable_contract["smoke_test"]["fallbacks"]["posix"]
    return {
        "preferred": {
            "launch": {
                "windows": [runnable_contract["launch"]["preferred"]["windows"]["artifact"]],
                "posix": [f"./{runnable_contract['launch']['preferred']['posix']['artifact']}"],
            },
            "smoke_test": {
                "windows": [runnable_contract["smoke_test"]["preferred"]["windows"]["artifact"]],
                "posix": [f"./{runnable_contract['smoke_test']['preferred']['posix']['artifact']}"],
            },
        },
        "preferred_commands": {
            "launch": {
                "windows": runnable_contract["launch"]["preferred"]["windows"]["argv"],
                "posix": runnable_contract["launch"]["preferred"]["posix"]["argv"],
            },
            "smoke_test": {
                "windows": runnable_contract["smoke_test"]["preferred"]["windows"]["argv"],
                "posix": runnable_contract["smoke_test"]["preferred"]["posix"]["argv"],
            },
        },
        "commands": {
            "launch": {
                "windows": [entry["argv"] for entry in launch_windows_fallbacks],
                "posix": [entry["argv"] for entry in launch_posix_fallbacks],
            },
            "smoke_test": {
                "windows": [entry["argv"] for entry in smoke_windows_fallbacks],
                "posix": [entry["argv"] for entry in smoke_posix_fallbacks],
            },
        },
        "launch": {
            "windows": [entry["artifact"] for entry in launch_windows_fallbacks],
            "posix": [f"./{entry['artifact']}" for entry in launch_posix_fallbacks],
        },
        "smoke_test": {
            "windows": [entry["artifact"] for entry in smoke_windows_fallbacks],
            "posix": [f"./{entry['artifact']}" for entry in smoke_posix_fallbacks],
        },
    }


def _native_supported_subset_default_path_contract(spec: NativePackageSpec) -> dict[str, Any] | None:
    if spec.subset != "supported_native":
        return None
    return {
        "kind": "python_free_supported_subset",
        "default_entrypoint": "vkf.exe",
        "native_driver_artifact": "vkf_driver_artifact_smoke",
        "native_pipeline": [
            "vkf_lexer_cursor_smoke",
            "vkf_parser_token_stream_smoke",
            "vkf_ast_to_ir_smoke",
            "vkf_compiler_artifact_smoke",
        ],
        "python_required_to_build": False,
        "python_required_to_run": False,
        "python_fallback_launchers": [],
        "unsupported_ui_scene_excluded": True,
    }


def _native_package_codegen_contract(
    compiler: CppCompiler,
    cpp_name: str,
    executable_name: str,
    windows_target: str,
    posix_target: str,
) -> dict[str, Any]:
    flags = cpp_compile_flags(compiler)
    return {
        "backend": "cpp_backend",
        "emitted_cpp": cpp_name,
        "entry_executable": executable_name,
        "compiler": {
            "kind": compiler.kind,
            "path": compiler.path,
        },
        "compile": {
            "executable": compiler.path,
            "flags": flags,
            "inputs": [cpp_name],
            "outputs": [executable_name],
        },
        "compile_argv": list(
            native_package_compile_argv(
                compiler,
                Path(cpp_name),
                Path(executable_name),
            )
        ),
        "launch_executables": {
            "windows": windows_target,
            "posix": posix_target,
        },
    }


def _write_native_package_support_files(
    package_dir: Path,
    windows_executable_name: str,
    posix_executable_name: str,
    layout: NativePackageLayout,
) -> tuple[Path, Path, Path, Path, Path, Path]:
    run_bat_path = package_dir / layout.run_bat_name
    run_ps1_path = package_dir / layout.run_ps1_name
    run_sh_path = package_dir / layout.run_sh_name
    smoke_bat_path = package_dir / layout.smoke_bat_name
    smoke_ps1_path = package_dir / layout.smoke_ps1_name
    smoke_sh_path = package_dir / layout.smoke_sh_name
    run_bat_path.write_text(_native_package_run_bat_text(windows_executable_name), encoding="utf-8", newline="")
    run_ps1_path.write_text(_native_package_run_ps1_text(windows_executable_name), encoding="utf-8")
    run_sh_path.write_text(_native_package_run_sh_text(posix_executable_name), encoding="utf-8")
    smoke_bat_path.write_text(_native_package_smoke_bat_text(layout), encoding="utf-8", newline="")
    smoke_ps1_path.write_text(_native_package_smoke_ps1_text(layout), encoding="utf-8")
    smoke_sh_path.write_text(_native_package_smoke_sh_text(layout), encoding="utf-8")
    return run_bat_path, run_ps1_path, run_sh_path, smoke_bat_path, smoke_ps1_path, smoke_sh_path


def _native_package_manifest(
    spec: NativePackageSpec,
    compiler: CppCompiler,
    package_dir: Path,
    cpp_name: str,
    executable_name: str,
    windows_target: str,
    posix_target: str,
    layout: NativePackageLayout,
) -> dict[str, Any]:
    runnable_contract = _native_package_runnable_contract(
        executable_name,
        windows_target,
        posix_target,
        layout,
        python_required_to_build=spec.build_host_python_required,
        python_required_to_run=spec.runtime_python_required,
    )
    runtime_contract = _native_package_runtime_contract_from_runnable(runnable_contract)
    install_contract = _native_package_install_contract_from_runnable(runnable_contract)
    codegen_contract = _native_package_codegen_contract(
        compiler,
        cpp_name,
        executable_name,
        windows_target,
        posix_target,
    )
    manifest = {
        "format_version": 1,
        "kind": spec.kind,
        "subset": spec.subset,
        "package_name": spec.package_name,
        "entrypoint": spec.entrypoint,
        "source": {
            "input": spec.source_input,
            "label": spec.source_label,
        },
        "compiler": {
            "kind": compiler.kind,
            "path": compiler.path,
        },
        "artifacts": {
            "directory": str(package_dir),
            "cpp": cpp_name,
            "executable": executable_name,
            "launch_executables": {
                "windows": windows_target,
                "posix": posix_target,
            },
            "launchers": {
                "windows": layout.run_bat_name,
                "windows_powershell": layout.run_ps1_name,
                "posix": layout.run_sh_name,
            },
            "smoke_tests": {
                "windows": layout.smoke_bat_name,
                "windows_powershell": layout.smoke_ps1_name,
                "posix": layout.smoke_sh_name,
            },
        },
        "runtime_contract": runtime_contract,
        "runnable_contract": runnable_contract,
        "install": install_contract,
        "codegen_contract": codegen_contract,
    }
    supported_contract = _native_supported_subset_default_path_contract(spec)
    if supported_contract is not None:
        manifest["supported_subset_default_path_contract"] = supported_contract
    return manifest


def load_native_package_manifest(manifest_path: Path) -> NativePackageManifestView:
    manifest_path = manifest_path.resolve()
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    package_dir = manifest_path.parent
    return NativePackageManifestView(
        package_dir=package_dir,
        manifest_path=manifest_path,
        data=data,
    )


def load_native_package(package_dir: Path) -> NativePackageSurfaceView:
    package_dir = package_dir.resolve()
    manifest = load_native_package_manifest(package_dir / "vektorflow-package.json")
    return NativePackageSurfaceView(package_dir=package_dir, manifest=manifest)


def build_native_package(cpp_source: str, spec: NativePackageSpec) -> NativePackageResult:
    package_dir = spec.package_dir.resolve()
    package_dir.mkdir(parents=True, exist_ok=True)
    layout = package_layout()
    compiler, cpp_path, _ = planned_cpp_artifacts(package_dir, exe_name=spec.package_name)
    built = compile_cpp_source(cpp_source, package_dir, exe_name=spec.package_name)
    windows_target, posix_target = _native_package_launch_targets(package_dir, built, spec.package_name)
    manifest_path = package_dir / layout.manifest_name
    readme_path = package_dir / layout.readme_name
    run_bat_path, run_ps1_path, run_sh_path, smoke_bat_path, smoke_ps1_path, smoke_sh_path = _write_native_package_support_files(
        package_dir,
        windows_target,
        posix_target,
        layout,
    )
    manifest = _native_package_manifest(
        spec,
        compiler,
        package_dir,
        cpp_path.name,
        built.name,
        windows_target,
        posix_target,
        layout,
    )
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    readme_path.write_text(
        _native_package_readme_text(spec, built.name, cpp_path.name, layout),
        encoding="utf-8",
    )
    return NativePackageResult(
        package_dir=package_dir,
        cpp_path=cpp_path,
        executable_path=built,
        manifest_path=manifest_path,
        readme_path=readme_path,
        run_bat_path=run_bat_path,
        run_ps1_path=run_ps1_path,
        run_sh_path=run_sh_path,
        smoke_bat_path=smoke_bat_path,
        smoke_ps1_path=smoke_ps1_path,
        smoke_sh_path=smoke_sh_path,
        compiler=compiler,
        manifest=manifest,
    )


def compile_cpp_source(source: str, out_dir: Path, exe_name: str = "vf_program") -> Path:
    build = compile_cpp_source_view(source, out_dir, exe_name=exe_name)
    return build.executable_path


def compile_cpp_source_view(source: str, out_dir: Path, exe_name: str = "vf_program") -> CppBuildSurfaceView:
    build = planned_cpp_build_view(out_dir, exe_name=exe_name)
    build.cpp_path.write_text(source, encoding="utf-8")
    cmd = list(build.compile_argv)
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise CppEmitError(res.stderr.strip() or res.stdout.strip() or "C++ compilation failed")
    return CppBuildSurfaceView(
        compiler=build.compiler,
        emission=CppEmissionSurfaceView(source_text=source),
        generated=build.generated,
        compile_command=build.compile_command,
    )


def run_cpp_executable(exe_path: Path, args: list[str] | None = None) -> subprocess.CompletedProcess[str]:
    cmd = [str(exe_path)]
    if args:
        cmd.extend(args)
    return subprocess.run(cmd, capture_output=True, text=True)


def _normalize_type(t: Any) -> Any:
    if isinstance(t, ast.NamedTypeSpec):
        return _normalize_type(t.type_expr)
    return t


def _type_key(t: Any) -> str:
    t = _normalize_type(t)
    if isinstance(t, ast.PrimTypeRef):
        return f"prim:{t.name}"
    if isinstance(t, ast.SymbolicValueType):
        return "symbolic" if t.domain is None else f"symbolic<{_type_key(t.domain)}>"
    if isinstance(t, ast.SymbolicDomainType):
        return f"domain:{t.name}"
    if isinstance(t, ast.TypePowerExpr):
        return f"pow({_type_key(t.base)}^{_type_key(t.exponent)})"
    if isinstance(t, ast.TypeSizeConst):
        return f"size:{t.value}"
    if isinstance(t, ast.TypeSizeVar):
        return f"sizevar:{t.name}"
    if isinstance(t, ast.TypeSizeBinOp):
        return f"sizeop({_type_key(t.left)}{t.op}{_type_key(t.right)})"
    if isinstance(t, ast.FixedVectorType):
        return f"vec[{_type_key(t.element_type)}:{_size_key(t.size)}]"
    if isinstance(t, ast.TypeExpr):
        inner = ",".join(f"{name}:{_type_key(inner)}" for name, inner in t.fields)
        return f"record({inner})"
    if isinstance(t, ast.MultisetType):
        return f"mset{{{_type_key(t.element_type)}}}"
    if isinstance(t, ast.MapValueType):
        inner = ",".join(f"{name}:{_type_key(inner)}" for name, inner in t.fields)
        return f"map({inner})"
    if isinstance(t, ast.LinkedListValueType):
        return f"list({','.join(_type_key(e) for e in t.elements)})"
    if isinstance(t, ast.TupleTypeExpr):
        return f"tuple({','.join(_type_key(e) for e in t.elements)})"
    if isinstance(t, ast.FuncType):
        return f"func({_type_key(t.domain)})->{_type_key(t.codomain)}"
    raise CppEmitError(f"unsupported type key for {type(t).__name__}")


def _size_key(size: Any) -> str:
    if isinstance(size, ast.TypeSizeConst):
        return str(size.value)
    if isinstance(size, ast.TypeSizeVar):
        return size.name
    if isinstance(size, ast.TypeSizeBinOp):
        return f"({_size_key(size.left)}{size.op}{_size_key(size.right)})"
    raise CppEmitError(f"unsupported size key for {type(size).__name__}")


def _struct_name(t: ast.TypeExpr) -> str:
    key = _type_key(t)
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
    return f"VfRecord_{digest}"


def _register_type(t: Any, state: EmitState) -> None:
    t = _normalize_type(t)
    if isinstance(t, ast.SymbolicValueType):
        if t.domain is not None:
            _register_type(t.domain, state)
        return
    if isinstance(t, ast.TypeExpr):
        name = _struct_name(t)
        if name not in state.struct_defs:
            state.struct_defs[name] = t
        for _, inner in t.fields:
            _register_type(inner, state)
        return
    if isinstance(t, ast.FixedVectorType):
        _register_type(t.element_type, state)
        return
    if isinstance(t, ast.MultisetType):
        _register_type(t.element_type, state)
        return
    if isinstance(t, ast.MapValueType):
        for _, inner in t.fields:
            _register_type(inner, state)
        return
    if isinstance(t, ast.LinkedListValueType):
        for inner in t.elements:
            _register_type(inner, state)
        return
    if isinstance(t, ast.TupleTypeExpr):
        for inner in t.elements:
            _register_type(inner, state)
        return
    if isinstance(t, ast.FuncType):
        _register_type(t.domain, state)
        _register_type(t.codomain, state)
        return


def _emit_size_expr(size: Any) -> str:
    if isinstance(size, ast.TypeSizeConst):
        return str(size.value)
    if isinstance(size, ast.TypeSizeVar):
        return size.name
    if isinstance(size, ast.TypeSizeBinOp):
        op_map = {
            "PLUS": "+",
            "MINUS": "-",
            "STAR": "*",
            "SLASH": "/",
            "+": "+",
            "-": "-",
            "*": "*",
            "/": "/",
        }
        if size.op not in op_map:
            raise CppEmitError(f"unsupported size-expression op {size.op}")
        left = _emit_size_expr(size.left)
        right = _emit_size_expr(size.right)
        return f"({left} {op_map[size.op]} {right})"
    raise CppEmitError(f"unsupported size expression {type(size).__name__}")


def _fixed_vector_uses_heap(t: Any) -> bool:
    t = _normalize_type(t)
    return (
        isinstance(t, ast.FixedVectorType)
        and isinstance(t.size, ast.TypeSizeConst)
        and int(t.size.value) > LARGE_FIXED_VECTOR_HEAP_THRESHOLD
    )


def _collect_size_vars(type_expr: Any, out: set[str]) -> None:
    type_expr = _normalize_type(type_expr)
    if isinstance(type_expr, ast.SymbolicValueType):
        if type_expr.domain is not None:
            _collect_size_vars(type_expr.domain, out)
    elif isinstance(type_expr, ast.TypePowerExpr):
        _collect_size_vars(type_expr.base, out)
        _collect_size_vars(type_expr.exponent, out)
    elif isinstance(type_expr, ast.FixedVectorType):
        _collect_size_vars_from_size(type_expr.size, out)
        _collect_size_vars(type_expr.element_type, out)
    elif isinstance(type_expr, ast.TypeExpr):
        for _, inner in type_expr.fields:
            _collect_size_vars(inner, out)
    elif isinstance(type_expr, ast.TupleTypeExpr):
        for inner in type_expr.elements:
            _collect_size_vars(inner, out)
    elif isinstance(type_expr, ast.MultisetType):
        _collect_size_vars(type_expr.element_type, out)
    elif isinstance(type_expr, ast.FuncType):
        _collect_size_vars(type_expr.domain, out)
        _collect_size_vars(type_expr.codomain, out)


def _collect_size_vars_from_size(size: Any, out: set[str]) -> None:
    if isinstance(size, ast.TypeSizeVar):
        out.add(size.name)
    elif isinstance(size, ast.TypeSizeBinOp):
        _collect_size_vars_from_size(size.left, out)
        _collect_size_vars_from_size(size.right, out)


def _cpp_multiset_key_supported(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bit", "int", "rational", "num", "chr", "str"}


def _cpp_dynamic_value_supported(t: Any) -> bool:
    return cpp_dynamic_value_supported(t, _normalize_type)


def _require_cpp_dynamic_value_supported(t: Any, context: str) -> Any:
    return require_cpp_dynamic_value_supported(t, _normalize_type, CppEmitError, context)


def _dynamic_hooks() -> DynamicEmitHooks:
    return DynamicEmitHooks(
        normalize_type=_normalize_type,
        expr_type=_expr_type,
        emit_expr=_emit_expr,
        emit_const=_emit_const,
        cpp_type=_cpp_type,
    )


def _bind_targets_name(node: Any, name: str) -> bool:
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return node.name == name
    if isinstance(node, (ir.AttrExpr, ir.IndexExpr)):
        return _bind_targets_name(node.value, name)
    return False


def _function_mutates_param(fn: ir.FunctionDef, name: str) -> bool:
    def visit_expr(expr: Any) -> bool:
        if isinstance(expr, ir.BindExpr) and _bind_targets_name(expr.target, name):
            return True
        if isinstance(expr, ir.CoerceExpr):
            return visit_expr(expr.expr)
        if isinstance(expr, ir.CallExpr):
            return visit_expr(expr.func) or any(visit_expr(arg) for arg in expr.args)
        if isinstance(expr, (ir.AttrExpr, ir.IndexExpr)):
            return visit_expr(expr.value) or any(visit_expr(idx) for idx in getattr(expr, "indices", []))
        if isinstance(expr, ir.BinaryExpr):
            return visit_expr(expr.left) or visit_expr(expr.right)
        if isinstance(expr, ir.UnaryExpr):
            return visit_expr(expr.operand)
        if isinstance(expr, (ir.ListExpr, ir.TupleExpr)):
            return any(visit_expr(elem) for elem in expr.elements)
        if isinstance(expr, ir.StructExpr):
            return any(visit_expr(value) for _name, value in expr.fields)
        return False

    def visit_stmt(stmt: Any) -> bool:
        if isinstance(stmt, (ir.StoreName, ir.StoreSlot)):
            return visit_expr(stmt.value)
        if isinstance(stmt, ir.ExprStmt):
            return visit_expr(stmt.expr)
        if isinstance(stmt, (ir.IfStmt, ir.WhileStmt)):
            return visit_expr(stmt.condition) or any(visit_stmt(inner) for inner in stmt.body.statements)
        if isinstance(stmt, ir.ReturnStmt):
            return stmt.value is not None and visit_expr(stmt.value)
        if isinstance(stmt, ir.PrintStmt):
            return visit_expr(stmt.value)
        return False

    return any(visit_stmt(stmt) for stmt in fn.body.statements)


def _cpp_param_decl(name: str, type_expr: Any, state: EmitState, *, mutable_value: bool = False) -> str:
    cpp_t = _cpp_type(type_expr, state)
    t = _normalize_type(type_expr)
    if not mutable_value and isinstance(t, (ast.FixedVectorType, ast.TypeExpr, ast.MultisetType, ast.MapValueType, ast.LinkedListValueType)):
        return f"const {cpp_t}& {name}"
    return f"{cpp_t} {name}"


def _cpp_type(t: Any, state: EmitState | None = None) -> str:
    t = _normalize_type(t)
    if isinstance(t, ast.SymbolicValueType):
        return "vf_symbolic"
    if isinstance(t, ast.PrimTypeRef):
        if t.name == "int":
            return "long long"
        if t.name == "rational":
            return "vf_rational"
        if t.name == "symbolic":
            return "vf_symbolic"
        if t.name == "num":
            return "std::complex<double>"
        if t.name == "bit":
            return "bool"
        if t.name == "chr":
            return "std::string"
        if t.name == "str":
            return "std::string"
    if isinstance(t, ast.TypeExpr):
        if state is not None:
            _register_type(t, state)
        return _struct_name(t)
    if isinstance(t, ast.FixedVectorType):
        if _fixed_vector_uses_heap(t):
            return f"std::vector<{_cpp_type(t.element_type, state)}>"
        return f"std::array<{_cpp_type(t.element_type, state)}, {_emit_size_expr(t.size)}>"
    if isinstance(t, ast.MultisetType):
        # Multisets are defined as sorted collections, so the native subset
        # uses std::map and currently limits keys to builtins with a clear order.
        if not _cpp_multiset_key_supported(t.element_type):
            raise CppEmitError("compiled multisets currently require primitive ordered key types")
        return f"std::map<{_cpp_type(t.element_type, state)}, long long>"
    if isinstance(t, ast.MapValueType):
        for _, inner in t.fields:
            _require_cpp_dynamic_value_supported(inner, "compiled maps")
        return "std::map<std::string, std::any>"
    if isinstance(t, ast.LinkedListValueType):
        for inner in t.elements:
            _require_cpp_dynamic_value_supported(inner, "compiled lists")
        return "std::list<std::any>"
    raise CppEmitError(f"unsupported C++ type emission for {type(t).__name__}")


def _const_type(value: Any) -> Any:
    if isinstance(value, bool):
        return ast.PrimTypeRef("bit")
    if value is None:
        raise CppEmitError("null is not yet supported in C++ emission")
    if isinstance(value, (int, float)):
        return ast.PrimTypeRef("num")
    if isinstance(value, str):
        return ast.PrimTypeRef("str")
    raise CppEmitError(f"unsupported constant type {type(value).__name__}")


def _promote_numeric(a: Any, b: Any) -> Any:
    a = _normalize_type(a)
    b = _normalize_type(b)
    if not isinstance(a, ast.PrimTypeRef) or not isinstance(b, ast.PrimTypeRef):
        raise CppEmitError("unsupported non-primitive numeric promotion")
    if a.name == "rational" or b.name == "rational":
        return ast.PrimTypeRef("rational")
    if a.name == "num" or b.name == "num":
        return ast.PrimTypeRef("num")
    if a.name == "int" and b.name == "int":
        return ast.PrimTypeRef("int")
    if a.name == "bit" and b.name == "bit":
        return ast.PrimTypeRef("bit")
    if {a.name, b.name} <= {"bit", "int"}:
        return ast.PrimTypeRef("int")
    raise CppEmitError(f"unsupported numeric promotion {a.name} vs {b.name}")


def _same_primitive_name(a: Any, b: Any) -> bool:
    a = _normalize_type(a)
    b = _normalize_type(b)
    return isinstance(a, ast.PrimTypeRef) and isinstance(b, ast.PrimTypeRef) and a.name == b.name


def _is_symbolic_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.SymbolicValueType) or (isinstance(t, ast.PrimTypeRef) and t.name == "symbolic")


def _is_scalar_numeric_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bit", "int", "rational", "num"}


def _infer_cpp_symbolic_builtin(name: str, arg_types: list[Any]) -> Any | None:
    has_symbolic_arg = any(_is_symbolic_type(t) for t in arg_types)
    if name == "symbolic":
        return ast.PrimTypeRef("symbolic")
    if name == "same":
        return ast.PrimTypeRef("bit") if has_symbolic_arg else None
    if name == "conditions":
        return ast.PrimTypeRef("str") if has_symbolic_arg else None
    if not has_symbolic_arg:
        return None
    if name in {"latex", "trace"}:
        return ast.PrimTypeRef("str")
    if name in {
        "assume",
        "cancel",
        "canonical",
        "collect",
        "complete_square",
        "compute",
        "delta",
        "derivative",
        "differentiate",
        "diff",
        "diff_n",
        "difference",
        "dsolve",
        "expand",
        "factor",
        "grad",
        "gradient",
        "integ",
        "integral",
        "integrate",
        "move",
        "shift",
        "solve",
        "trig_compress",
        "trig_expand",
        *SYMBOLIC_MATH_INTRINSIC_NAMES,
    }:
        return ast.PrimTypeRef("symbolic")
    return None


def _stdlib_env(module: ir.Module) -> dict[str, Any]:
    env: dict[str, Any] = {
        stdlib_import.binding_name: StdlibNamespaceType(stdlib_import.module_name)
        for stdlib_import in module.stdlib_imports
    }
    for stdlib_import in module.stdlib_imports:
        if stdlib_import.module_name == "symbolic" and stdlib_import.spill_exports:
            env.update(
                {
                    name: StdlibFunctionType("symbolic", name)
                    for name in SYMBOLIC_STDLIB_EXPORTS
                }
            )
    return env


def _expr_type(node: Any, typed: TypedModuleInfo) -> Any:
    return _normalize_type(typed.expr_type(node))


def _cpp_name(name: str, state: EmitState) -> str:
    if state.current_name_map is None:
        return name
    return state.current_name_map.get(name, name)


def _infer_expr_type(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef]) -> Any:
    if isinstance(node, ir.Const):
        return _const_type(node.value)
    if isinstance(node, ir.LoadName):
        if node.name == "inf":
            return ast.PrimTypeRef("symbolic")
        if node.name not in env:
            raise CppEmitError(f"unknown name in C++ emitter: {node.name}")
        return env[node.name]
    if isinstance(node, ir.CoerceExpr):
        return _normalize_type(node.target_type)
    if isinstance(node, ir.ListExpr):
        if not node.elements:
            raise CppEmitError("empty list literals are not yet supported in C++ emission")
        elem_types = [_infer_expr_type(e, env, functions) for e in node.elements]
        cur = elem_types[0]
        for nxt in elem_types[1:]:
            cur = _promote_numeric(cur, nxt)
        return ast.FixedVectorType(cur, ast.TypeSizeConst(len(node.elements)))
    if isinstance(node, ir.MultisetExpr):
        if not node.pairs:
            raise CppEmitError("empty multiset literals are not yet supported in C++ emission")
        elem_types = [_infer_expr_type(value, env, functions) for value, _ in node.pairs]
        cur = elem_types[0]
        for nxt in elem_types[1:]:
            if isinstance(_normalize_type(cur), ast.PrimTypeRef) and isinstance(_normalize_type(nxt), ast.PrimTypeRef):
                cur = _promote_numeric(cur, nxt)
            elif _normalize_type(cur) != _normalize_type(nxt):
                raise CppEmitError("multiset literal requires compatible element types")
        return ast.MultisetType(cur)
    if isinstance(node, ir.MapExpr):
        return ast.MapValueType([(name, _infer_expr_type(value, env, functions)) for name, value in node.fields])
    if isinstance(node, ir.LinkedListExpr):
        if node.spread is not None:
            spread_t = _normalize_type(_infer_expr_type(node.spread, env, functions))
            if isinstance(spread_t, ast.FixedVectorType):
                if not isinstance(spread_t.size, ast.TypeSizeConst):
                    raise CppEmitError("linked-list spread requires a resolved source size in C++ emission")
                return ast.LinkedListValueType([spread_t.element_type] * spread_t.size.value)
            if isinstance(spread_t, ast.LinkedListValueType):
                return spread_t
            raise CppEmitError("linked-list spread requires a vector or linked-list source")
        return ast.LinkedListValueType([_infer_expr_type(elem, env, functions) for elem in node.elements])
    if isinstance(node, ir.StructExpr):
        return ast.TypeExpr([(name, _infer_expr_type(value, env, functions)) for name, value in node.fields])
    if isinstance(node, ir.AttrExpr):
        intrinsic = resolve_native_intrinsic(node)
        if intrinsic is not None and intrinsic.kind == "math_const":
            return ast.PrimTypeRef("num")
        base_t = _normalize_type(_infer_expr_type(node.value, env, functions))
        if isinstance(base_t, StdlibNamespaceType) and base_t.module_name == "symbolic" and node.name in SYMBOLIC_STDLIB_EXPORTS:
            return StdlibFunctionType("symbolic", node.name)
        if not isinstance(base_t, ast.TypeExpr):
            if isinstance(base_t, ast.MapValueType):
                for name, inner in base_t.fields:
                    if name == node.name:
                        return inner
                raise CppEmitError(f"missing field {node.name!r} in map value")
            raise CppEmitError("attribute access requires a struct or map type in C++ emission")
        for name, inner in base_t.fields:
            if name == node.name:
                return inner
        raise CppEmitError(f"missing field {node.name!r} in struct type")
    if isinstance(node, ir.IndexExpr):
        current_t = _normalize_type(_infer_expr_type(node.value, env, functions))
        for idx in node.indices:
            idx_t = _normalize_type(_infer_expr_type(idx, env, functions))
            if not _is_scalar_numeric_type(idx_t):
                raise CppEmitError("index access requires a numeric index in C++ emission")
            if isinstance(current_t, ast.FixedVectorType):
                current_t = _normalize_type(current_t.element_type)
                continue
            raise CppEmitError("index access currently requires a fixed-vector type in C++ emission")
        return current_t
    if isinstance(node, ir.BindExpr):
        return _infer_expr_type(node.value, env, functions)
    if isinstance(node, ir.UnaryExpr):
        t = _infer_expr_type(node.operand, env, functions)
        if node.op == "NOT":
            return ast.PrimTypeRef("bit")
        return t
    if isinstance(node, ir.BinaryExpr):
        lt = _infer_expr_type(node.left, env, functions)
        rt = _infer_expr_type(node.right, env, functions)
        if node.op == "AMPERSAND":
            lt_n = _normalize_type(lt)
            rt_n = _normalize_type(rt)
            if _is_symbolic_type(lt_n) or _is_symbolic_type(rt_n):
                return ast.PrimTypeRef("symbolic")
            if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                if not _same_primitive_name(lt_n.element_type, rt_n.element_type):
                    raise CppEmitError("vector concat requires matching element types")
                return ast.FixedVectorType(
                    lt_n.element_type,
                    ast.TypeSizeBinOp("PLUS", lt_n.size, rt_n.size),
                )
            if isinstance(lt_n, ast.LinkedListValueType) and isinstance(rt_n, ast.LinkedListValueType):
                return ast.LinkedListValueType(list(lt_n.elements) + list(rt_n.elements))
        if node.op in ("PLUS", "MINUS", "STAR", "SLASH", "FLOOR_DIV", "PERCENT", "CARET"):
            lt_n = _normalize_type(lt)
            rt_n = _normalize_type(rt)
            if _is_symbolic_type(lt_n) or _is_symbolic_type(rt_n):
                if node.op not in ("PLUS", "MINUS", "STAR", "SLASH", "CARET"):
                    raise CppEmitError("symbolic arithmetic supports +, -, *, /, and ^ in C++ emission")
                return ast.PrimTypeRef("symbolic")
            if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                if node.op not in ("PLUS", "MINUS", "STAR", "SLASH"):
                    raise CppEmitError(f"unsupported vector op for C++ emitter: {node.op}")
                if not _same_primitive_name(lt_n.element_type, rt_n.element_type):
                    raise CppEmitError("vector arithmetic requires matching element types")
                return lt_n
                if node.op == "STAR":
                    if isinstance(lt_n, ast.FixedVectorType) and _is_scalar_numeric_type(rt_n):
                        return lt_n
                    if isinstance(rt_n, ast.FixedVectorType) and _is_scalar_numeric_type(lt_n):
                        return rt_n
            if isinstance(lt_n, ast.MultisetType) and isinstance(rt_n, ast.MultisetType):
                if node.op not in ("PLUS", "MINUS", "FLOOR_DIV", "PERCENT"):
                    raise CppEmitError("multisets support +, -, //, and % count operators")
                if lt_n.element_type != rt_n.element_type:
                    raise CppEmitError("multiset arithmetic requires matching element types")
                return lt_n
            return _promote_numeric(lt, rt)
        if node.op in ("EQ", "NEQ") and (_is_symbolic_type(_normalize_type(lt)) or _is_symbolic_type(_normalize_type(rt))):
            return ast.PrimTypeRef("symbolic")
        if node.op in ("EQ", "NEQ", "LT", "LE", "GT", "GE", "AND", "OR", "XOR"):
            return ast.PrimTypeRef("bit")
        if node.op == "AMPERSAND":
            if isinstance(_normalize_type(lt), ast.PrimTypeRef) and _normalize_type(lt).name == "str":
                return ast.PrimTypeRef("str")
            if isinstance(_normalize_type(rt), ast.PrimTypeRef) and _normalize_type(rt).name == "str":
                return ast.PrimTypeRef("str")
        raise CppEmitError(f"unsupported binary op for C++ emitter: {node.op}")
    if isinstance(node, ir.CallExpr):
        if isinstance(node.func, ir.LoadName):
            fname = node.func.name
            if fname in ("bit", "int", "rational", "num", "symbolic", "chr", "str"):
                return ast.PrimTypeRef(fname)
            if (
                fname == "solve"
                and isinstance(env.get(fname), StdlibFunctionType)
                and env[fname].module_name == "symbolic"
                and len(node.args) >= 3
            ):
                arg_types = [_infer_expr_type(arg, env, functions) for arg in node.args]
                if _is_symbolic_type(arg_types[0]):
                    fields: list[tuple[str, Any]] = []
                    for arg, arg_t in zip(node.args[1:], arg_types[1:]):
                        if isinstance(arg, (ir.LoadName, ir.LoadSlot)) and _is_symbolic_type(arg_t):
                            fields.append((arg.name, ast.PrimTypeRef("symbolic")))
                    if len(fields) == len(node.args) - 1:
                        return ast.TypeExpr(fields)
            if isinstance(env.get(fname), StdlibFunctionType) and env[fname].module_name == "symbolic":
                symbolic_return = _infer_cpp_symbolic_builtin(fname, [_infer_expr_type(arg, env, functions) for arg in node.args])
                if symbolic_return is not None:
                    return symbolic_return
            if fname in functions:
                r = functions[fname].return_type
                if r is None:
                    raise CppEmitError(f"function {fname} missing return type for C++ emission")
                return _normalize_type(r)
        if isinstance(node.func, ir.AttrExpr):
            func_t = _normalize_type(_infer_expr_type(node.func, env, functions))
            if isinstance(func_t, StdlibFunctionType) and func_t.module_name == "symbolic":
                symbolic_return = _infer_cpp_symbolic_builtin(func_t.name, [_infer_expr_type(arg, env, functions) for arg in node.args])
                if symbolic_return is not None:
                    return symbolic_return
        intrinsic = resolve_native_intrinsic(node.func)
        if intrinsic is not None and intrinsic.kind == "stat" and intrinsic.name in SYMBOLIC_STAT_RANGE_NAMES:
            arg_types = [_infer_expr_type(arg, env, functions) for arg in node.args]
            if len(arg_types) == 4 and any(_is_symbolic_type(t) for t in arg_types):
                return ast.PrimTypeRef("symbolic")
        raise CppEmitError("unsupported call target for C++ emitter")
    raise CppEmitError(f"unsupported IR expr type {type(node).__name__}")


def _emit_const(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        escaped = value.encode("unicode_escape").decode("ascii").replace('"', '\\"')
        return f'"{escaped}"'
    raise CppEmitError(f"unsupported constant for C++ emission: {type(value).__name__}")


def _emit_vector_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    target = _normalize_type(node.target_type)
    if not isinstance(target, ast.FixedVectorType):
        raise CppEmitError("internal: vector coercion helper needs a fixed-vector target")
    if isinstance(node.expr, ir.ListExpr):
        elems = [_emit_expr(ir.CoerceExpr(elem, target.element_type), env, functions, state, typed) for elem in node.expr.elements]
        return f"{_cpp_type(target, state)}{{{', '.join(elems)}}}"
    inner = _emit_expr(node.expr, env, functions, state, typed)
    return f"vf_array_cast<{_cpp_type(target.element_type, state)}, {_emit_size_expr(target.size)}>({inner})"


def _emit_multiset_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    target = _normalize_type(node.target_type)
    if not isinstance(target, ast.MultisetType):
        raise CppEmitError("internal: multiset coercion helper needs a multiset target")
    if isinstance(node.expr, ir.MultisetExpr):
        pairs = []
        for value, count in node.expr.pairs:
            elem = _emit_expr(ir.CoerceExpr(value, target.element_type), env, functions, state, typed)
            cnt = _emit_expr(ir.CoerceExpr(count, ast.PrimTypeRef("int")), env, functions, state, typed)
            pairs.append(f"{{{elem}, static_cast<long long>({cnt})}}")
        return f"vf_mset_make<{_cpp_type(target.element_type, state)}>({{{', '.join(pairs)}}})"
    return _emit_expr(node.expr, env, functions, state, typed)


def _emit_map_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_map_coercion(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_linked_list_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_linked_list_coercion(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _detect_numeric_progression(node: ir.ListExpr) -> tuple[float, float] | None:
    if len(node.elements) < 2:
        return None
    values: list[float] = []
    for elem in node.elements:
        if not isinstance(elem, ir.Const):
            return None
        value = elem.value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        values.append(float(value))
    step = values[1] - values[0]
    for idx in range(2, len(values)):
        if not math.isclose(values[idx] - values[idx - 1], step, rel_tol=0.0, abs_tol=1e-12):
            return None
    return values[0], step


def _emit_record_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    target = _normalize_type(node.target_type)
    if not isinstance(target, ast.TypeExpr):
        raise CppEmitError("internal: record coercion helper needs a record target")
    if isinstance(node.expr, ir.StructExpr):
        _register_type(target, state)
        value_map = {name: value for name, value in node.expr.fields}
        elems = []
        for fname, ftype in target.fields:
            if fname not in value_map:
                raise CppEmitError(f"missing field {fname!r} for struct coercion")
            elems.append(_emit_expr(ir.CoerceExpr(value_map[fname], ftype), env, functions, state, typed))
        return f"{_cpp_type(target, state)}{{{', '.join(elems)}}}"
    return _emit_expr(node.expr, env, functions, state, typed)


def _emit_list_literal(node: ir.ListExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.FixedVectorType):
        raise CppEmitError("list literal did not infer a fixed-vector type")
    if len(node.elements) == 1 and isinstance(node.elements[0], ir.RangeExpr):
        return _emit_range_expr(node.elements[0], env, functions, state, typed)
    progression = _detect_numeric_progression(node)
    if progression is not None and len(node.elements) >= 16:
        start, step = progression
        elem_type = _cpp_type(inferred.element_type, state)
        size_expr = _emit_size_expr(inferred.size)
        return f"vf_array_iota<{elem_type}, {size_expr}>({_emit_const(start)}, {_emit_const(step)})"
    elems = [_emit_expr(ir.CoerceExpr(elem, inferred.element_type), env, functions, state, typed) for elem in node.elements]
    return f"{_cpp_type(inferred, state)}{{{', '.join(elems)}}}"


def _emit_range_expr(node: ir.RangeExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.FixedVectorType):
        raise CppEmitError("native range emission requires a constant finite range")
    if node.end is None:
        raise CppEmitError("native range emission requires an end value")
    if node.start is not None and not isinstance(node.start, ir.Const):
        raise CppEmitError("native range emission requires a constant start")
    if not isinstance(node.end, ir.Const):
        raise CppEmitError("native range emission requires a constant end")
    start = 0 if node.start is None else node.start.value
    end = node.end.value
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        raise CppEmitError("native range emission requires numeric bounds")
    step = 1.0 if end >= start else -1.0
    elem_type = _cpp_type(inferred.element_type, state)
    size_expr = _emit_size_expr(inferred.size)
    if _fixed_vector_uses_heap(inferred):
        return f"vf_vector_iota<{elem_type}>({_emit_const(start)}, {_emit_const(step)}, static_cast<std::size_t>({size_expr}))"
    return f"vf_array_iota<{elem_type}, {size_expr}>({_emit_const(start)}, {_emit_const(step)})"


def _emit_multiset_literal(node: ir.MultisetExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.MultisetType):
        raise CppEmitError("multiset literal did not infer a multiset type")
    return _emit_multiset_coercion(ir.CoerceExpr(node, inferred), env, functions, state, typed)


def _emit_dynamic_any(expr: Any, expr_type: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_dynamic_any(
        expr,
        expr_type,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_map_literal(node: ir.MapExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_map_literal(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_linked_list_literal(node: ir.LinkedListExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_linked_list_literal(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_map_attr_access(node: ir.AttrExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_map_attr_access(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_dynamic_collection_binary(node: ir.BinaryExpr, left: str, right: str, left_type: Any, right_type: Any) -> str | None:
    if node.op == "AMPERSAND":
        return _dyn_emit_linked_list_concat(
            left,
            right,
            left_type,
            right_type,
            hooks=_dynamic_hooks(),
            error_type=CppEmitError,
        )
    return None


def _emit_fused_array_expr(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str | None:
    node_type = _normalize_type(_expr_type(node, typed))
    if not isinstance(node_type, ast.FixedVectorType):
        return None
    scalar_expr = _emit_fused_array_scalar(node, "vf_i", env, functions, state, typed)
    if scalar_expr is None:
        return None
    elem_cpp = _cpp_type(node_type.element_type, state)
    arr_cpp = _cpp_type(node_type, state)
    size_cpp = _emit_size_expr(node_type.size)
    return (
        "([&]() { "
        f"{arr_cpp} vf_out{{}}; "
        f"for (std::size_t vf_i = 0; vf_i < {size_cpp}; ++vf_i) "
        f"vf_out[vf_i] = static_cast<{elem_cpp}>({scalar_expr}); "
        "return vf_out; "
        "}())"
    )


def _emit_fused_array_scalar(node: Any, idx_name: str, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str | None:
    node_type = _normalize_type(_expr_type(node, typed))
    if not isinstance(node_type, ast.FixedVectorType):
        return None
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return f"{_emit_expr(node, env, functions, state, typed)}[{idx_name}]"
    if isinstance(node, ir.AttrExpr):
        base_type = _normalize_type(_expr_type(node.value, typed))
        if isinstance(base_type, ast.TypeExpr):
            return f"{_emit_expr(node, env, functions, state, typed)}[{idx_name}]"
        return None
    if isinstance(node, ir.CoerceExpr) and isinstance(_normalize_type(node.target_type), ast.FixedVectorType):
        return _emit_fused_array_scalar(node.expr, idx_name, env, functions, state, typed)
    if isinstance(node, ir.BinaryExpr):
        left_type = _normalize_type(_expr_type(node.left, typed))
        right_type = _normalize_type(_expr_type(node.right, typed))
        op_map = {
            "PLUS": "+",
            "MINUS": "-",
            "STAR": "*",
            "SLASH": "/",
        }
        if node.op in op_map:
            if isinstance(left_type, ast.FixedVectorType) and isinstance(right_type, ast.FixedVectorType):
                left = _emit_fused_array_scalar(node.left, idx_name, env, functions, state, typed)
                right = _emit_fused_array_scalar(node.right, idx_name, env, functions, state, typed)
                if left is None or right is None:
                    return None
                return f"({left} {op_map[node.op]} {right})"
            if node.op == "STAR":
                if isinstance(left_type, ast.FixedVectorType) and _is_scalar_numeric_type(right_type):
                    left = _emit_fused_array_scalar(node.left, idx_name, env, functions, state, typed)
                    if left is None:
                        return None
                    right = _emit_expr(node.right, env, functions, state, typed)
                    return f"({left} * {right})"
                if isinstance(right_type, ast.FixedVectorType) and _is_scalar_numeric_type(left_type):
                    right = _emit_fused_array_scalar(node.right, idx_name, env, functions, state, typed)
                    if right is None:
                        return None
                    left = _emit_expr(node.left, env, functions, state, typed)
                    return f"({left} * {right})"
    return None


def _emit_struct_literal(node: ir.StructExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.TypeExpr):
        raise CppEmitError("struct literal did not infer a record type")
    return _emit_record_coercion(ir.CoerceExpr(node, inferred), env, functions, state, typed)


def _emit_collection_binary(
    node: ir.BinaryExpr,
    left: str,
    right: str,
    left_type: Any,
    right_type: Any,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: EmitState,
    typed: TypedModuleInfo,
) -> str | None:
    if isinstance(left_type, ast.MultisetType) or isinstance(right_type, ast.MultisetType):
        if not isinstance(left_type, ast.MultisetType) or not isinstance(right_type, ast.MultisetType):
            raise CppEmitError(f"unsupported mixed multiset expression for C++ emitter: {node.op}")
        suffix = {
            "PLUS": "union",
            "MINUS": "difference",
            "FLOORDIV": "floor_div",
            "PERCENT": "mod",
        }.get(node.op)
        if suffix is None:
            raise CppEmitError("multisets support +, -, //, and % count operators")
        return f"vf_mset_{suffix}({left}, {right})"
    if isinstance(left_type, ast.FixedVectorType) or isinstance(right_type, ast.FixedVectorType):
        fused = _emit_fused_array_expr(node, env, functions, state, typed)
        if fused is not None:
            return fused
        if node.op == "AMPERSAND":
            return f"vf_array_cat({left}, {right})"
        if node.op in ("PLUS", "MINUS", "STAR", "SLASH"):
            if isinstance(left_type, ast.FixedVectorType) and isinstance(right_type, ast.FixedVectorType):
                suffix = {
                    "PLUS": "add",
                    "MINUS": "sub",
                    "STAR": "mul",
                    "SLASH": "div",
                }[node.op]
                return f"vf_array_{suffix}({left}, {right})"
            if node.op == "STAR":
                if isinstance(left_type, ast.FixedVectorType):
                    return f"vf_array_scale({left}, {right})"
                if isinstance(right_type, ast.FixedVectorType):
                    return f"vf_array_scale({right}, {left})"
        raise CppEmitError(f"unsupported vector expression for C++ emitter: {node.op}")
    dyn = _emit_dynamic_collection_binary(node, left, right, left_type, right_type)
    if dyn is not None:
        return dyn
    if isinstance(left_type, ast.LinkedListValueType) or isinstance(right_type, ast.LinkedListValueType):
        raise CppEmitError(f"unsupported linked-list expression for C++ emitter: {node.op}")
    return None


def _emit_inplace_fused_array_store(
    target_name: str,
    value: Any,
    final_type: Any,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    indent: str,
    state: EmitState,
    typed: TypedModuleInfo,
) -> list[str] | None:
    final_type = _normalize_type(final_type)
    if not isinstance(final_type, ast.FixedVectorType):
        return None
    scalar_expr = _emit_fused_array_scalar(value, "vf_i", env, functions, state, typed)
    if scalar_expr is None:
        return None
    cpp_name = _cpp_name(target_name, state)
    elem_cpp = _cpp_type(final_type.element_type, state)
    size_cpp = _emit_size_expr(final_type.size)
    return [
        f"{indent}for (std::size_t vf_i = 0; vf_i < {size_cpp}; ++vf_i) {{",
        f"{indent}    {cpp_name}[vf_i] = static_cast<{elem_cpp}>({scalar_expr});",
        f"{indent}}}",
    ]


def _emit_intrinsic_call(
    node: ir.CallExpr,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: EmitState,
    typed: TypedModuleInfo,
) -> str | None:
    if isinstance(node.func, ir.LoadName) and node.func.name in functions:
        return None
    intrinsic = resolve_native_intrinsic(node.func)
    if intrinsic is None:
        try:
            func_t = _expr_type(node.func, typed)
        except Exception:
            func_t = None
        if isinstance(func_t, StdlibFunctionType) and func_t.module_name in {"math", "stat"}:
            intrinsic = NativeIntrinsic(func_t.module_name, func_t.name, "math" if func_t.module_name == "math" else "stat" if func_t.module_name == "stat" else func_t.module_name)
    if intrinsic is None:
        return None
    if intrinsic.kind == "stat" and intrinsic.name == "sum" and len(node.args) == 1:
        range_sum = _emit_direct_range_sum(node.args[0], env, functions, state, typed)
        if range_sum is not None:
            return range_sum
    args = [_emit_expr(a, env, functions, state, typed) for a in node.args]
    if intrinsic.kind == "math_const":
        const_map = {
            "pi": "3.14159265358979323846",
            "e": "2.71828182845904523536",
            "tau": "6.28318530717958647692",
        }
        return const_map[intrinsic.name]
    if intrinsic.kind == "math":
        arg_types = [_expr_type(a, typed) for a in node.args]
        if any(_is_symbolic_type(t) for t in arg_types):
            if len(args) != 1:
                raise CppEmitError("symbolic math intrinsics currently require one argument")
            return f"vf_sym_call(\"{intrinsic.name}\", vf_to_symbolic({args[0]}))"
        num_args = [f"vf_to_num({arg})" for arg in args]
        if intrinsic.name == "log":
            return f"(std::log({num_args[0]}) / std::log({num_args[1]}))"
        if intrinsic.name == "atan2":
            return f"std::atan2({args[0]}, {args[1]})"
        name_map = {
            "sin": "std::sin",
            "cos": "std::cos",
            "tan": "std::tan",
            "sinh": "std::sinh",
            "cosh": "std::cosh",
            "asin": "std::asin",
            "acos": "std::acos",
            "atan": "std::atan",
            "asinh": "std::asinh",
            "acosh": "std::acosh",
            "atanh": "std::atanh",
            "exp": "std::exp",
            "ln": "std::log",
            "lg": "std::log10",
            "sqrt": "std::sqrt",
        }
        if intrinsic.name == "lg2":
            return f"(std::log({num_args[0]}) / std::log(vf_to_num(2.0)))"
        return f"{name_map[intrinsic.name]}({', '.join(num_args)})"
    if intrinsic.kind == "stat":
        arg_types = [_expr_type(a, typed) for a in node.args]
        if intrinsic.name in SYMBOLIC_STAT_RANGE_NAMES and len(args) == 4 and any(_is_symbolic_type(t) for t in arg_types):
            helper = {"sum": "vf_sym_sum", "mean": "vf_sym_mean", "median": "vf_sym_median"}[intrinsic.name]
            return (
                f"{helper}(vf_to_symbolic({args[0]}), vf_to_symbolic({args[1]}), "
                f"vf_to_symbolic({args[2]}), vf_to_symbolic({args[3]}))"
            )
        if intrinsic.name == "sum":
            return f"vf_array_sum({args[0]})"
        if intrinsic.name == "mean":
            vector_t = _normalize_type(_expr_type(node.args[0], typed))
            if not isinstance(vector_t, ast.FixedVectorType):
                raise CppEmitError("stat.mean requires a fixed vector argument")
            return f"(vf_to_real(vf_array_sum({args[0]})) / static_cast<double>({_emit_size_expr(vector_t.size)}))"
        if intrinsic.name == "min":
            return f"vf_to_real(vf_array_min({args[0]}))"
        if intrinsic.name == "max":
            return f"vf_to_real(vf_array_max({args[0]}))"
        if intrinsic.name == "range":
            return f"(vf_to_real(vf_array_max({args[0]})) - vf_to_real(vf_array_min({args[0]})))"
        if intrinsic.name == "count":
            vector_t = _normalize_type(_expr_type(node.args[0], typed))
            if not isinstance(vector_t, ast.FixedVectorType):
                raise CppEmitError("stat.count requires a fixed vector argument")
            return f"static_cast<long long>({_emit_size_expr(vector_t.size)})"
        if intrinsic.name == "variance":
            return f"vf_array_variance({args[0]})"
        if intrinsic.name == "std":
            return f"vf_array_std({args[0]})"
        if intrinsic.name == "median":
            return f"vf_array_median({args[0]})"
        if intrinsic.name == "percentile":
            return f"vf_array_percentile({args[0]}, {args[1]})"
        if intrinsic.name == "iqr":
            return f"vf_array_iqr({args[0]})"
        if intrinsic.name == "zscore":
            return f"vf_array_zscore({args[0]})"
        if intrinsic.name == "normalize":
            return f"vf_array_normalize({args[0]})"
        if intrinsic.name == "covariance":
            return f"vf_array_covariance({args[0]}, {args[1]})"
        if intrinsic.name == "correlation":
            return f"vf_array_correlation({args[0]}, {args[1]})"
        if intrinsic.name == "clamp":
            return f"std::max({args[1]}, std::min({args[2]}, {args[0]}))"
        if intrinsic.name == "sign":
            return f"(({args[0]} > 0) ? 1LL : (({args[0]} < 0) ? -1LL : 0LL))"
    if intrinsic.kind == "io_file":
        if intrinsic.name == "read_text":
            return f"vf_read_file_text({args[0]})"
        if intrinsic.name == "read_bytes":
            return f"vf_read_file_bytes({args[0]})"
    raise CppEmitError(f"unsupported intrinsic {intrinsic.kind}.{intrinsic.name}")


def _emit_symbolic_builtin_call(
    name: str,
    args: list[Any],
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: EmitState,
    typed: TypedModuleInfo,
) -> str | None:
    if name == "same" and len(args) == 2 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        a = _emit_expr(args[0], env, functions, state, typed)
        b = _emit_expr(args[1], env, functions, state, typed)
        return f"vf_sym_same(vf_to_symbolic({a}), vf_to_symbolic({b}))"
    if name == "conditions" and len(args) == 1 and _is_symbolic_type(_expr_type(args[0], typed)):
        a = _emit_expr(args[0], env, functions, state, typed)
        return f"vf_sym_conditions({a})"
    if name in {"latex", "trace"} and args and _is_symbolic_type(_expr_type(args[0], typed)):
        a = _emit_expr(args[0], env, functions, state, typed)
        if name == "latex":
            return f"vf_sym_latex({a})"
        if len(args) != 2:
            raise CppEmitError("trace requires a symbolic expression and direction")
        direction = _emit_expr(args[1], env, functions, state, typed)
        return f"vf_sym_trace({a}, {direction})"
    unary_moves = {
        "cancel": "vf_sym_cancel",
        "canonical": "vf_sym_compute",
        "collect": "vf_sym_collect",
        "complete_square": "vf_sym_complete_square",
        "compute": "vf_sym_compute",
        "expand": "vf_sym_expand",
        "factor": "vf_sym_factor",
        "trig_compress": "vf_sym_trig_compress",
        "trig_expand": "vf_sym_trig_expand",
    }
    if name in unary_moves and len(args) == 1 and _is_symbolic_type(_expr_type(args[0], typed)):
        a = _emit_expr(args[0], env, functions, state, typed)
        return f"{unary_moves[name]}({a})"
    if name == "move" and len(args) == 2 and _is_symbolic_type(_expr_type(args[0], typed)):
        a = _emit_expr(args[0], env, functions, state, typed)
        direction = _emit_expr(args[1], env, functions, state, typed)
        return f"vf_make_symbolic(vf_sym_trace({a}, {direction}))"
    if name == "assume" and len(args) == 2 and _is_symbolic_type(_expr_type(args[0], typed)):
        a = _emit_expr(args[0], env, functions, state, typed)
        condition = _emit_expr(args[1], env, functions, state, typed)
        return f"vf_sym_assume({a}, {condition})"
    if name == "solve" and len(args) >= 3 and _is_symbolic_type(_expr_type(args[0], typed)):
        fields: list[tuple[str, Any]] = []
        for arg in args[1:]:
            if isinstance(arg, (ir.LoadName, ir.LoadSlot)) and _is_symbolic_type(_expr_type(arg, typed)):
                fields.append((arg.name, ast.PrimTypeRef("symbolic")))
        if len(fields) == len(args) - 1:
            record_t = ast.TypeExpr(fields)
            _register_type(record_t, state)
            expr = _emit_expr(args[0], env, functions, state, typed)
            emitted_vars = [_emit_expr(arg, env, functions, state, typed) for arg in args[1:]]
            if len(emitted_vars) == 2:
                state.match_counter += 1
                tmp = f"vf_solve_{state.match_counter}"
                return (
                    f"([&]() {{ auto {tmp} = vf_sym_solve_linear_diophantine2_fields(vf_to_symbolic({expr}), "
                    f"vf_to_symbolic({emitted_vars[0]}), vf_to_symbolic({emitted_vars[1]})); "
                    f"return {_cpp_type(record_t, state)}{{{tmp}[0], {tmp}[1]}}; }}())"
                )
            values = [
                f"vf_make_symbolic(std::string(\"solve(\") + vf_to_symbolic({expr}).text + std::string(\", \") + vf_to_symbolic({var}).text + std::string(\")\"))"
                for var in emitted_vars
            ]
            return f"{_cpp_type(record_t, state)}{{{', '.join(values)}}}"
    if name == "shift" and len(args) == 3 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        expr = _emit_expr(args[0], env, functions, state, typed)
        var = _emit_expr(args[1], env, functions, state, typed)
        step = _emit_expr(args[2], env, functions, state, typed)
        return f"vf_sym_shift(vf_to_symbolic({expr}), vf_to_symbolic({var}), vf_to_symbolic({step}))"
    if name in {"difference", "delta"} and len(args) == 2 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        expr = _emit_expr(args[0], env, functions, state, typed)
        var = _emit_expr(args[1], env, functions, state, typed)
        return f"vf_sym_difference(vf_to_symbolic({expr}), vf_to_symbolic({var}))"
    if name in {"integral", "integrate"} and len(args) == 4 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        expr = _emit_expr(args[0], env, functions, state, typed)
        var = _emit_expr(args[1], env, functions, state, typed)
        start = _emit_expr(args[2], env, functions, state, typed)
        end = _emit_expr(args[3], env, functions, state, typed)
        return f"vf_sym_integral(vf_to_symbolic({expr}), vf_to_symbolic({var}), vf_to_symbolic({start}), vf_to_symbolic({end}))"
    if name == "integ" and len(args) == 4 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        expr = _emit_expr(args[0], env, functions, state, typed)
        var = _emit_expr(args[1], env, functions, state, typed)
        start = _emit_expr(args[2], env, functions, state, typed)
        end = _emit_expr(args[3], env, functions, state, typed)
        return f"vf_sym_integral(vf_to_symbolic({expr}), vf_to_symbolic({var}), vf_to_symbolic({start}), vf_to_symbolic({end}))"
    if name in {"diff", "derivative", "differentiate", "diff_n"} and len(args) == 3 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        expr = _emit_expr(args[0], env, functions, state, typed)
        var = _emit_expr(args[1], env, functions, state, typed)
        order = _emit_expr(args[2], env, functions, state, typed)
        return f"vf_sym_derivative_n(vf_to_symbolic({expr}), vf_to_symbolic({var}), vf_to_symbolic({order}))"
    binary_calculus = {
        "derivative": "vf_sym_derivative",
        "differentiate": "vf_sym_derivative",
        "diff": "vf_sym_derivative",
        "grad": "vf_sym_gradient",
        "gradient": "vf_sym_gradient",
        "integ": "vf_sym_integral",
        "integral": "vf_sym_integral",
        "integrate": "vf_sym_integral",
        "solve": "vf_sym_solve",
        "dsolve": "vf_sym_dsolve",
    }
    if name in binary_calculus and len(args) == 2 and any(_is_symbolic_type(_expr_type(arg, typed)) for arg in args):
        a = _emit_expr(args[0], env, functions, state, typed)
        b = _emit_expr(args[1], env, functions, state, typed)
        return f"{binary_calculus[name]}(vf_to_symbolic({a}), vf_to_symbolic({b}))"
    if name in SYMBOLIC_MATH_INTRINSIC_NAMES and len(args) == 1 and _is_symbolic_type(_expr_type(args[0], typed)):
        a = _emit_expr(args[0], env, functions, state, typed)
        return f"vf_sym_call(\"{name}\", vf_to_symbolic({a}))"
    return None


def _range_expr_from_direct_sum_arg(node: Any) -> ir.RangeExpr | None:
    if isinstance(node, ir.RangeExpr):
        return node
    if isinstance(node, ir.ListExpr) and len(node.elements) == 1 and isinstance(node.elements[0], ir.RangeExpr):
        return node.elements[0]
    return None


def _emit_direct_range_sum(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str | None:
    range_expr = _range_expr_from_direct_sum_arg(node)
    if range_expr is None or range_expr.end is None:
        return None
    if range_expr.start is not None and not isinstance(range_expr.start, ir.Const):
        return None
    if not isinstance(range_expr.end, ir.Const):
        return None
    start = 0 if range_expr.start is None else range_expr.start.value
    end = range_expr.end.value
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    step = 1 if end >= start else -1
    cmp_op = "<=" if step > 0 else ">="
    step_op = "++" if step > 0 else "--"
    start_expr = _emit_const(start)
    end_expr = _emit_const(end)
    return (
        "([&]() { "
        "double vf_sum = 0.0; "
        f"for (long long vf_i = static_cast<long long>({start_expr}); vf_i {cmp_op} static_cast<long long>({end_expr}); {step_op}vf_i) "
        "vf_sum += static_cast<double>(vf_i); "
        "return vf_sum; "
        "}())"
    )


def _match_array_sum_function(fn: ir.FunctionDef, typed: TypedModuleInfo, state: EmitState) -> ArrayReducePattern | None:
    if len(fn.params) != 1 or len(fn.param_types) != 1:
        return None
    param_type = _normalize_type(fn.param_types[0])
    if not isinstance(param_type, ast.FixedVectorType):
        return None
    if not isinstance(_normalize_type(fn.return_type), ast.PrimTypeRef):
        return None
    body = fn.body.statements
    if len(body) != 4:
        return None
    init_i, init_acc, loop_stmt, tail = body
    if not (
        isinstance(init_i, (ir.StoreName, ir.StoreSlot))
        and isinstance(init_acc, (ir.StoreName, ir.StoreSlot))
        and isinstance(loop_stmt, ir.WhileStmt)
        and isinstance(tail, ir.ExprStmt)
        and isinstance(tail.expr, (ir.LoadName, ir.LoadSlot))
    ):
        return None
    if not (isinstance(init_i.value, ir.Const) and init_i.value.value == 0.0):
        return None
    if not (isinstance(init_acc.value, ir.Const) and init_acc.value.value == 0.0):
        return None
    index_name = init_i.name
    acc_name = init_acc.name
    if tail.expr.name != acc_name:
        return None
    cond = loop_stmt.condition
    if not (
        isinstance(cond, ir.BinaryExpr)
        and cond.op == "LT"
        and isinstance(cond.left, (ir.LoadName, ir.LoadSlot))
        and cond.left.name == index_name
    ):
        return None
    loop_body = loop_stmt.body.statements
    if len(loop_body) != 2:
        return None
    acc_update, idx_update = loop_body
    if not (isinstance(acc_update, (ir.StoreName, ir.StoreSlot)) and isinstance(idx_update, (ir.StoreName, ir.StoreSlot))):
        return None
    if acc_update.name != acc_name or idx_update.name != index_name:
        return None
    if not (
        isinstance(acc_update.value, ir.BinaryExpr)
        and acc_update.value.op == "PLUS"
        and isinstance(acc_update.value.left, (ir.LoadName, ir.LoadSlot))
        and acc_update.value.left.name == acc_name
        and isinstance(acc_update.value.right, ir.IndexExpr)
        and isinstance(acc_update.value.right.value, (ir.LoadName, ir.LoadSlot))
        and acc_update.value.right.value.name == fn.params[0]
        and len(acc_update.value.right.indices) == 1
        and isinstance(acc_update.value.right.indices[0], (ir.LoadName, ir.LoadSlot))
        and acc_update.value.right.indices[0].name == index_name
    ):
        return None
    if not (
        isinstance(idx_update.value, ir.BinaryExpr)
        and idx_update.value.op == "PLUS"
        and isinstance(idx_update.value.left, (ir.LoadName, ir.LoadSlot))
        and idx_update.value.left.name == index_name
        and isinstance(idx_update.value.right, ir.Const)
        and idx_update.value.right.value == 1.0
    ):
        return None
    old_name_map = state.current_name_map
    try:
        fn_name_map: dict[str, str] = {name: name for name in fn.params}
        for name, slot in typed.function_slots.get(fn.name, {}).items():
            if name in fn_name_map:
                continue
            fn_name_map[name] = f"vf_s{slot}_{name}"
        state.current_name_map = fn_name_map
        bound_expr = _emit_expr(cond.right, {fn.params[0]: param_type}, {fn.name: fn}, state, typed)
    finally:
        state.current_name_map = old_name_map
    return ArrayReducePattern(
        vector_name=fn.params[0],
        index_name=index_name,
        acc_name=acc_name,
        bound_expr=bound_expr,
    )


def _emit_expr(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    if isinstance(node, ir.Const):
        return _emit_const(node.value)
    if isinstance(node, ir.LoadName):
        if node.name == "inf":
            return 'vf_make_symbolic("inf")'
        return _cpp_name(node.name, state)
    if isinstance(node, ir.LoadSlot):
        return _cpp_name(node.name, state)
    if isinstance(node, ir.CoerceExpr):
        inner = _emit_expr(node.expr, env, functions, state, typed)
        t = _normalize_type(node.target_type)
        if isinstance(t, ast.FixedVectorType):
            return _emit_vector_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.MultisetType):
            return _emit_multiset_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.MapValueType):
            return _emit_map_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.LinkedListValueType):
            return _emit_linked_list_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.TypeExpr):
            if isinstance(node.expr, ir.StructExpr):
                return _emit_record_coercion(node, env, functions, state, typed)
            return inner
        if isinstance(t, ast.SymbolicValueType):
            return f"vf_to_symbolic({inner})"
        if not isinstance(t, ast.PrimTypeRef):
            raise CppEmitError("only primitive coercions are supported in C++ emission")
        if t.name == "num":
            if isinstance(node.expr, ir.Const) and isinstance(node.expr.value, int) and not isinstance(node.expr.value, bool):
                return f"vf_to_num({node.expr.value}.0)"
            return f"vf_to_num({inner})"
        if t.name == "int":
            return f"vf_to_int({inner})"
        if t.name == "rational":
            return f"vf_to_rational({inner})"
        if t.name == "symbolic":
            return f"vf_to_symbolic({inner})"
        if t.name == "bit":
            return f"vf_to_bool({inner})"
        if t.name == "str":
            return f"vf_to_str({inner})"
        raise CppEmitError(f"unsupported coercion target {t.name}")
    if isinstance(node, ir.ListExpr):
        return _emit_list_literal(node, env, functions, state, typed)
    if isinstance(node, ir.RangeExpr):
        return _emit_range_expr(node, env, functions, state, typed)
    if isinstance(node, ir.MapExpr):
        return _emit_map_literal(node, env, functions, state, typed)
    if isinstance(node, ir.LinkedListExpr):
        return _emit_linked_list_literal(node, env, functions, state, typed)
    if isinstance(node, ir.MultisetExpr):
        return _emit_multiset_literal(node, env, functions, state, typed)
    if isinstance(node, ir.StructExpr):
        return _emit_struct_literal(node, env, functions, state, typed)
    if isinstance(node, ir.AttrExpr):
        intrinsic = resolve_native_intrinsic(node)
        if intrinsic is not None and intrinsic.kind == "math_const":
            emitted = _emit_intrinsic_call(ir.CallExpr(node, []), env, functions, state, typed)
            if emitted is not None:
                return emitted
        base_type = _normalize_type(_expr_type(node.value, typed))
        if isinstance(base_type, ast.MapValueType):
            return _emit_map_attr_access(node, env, functions, state, typed)
        base_expr = _emit_expr(node.value, env, functions, state, typed)
        return f"{base_expr}.{node.name}"
    if isinstance(node, ir.IndexExpr):
        base_type = _normalize_type(_expr_type(node.value, typed))
        if not isinstance(base_type, ast.FixedVectorType):
            raise CppEmitError("index access currently requires a fixed-vector type in C++ emission")
        expr = _emit_expr(node.value, env, functions, state, typed)
        current_t = base_type
        for idx in node.indices:
            idx_expr = _emit_expr(idx, env, functions, state, typed)
            expr = f"{expr}[static_cast<std::size_t>({idx_expr})]"
            current_t = _normalize_type(current_t.element_type) if isinstance(current_t, ast.FixedVectorType) else current_t
        return expr
    if isinstance(node, ir.BindExpr):
        return (
            "([&]() -> decltype(auto) { "
            f"{_emit_lvalue(node.target, env, functions, state, typed)} = "
            f"{_emit_expr(node.value, env, functions, state, typed)}; "
            f"return {_emit_lvalue(node.target, env, functions, state, typed)}; "
            "}())"
        )
    if isinstance(node, ir.UnaryExpr):
        inner = _emit_expr(node.operand, env, functions, state, typed)
        if node.op == "MINUS":
            if _is_symbolic_type(_expr_type(node.operand, typed)):
                return f"(-vf_to_symbolic({inner}))"
            return f"(-{inner})"
        if node.op == "NOT":
            return f"(!{inner})"
        raise CppEmitError(f"unsupported unary op {node.op}")
    if isinstance(node, ir.BinaryExpr):
        left = _emit_expr(node.left, env, functions, state, typed)
        right = _emit_expr(node.right, env, functions, state, typed)
        left_type = _expr_type(node.left, typed)
        right_type = _expr_type(node.right, typed)
        coll = _emit_collection_binary(node, left, right, left_type, right_type, env, functions, state, typed)
        if coll is not None:
            return coll
        lt_n = _normalize_type(left_type)
        rt_n = _normalize_type(right_type)
        if _is_symbolic_type(lt_n) or _is_symbolic_type(rt_n):
            left = f"vf_to_symbolic({left})"
            right = f"vf_to_symbolic({right})"
            if node.op == "AMPERSAND":
                return f"vf_sym_binop({left}, \"&\", {right})"
            if node.op == "CARET":
                return f"vf_sym_pow({left}, {right})"
            if node.op in {"EQ", "NEQ"}:
                return f"vf_sym_relation({left}, \"{'=' if node.op == 'EQ' else '!='}\", {right})"
            if node.op in {"PLUS", "MINUS", "STAR", "SLASH"}:
                return f"({left} { {'PLUS': '+', 'MINUS': '-', 'STAR': '*', 'SLASH': '/'}[node.op] } {right})"
            raise CppEmitError(f"unsupported symbolic binary op {node.op}")
        if node.op == "CARET":
            return f"std::pow({left}, {right})"
        op_map = {
            "PLUS": "+",
            "MINUS": "-",
            "STAR": "*",
            "SLASH": "/",
            "FLOOR_DIV": "/",
            "PERCENT": "%",
            "EQ": "==",
            "NEQ": "!=",
            "LT": "<",
            "LE": "<=",
            "GT": ">",
            "GE": ">=",
            "AND": "&&",
            "OR": "||",
        }
        if node.op == "XOR":
            return f"(static_cast<bool>({left}) != static_cast<bool>({right}))"
        if (
            isinstance(lt_n, ast.PrimTypeRef)
            and isinstance(rt_n, ast.PrimTypeRef)
            and "rational" in {lt_n.name, rt_n.name}
            and node.op in {"PLUS", "MINUS", "STAR", "SLASH", "EQ", "NEQ", "LT", "LE", "GT", "GE"}
        ):
            left = f"vf_to_rational({left})"
            right = f"vf_to_rational({right})"
        elif (
            isinstance(lt_n, ast.PrimTypeRef)
            and isinstance(rt_n, ast.PrimTypeRef)
            and "num" in {lt_n.name, rt_n.name}
            and node.op in {"PLUS", "MINUS", "STAR", "SLASH", "EQ", "NEQ"}
        ):
            left = f"vf_to_num({left})"
            right = f"vf_to_num({right})"
        if node.op in {"LT", "LE", "GT", "GE"}:
            if (
                isinstance(lt_n, ast.PrimTypeRef)
                and isinstance(rt_n, ast.PrimTypeRef)
                and "num" in {lt_n.name, rt_n.name}
            ):
                helper = {"LT": "vf_num_lt", "LE": "vf_num_le", "GT": "vf_num_gt", "GE": "vf_num_ge"}[node.op]
                return f"{helper}(vf_to_num({left}), vf_to_num({right}))"
        if node.op == "AMPERSAND":
            return f"({left} + {right})"
        if node.op not in op_map:
            raise CppEmitError(f"unsupported binary op {node.op}")
        return f"({left} {op_map[node.op]} {right})"
    if isinstance(node, ir.CallExpr):
        intrinsic = _emit_intrinsic_call(node, env, functions, state, typed)
        if intrinsic is not None:
            return intrinsic
        if isinstance(node.func, ir.AttrExpr) and node.func.name == "length" and not node.args and not node.kwargs and not node.spreads:
            base = _emit_expr(node.func.value, env, functions, state, typed)
            return f"static_cast<long long>({base}.size())"
        if isinstance(node.func, ir.AttrExpr):
            func_t = _expr_type(node.func, typed)
            if isinstance(func_t, StdlibFunctionType) and func_t.module_name == "symbolic":
                symbolic_call = _emit_symbolic_builtin_call(func_t.name, node.args, env, functions, state, typed)
                if symbolic_call is not None:
                    return symbolic_call
            raise CppEmitError("only direct named calls are supported in C++ emission")
        if not isinstance(node.func, ir.LoadName):
            raise CppEmitError("only direct named calls are supported in C++ emission")
        fname = _cpp_name(node.func.name, state) if node.func.name not in functions and node.func.name not in {"bit", "int", "rational", "num", "symbolic", "chr", "str"} else node.func.name
        args = ", ".join(_emit_expr(a, env, functions, state, typed) for a in node.args)
        if fname == "int":
            return f"vf_to_int({args})"
        if fname == "num":
            return f"vf_to_num({args})"
        if fname == "rational":
            if len(node.args) == 2:
                emitted_args = [_emit_expr(a, env, functions, state, typed) for a in node.args]
                return f"vf_make_rational(vf_to_int({emitted_args[0]}), vf_to_int({emitted_args[1]}))"
            return f"vf_to_rational({args})"
        if fname == "symbolic":
            return f"vf_to_symbolic({args})"
        if isinstance(env.get(node.func.name), StdlibFunctionType) and env[node.func.name].module_name == "symbolic":
            symbolic_call = _emit_symbolic_builtin_call(node.func.name, node.args, env, functions, state, typed)
            if symbolic_call is not None:
                return symbolic_call
        if fname == "bit":
            return f"vf_to_bool({args})"
        if fname == "chr":
            return f"vf_to_str({args})"
        if fname == "str":
            return f"vf_to_str({args})"
        if node.func.name in functions and node.func.name in CPP_STD_CONFLICT_NAMES:
            return f"::{node.func.name}({args})"
        return f"{fname}({args})"
    raise CppEmitError(f"unsupported expression emission for {type(node).__name__}")


def _emit_print(expr: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    t = _expr_type(expr, typed)
    code = _emit_expr(expr, env, functions, state, typed)
    if isinstance(t, (ast.FixedVectorType, ast.TypeExpr, ast.MultisetType, ast.MapValueType, ast.LinkedListValueType)):
        return f"std::cout << vf_format_value({code}) << \"\\n\";"
    if isinstance(t, ast.SymbolicValueType):
        return f"std::cout << vf_format_symbolic({code}) << \"\\n\";"
    if not isinstance(t, ast.PrimTypeRef):
        raise CppEmitError("only primitive print values are supported in C++ emission")
    if t.name == "bit":
        return f'std::cout << ({code} ? "true" : "false") << "\\n";'
    if t.name == "int":
        return f"std::cout << {code} << \"\\n\";"
    if t.name == "num":
        return f"std::cout << vf_format_num({code}) << \"\\n\";"
    if t.name == "rational":
        return f"std::cout << vf_format_rational({code}) << \"\\n\";"
    if t.name == "symbolic":
        return f"std::cout << vf_format_symbolic({code}) << \"\\n\";"
    if t.name in {"chr", "str"}:
        return f"std::cout << {code} << \"\\n\";"
    raise CppEmitError(f"unsupported print type {t.name}")


def _emit_lvalue(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return _cpp_name(node.name, state)
    if isinstance(node, ir.AttrExpr):
        base = _emit_lvalue(node.value, env, functions, state, typed)
        return f"{base}.{node.name}"
    if isinstance(node, ir.IndexExpr):
        base = _emit_lvalue(node.value, env, functions, state, typed)
        current_t = _normalize_type(_expr_type(node.value, typed))
        for idx in node.indices:
            if not isinstance(current_t, ast.FixedVectorType):
                raise CppEmitError("index assignment currently requires a fixed-vector lvalue in C++ emission")
            idx_expr = _emit_expr(idx, env, functions, state, typed)
            base = f"{base}[static_cast<std::size_t>({idx_expr})]"
            current_t = _normalize_type(current_t.element_type)
        return base
    raise CppEmitError(f"unsupported assignment target for C++ emission: {type(node).__name__}")


def _emit_bind_expr_stmt(node: ir.BindExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, state: EmitState, typed: TypedModuleInfo) -> str:
    return f"{indent}{_emit_lvalue(node.target, env, functions, state, typed)} = {_emit_expr(node.value, env, functions, state, typed)};"


def _emit_stmt(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, state: EmitState, typed: TypedModuleInfo) -> tuple[list[str], dict[str, Any]]:
    lines: list[str] = []
    env = dict(env)
    if isinstance(node, ir.TypeDef):
        _register_type(node.type_expr, state)
        return lines, env
    if isinstance(node, ir.StoreName):
        expr_type = _expr_type(node.value, typed)
        declared = _normalize_type(node.declared_type) if node.declared_type is not None else None
        final_type = declared if declared is not None else expr_type
        cpp_name = _cpp_name(node.name, state)
        if node.name in env:
            inplace = _emit_inplace_fused_array_store(node.name, node.value, final_type, env, functions, indent, state, typed)
            if inplace is not None:
                lines.extend(inplace)
            else:
                lines.append(f"{indent}{cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        else:
            lines.append(f"{indent}{_cpp_type(final_type, state)} {cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        env[node.name] = final_type
        return lines, env
    if isinstance(node, ir.StoreSlot):
        expr_type = _expr_type(node.value, typed)
        declared = _normalize_type(node.declared_type) if node.declared_type is not None else None
        final_type = declared if declared is not None else expr_type
        cpp_name = _cpp_name(node.name, state)
        if node.name in env:
            inplace = _emit_inplace_fused_array_store(node.name, node.value, final_type, env, functions, indent, state, typed)
            if inplace is not None:
                lines.extend(inplace)
            else:
                lines.append(f"{indent}{cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        else:
            lines.append(f"{indent}{_cpp_type(final_type, state)} {cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        env[node.name] = final_type
        return lines, env
    if isinstance(node, ir.PrintStmt):
        lines.append(indent + _emit_print(node.value, env, functions, state, typed))
        return lines, env
    if isinstance(node, ir.ExprStmt):
        if isinstance(node.expr, ir.BindExpr):
            lines.append(_emit_bind_expr_stmt(node.expr, env, functions, indent, state, typed))
            return lines, env
        lines.append(f"{indent}{_emit_expr(node.expr, env, functions, state, typed)};")
        return lines, env
    if isinstance(node, ir.IfStmt):
        cond = _emit_expr(node.condition, env, functions, state, typed)
        lines.append(f"{indent}if ({cond}) {{")
        body_lines, _ = _emit_block(node.body, env, functions, indent + "    ", function_mode=False, state=state, typed=typed)
        lines.extend(body_lines)
        lines.append(f"{indent}}}")
        return lines, env
    if isinstance(node, ir.WhileStmt):
        cond = _emit_expr(node.condition, env, functions, state, typed)
        lines.append(f"{indent}while ({cond}) {{")
        body_lines, _ = _emit_block(node.body, env, functions, indent + "    ", function_mode=False, state=state, typed=typed)
        lines.extend(body_lines)
        lines.append(f"{indent}}}")
        return lines, env
    if isinstance(node, ir.MatchStmt):
        if node.loop:
            lines.append(f"{indent}while (true) {{")
            inner_lines = _emit_match_body(node, env, functions, indent + "    ", state, typed)
            lines.extend(inner_lines)
            lines.append(f"{indent}}}")
            return lines, env
        lines.extend(_emit_match_body(node, env, functions, indent, state, typed))
        return lines, env
    if isinstance(node, ir.ContinueStmt):
        lines.append(f"{indent}continue;")
        return lines, env
    if isinstance(node, ir.BreakStmt):
        lines.append(f"{indent}break;")
        return lines, env
    if isinstance(node, ir.ReturnStmt):
        if node.value is None:
            lines.append(f"{indent}return;")
        else:
            lines.append(f"{indent}return {_emit_expr(node.value, env, functions, state, typed)};")
        return lines, env
    raise CppEmitError(f"unsupported statement emission for {type(node).__name__}")


def _emit_block(block: ir.Block, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, *, function_mode: bool, state: EmitState, typed: TypedModuleInfo) -> tuple[list[str], dict[str, Any]]:
    lines: list[str] = []
    cur_env = dict(env)
    for idx, stmt in enumerate(block.statements):
        if function_mode and idx == len(block.statements) - 1 and isinstance(stmt, ir.ExprStmt):
            lines.append(f"{indent}return {_emit_expr(stmt.expr, cur_env, functions, state, typed)};")
            continue
        emitted, cur_env = _emit_stmt(stmt, cur_env, functions, indent, state, typed)
        lines.extend(emitted)
    return lines, cur_env


def _emit_match_body(node: ir.MatchStmt, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, state: EmitState, typed: TypedModuleInfo) -> list[str]:
    lines: list[str] = []
    disc_name = f"vf_match_{state.match_counter:04d}"
    state.match_counter += 1
    lines.append(f"{indent}auto {disc_name} = {_emit_expr(node.discriminant, env, functions, state, typed)};")
    best_name = f"{disc_name}_best"
    chosen_name = f"{disc_name}_chosen"
    default_name = f"{disc_name}_default"
    lines.append(f"{indent}int {best_name} = -1;")
    lines.append(f"{indent}int {chosen_name} = -1;")
    lines.append(f"{indent}int {default_name} = -1;")
    for idx, arm in enumerate(node.arms):
        if arm.condition is None:
            lines.append(f"{indent}{default_name} = {idx};")
            continue
        cond_name = f"{disc_name}_arm_{idx}"
        cond_expr = _emit_expr(arm.condition, env, functions, state, typed)
        cond_type = _expr_type(arm.condition, typed)
        lines.append(f"{indent}{_cpp_type(cond_type, state)} {cond_name} = {cond_expr};")
        lines.append(f"{indent}{{")
        lines.append(f"{indent}    int vf_spec = vf_match_specificity({disc_name}, {cond_name});")
        lines.append(f"{indent}    if (vf_spec < 0) vf_spec = vf_match_specificity({cond_name}, {disc_name});")
        lines.append(f"{indent}    if (vf_spec > {best_name}) {{")
        lines.append(f"{indent}        {best_name} = vf_spec;")
        lines.append(f"{indent}        {chosen_name} = {idx};")
        lines.append(f"{indent}    }}")
        lines.append(f"{indent}}}")
    lines.append(f"{indent}if ({chosen_name} < 0) {chosen_name} = {default_name};")
    if node.loop:
        lines.append(f"{indent}if ({chosen_name} < 0) break;")
    first = True
    for idx, arm in enumerate(node.arms):
        kw = "if" if first else "else if"
        lines.append(f"{indent}{kw} ({chosen_name} == {idx}) {{")
        body_lines, _ = _emit_block(arm.body, env, functions, indent + "    ", function_mode=False, state=state, typed=typed)
        lines.extend(body_lines)
        lines.append(f"{indent}}}")
        first = False
    return lines


def _collect_types_from_expr(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState) -> Any:
    t = _infer_expr_type(node, env, functions)
    _register_type(t, state)
    if isinstance(node, ir.CoerceExpr):
        _register_type(node.target_type, state)
        _collect_types_from_expr(node.expr, env, functions, state)
    elif isinstance(node, ir.BindExpr):
        _collect_types_from_expr(node.target, env, functions, state)
        _collect_types_from_expr(node.value, env, functions, state)
    elif isinstance(node, ir.CallExpr):
        for arg in node.args:
            _collect_types_from_expr(arg, env, functions, state)
    elif isinstance(node, ir.ListExpr):
        for elem in node.elements:
            _collect_types_from_expr(elem, env, functions, state)
    elif isinstance(node, ir.MapExpr):
        for _, value in node.fields:
            _collect_types_from_expr(value, env, functions, state)
    elif isinstance(node, ir.LinkedListExpr):
        for elem in node.elements:
            _collect_types_from_expr(elem, env, functions, state)
        if node.spread is not None:
            _collect_types_from_expr(node.spread, env, functions, state)
    elif isinstance(node, ir.MultisetExpr):
        for value, count in node.pairs:
            _collect_types_from_expr(value, env, functions, state)
            _collect_types_from_expr(count, env, functions, state)
    elif isinstance(node, ir.StructExpr):
        for _, value in node.fields:
            _collect_types_from_expr(value, env, functions, state)
    elif isinstance(node, ir.AttrExpr):
        _collect_types_from_expr(node.value, env, functions, state)
    elif isinstance(node, ir.IndexExpr):
        _collect_types_from_expr(node.value, env, functions, state)
        for idx in node.indices:
            _collect_types_from_expr(idx, env, functions, state)
    elif isinstance(node, ir.UnaryExpr):
        _collect_types_from_expr(node.operand, env, functions, state)
    elif isinstance(node, ir.BinaryExpr):
        _collect_types_from_expr(node.left, env, functions, state)
        _collect_types_from_expr(node.right, env, functions, state)
    return t


def _collect_types_from_block(block: ir.Block, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState) -> dict[str, Any]:
    cur_env = dict(env)
    for stmt in block.statements:
        if isinstance(stmt, ir.TypeDef):
            _register_type(stmt.type_expr, state)
        elif isinstance(stmt, ir.StoreName):
            expr_t = _collect_types_from_expr(stmt.value, cur_env, functions, state)
            final_t = _normalize_type(stmt.declared_type) if stmt.declared_type is not None else expr_t
            _register_type(final_t, state)
            cur_env[stmt.name] = final_t
        elif isinstance(stmt, ir.PrintStmt):
            _collect_types_from_expr(stmt.value, cur_env, functions, state)
        elif isinstance(stmt, ir.ExprStmt):
            _collect_types_from_expr(stmt.expr, cur_env, functions, state)
        elif isinstance(stmt, ir.IfStmt):
            _collect_types_from_expr(stmt.condition, cur_env, functions, state)
            _collect_types_from_block(stmt.body, cur_env, functions, state)
        elif isinstance(stmt, ir.WhileStmt):
            _collect_types_from_expr(stmt.condition, cur_env, functions, state)
            _collect_types_from_block(stmt.body, cur_env, functions, state)
        elif isinstance(stmt, ir.MatchStmt):
            _collect_types_from_expr(stmt.discriminant, cur_env, functions, state)
            for arm in stmt.arms:
                if arm.condition is not None:
                    _collect_types_from_expr(arm.condition, cur_env, functions, state)
                _collect_types_from_block(arm.body, cur_env, functions, state)
        elif isinstance(stmt, ir.ReturnStmt) and stmt.value is not None:
            _collect_types_from_expr(stmt.value, cur_env, functions, state)
    return cur_env


def _emit_struct_def(name: str, type_expr: ast.TypeExpr, state: EmitState) -> list[str]:
    lines = [f"struct {name} {{"]
    for fname, ftype in type_expr.fields:
        lines.append(f"    {_cpp_type(ftype, state)} {fname};")
    lines.append("};")
    lines.append(f"static std::string vf_format_value(const {name}& v) {{")
    lines.append("    std::ostringstream oss;")
    lines.append('    oss << "(";')
    for idx, (fname, _) in enumerate(type_expr.fields):
        prefix = '    ' if idx == 0 else '    '
        if idx > 0:
            lines.append('    oss << ", ";')
        lines.append(f'    oss << "{fname}:" << vf_format_value(v.{fname});')
    lines.append('    oss << ")";')
    lines.append("    return oss.str();")
    lines.append("}")
    lines.append("")
    return lines


def _emit_struct_defs_in_order(state: EmitState) -> list[str]:
    out: list[str] = []
    emitted: set[str] = set()

    def visit_type(t: Any) -> None:
        t = _normalize_type(t)
        if isinstance(t, ast.TypeExpr):
            name = _struct_name(t)
            if name in emitted:
                return
            for _, inner in t.fields:
                visit_type(inner)
            out.extend(_emit_struct_def(name, t, state))
            emitted.add(name)
            return
        if isinstance(t, ast.FixedVectorType):
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MultisetType):
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MapValueType):
            for _, inner in t.fields:
                visit_type(inner)
            return
        if isinstance(t, ast.LinkedListValueType):
            for inner in t.elements:
                visit_type(inner)
            return
        if isinstance(t, ast.TupleTypeExpr):
            for inner in t.elements:
                visit_type(inner)
            return

    for name in list(state.struct_defs):
        visit_type(state.struct_defs[name])
    return out


def emit_cpp_module(module: ir.Module) -> str:
    prepared = _prepare_native_module(module)
    module = prepared.module
    typed = prepared.typed
    features = _collect_runtime_features(module, typed)
    state = EmitState()
    functions = prepared.functions
    for typ in typed.expr_types.values():
        _register_type(typ, state)
    for stmt in module.statements:
        if isinstance(stmt, ir.TypeDef):
            _register_type(stmt.type_expr, state)
            continue
        if not isinstance(stmt, ir.FunctionDef):
            continue
        for ptype in stmt.param_types:
            if ptype is not None:
                _register_type(ptype, state)
        if stmt.return_type is not None:
            _register_type(stmt.return_type, state)
    headers = _emit_runtime_headers(features) + _emit_runtime_support(features)
    struct_lines = _emit_struct_defs_in_order(state)
    fn_lines: list[str] = []
    for fn in module.statements:
        if not isinstance(fn, ir.FunctionDef):
            continue
        if fn.return_type is None:
            raise CppEmitError(f"function {fn.name} needs an explicit return type for C++ emission")
        size_vars: set[str] = set()
        for ptype in fn.param_types:
            if ptype is not None:
                _collect_size_vars(ptype, size_vars)
        _collect_size_vars(fn.return_type, size_vars)
        if size_vars:
            fn_lines.append(
                "template <" + ", ".join(f"std::size_t {name}" for name in sorted(size_vars)) + ">"
            )
        ret_cpp = _cpp_type(fn.return_type, state)
        param_bits: list[str] = []
        local_env: dict[str, Any] = _stdlib_env(module)
        for name, ptype in zip(fn.params, fn.param_types):
            if ptype is None:
                raise CppEmitError(f"function {fn.name} parameter {name} needs an explicit type for C++ emission")
            param_bits.append(_cpp_param_decl(name, ptype, state, mutable_value=_function_mutates_param(fn, name)))
            local_env[name] = _normalize_type(ptype)
        old_name_map = state.current_name_map
        fn_name_map: dict[str, str] = {name: name for name in fn.params}
        for name, slot in typed.function_slots.get(fn.name, {}).items():
            if name in fn_name_map:
                continue
            fn_name_map[name] = f"vf_s{slot}_{name}"
        state.current_name_map = fn_name_map
        fn_lines.append(f"{ret_cpp} {fn.name}({', '.join(param_bits)}) {{")
        reduction = _match_array_sum_function(fn, typed, state)
        if reduction is not None:
            vec_cpp = _cpp_name(reduction.vector_name, state)
            fn_lines.append(f"    {ret_cpp} {_cpp_name(reduction.acc_name, state)}{{}};")
            fn_lines.append(
                f"    for (std::size_t {_cpp_name(reduction.index_name, state)} = 0; "
                f"{_cpp_name(reduction.index_name, state)} < static_cast<std::size_t>({reduction.bound_expr}); "
                f"++{_cpp_name(reduction.index_name, state)}) {{"
            )
            fn_lines.append(
                f"        {_cpp_name(reduction.acc_name, state)} += "
                f"{vec_cpp}[{_cpp_name(reduction.index_name, state)}];"
            )
            fn_lines.append("    }")
            fn_lines.append(f"    return {_cpp_name(reduction.acc_name, state)};")
        else:
            body_lines, _ = _emit_block(fn.body, local_env, functions, "    ", function_mode=True, state=state, typed=typed)
            fn_lines.extend(body_lines)
        fn_lines.append("}")
        fn_lines.append("")
        state.current_name_map = old_name_map
    main_lines = ["int main() {"] 
    env: dict[str, Any] = _stdlib_env(module)
    for stmt in module.statements:
        if isinstance(stmt, (ir.FunctionDef, ir.TypeDef)):
            continue
        emitted, env = _emit_stmt(stmt, env, functions, "    ", state, typed)
        main_lines.extend(emitted)
    main_lines.append("    return 0;")
    main_lines.append("}")
    return "\n".join(headers + struct_lines + fn_lines + main_lines) + "\n"


def emit_cpp_from_tokens(tokens: list[Any]) -> str:
    from .ir import lower_module
    from .parser import parse_tokens

    mod = parse_tokens(tokens)
    lowered = lower_module(mod)
    return emit_cpp_module(lowered)


def emit_cpp_from_token_stream_json(payload: str) -> str:
    from .ir import lower_module
    from .parser import parse_token_stream_json

    mod = parse_token_stream_json(payload)
    lowered = lower_module(mod)
    return emit_cpp_module(lowered)


def emit_cpp_from_source_file(path: Path) -> str:
    return emit_cpp_from_source_text(path.read_text(encoding="utf-8"), filename=str(path))


def emit_cpp_from_source_text(source: str, filename: str) -> str:
    from .parser import parse_module
    from .ir import lower_module

    mod = parse_module(source, filename=filename)
    lowered = lower_module(mod)
    return emit_cpp_module(lowered)


def emit_cpp_for_package_mode(
    mode: str,
    source: str | None,
    filename: str,
    *,
    filename_label: str | None = None,
) -> str:
    resolved_mode = package_mode(mode)
    if resolved_mode.name == "native_core":
        from .native_frontend import emit_cpp_from_native_subset

        return emit_cpp_from_native_subset(
            source,
            filename,
            subset="native_core",
            filename_label=filename_label,
        )

    if source is None:
        source = Path(filename).read_text(encoding="utf-8")
    return emit_cpp_from_source_text(source, filename)


def package_program(
    mode: str,
    source: str | None,
    package_source: NativePackageSource,
    *,
    out_dir: Path,
) -> NativePackageResult:
    resolved_mode = package_mode(mode)
    cpp_source = emit_cpp_for_package_mode(
        resolved_mode.name,
        source,
        package_source.filename,
        filename_label=package_source.source_label,
    )
    return build_native_package(
        cpp_source,
        NativePackageSpec(
            package_dir=out_dir,
            package_name=package_source.package_name,
            entrypoint=resolved_mode.entrypoint,
            subset=resolved_mode.subset,
            source_input=package_source.source_input,
            source_label=package_source.source_label,
            build_host_python_required=resolved_mode.build_host_python_required,
            runtime_python_required=False,
        ),
    )


def build_cpp_module(module: ir.Module, out_dir: Path, exe_name: str = "vf_program") -> Path:
    return build_cpp_module_view(module, out_dir, exe_name=exe_name).executable_path


def build_cpp_module_view(module: ir.Module, out_dir: Path, exe_name: str = "vf_program") -> CppBuildSurfaceView:
    return compile_cpp_source_view(emit_cpp_module(module), out_dir, exe_name=exe_name)


def build_cpp_from_tokens(tokens: list[Any], out_dir: Path, exe_name: str = "vf_program") -> Path:
    return build_cpp_from_tokens_view(tokens, out_dir, exe_name=exe_name).executable_path


def build_cpp_from_tokens_view(tokens: list[Any], out_dir: Path, exe_name: str = "vf_program") -> CppBuildSurfaceView:
    return compile_cpp_source_view(emit_cpp_from_tokens(tokens), out_dir, exe_name=exe_name)


def build_cpp_from_token_stream_json(payload: str, out_dir: Path, exe_name: str = "vf_program") -> Path:
    return build_cpp_from_token_stream_json_view(payload, out_dir, exe_name=exe_name).executable_path


def build_cpp_from_token_stream_json_view(
    payload: str,
    out_dir: Path,
    exe_name: str = "vf_program",
) -> CppBuildSurfaceView:
    return compile_cpp_source_view(emit_cpp_from_token_stream_json(payload), out_dir, exe_name=exe_name)


def build_cpp_from_source_file(path: Path, out_dir: Path, exe_name: str | None = None) -> Path:
    return build_cpp_from_source_file_view(path, out_dir, exe_name=exe_name).executable_path


def build_cpp_from_source_file_view(
    path: Path,
    out_dir: Path,
    exe_name: str | None = None,
) -> CppBuildSurfaceView:
    artifact_name = path.stem if exe_name is None else exe_name
    return compile_cpp_source_view(emit_cpp_from_source_file(path), out_dir, exe_name=artifact_name)


def compile_and_run_module(module: ir.Module) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory(prefix="vf_cpp_") as td:
        build = build_cpp_module_view(module, Path(td))
        return run_cpp_executable(build.executable_path)
