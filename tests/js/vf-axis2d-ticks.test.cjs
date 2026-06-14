const assert = require("node:assert/strict");
const axis2d = require("../../web/vf-ui/vf-axis2d-ticks.js");

{
  const step = axis2d.chooseAxisTickStep(0.25, 80, [1, 2, 5], 40, 120);
  assert.ok(step > 0);
  assert.equal(step, 20);
}

{
  const values = axis2d.axisTickValuesForMode(0, 100, 20, null, "linear", false, [1, 2, 5], 400, 80, 40, 120);
  assert.deepEqual(values, [0, 20, 40, 60, 80, 100]);
}

{
  const values = axis2d.axisCrosshairTickValuesForMode(0.1, 1000, 1, null, "log", [1, 2, 5], 400, 80, 40, 120);
  assert.ok(values.length > 0);
  assert.ok(!values.includes(1));
}

{
  const label = axis2d.axisTickLabelWithOffset(1000005, "linear", 1000000, 1000010, 1000000, 1);
  assert.equal(label, "5");
}

{
  const unit = axis2d.axisValueToUnit(10, 1, 100, "log");
  assert.ok(Math.abs(unit - 0.5) < 1e-6);
  const value = axis2d.axisUnitToValue(0.5, 1, 100, "log");
  assert.ok(Math.abs(value - 10) < 1e-6);
}

{
  const state = axis2d.buildAxisBoxTickState({
    width: 400,
    height: 200,
    x_min: 0,
    x_max: 100,
    y_min: -50,
    y_max: 50,
    x_mode: "linear",
    y_mode: "linear",
    hints: [1, 2, 5],
    dist: 80,
    min_dist: 40,
    max_dist: 120,
    tick_label_font_size: 11
  });
  assert.equal(state.x.step, 20);
  assert.deepEqual(state.x.values, [0, 20, 40, 60, 80, 100]);
  assert.ok(state.y.step > 0);
  assert.ok(Array.isArray(state.y.values));
}

{
  const state = axis2d.buildAxisCrosshairTickState({
    width: 300,
    height: 200,
    x_visible_min: -10,
    x_visible_max: 10,
    y_visible_min: -5,
    y_visible_max: 5,
    x_mode: "linear",
    y_mode: "linear",
    hints: [1, 2, 5],
    dist: 80,
    min_dist: 40,
    max_dist: 120,
    tick_label_font_size: 11
  });
  assert.equal(state.x.step, 5);
  assert.deepEqual(state.x.values, [-10, -5, 5, 10]);
  assert.equal(state.x.offset, 0);
  assert.ok(state.y.step > 0);
  assert.ok(Array.isArray(state.y.values));
}

{
  const cfg = { r_min: -2, r_max: 4, theta_offset_rad: Math.PI };
  const range = axis2d.polarRadialRange(cfg);
  assert.equal(range.min, 0);
  assert.equal(range.max, 4);
  assert.equal(range.span, 4);
  assert.equal(axis2d.polarThetaOffset(cfg), Math.PI);
  assert.equal(axis2d.applyPolarRadialRange(cfg, 1, 3), true);
  assert.equal(cfg.r_min, 1);
  assert.equal(cfg.r_max, 3);
  assert.equal(axis2d.setPolarThetaOffset(cfg, "bad"), true);
  assert.equal(cfg.theta_offset_rad, 0);
}

console.log("vf-axis2d-ticks tests passed");
