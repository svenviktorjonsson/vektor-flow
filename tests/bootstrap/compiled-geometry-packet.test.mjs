import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import axis2dTicks from "../../web/vf-ui/vf-axis2d-ticks.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executable = process.env.VKF_GEOMETRY_PROBE ?? path.join(repository, "build/compiled-geometry-packet-probe");
const x = Array.from({ length: 101 }, (_, index) => 0.1 * index);
const y = x.map(Math.sin);

function packet(properties = { x_u: x, y_u: y, id: "sine", color: [0.12, 0.72, 1, 1] }) {
  return request({ properties, width: 640, height: 360 });
}

function request(value) {
  const child = spawnSync(executable, [], { input: JSON.stringify(value),
    encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("compiled u geometry emits one filled continuous 101-sample curve into the frozen retained arena", () => {
  const result = packet();
  assert.equal(result.ok, true, result.message);
  assert.equal(result.metadata.schema, "vektor-flow/retained-scene-arena");
  assert.equal(result.metadata.version, 1);
  assert.equal(result.layout.dimension, 2);
  const curve = result.metadata.scene.meshes.find(mesh => mesh.id === "sine");
  assert.equal(curve.topology, "triangle-list");
  assert.equal(curve.vertices.storage, "float32");
  assert.equal(curve.indices.storage, "uint32");
  assert.equal(curve.vertices.length, 101 * 2 * 10);
  assert.equal(curve.indices.length, 100 * 6);
  const arena = Uint8Array.from(result.arena);
  const vertices = new Float32Array(arena.buffer, curve.vertices.byte_offset, curve.vertices.length);
  const indices = new Uint32Array(arena.buffer, curve.indices.byte_offset, curve.indices.length);
  assert.ok([...vertices].every(Number.isFinite));
  assert.ok([...indices].every(index => index < 202));
  for (let segment = 0; segment < 100; segment++) {
    assert.deepEqual([...indices.slice(segment * 6, segment * 6 + 6)],
      [segment * 2, segment * 2 + 1, segment * 2 + 2, segment * 2 + 1, segment * 2 + 3, segment * 2 + 2]);
  }
});

test("pure packer preserves the existing retained-scene triangle fixture byte for byte", () => {
  const vertices = [0, 0, 0, 0, 0, 1, 1, 0, 0, 1,
    1, 0, 0, 0, 0, 1, 0, 1, 0, 1,
    0, 1, 0, 0, 0, 1, 0, 0, 1, 1];
  const result = request({ scene: { meshes: [{ id: "triangle", vertices, indices: [0, 1, 2] }] } });
  assert.equal(result.ok, true, result.message);
  const expected = Buffer.concat([Buffer.from(Float32Array.from(vertices).buffer), Buffer.from(Uint32Array.from([0, 1, 2]).buffer)]);
  assert.deepEqual(Buffer.from(result.arena), expected);
  assert.deepEqual(result.metadata.scene.meshes[0].vertices, { byte_offset: 0, length: 30, storage: "float32" });
  assert.deepEqual(result.metadata.scene.meshes[0].indices, { byte_offset: 120, length: 3, storage: "uint32" });
});

test("compiler-owned default axes and labels match the current README tick algorithm", () => {
  const result = packet();
  assert.equal(result.ok, true, result.message);
  const bounds = { x_visible_min: 0, x_visible_max: 10, y_visible_min: Math.min(...y), y_visible_max: Math.max(...y) };
  const expected = axis2dTicks.buildAxisCrosshairTickState({ ...bounds,
    width: 640, height: 360, dist: 72, min_dist: 48, max_dist: 96, tick_label_font_size: 11 });
  assert.deepEqual(result.layout.axes, expected);
  for (const axis of ["x", "y"]) {
    assert.deepEqual(result.layout.labels.filter(label => label.axis === axis).map(label => label.text),
      expected[axis].values.map(value => axis2dTicks.axisTickLabelWithOffset(value, "linear",
        expected[axis].visible_min, expected[axis].visible_max, expected[axis].offset, expected[axis].step)));
  }
});

test("axes and every tick are emitted as filled geometry rather than reconstructed by JavaScript", () => {
  const result = packet();
  assert.equal(result.ok, true, result.message);
  const axes = result.metadata.scene.meshes.find(mesh => mesh.id === "sine$axes");
  assert.ok(axes, "compiled axis mesh is missing");
  const strokes = 2 + result.layout.axes.x.values.length + result.layout.axes.y.values.length;
  assert.equal(axes.topology, "triangle-list");
  assert.equal(axes.vertices.length, strokes * 4 * 10);
  assert.equal(axes.indices.length, strokes * 6);
  assert.equal(result.layout.coordinate_space, "pixel");
});

test("every sine segment interior is covered by filled triangles, including shared joins", () => {
  const result = packet();
  assert.equal(result.ok, true, result.message);
  const curve = result.metadata.scene.meshes.find(mesh => mesh.id === "sine");
  const arena = Uint8Array.from(result.arena);
  const vertices = new Float32Array(arena.buffer, curve.vertices.byte_offset, curve.vertices.length);
  const indices = new Uint32Array(arena.buffer, curve.indices.byte_offset, curve.indices.length);
  const point = index => [vertices[index * 10], vertices[index * 10 + 1]];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => {
    const signs = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
    return signs.every(value => value >= 0) || signs.every(value => value <= 0);
  };
  const centers = x.map((value, index) => {
    const left = point(index * 2), right = point(index * 2 + 1);
    const center = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
    const expected = [18 + value / 10 * 604, 342 - (y[index] - Math.min(...y)) / (Math.max(...y) - Math.min(...y)) * 324];
    // One Float32 ULP at the 640-pixel viewport bound.
    expected.forEach((coordinate, axis) => assert.ok(Math.abs(center[axis] - coordinate) <= 2 ** -14));
    return center;
  });
  for (let segment = 0; segment < 100; segment++) {
    for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      const p = centers[segment].map((value, axis) => value * (1 - t) + centers[segment + 1][axis] * t);
      const base = segment * 6;
      assert.ok(inside(p, ...[0, 1, 2].map(offset => point(indices[base + offset])))
        || inside(p, ...[3, 4, 5].map(offset => point(indices[base + offset]))), `unfilled segment ${segment} at ${t}`);
    }
  }
});

test("unsupported channels and malformed curves fail without a partial scene", () => {
  const original = { x_u: x, y_u: y, id: "sine", color: [0.12, 0.72, 1, 1] };
  for (const [properties, message] of [
    [{ ...original, x_i: x }, "compiled u-curve does not support `x_i`"],
    [{ ...original, z: 0 }, "compiled u-curve does not support `z`"],
    [{ ...original, y_u: y.slice(1) }, "retained Frame.add x and y lines must have the same length"],
    [{ ...original, x_u: [0, "bad"] }, "compiled u-curve `x_u` requires finite numeric values"],
  ]) {
    const result = packet(properties);
    assert.deepEqual(result, { ok: false, message });
  }
  assert.deepEqual(packet(), packet(), "fresh repeated runs must produce identical bytes and layout");
});

test("default tick layout preserves existing behavior for edited scales and offsets", () => {
  for (const [scale, offset] of [[0.001, 0], [1000, 0], [1, 100000000], [0.1, -10], [3.7, 0]]) {
    const values = x.map(value => offset + scale * value);
    const result = packet({ x_u: values, y_u: y, id: "edited", color: [1, 0, 0, 1] });
    assert.equal(result.ok, true, result.message);
    const expected = axis2dTicks.buildAxisCrosshairTickState({
      width: 640, height: 360, x_visible_min: Math.min(...values), x_visible_max: Math.max(...values),
      y_visible_min: Math.min(...y), y_visible_max: Math.max(...y),
      dist: 72, min_dist: 48, max_dist: 96, tick_label_font_size: 11 });
    assert.deepEqual(result.layout.axes, expected, `scale ${scale}, offset ${offset}`);
    assert.deepEqual(result.layout.labels.filter(label => label.axis === "x").map(label => label.text),
      expected.x.values.map(value => axis2dTicks.axisTickLabelWithOffset(value, "linear",
        expected.x.visible_min, expected.x.visible_max, expected.x.offset, expected.x.step)));
  }
});
