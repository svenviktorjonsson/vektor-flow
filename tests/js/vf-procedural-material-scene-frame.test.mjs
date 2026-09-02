import assert from "node:assert/strict";
import test from "node:test";

import {
  createProceduralMaterialSceneFrameSchedulerReference,
} from "../../web/vf-ui/vf-procedural-material-scene-frame.mjs";

test("material scheduler serializes retained spectral frames", async () => {
  const scheduled = [];
  const draws = [];
  let pipelineDestroyed = false;
  const drawPipeline = {
    draw(request) {
      draws.push(request);
      return {
        frame: request.frame,
        bindGroup: "shared-binding",
        reusedBinding: request.frame > 0,
      };
    },
    destroy() {
      pipelineDestroyed = true;
    },
    snapshot() {
      return {
        destroyed: pipelineDestroyed,
        draws: draws.length,
      };
    },
  };
  const scheduler =
    createProceduralMaterialSceneFrameSchedulerReference({
      drawPipeline,
      frameBudget: 2,
      scheduleFrame(callback) {
        scheduled.push(callback);
      },
    });
  const request = {
    packet: {},
    pipeline: {},
    outputBuffer: {},
    submit(draw) {
      return {
        bindGroup: draw.bindGroup,
        linearHdrRgb: [0.28, 0.18, 0.05],
      };
    },
  };
  const firstPending = scheduler.requestFrame(request);
  const secondPending = scheduler.requestFrame(request);

  assert.equal(scheduled.length, 1);
  scheduled.shift()(10.0);
  const first = await firstPending;
  assert.equal(scheduled.length, 1);
  scheduled.shift()(26.0);
  const second = await secondPending;

  assert.equal(first.frame, 0);
  assert.equal(second.frame, 1);
  assert.equal(first.timestamp, 10.0);
  assert.equal(second.timestamp, 26.0);
  assert.deepEqual(second.output.linearHdrRgb, [0.28, 0.18, 0.05]);
  assert.strictEqual(first.output.bindGroup, second.output.bindGroup);
  assert.equal(draws.length, 2);
  assert.equal(draws[0].frame, 0);
  assert.equal(draws[1].frame, 1);
  assert.deepEqual(scheduler.snapshot(), {
    frameBudget: 2,
    pendingFrames: 0,
    scheduled: false,
    active: false,
    completedFrames: 2,
    nextFrame: 2,
    destroyed: false,
    drawPipeline: { destroyed: false, draws: 2 },
  });

  scheduler.destroy();
  assert.equal(pipelineDestroyed, true);
  assert.equal(scheduler.snapshot().destroyed, true);
  assert.equal(scheduler.snapshot().drawPipeline.destroyed, true);
  await assert.rejects(
    scheduler.requestFrame(request),
    /destroyed/u,
  );
});
