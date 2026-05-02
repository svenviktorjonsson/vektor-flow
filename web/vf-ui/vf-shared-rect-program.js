(function (global) {
  "use strict";

  var vkfSource = "# VKF-driven topology hierarchy transform interaction.\n# Run: vkf examples/ui_shared_runtime_rect.vkf\n\nui: .ui\nt: .time\nevents: ui.events\nd: ui.display\n\npanel: d.frame(\n  title: \"VKF topology transforms\",\n  draggable: true,\n  closable: true,\n  resizable: true,\n  dockable: true,\n  dock_loc: \"bl\",\n  alpha: 0.96,\n  master: true\n)\n\nd.add_frame(panel, [0, 0, d.width, d.height])\n\nroot_a: panel.add(\n  x: [80, 300, 292, 88],\n  y: [70, 92, 250, 270],\n  face_color: [0.9, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.2, 1],\n  vertex_color: [1, 0.2, 0.72, 1],\n  origin: [190, 170, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_a.add_vertices([0, 1, 2, 3])\nroot_a.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a.add_faces([[0, 1, 2, 3]])\n\nroot_a_face_hidden: root_a.add(\n  x: [132, 248, 240, 140],\n  y: [114, 124, 226, 234],\n  face_color: [0.9, 0.24, 0.16, 0],\n  edge_color: [0.98, 0.72, 0.2, 1],\n  vertex_color: [1, 0.2, 0.72, 1],\n  origin: [190, 170, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_a_face_hidden.add_vertices([0, 1, 2, 3])\nroot_a_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a_face_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_a_face_hidden_edge_hidden: root_a_face_hidden.add(\n  x: [148, 190, 185, 153],\n  y: [132, 136, 168, 173],\n  face_color: [0.9, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.2, 0],\n  vertex_color: [1, 0.2, 0.72, 1],\n  origin: [169, 150, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_a_face_hidden_edge_hidden.add_vertices([0, 1, 2, 3])\nroot_a_face_hidden_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a_face_hidden_edge_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_a_face_hidden_vertex_hidden: root_a_face_hidden.add(\n  x: [186, 230, 225, 191],\n  y: [162, 167, 200, 204],\n  face_color: [0.9, 0.24, 0.16, 0.46],\n  edge_color: [0.98, 0.72, 0.2, 1],\n  vertex_color: [1, 0.2, 0.72, 0],\n  origin: [208, 181, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_a_face_hidden_vertex_hidden.add_vertices([0, 1, 2, 3])\nroot_a_face_hidden_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_a_face_hidden_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b: panel.add(\n  x: [380, 600, 592, 388],\n  y: [70, 92, 250, 270],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.2, 1, 0.7, 1],\n  vertex_color: [1, 0.25, 0.78, 1],\n  origin: [490, 170, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_b.add_vertices([0, 1, 2, 3])\nroot_b.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b.add_faces([[0, 1, 2, 3]])\n\nroot_b_edge_hidden: root_b.add(\n  x: [432, 548, 540, 440],\n  y: [114, 124, 226, 234],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.2, 1, 0.7, 0],\n  vertex_color: [1, 0.25, 0.78, 1],\n  origin: [490, 170, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_b_edge_hidden.add_vertices([0, 1, 2, 3])\nroot_b_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b_edge_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b_edge_hidden_face_hidden: root_b_edge_hidden.add(\n  x: [448, 490, 485, 453],\n  y: [132, 136, 168, 173],\n  face_color: [0.16, 0.74, 0.34, 0],\n  edge_color: [0.2, 1, 0.7, 1],\n  vertex_color: [1, 0.25, 0.78, 1],\n  origin: [469, 150, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_b_edge_hidden_face_hidden.add_vertices([0, 1, 2, 3])\nroot_b_edge_hidden_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b_edge_hidden_face_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_b_edge_hidden_vertex_hidden: root_b_edge_hidden.add(\n  x: [486, 530, 525, 491],\n  y: [162, 167, 200, 204],\n  face_color: [0.16, 0.74, 0.34, 0.46],\n  edge_color: [0.2, 1, 0.7, 1],\n  vertex_color: [1, 0.25, 0.78, 0],\n  origin: [508, 181, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_b_edge_hidden_vertex_hidden.add_vertices([0, 1, 2, 3])\nroot_b_edge_hidden_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_b_edge_hidden_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c: panel.add(\n  x: [680, 900, 892, 688],\n  y: [70, 92, 250, 270],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 1],\n  vertex_color: [1, 0.82, 0.2, 1],\n  origin: [790, 170, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_c.add_vertices([0, 1, 2, 3])\nroot_c.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c.add_faces([[0, 1, 2, 3]])\n\nroot_c_vertex_hidden: root_c.add(\n  x: [732, 848, 840, 740],\n  y: [114, 124, 226, 234],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 1],\n  vertex_color: [1, 0.82, 0.2, 0],\n  origin: [790, 170, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_c_vertex_hidden.add_vertices([0, 1, 2, 3])\nroot_c_vertex_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c_vertex_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c_vertex_hidden_face_hidden: root_c_vertex_hidden.add(\n  x: [748, 790, 785, 753],\n  y: [132, 136, 168, 173],\n  face_color: [0.22, 0.54, 0.96, 0],\n  edge_color: [0.12, 0.95, 0.95, 1],\n  vertex_color: [1, 0.82, 0.2, 1],\n  origin: [769, 150, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_c_vertex_hidden_face_hidden.add_vertices([0, 1, 2, 3])\nroot_c_vertex_hidden_face_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c_vertex_hidden_face_hidden.add_faces([[0, 1, 2, 3]])\n\nroot_c_vertex_hidden_edge_hidden: root_c_vertex_hidden.add(\n  x: [786, 830, 825, 791],\n  y: [162, 167, 200, 204],\n  face_color: [0.22, 0.54, 0.96, 0.46],\n  edge_color: [0.12, 0.95, 0.95, 0],\n  vertex_color: [1, 0.82, 0.2, 1],\n  origin: [808, 181, 0],\n  vertex_radius: 2,\n  edge_radius: 1\n)\nroot_c_vertex_hidden_edge_hidden.add_vertices([0, 1, 2, 3])\nroot_c_vertex_hidden_edge_hidden.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]])\nroot_c_vertex_hidden_edge_hidden.add_faces([[0, 1, 2, 3]])\n\ndrag(e):\n  target: panel.get(e.hover)\n  target?\n    e.hover.kind?>\n      ui.HOVER_VERTEX =>\n        target.rotate_scale_at_vertex(vertex: e.hover.vertex_id, cursor: e.cursor, trans: e.trans)\n      ui.HOVER_EDGE =>\n        target.scale_edge(edge: e.hover.edge_id, cursor: e.cursor, trans: e.trans)\n      ui.HOVER_FACE =>\n        target.translate(trans: e.trans)\n\n:: \"vkf topology ready\"\n\n(e: events.get())??>\n  ui.MOUSE_DOWN =>\n    ui.cursor.set_mode(\"closed_hand\")\n  ui.MOUSE_MOVE =>\n    ui.cursor.set_mode(\"open_hand\")\n  ui.MOUSE_DRAG =>\n    drag(e)\n  ui.MOUSE_UP =>\n    ui.cursor.set_mode(\"open_hand\")\n  t.sleep(0.016)\n";

  var roots = [{"name":"root_a","hidden":"face","x":[80,300,292,88],"y":[70,92,250,270],"origin":[190,170,0],"face_color":[0.9,0.24,0.16,0.46],"edge_color":[0.98,0.72,0.2,1],"vertex_color":[1,0.2,0.72,1]},{"name":"root_b","hidden":"edge","x":[380,600,592,388],"y":[70,92,250,270],"origin":[490,170,0],"face_color":[0.16,0.74,0.34,0.46],"edge_color":[0.2,1,0.7,1],"vertex_color":[1,0.25,0.78,1]},{"name":"root_c","hidden":"vertex","x":[680,900,892,688],"y":[70,92,250,270],"origin":[790,170,0],"face_color":[0.22,0.54,0.96,0.46],"edge_color":[0.12,0.95,0.95,1],"vertex_color":[1,0.82,0.2,1]}];

  function colors(root, hidden) {
    var face = root.face_color.slice();
    var edge = root.edge_color.slice();
    var vertex = root.vertex_color.slice();
    if (hidden === "face") { face[3] = 0; }
    if (hidden === "edge") { edge[3] = 0; }
    if (hidden === "vertex") { vertex[3] = 0; }
    return { face_color: face, edge_color: edge, vertex_color: vertex };
  }

  function quadInside(root, level, side) {
    var minX = Math.min.apply(Math, root.x);
    var maxX = Math.max.apply(Math, root.x);
    var minY = Math.min.apply(Math, root.y);
    var maxY = Math.max.apply(Math, root.y);
    if (level === 1) {
      var x0 = minX + 52, x1 = maxX - 52, y0 = minY + 44, y1 = maxY - 44;
      return { x: [x0, x1, x1 - 8, x0 + 8], y: [y0, y0 + 10, y1, y1 + 8], origin: [(x0 + x1) / 2, (y0 + y1) / 2, 0] };
    }
    var child = quadInside(root, 1);
    var minCx = Math.min.apply(Math, child.x);
    var maxCx = Math.max.apply(Math, child.x);
    var minCy = Math.min.apply(Math, child.y);
    if (side === "left") {
      var lx0 = minCx + 16, lx1 = minCx + 58, ly0 = minCy + 18, ly1 = minCy + 54;
      return { x: [lx0, lx1, lx1 - 5, lx0 + 5], y: [ly0, ly0 + 4, ly1, ly1 + 5], origin: [(lx0 + lx1) / 2, (ly0 + ly1) / 2, 0] };
    }
    var rx0 = maxCx - 62, rx1 = maxCx - 18, ry0 = minCy + 48, ry1 = minCy + 86;
    return { x: [rx0, rx1, rx1 - 5, rx0 + 5], y: [ry0, ry0 + 5, ry1, ry1 + 4], origin: [(rx0 + rx1) / 2, (ry0 + ry1) / 2, 0] };
  }

  function addQuad(parent, root, spec, hidden, overlay) {
    var c = colors(root, hidden);
    var mesh = parent.add({
      x: spec.x,
      y: spec.y,
      face_color: c.face_color,
      edge_color: c.edge_color,
      vertex_color: c.vertex_color,
      volume_color: c.face_color,
      origin: spec.origin,
      vertex_radius: overlay.vertex,
      edge_radius: overlay.edge
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
        ui.display.add_frame(panel, [0, 0, ui.display.width, ui.display.height]);

        for (var i = 0; i < roots.length; i++) {
          var root = roots[i];
          var rootMesh = addQuad(panel, root, root, null, { vertex: 2, edge: 1 });
          var childSpec = quadInside(root, 1);
          var child = addQuad(rootMesh, root, childSpec, root.hidden, { vertex: 2, edge: 1 });
          var remaining = ["face", "edge", "vertex"].filter(function (kind) { return kind !== root.hidden; });
          addQuad(child, root, quadInside(root, 2, "left"), remaining[0], { vertex: 2, edge: 1 });
          addQuad(child, root, quadInside(root, 2, "right"), remaining[1], { vertex: 2, edge: 1 });
        }
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
