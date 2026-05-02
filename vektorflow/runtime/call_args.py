"""Function-call argument binding shared by AST and IR execution."""

from __future__ import annotations

from typing import Any

from ..errors import EvalError
from .axis_tagged import axis_tagged_data
from .collections_runtime import runtime_collection_expanded_values, runtime_collection_kind
from .struct_value import VF_TYPE_KEY, is_struct_dict
from .vmap import VMap


_UNSET = object()


def bind_function_call_args(
    param_names: list[str],
    args: list[Any],
    kw: dict[str, Any] | None = None,
    spreads: list[Any] | None = None,
) -> list[Any]:
    """Bind positional, named, and ``:`` spill arguments to a function signature."""
    kw = kw or {}
    spreads = spreads or []
    bound: list[Any] = [_UNSET] * len(param_names)
    cursor = 0

    def bind_next(value: Any) -> None:
        nonlocal cursor
        while cursor < len(bound) and bound[cursor] is not _UNSET:
            cursor += 1
        if cursor >= len(bound):
            raise EvalError("too many positional arguments")
        bound[cursor] = value
        cursor += 1

    def bind_named(name: str, value: Any) -> None:
        if name not in param_names:
            raise EvalError(f"unknown argument {name!r}")
        idx = param_names.index(name)
        if bound[idx] is not _UNSET:
            raise EvalError(f"duplicate argument {name!r}")
        bound[idx] = value

    for arg in args:
        bind_next(arg)
    for name, value in kw.items():
        bind_named(name, value)
    for spread in spreads:
        named = _named_spill_values(spread)
        if named is not None:
            for name, value in named.items():
                bind_named(name, value)
            continue
        for value in _positional_spill_values(spread):
            bind_next(value)

    missing = [name for name, value in zip(param_names, bound) if value is _UNSET]
    if missing:
        raise EvalError(f"missing argument {missing[0]!r}")
    return list(bound)


def _named_spill_values(value: Any) -> dict[str, Any] | None:
    value = axis_tagged_data(value)
    if isinstance(value, VMap):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise EvalError("map argument spill requires string keys")
            out[key] = item
        return out
    if is_struct_dict(value):
        return {str(key): item for key, item in value.items() if key != VF_TYPE_KEY}
    return None


def _positional_spill_values(value: Any) -> tuple[Any, ...]:
    value = axis_tagged_data(value)
    if runtime_collection_kind(value) in {"map", "multiset"}:
        raise EvalError("argument spill requires a vector/list/tuple or record/map value")
    try:
        return runtime_collection_expanded_values(value)
    except TypeError as exc:
        raise EvalError("argument spill requires a vector/list/tuple or record/map value") from exc
