from __future__ import annotations

import json
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib.ui import Display


def test_plot_panel_spills_plot_frame_wrapper() -> None:
    src = """
ui:.ui

Frame(...arg, :::kwargs):
  d: ui.display
  frame: d.frame(:arg, :kwargs)
  mount(rect):
    d.add_frame(frame, rect)
  :

PlotFrame(dim: int = 2, axis_mode: str = "crosshair", ...arg, :::kwargs):
  :Frame(:arg, :kwargs)
  dim: dim
  axis_mode: axis_mode
  :

PlotPanel(dim: int = 2, axis_mode: str = "crosshair", ...arg, :::kwargs):
  :PlotFrame(:arg, dim: dim, axis_mode: axis_mode, :kwargs)
  :

CrossHair2D(plot, x_min: num = -1, x_max: num = 1, y_min: num = -1, y_max: num = 1):
  :plot
  x_min: x_min
  x_max: x_max
  y_min: y_min
  y_max: y_max
  axis2d: ui.axis_2d(
    frame,
    x_min: x_min,
    x_max: x_max,
    y_min: y_min,
    y_max: y_max,
    prefix: "plot_crosshair"
  )
  draw():
    axis2d.crosshair()
  :

panel: PlotPanel(
  dim: 2,
  axis_mode: "crosshair",
  title: "Spilled Plot Frame",
  alpha: 0.92,
  draggable: true,
  dockable: true,
  resizable: true,
  closable: true,
  dock_loc: "bl",
  master: true
)
plot: CrossHair2D(panel, x_min: -1, x_max: 1, y_min: -1, y_max: 1)
plot.mount((0.16, 0.18, 0.42, 0.32))
plot.draw()
"""
    mod = parse_module(src, filename="<frame-spill>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)

    display = ip.globals["plot"]["d"]
    assert isinstance(display, Display)
    data = json.loads(display.dumps())
    spec = data[0]["payload"]["spec"]

    assert spec["title"] == "Spilled Plot Frame"
    assert spec["flags"]["dockable"] is True
    assert spec["flags"]["closable"] is True
    assert spec["flags"]["resizable"] is True
    assert spec["dock_location"] == "bl"
    assert spec["body_transparent"] is False
    assert ip.globals["plot"]["dim"] == 2
    assert ip.globals["plot"]["axis_mode"] == "crosshair"

    frame_id = ip.globals["plot"]["frame"]._frame_id
    meshes = display._geom[frame_id]["meshes"]
    assert {mesh["id"] for mesh in meshes} == {"plot_crosshair_crosshair"}
    assert len(meshes) == 1
    for mesh in meshes:
        assert mesh["mode3d"] is False
        assert mesh["render_mode"] == "marker_impostor"
        assert mesh["edge_width"] == 1.0
        assert mesh["color"] == "white"
        assert mesh["aspect"] == "equal"
        assert mesh["axis_full_frame"] is True
        assert mesh["axis_ticks"]["enabled"] is True
        assert mesh["axis_ticks"]["hints"] == [1, 2, 5]
        assert mesh["axis_ticks"]["dist"] == 120.0
        assert mesh["axis_ticks"]["len"] == 7.0
        assert mesh["axis_ticks"]["x_alignment"] == "center"
        assert mesh["axis_ticks"]["y_alignment"] == "center"
        assert mesh["indices"] == [0, 1, 2, 3]
