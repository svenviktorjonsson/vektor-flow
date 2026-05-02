(function (global) {
  "use strict";

  var vkfSource = "# VKF-driven topology hierarchy transform interaction.\n# Run: vkf examples/ui_shared_runtime_rect.vkf\n\nui: .ui\nt: .time\nevents: ui.events\nd: ui.display\n\npanel: d.frame(\n  title: \"VKF topology transforms\",\n  draggable: true,\n  closable: true,\n  resizable: true,\n  dockable: true,\n  dock_loc: \"bl\",\n  alpha: 0.96,\n  master: true\n)\n\nd.add_frame(panel, [0.16, 0.16, 0.50, 0.40])\n\nroot_a: panel.add(\n  x: [82, 252, 242, 92],\n  y: [78, 92, 214, 226],\n  face_color: [0.90, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.20, 1.0],\n  vertex_color: [1.0, 0.20, 0.72, 1.0],\n  origin: [167, 152, 0],\n  vertex_width: 10,\n  edge_width: 7\n)\nroot_a.add_vertices([0, 1, 2, 3])\nroot_a.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a.add_faces([[0, 1, 2, 3]])\n\nhide_face: root_a.add(\n  x: [32, 112, 104, 40],\n  y: [34, 40, 96, 104],\n  face_color: [0.20, 0.55, 1.0, 0.0],\n  edge_color: [0.20, 1.0, 0.55, 1.0],\n  vertex_color: [1.0, 0.86, 0.24, 1.0],\n  origin: [72, 70, 0],\n  vertex_width: 9,\n  edge_width: 6\n)\nhide_face.add_vertices([0, 1, 2, 3])\nhide_face.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_face.add_faces([[0, 1, 2, 3]])\n\nhide_face_edge_hidden: hide_face.add(\n  x: [10, 44, 40, 14],\n  y: [12, 16, 40, 44],\n  face_color: [0.20, 0.70, 1.0, 0.45],\n  edge_color: [0.20, 1.0, 0.55, 0.0],\n  vertex_color: [1.0, 0.86, 0.24, 1.0],\n  origin: [27, 28, 0],\n  vertex_width: 8,\n  edge_width: 6\n)\nhide_face_edge_hidden.add_vertices([0, 1, 2, 3])\nhide_face_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_face_edge_hidden.add_faces([[0, 1, 2, 3]])\n\nhide_face_vertex_hidden: hide_face.add(\n  x: [50, 88, 84, 54],\n  y: [26, 30, 58, 62],\n  face_color: [0.20, 0.70, 1.0, 0.45],\n  edge_color: [0.20, 1.0, 0.55, 1.0],\n  vertex_color: [1.0, 0.86, 0.24, 0.0],\n  origin: [69, 44, 0],\n  vertex_width: 8,\n  edge_width: 6\n)\nhide_face_vertex_hidden.add_vertices([0, 1, 2, 3])\nhide_face_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_face_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b: panel.add(\n  x: [318, 488, 476, 330],\n  y: [74, 92, 214, 226],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.20, 1.0, 0.70, 1.0],\n  vertex_color: [1.0, 0.25, 0.78, 1.0],\n  origin: [403, 152, 0],\n  vertex_width: 10,\n  edge_width: 7\n)\nroot_b.add_vertices([0, 1, 2, 3])\nroot_b.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b.add_faces([[0, 1, 2, 3]])\n\nhide_edge: root_b.add(\n  x: [32, 112, 104, 40],\n  y: [34, 40, 96, 104],\n  face_color: [0.95, 0.75, 0.18, 0.46],\n  edge_color: [0.20, 1.0, 0.70, 0.0],\n  vertex_color: [1.0, 0.25, 0.78, 1.0],\n  origin: [72, 70, 0],\n  vertex_width: 9,\n  edge_width: 6\n)\nhide_edge.add_vertices([0, 1, 2, 3])\nhide_edge.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_edge.add_faces([[0, 1, 2, 3]])\n\nhide_edge_face_hidden: hide_edge.add(\n  x: [10, 44, 40, 14],\n  y: [12, 16, 40, 44],\n  face_color: [0.95, 0.75, 0.18, 0.0],\n  edge_color: [0.20, 1.0, 0.70, 1.0],\n  vertex_color: [1.0, 0.25, 0.78, 1.0],\n  origin: [27, 28, 0],\n  vertex_width: 8,\n  edge_width: 6\n)\nhide_edge_face_hidden.add_vertices([0, 1, 2, 3])\nhide_edge_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_edge_face_hidden.add_faces([[0, 1, 2, 3]])\n\nhide_edge_vertex_hidden: hide_edge.add(\n  x: [50, 88, 84, 54],\n  y: [26, 30, 58, 62],\n  face_color: [0.95, 0.75, 0.18, 0.46],\n  edge_color: [0.20, 1.0, 0.70, 1.0],\n  vertex_color: [1.0, 0.25, 0.78, 0.0],\n  origin: [69, 44, 0],\n  vertex_width: 8,\n  edge_width: 6\n)\nhide_edge_vertex_hidden.add_vertices([0, 1, 2, 3])\nhide_edge_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_edge_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c: panel.add(\n  x: [554, 724, 710, 566],\n  y: [78, 96, 214, 226],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 1.0],\n  vertex_color: [1.0, 0.82, 0.20, 1.0],\n  origin: [639, 152, 0],\n  vertex_width: 10,\n  edge_width: 7\n)\nroot_c.add_vertices([0, 1, 2, 3])\nroot_c.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c.add_faces([[0, 1, 2, 3]])\n\nhide_vertex: root_c.add(\n  x: [32, 112, 104, 40],\n  y: [34, 40, 96, 104],\n  face_color: [1.0, 0.34, 0.22, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 1.0],\n  vertex_color: [1.0, 0.82, 0.20, 0.0],\n  origin: [72, 70, 0],\n  vertex_width: 9,\n  edge_width: 6\n)\nhide_vertex.add_vertices([0, 1, 2, 3])\nhide_vertex.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_vertex.add_faces([[0, 1, 2, 3]])\n\nhide_vertex_face_hidden: hide_vertex.add(\n  x: [10, 44, 40, 14],\n  y: [12, 16, 40, 44],\n  face_color: [1.0, 0.34, 0.22, 0.0],\n  edge_color: [0.12, 0.95, 0.95, 1.0],\n  vertex_color: [1.0, 0.82, 0.20, 1.0],\n  origin: [27, 28, 0],\n  vertex_width: 8,\n  edge_width: 6\n)\nhide_vertex_face_hidden.add_vertices([0, 1, 2, 3])\nhide_vertex_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_vertex_face_hidden.add_faces([[0, 1, 2, 3]])\n\nhide_vertex_edge_hidden: hide_vertex.add(\n  x: [50, 88, 84, 54],\n  y: [26, 30, 58, 62],\n  face_color: [1.0, 0.34, 0.22, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 0.0],\n  vertex_color: [1.0, 0.82, 0.20, 1.0],\n  origin: [69, 44, 0],\n  vertex_width: 8,\n  edge_width: 6\n)\nhide_vertex_edge_hidden.add_vertices([0, 1, 2, 3])\nhide_vertex_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nhide_vertex_edge_hidden.add_faces([[0, 1, 2, 3]])\n\ndrag(e):\n  target: panel.get(e.hover)\n  target?\n    e.hover.kind?>\n      ui.HOVER_VERTEX =>\n        target.rotate_scale_at_vertex(vertex: e.hover.vertex_id, cursor: e.cursor, trans: e.trans)\n      ui.HOVER_EDGE =>\n        target.scale_edge(edge: e.hover.edge_id, cursor: e.cursor, trans: e.trans)\n      ui.HOVER_FACE =>\n        target.translate(trans: e.trans)\n\n:: \"vkf topology ready\"\n\n(e: events.get())??>\n  ui.MOUSE_DOWN =>\n    ui.cursor.set_mode(\"closed_hand\")\n  ui.MOUSE_MOVE =>\n    ui.cursor.set_mode(\"open_hand\")\n  ui.MOUSE_DRAG =>\n    drag(e)\n  ui.MOUSE_UP =>\n    ui.cursor.set_mode(\"open_hand\")\n  t.sleep(0.016)\r\n";

  function addQuad(parent, spec) {
    var mesh = parent.add({
      x: spec.x,
      y: spec.y,
      face_color: spec.face_color,
      edge_color: spec.edge_color,
      vertex_color: spec.vertex_color,
      volume_color: spec.volume_color || spec.face_color,
      origin: spec.origin,
      vertex_width: spec.vertex_width == null ? 8 : spec.vertex_width,
      edge_width: spec.edge_width == null ? 6 : spec.edge_width
    });
    mesh.add_vertices([0, 1, 2, 3]);
    mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
    mesh.add_faces([[0, 1, 2, 3]]);
    return mesh;
  }

  function addTopologyTree(parent, rootSpec, hiddenChannel) {
    var root = addQuad(parent, rootSpec);
    var childFace = rootSpec.childFace;
    var childEdge = rootSpec.childEdge;
    var childVertex = rootSpec.childVertex;
    var child = addQuad(root, hiddenChannel === "face" ? childFace : hiddenChannel === "edge" ? childEdge : childVertex);
    if (hiddenChannel !== "face") {
      addQuad(child, childFace.smallA);
    }
    if (hiddenChannel !== "edge") {
      addQuad(child, childEdge.smallA);
    }
    if (hiddenChannel !== "vertex") {
      addQuad(child, childVertex.smallB);
    }
    return root;
  }

  function createVkfSharedRectProgram() {
    var panel = null;
    var activeTarget = null;

    return {
      source: vkfSource,
      init: function (api) {
        var ui = api.ui;
        panel = ui.display.frame({
          title: "VKF topology transforms",
          draggable: true,
          closable: true,
          resizable: true,
          dockable: true,
          dock_loc: "bl",
          alpha: 0.96,
          master: true
        });
        ui.display.add_frame(panel, [0.16, 0.16, 0.50, 0.40]);

        var childFace = {
          x: [32, 112, 104, 40], y: [34, 40, 96, 104],
          face_color: [0.20, 0.55, 1.0, 0.0], edge_color: [0.20, 1.0, 0.55, 1.0], vertex_color: [1.0, 0.86, 0.24, 1.0],
          origin: [72, 70, 0], vertex_width: 9, edge_width: 6,
          smallA: { x: [10, 44, 40, 14], y: [12, 16, 40, 44], face_color: [0.20, 0.70, 1.0, 0.45], edge_color: [0.20, 1.0, 0.55, 0.0], vertex_color: [1.0, 0.86, 0.24, 1.0], origin: [27, 28, 0], vertex_width: 8, edge_width: 6 },
          smallB: { x: [50, 88, 84, 54], y: [26, 30, 58, 62], face_color: [0.20, 0.70, 1.0, 0.45], edge_color: [0.20, 1.0, 0.55, 1.0], vertex_color: [1.0, 0.86, 0.24, 0.0], origin: [69, 44, 0], vertex_width: 8, edge_width: 6 }
        };
        var childEdge = {
          x: [32, 112, 104, 40], y: [34, 40, 96, 104],
          face_color: [0.95, 0.75, 0.18, 0.46], edge_color: [0.20, 1.0, 0.70, 0.0], vertex_color: [1.0, 0.25, 0.78, 1.0],
          origin: [72, 70, 0], vertex_width: 9, edge_width: 6,
          smallA: { x: [10, 44, 40, 14], y: [12, 16, 40, 44], face_color: [0.95, 0.75, 0.18, 0.0], edge_color: [0.20, 1.0, 0.70, 1.0], vertex_color: [1.0, 0.25, 0.78, 1.0], origin: [27, 28, 0], vertex_width: 8, edge_width: 6 },
          smallB: { x: [50, 88, 84, 54], y: [26, 30, 58, 62], face_color: [0.95, 0.75, 0.18, 0.46], edge_color: [0.20, 1.0, 0.70, 1.0], vertex_color: [1.0, 0.25, 0.78, 0.0], origin: [69, 44, 0], vertex_width: 8, edge_width: 6 }
        };
        var childVertex = {
          x: [32, 112, 104, 40], y: [34, 40, 96, 104],
          face_color: [1.0, 0.34, 0.22, 0.46], edge_color: [0.12, 0.95, 0.95, 1.0], vertex_color: [1.0, 0.82, 0.20, 0.0],
          origin: [72, 70, 0], vertex_width: 9, edge_width: 6,
          smallA: { x: [10, 44, 40, 14], y: [12, 16, 40, 44], face_color: [1.0, 0.34, 0.22, 0.0], edge_color: [0.12, 0.95, 0.95, 1.0], vertex_color: [1.0, 0.82, 0.20, 1.0], origin: [27, 28, 0], vertex_width: 8, edge_width: 6 },
          smallB: { x: [50, 88, 84, 54], y: [26, 30, 58, 62], face_color: [1.0, 0.34, 0.22, 0.46], edge_color: [0.12, 0.95, 0.95, 0.0], vertex_color: [1.0, 0.82, 0.20, 1.0], origin: [69, 44, 0], vertex_width: 8, edge_width: 6 }
        };

        addTopologyTree(panel, { x: [82, 252, 242, 92], y: [78, 92, 214, 226], face_color: [0.90, 0.24, 0.16, 0.46], edge_color: [0.98, 0.72, 0.20, 1.0], vertex_color: [1.0, 0.20, 0.72, 1.0], origin: [167, 152, 0], vertex_width: 10, edge_width: 7, childFace: childFace, childEdge: childEdge, childVertex: childVertex }, "face");
        addTopologyTree(panel, { x: [318, 488, 476, 330], y: [74, 92, 214, 226], face_color: [0.16, 0.74, 0.34, 0.46], edge_color: [0.20, 1.0, 0.70, 1.0], vertex_color: [1.0, 0.25, 0.78, 1.0], origin: [403, 152, 0], vertex_width: 10, edge_width: 7, childFace: childFace, childEdge: childEdge, childVertex: childVertex }, "edge");
        addTopologyTree(panel, { x: [554, 724, 710, 566], y: [78, 96, 214, 226], face_color: [0.22, 0.54, 0.96, 0.46], edge_color: [0.12, 0.95, 0.95, 1.0], vertex_color: [1.0, 0.82, 0.20, 1.0], origin: [639, 152, 0], vertex_width: 10, edge_width: 7, childFace: childFace, childEdge: childEdge, childVertex: childVertex }, "vertex");
      },
      update: function (input, api) {
        var ui = api.ui;
        var e = ui.events.get();
        if (!input.pointerDown) {
          activeTarget = null;
          return;
        }
        activeTarget = activeTarget || panel.get(e.hover);
        if (!activeTarget) {
          return;
        }
        switch (e.hover.kind) {
          case ui.HOVER_VERTEX:
            activeTarget.rotate_scale_at_vertex({ vertex: e.hover.vertex_id, cursor: e.cursor, trans: e.trans });
            break;
          case ui.HOVER_EDGE:
            activeTarget.scale_edge({ edge: e.hover.edge_id, cursor: e.cursor, trans: e.trans });
            break;
          case ui.HOVER_FACE:
            activeTarget.translate({ trans: e.trans });
            break;
        }
      }
    };
  }

  global.VfSharedRectProgram = {
    source: vkfSource,
    create: createVkfSharedRectProgram
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
