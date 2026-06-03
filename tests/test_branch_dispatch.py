from __future__ import annotations

from vektorflow.errors import ASSERTION_ERROR_TYPE, ERROR, AssertionError as VfAssertionError
from vektorflow.runtime.branch_dispatch import BranchCandidate, select_branch
from vektorflow.stdlib.events import encode_event_code, encode_frame_pattern, encode_ui_pattern


def _select(subject, patterns):
    return select_branch(
        subject,
        [BranchCandidate(arm, pattern, index) for index, (arm, pattern) in enumerate(patterns)],
        default_arm="default",
        exact_match=lambda a, b: a == b,
        type_registry={},
        event_object_code=lambda value: None,
    )


def test_select_branch_prefers_exact_scalar_lookup_over_broader_bitmask() -> None:
    selection = _select(12, [("broad", 8), ("exact", 12)])

    assert selection.arm == "exact"
    assert selection.score == 1_000_000
    assert selection.defaulted is False


def test_select_branch_uses_bitmask_specificity_for_numeric_patterns() -> None:
    exact = encode_event_code("down", frame_id="board")
    broad = encode_ui_pattern("down")
    narrow = encode_frame_pattern("down", frame_id="board")
    selection = _select(exact, [("broad", broad), ("narrow", narrow)])

    assert selection.arm == "narrow"
    assert selection.defaulted is False


def test_select_branch_uses_error_mask_specificity() -> None:
    selection = _select(
        VfAssertionError("boom"),
        [("general", ERROR), ("assertion", ASSERTION_ERROR_TYPE)],
    )

    assert selection.arm == "assertion"
    assert selection.defaulted is False
