"""Runtime branch selection for ``??`` and ``!?``.

This module is the seam for VKF's branch-selection contract. Callers evaluate
arm expressions, then ask this module which arm wins. Exact scalar arms use a
lookup table; event, type, and error arms use specificity scores.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable

from ..errors import ErrorTypeValue, error_type_match_specificity
from ..stdlib.events import event_match_specificity
from .struct_value import get_spill_base, struct_has_spill_base
from .type_values import infer_type, is_type_value, type_match_specificity


@dataclass(frozen=True)
class BranchCandidate:
    """One evaluated branch pattern and its original arm."""

    arm: Any
    pattern: Any
    order: int


@dataclass(frozen=True)
class BranchSelection:
    """The selected branch plus the score explaining why it won."""

    arm: Any | None
    score: int | None = None
    defaulted: bool = False


def _exact_key(value: Any) -> tuple[type[Any], Any] | None:
    """Return a stable exact lookup key for hashable scalar branch subjects."""
    if value is None or isinstance(value, (bool, int, float, str)):
        try:
            hash(value)
        except TypeError:
            return None
        return (type(value), value)
    return None


def branch_match_specificity(
    subject: Any,
    pattern: Any,
    *,
    exact_match: Callable[[Any, Any], bool],
    type_registry: Any,
    event_object_code: Callable[[Any], int | None],
) -> int | None:
    """Return specificity for one branch pattern, or ``None`` when unmatched."""
    if exact_match(subject, pattern):
        return 1_000_000
    if isinstance(subject, dict) and struct_has_spill_base(subject):
        delegated = branch_match_specificity(
            get_spill_base(subject),
            pattern,
            exact_match=exact_match,
            type_registry=type_registry,
            event_object_code=event_object_code,
        )
        if delegated is not None:
            return delegated + 5
    subject_event_code = event_object_code(subject)
    if subject_event_code is not None and isinstance(pattern, int):
        score = event_match_specificity(subject_event_code, pattern)
        if score is not None:
            return score
        return event_match_specificity(pattern, subject_event_code)
    pattern_event_code = event_object_code(pattern)
    if pattern_event_code is not None and isinstance(subject, int):
        score = event_match_specificity(subject, pattern_event_code)
        if score is not None:
            return score
        return event_match_specificity(pattern_event_code, subject)
    if isinstance(subject, int) and isinstance(pattern, int):
        score = event_match_specificity(subject, pattern)
        if score is not None:
            return score
        return event_match_specificity(pattern, subject)
    if isinstance(pattern, ErrorTypeValue) and isinstance(subject, BaseException):
        return error_type_match_specificity(subject, pattern)
    if is_type_value(pattern):
        actual = infer_type(subject, type_registry)
        return type_match_specificity(actual, pattern, type_registry)
    return None


def select_branch(
    subject: Any,
    candidates: Iterable[BranchCandidate],
    *,
    default_arm: Any | None,
    exact_match: Callable[[Any, Any], bool],
    type_registry: Any,
    event_object_code: Callable[[Any], int | None],
) -> BranchSelection:
    """Select the winning arm for ``subject``.

    Exact scalar lookup gives the common numeric/string dispatch path an O(1)
    table hit after arm expressions have been evaluated. Other branch kinds
    share the same specificity scoring used by ``??`` and ``!?``.
    """
    exact: dict[tuple[type[Any], Any], BranchCandidate] = {}
    materialized = list(candidates)
    for candidate in materialized:
        key = _exact_key(candidate.pattern)
        if key is not None and key not in exact:
            exact[key] = candidate

    subject_key = _exact_key(subject)
    if subject_key is not None:
        exact_candidate = exact.get(subject_key)
        if exact_candidate is not None and exact_match(subject, exact_candidate.pattern):
            return BranchSelection(exact_candidate.arm, 1_000_000, False)

    best_arm: Any | None = None
    best_score = -1
    for candidate in materialized:
        score = branch_match_specificity(
            subject,
            candidate.pattern,
            exact_match=exact_match,
            type_registry=type_registry,
            event_object_code=event_object_code,
        )
        if score is None:
            continue
        if score > best_score:
            best_score = score
            best_arm = candidate.arm

    if best_arm is not None:
        return BranchSelection(best_arm, best_score, False)
    return BranchSelection(default_arm, None, default_arm is not None)
