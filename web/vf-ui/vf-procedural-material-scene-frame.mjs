const MAX_PENDING_FRAMES = 64;

function requireConfiguration(drawPipeline, scheduleFrame, frameBudget) {
  if (
    typeof drawPipeline?.draw !== "function"
    || typeof drawPipeline?.destroy !== "function"
    || typeof drawPipeline?.snapshot !== "function"
  ) {
    throw new TypeError("procedural material draw pipeline is required");
  }
  if (typeof scheduleFrame !== "function") {
    throw new TypeError("procedural material scheduleFrame is required");
  }
  if (
    !Number.isSafeInteger(frameBudget)
    || frameBudget < 1
    || frameBudget > MAX_PENDING_FRAMES
  ) {
    throw new RangeError(
      "procedural material frameBudget must be 1 through 64",
    );
  }
}

function requireRequest(request) {
  if (
    !request
    || typeof request !== "object"
    || !request.packet
    || !request.pipeline
    || !request.outputBuffer
    || typeof request.submit !== "function"
  ) {
    throw new TypeError("procedural material scene-frame request is required");
  }
}

export function createProceduralMaterialSceneFrameSchedulerReference({
  drawPipeline,
  scheduleFrame,
  frameBudget,
}) {
  requireConfiguration(drawPipeline, scheduleFrame, frameBudget);
  const pending = [];
  let scheduled = false;
  let active = false;
  let nextFrame = 0;
  let completedFrames = 0;
  let destroyed = false;

  function ensureScheduled() {
    if (scheduled || active || pending.length === 0 || destroyed) return;
    scheduled = true;
    scheduleFrame((timestamp) => {
      void runFrame(timestamp);
    });
  }

  async function runFrame(timestamp) {
    scheduled = false;
    if (destroyed || active) return;
    const item = pending.shift();
    if (!item) return;
    active = true;
    const frame = nextFrame;
    nextFrame += 1;
    try {
      const draw = drawPipeline.draw({
        frame,
        packet: item.request.packet,
        pipeline: item.request.pipeline,
        outputBuffer: item.request.outputBuffer,
      });
      const output = await item.request.submit(draw);
      completedFrames += 1;
      item.resolve(Object.freeze({
        kind: "procedural-material-scene-frame:v1",
        frame,
        timestamp,
        draw,
        output,
      }));
    } catch (error) {
      item.reject(error);
    } finally {
      active = false;
      ensureScheduled();
    }
  }

  function requestFrame(request) {
    if (destroyed) {
      return Promise.reject(
        new RangeError("procedural material scene scheduler is destroyed"),
      );
    }
    try {
      requireRequest(request);
    } catch (error) {
      return Promise.reject(error);
    }
    if (pending.length + Number(active) >= frameBudget) {
      return Promise.reject(
        new RangeError("procedural material scene frame budget is exhausted"),
      );
    }
    const completion = new Promise((resolve, reject) => {
      pending.push({ request, resolve, reject });
    });
    ensureScheduled();
    return completion;
  }

  function destroy() {
    if (destroyed) return;
    if (active) {
      throw new RangeError(
        "procedural material scene frame is active during teardown",
      );
    }
    destroyed = true;
    const error = new RangeError(
      "procedural material scene scheduler is destroyed",
    );
    while (pending.length > 0) {
      pending.shift().reject(error);
    }
    drawPipeline.destroy();
  }

  function snapshot() {
    return Object.freeze({
      frameBudget,
      pendingFrames: pending.length,
      scheduled,
      active,
      completedFrames,
      nextFrame,
      destroyed,
      drawPipeline: drawPipeline.snapshot(),
    });
  }

  return Object.freeze({
    kind: "procedural-material-scene-frame-scheduler:v1",
    frameBudget,
    requestFrame,
    destroy,
    snapshot,
  });
}
