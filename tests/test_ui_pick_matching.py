from __future__ import annotations

from types import SimpleNamespace

from vektorflow.stdlib import ui


def _event_for(pick_id: int) -> SimpleNamespace:
    return SimpleNamespace(object_id=1, pick_id=pick_id)


def test_content_hit_ignores_visual_representation_layer() -> None:
    base_face = ui._pick_meta(1, ui._PICK_KIND_FACE, 0)
    overlay_face_pick_id = ui._pack_pick_id(2, ui._PICK_KIND_FACE, 0)

    assert ui._pick_hit(_event_for(overlay_face_pick_id), base_face, "content")
    assert not ui._pick_hit(_event_for(overlay_face_pick_id), base_face, "representation")


def test_content_hit_still_rejects_different_carriers() -> None:
    edge_zero = ui._pick_meta(3, ui._PICK_KIND_EDGE, 0)
    edge_one_overlay_pick_id = ui._pack_pick_id(4, ui._PICK_KIND_EDGE, 1)

    assert not ui._pick_hit(_event_for(edge_one_overlay_pick_id), edge_zero, "content")
