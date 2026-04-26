"""UI scene instructions for vektor-flow hosts (browser / desktop shell).

A frame is a rect with optional window chrome — drag, minimize, resize, close — and a body slot.

Python programs and a future compiler can emit the same structures; hosts only apply patches.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

TitleAlign = Literal["left", "center", "right"]
# Eight corners / edge midpoints of the view (no plain “center” / cc).
# bl=bottom-left, bc=bottom-center, br, tl, tc, tr, cl=center-left, cr=center-right.
DockLocation = Literal["bl", "bc", "br", "tl", "tc", "tr", "cl", "cr"]


def parse_dock_location(raw: str) -> DockLocation:
    """Parse user input into one of eight dock positions. Rejects ``cc`` / center-only."""
    t = (raw or "").strip().lower()
    t = t.replace(" ", "").replace("\t", "").replace("\n", "")
    t = t.replace("-", "").replace("_", "")
    if t in ("", "cc", "c", "center", "centre"):
        raise ValueError(
            "dock_location must be one of: bl, bc, br, tl, tc, tr, cl, cr "
            f"(e.g. bottom left, CR, bl); got {raw!r}"
        )
    # Legacy single-edge (mapped to a corner or edge midpoint).
    if t == "bottom":
        t = "bl"  # start from the left, not center
    elif t == "top":
        t = "tl"
    elif t == "left":
        t = "cl"
    elif t == "right":
        t = "cr"
    if t in ("bl", "bc", "br", "tl", "tc", "tr", "cl", "cr"):
        return t  # type: ignore[return-value]
    long_map: dict[str, str] = {
        "bottomleft": "bl",
        "bottomcenter": "bc",
        "bottomright": "br",
        "topleft": "tl",
        "topcenter": "tc",
        "topright": "tr",
        "centerleft": "cl",
        "centerright": "cr",
        "leftcenter": "cl",
        "rightcenter": "cr",
        "lefttop": "tl",
        "leftbottom": "bl",
        "righttop": "tr",
        "rightbottom": "br",
        "topleftcorner": "tl",
        "bottomleftcorner": "bl",
    }
    if t in long_map:
        return long_map[t]  # type: ignore[return-value]
    # Unordered 2 letters: LB, rb, tr/rt, cl/lc, …
    if len(t) == 2:
        fs = frozenset(t)
        for canon in ("bl", "bc", "br", "tl", "tc", "tr", "cl", "cr"):
            if frozenset(canon) == fs:
                return canon  # type: ignore[return-value]
    raise ValueError(
        "dock_location must be one of: bl, bc, br, tl, tc, tr, cl, cr "
        f"(with aliases e.g. LB, bottom_left, center_right); got {raw!r}"
    )


@dataclass(frozen=True, slots=True)
class NormRect:
    """Rectangle in **parent-normalized** coordinates (0..1), origin top-left."""

    x: float
    y: float
    w: float
    h: float

    def validate(self) -> None:
        for name, v in (("x", self.x), ("y", self.y), ("w", self.w), ("h", self.h)):
            if not 0.0 <= v <= 1.0:
                raise ValueError(f"{name} must be in [0, 1], got {v}")


@dataclass(frozen=True, slots=True)
class FrameFlags:
    """Chrome behaviour for a frame."""

    draggable: bool = True
    dockable: bool = True
    resizable: bool = True
    closable: bool = True
    # When true, host may omit in-browser WebView chrome (native shell only).
    use_browser: bool = True


@dataclass(frozen=True, slots=True)
class FrameSpec:
    """Declarative description of one floating panel / frame."""

    id: str
    title: str = ""
    # Alignment for the title chrome (and future label pattern: _name_ center, _name right, name_ left).
    title_align: TitleAlign = "left"
    rect: NormRect | None = None
    flags: FrameFlags = field(default_factory=FrameFlags)
    alpha: float = 1.0
    # When true, this is the main window: the host UI closes *all* other frames when this
    # one is closed; each frame still has its own drag, resize, and dock/minimize otherwise.
    master: bool = False
    # Where to stack the chrome when docked (in view coordinates).
    dock_location: DockLocation = "bl"
    # Anchor for initial rect placement. Example: ``anchor="bl"`` means rect (x,y,w,h)
    # uses bottom-left anchoring so (0,0,...) starts at the container's bottom-left.
    anchor: DockLocation = "tl"
    # Optional widget tree for ``vf-ui`` (``web/vf-ui/vf-widgets.js``).
    # Each node is a JSON dict: at least ``id`` and ``type`` (e.g. ``label``, ``button``).
    body: tuple[dict[str, Any], ...] | None = None
    # Optional body layout hint for widgets, e.g. ``{"type":"grid","rows":4,"cols":3}``.
    body_layout: dict[str, Any] | None = None
    # Optional parent frame id. When set, ``rect`` is normalized to the parent frame body.
    parent_id: str | None = None

    def to_json_obj(self) -> dict[str, Any]:
        d = asdict(self)
        d["flags"] = asdict(self.flags)
        if self.rect:
            d["rect"] = asdict(self.rect)
        else:
            d["rect"] = None
        if self.body is not None:
            d["body"] = [dict(n) for n in self.body]
        else:
            d["body"] = None
        d["body_layout"] = dict(self.body_layout) if self.body_layout is not None else None
        d["anchor"] = self.anchor
        d["parent_id"] = self.parent_id
        return d


UiCommandKind = Literal[
    "frame_upsert",
    "frame_remove",
    "frame_set_rect",
    "frame_expand_to_fit",
    "frame_set_flags",
    "body_patch",
]


@dataclass(frozen=True, slots=True)
class UiCommand:
    """One host instruction (append-only log or apply-last per id — host policy)."""

    kind: UiCommandKind
    id: str
    payload: dict[str, Any] = field(default_factory=dict)

    def to_json_obj(self) -> dict[str, Any]:
        return {"kind": self.kind, "id": self.id, "payload": dict(self.payload)}


def dumps_scene(commands: list[UiCommand]) -> str:
    import json

    return json.dumps([c.to_json_obj() for c in commands], indent=2)
