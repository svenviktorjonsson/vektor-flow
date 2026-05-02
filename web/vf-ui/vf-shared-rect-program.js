(function (global) {
  "use strict";

  var vkfSource = "# VKF-driven topology hierarchy transform interaction.\n# Geometry coordinates are normalized: lower-left (-1,-1), upper-right (1,1).\n\nui: .ui\nt: .time\nevents: ui.events\nd: ui.display\n\npanel: d.frame(\n  title: \"VKF topology transforms\",\n  draggable: true,\n  closable: true,\n  resizable: true,\n  dockable: true,\n  dock_loc: \"bl\",\n  alpha: 0.96,\n  master: true\n)\n\nd.add_frame(panel, [0, 0, d.width, d.height])\n\nroot_a: panel.add(\n  x: [-1, 1, 1, -1],\n  y: [-1, -1, 1, 1],\n  face_color: [0.9, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.2, 1],\n  vertex_color: [1, 0.2, 0.72, 1],\n  bounds: [80, 70, 220, 200],\n  origin: [0, 0, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_a.add_vertices([0, 1, 2, 3])\nroot_a.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a.add_faces([[0, 1, 2, 3]])\n\nroot_a_face_hidden: root_a.add(\n  x: [-0.58, 0.58, 0.5, -0.5],\n  y: [-0.52, -0.42, 0.48, 0.56],\n  face_color: [0.9, 0.24, 0.16, 0],\n  edge_color: [0.98, 0.72, 0.2, 1],\n  vertex_color: [1, 0.2, 0.72, 1],\n  origin: [0, 0, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_a_face_hidden.add_vertices([0, 1, 2, 3])\nroot_a_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a_face_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_a_face_hidden_edge_hidden: root_a_face_hidden.add(\n  x: [-0.72, -0.24, -0.3, -0.66],\n  y: [-0.56, -0.5, -0.12, -0.06],\n  face_color: [0.9, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.2, 0],\n  vertex_color: [1, 0.2, 0.72, 1],\n  origin: [-0.48, -0.31, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_a_face_hidden_edge_hidden.add_vertices([0, 1, 2, 3])\nroot_a_face_hidden_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a_face_hidden_edge_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_a_face_hidden_vertex_hidden: root_a_face_hidden.add(\n  x: [0.16, 0.66, 0.6, 0.22],\n  y: [0.04, 0.1, 0.48, 0.54],\n  face_color: [0.9, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.2, 1],\n  vertex_color: [1, 0.2, 0.72, 0],\n  origin: [0.41, 0.29, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_a_face_hidden_vertex_hidden.add_vertices([0, 1, 2, 3])\nroot_a_face_hidden_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a_face_hidden_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b: panel.add(\n  x: [-1, 1, 1, -1],\n  y: [-1, -1, 1, 1],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.2, 1, 0.7, 1],\n  vertex_color: [1, 0.25, 0.78, 1],\n  bounds: [380, 70, 220, 200],\n  origin: [0, 0, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_b.add_vertices([0, 1, 2, 3])\nroot_b.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b.add_faces([[0, 1, 2, 3]])\n\nroot_b_edge_hidden: root_b.add(\n  x: [-0.58, 0.58, 0.5, -0.5],\n  y: [-0.52, -0.42, 0.48, 0.56],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.2, 1, 0.7, 0],\n  vertex_color: [1, 0.25, 0.78, 1],\n  origin: [0, 0, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_b_edge_hidden.add_vertices([0, 1, 2, 3])\nroot_b_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b_edge_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b_edge_hidden_face_hidden: root_b_edge_hidden.add(\n  x: [-0.72, -0.24, -0.3, -0.66],\n  y: [-0.56, -0.5, -0.12, -0.06],\n  face_color: [0.16, 0.74, 0.34, 0],\n  edge_color: [0.2, 1, 0.7, 1],\n  vertex_color: [1, 0.25, 0.78, 1],\n  origin: [-0.48, -0.31, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_b_edge_hidden_face_hidden.add_vertices([0, 1, 2, 3])\nroot_b_edge_hidden_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b_edge_hidden_face_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b_edge_hidden_vertex_hidden: root_b_edge_hidden.add(\n  x: [0.16, 0.66, 0.6, 0.22],\n  y: [0.04, 0.1, 0.48, 0.54],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.2, 1, 0.7, 1],\n  vertex_color: [1, 0.25, 0.78, 0],\n  origin: [0.41, 0.29, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_b_edge_hidden_vertex_hidden.add_vertices([0, 1, 2, 3])\nroot_b_edge_hidden_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b_edge_hidden_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c: panel.add(\n  x: [-1, 1, 1, -1],\n  y: [-1, -1, 1, 1],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 1],\n  vertex_color: [1, 0.82, 0.2, 1],\n  bounds: [680, 70, 220, 200],\n  origin: [0, 0, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_c.add_vertices([0, 1, 2, 3])\nroot_c.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c.add_faces([[0, 1, 2, 3]])\n\nroot_c_vertex_hidden: root_c.add(\n  x: [-0.58, 0.58, 0.5, -0.5],\n  y: [-0.52, -0.42, 0.48, 0.56],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 1],\n  vertex_color: [1, 0.82, 0.2, 0],\n  origin: [0, 0, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_c_vertex_hidden.add_vertices([0, 1, 2, 3])\nroot_c_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c_vertex_hidden_face_hidden: root_c_vertex_hidden.add(\n  x: [-0.72, -0.24, -0.3, -0.66],\n  y: [-0.56, -0.5, -0.12, -0.06],\n  face_color: [0.22, 0.54, 0.96, 0],\n  edge_color: [0.12, 0.95, 0.95, 1],\n  vertex_color: [1, 0.82, 0.2, 1],\n  origin: [-0.48, -0.31, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_c_vertex_hidden_face_hidden.add_vertices([0, 1, 2, 3])\nroot_c_vertex_hidden_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c_vertex_hidden_face_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c_vertex_hidden_edge_hidden: root_c_vertex_hidden.add(\n  x: [0.16, 0.66, 0.6, 0.22],\n  y: [0.04, 0.1, 0.48, 0.54],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 0],\n  vertex_color: [1, 0.82, 0.2, 1],\n  origin: [0.41, 0.29, 0],\n  vertex_radius: 4,\n  edge_radius: 2\n)\nroot_c_vertex_hidden_edge_hidden.add_vertices([0, 1, 2, 3])\nroot_c_vertex_hidden_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c_vertex_hidden_edge_hidden.add_faces([[0, 1, 2, 3]])\n\ndrag(e):\n  target: panel.get(e.hover)\n  target?\n    e.hover.kind?>\n      ui.HOVER_VERTEX =>\n        target.rotate_scale_at_vertex(vertex: e.hover.vertex_id, local_cursor: e.local_cursor, local_trans: e.local_trans)\n      ui.HOVER_EDGE =>\n        target.scale_edge(edge: e.hover.edge_id, local_cursor: e.local_cursor, local_anchor: e.local_anchor, local_trans: e.local_trans)\n      ui.HOVER_FACE =>\n        target.translate(trans: e.local_trans)\n\n:: \"vkf topology ready\"\n\n(e: events.get())??>\n  ui.MOUSE_DOWN =>\n    ui.cursor.set_mode(\"closed_hand\")\n  ui.MOUSE_MOVE =>\n    ui.cursor.set_mode(\"open_hand\")\n  ui.MOUSE_DRAG =>\n    drag(e)\n  ui.MOUSE_UP =>\n    ui.cursor.set_mode(\"open_hand\")\n  t.sleep(0.016)\n";
  var roots = [{"name":"root_a","hidden":"face","bounds":[80,70,220,200],"face_color":[0.9,0.24,0.16,0.46],"edge_color":[0.98,0.72,0.2,1],"vertex_color":[1,0.2,0.72,1]},{"name":"root_b","hidden":"edge","bounds":[380,70,220,200],"face_color":[0.16,0.74,0.34,0.46],"edge_color":[0.2,1,0.7,1],"vertex_color":[1,0.25,0.78,1]},{"name":"root_c","hidden":"vertex","bounds":[680,70,220,200],"face_color":[0.22,0.54,0.96,0.46],"edge_color":[0.12,0.95,0.95,1],"vertex_color":[1,0.82,0.2,1]}];

  function colors(root, hidden) {
    var face = root.face_color.slice();
    var edge = root.edge_color.slice();
    var vertex = root.vertex_color.slice();
    if (hidden === "face") { face[3] = 0; }
    if (hidden === "edge") { edge[3] = 0; }
    if (hidden === "vertex") { vertex[3] = 0; }
    return { face_color: face, edge_color: edge, vertex_color: vertex };
  }

  function shape(level, side) {
    if (level === 0) { return { x: [-1, 1, 1, -1], y: [-1, -1, 1, 1], origin: [0, 0, 0] }; }
    if (level === 1) { return { x: [-0.58, 0.58, 0.50, -0.50], y: [-0.52, -0.42, 0.48, 0.56], origin: [0, 0, 0] }; }
    if (side === "left") { return { x: [-0.72, -0.24, -0.30, -0.66], y: [-0.56, -0.50, -0.12, -0.06], origin: [-0.48, -0.31, 0] }; }
    return { x: [0.16, 0.66, 0.60, 0.22], y: [0.04, 0.10, 0.48, 0.54], origin: [0.41, 0.29, 0] };
  }

  function addQuad(parent, root, spec, hidden, isRoot) {
    var c = colors(root, hidden);
    var mesh = parent.add({
      x: spec.x,
      y: spec.y,
      face_color: c.face_color,
      edge_color: c.edge_color,
      vertex_color: c.vertex_color,
      volume_color: c.face_color,
      bounds: isRoot ? root.bounds : undefined,
      origin: spec.origin,
      vertex_radius: 4,
      edge_radius: 2
    });
    mesh.add_vertices([0, 1, 2, 3]);
    mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
    mesh.add_faces([[0, 1, 2, 3]]);
    return mesh;
  }

  function createVkfSharedRectProgram() {
    var panel = null;
    var activeTarget = null;

    return {
      source: vkfSource,
      init: function (api) {
        var ui = api.ui;
        panel = ui.display.frame({ title: "VKF topology transforms", draggable: true, closable: true, resizable: true, dockable: true, dock_loc: "bl", alpha: 0.96, master: true });
        ui.display.add_frame(panel, [0, 0, ui.display.width, ui.display.height]);
        for (var i = 0; i < roots.length; i++) {
          var root = roots[i];
          var rootMesh = addQuad(panel, root, shape(0), null, true);
          var child = addQuad(rootMesh, root, shape(1), root.hidden, false);
          var remaining = ["face", "edge", "vertex"].filter(function (kind) { return kind !== root.hidden; });
          addQuad(child, root, shape(2, "left"), remaining[0], false);
          addQuad(child, root, shape(2, "right"), remaining[1], false);
        }
      },
      update: function (input, api) {
        var ui = api.ui;
        var e = ui.events.get();
        if (!input.pointerDown) { activeTarget = null; return; }
        activeTarget = activeTarget || panel.get(e.hover);
        if (!activeTarget) { return; }
        switch (e.hover.kind) {
          case ui.HOVER_VERTEX:
            activeTarget.rotate_scale_at_vertex({ vertex: e.hover.vertex_id, local_cursor: e.local_cursor, local_trans: e.local_trans });
            break;
          case ui.HOVER_EDGE:
            activeTarget.scale_edge({ edge: e.hover.edge_id, local_cursor: e.local_cursor, local_anchor: e.local_anchor, local_trans: e.local_trans });
            break;
          case ui.HOVER_FACE:
            activeTarget.translate({ trans: e.local_trans });
            break;
        }
      }
    };
  }

  global.VfSharedRectProgram = { source: vkfSource, create: createVkfSharedRectProgram };
})(typeof globalThis !== "undefined" ? globalThis : this);
