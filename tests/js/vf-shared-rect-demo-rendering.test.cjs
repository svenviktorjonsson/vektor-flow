const assert = require("node:assert/strict");

global.addEventListener = function () {};
require("../../web/vf-ui/vf-shared-rect-demo.js");

function createFakeContext() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    beginPath() { calls.push(["beginPath"]); },
    moveTo(x, y) { calls.push(["moveTo", x, y]); },
    lineTo(x, y) { calls.push(["lineTo", x, y]); },
    closePath() { calls.push(["closePath"]); },
    fill() { calls.push(["fill"]); },
    stroke() { calls.push(["stroke"]); },
    arc(x, y, r, start, end) { calls.push(["arc", x, y, r, start, end]); },
    rect(x, y, w, h) { calls.push(["rect", x, y, w, h]); },
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    setLineDash(pattern) { calls.push(["setLineDash", pattern.slice()]); }
  };
}

const ctx = createFakeContext();
const mesh = {
  face_color: [0, 0, 0, 0],
  edge_color: [1, 0.5, 0, 1],
  vertex_color: [0.2, 1, 0.6, 1],
  edge_width: 3,
  edge_style: "---  ",
  edge_unit_length: 6,
  vertex_radius: 5,
  vertex_style: "triangle",
  vertices: [0, 1, 2],
  edges: [[0, 1], [1, 2]],
  faces: [],
  world_point(index) {
    return [
      [10, 20],
      [40, 20],
      [25, 45]
    ][index];
  }
};

global.VfSharedRectDemo.drawMesh(ctx, mesh);

assert.deepEqual(ctx.calls.find((call) => call[0] === "setLineDash"), ["setLineDash", [18, 12]]);
assert.equal(ctx.lineCap, "butt");
assert.equal(ctx.calls.filter((call) => call[0] === "stroke").length, 2);
assert.equal(ctx.calls.filter((call) => call[0] === "arc").length, 0);
assert.equal(ctx.calls.filter((call) => call[0] === "fill").length, 3);

const triangleStarts = ctx.calls
  .map((call, index) => [call, index])
  .filter(([call]) => call[0] === "moveTo");
assert.deepEqual(triangleStarts[2][0], ["moveTo", 10, 15]);

const dottedCtx = createFakeContext();
global.VfSharedRectDemo.drawMesh(dottedCtx, {
  face_color: [0, 0, 0, 0],
  edge_color: [1, 1, 1, 1],
  vertex_color: [1, 1, 1, 1],
  edge_width: 2,
  edge_style: ".  ",
  edge_unit_length: 8,
  vertex_radius: 4,
  vertex_style: "square",
  vertices: [0],
  edges: [[0, 1]],
  faces: [],
  world_point(index) {
    return [
      [20, 30],
      [50, 30]
    ][index];
  }
});

assert.deepEqual(dottedCtx.calls.find((call) => call[0] === "setLineDash"), ["setLineDash", [0, 16]]);
assert.equal(dottedCtx.lineCap, "round");
assert.deepEqual(dottedCtx.calls.find((call) => call[0] === "rect"), ["rect", 16, 26, 8, 8]);

const solidCtx = createFakeContext();
global.VfSharedRectDemo.drawMesh(solidCtx, {
  face_color: [0, 0, 0, 0],
  edge_color: [1, 1, 1, 1],
  vertex_color: [1, 1, 1, 1],
  edge_width: 2,
  edge_style: ".",
  vertex_radius: 0,
  vertices: [],
  edges: [[0, 1]],
  faces: [],
  world_point(index) {
    return [
      [0, 0],
      [20, 0]
    ][index];
  }
});

assert.deepEqual(solidCtx.calls.find((call) => call[0] === "setLineDash"), ["setLineDash", []]);

console.log("vf-shared-rect-demo rendering tests passed");
