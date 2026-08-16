import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayeredCanvasCaptureStream } from '../../web/vf-ui/vf-media-capture.mjs';

function captureFixture() {
  const draws = [];
  const scheduled = [];
  const track = {
    readyState: 'live',
    requestFrameCalls: 0,
    requestFrame() { this.requestFrameCalls += 1; }
  };
  const stream = {
    getVideoTracks: () => [track]
  };
  const output = {
    width: 0,
    height: 0,
    captureFrameRate: null,
    getContext: () => ({
      clearRect() {},
      drawImage(canvas) { draws.push(canvas.id); }
    }),
    captureStream(frameRate) {
      this.captureFrameRate = frameRate;
      return stream;
    }
  };
  return { draws, scheduled, track, stream, output };
}

test('layered canvas capture composites canvas objects and resolvers in order every frame', () => {
  const fixture = captureFixture();
  const base = { id: 'base', width: 1280, height: 648 };
  const gpu = { id: 'gpu', width: 1280, height: 648 };
  let overlay = { id: 'overlay-1', width: 1280, height: 648 };

  const stream = createLayeredCanvasCaptureStream({
    layers: [base, () => gpu, () => overlay],
    document: { createElement: () => fixture.output },
    requestFrame: (callback) => fixture.scheduled.push(callback),
    frameRate: 30
  });

  assert.equal(stream, fixture.stream);
  assert.deepEqual(fixture.draws, ['base', 'gpu', 'overlay-1']);
  assert.deepEqual([fixture.output.width, fixture.output.height], [1280, 648]);
  assert.equal(fixture.output.captureFrameRate, 30);
  assert.equal(fixture.track.requestFrameCalls, 1);
  assert.equal(fixture.scheduled.length, 1);

  overlay = { id: 'overlay-2', width: 1280, height: 648 };
  fixture.scheduled.shift()();
  assert.deepEqual(fixture.draws, [
    'base', 'gpu', 'overlay-1',
    'base', 'gpu', 'overlay-2'
  ]);
  assert.equal(fixture.track.requestFrameCalls, 2);
  assert.equal(fixture.scheduled.length, 1);
});

test('layered canvas capture stops scheduling frames when its video tracks end', () => {
  const fixture = captureFixture();
  createLayeredCanvasCaptureStream({
    layers: [{ id: 'base', width: 640, height: 360 }],
    document: { createElement: () => fixture.output },
    requestFrame: (callback) => fixture.scheduled.push(callback)
  });

  fixture.track.readyState = 'ended';
  fixture.scheduled.shift()();

  assert.equal(fixture.scheduled.length, 0);
  assert.deepEqual(fixture.draws, ['base']);
  assert.equal(fixture.track.requestFrameCalls, 1);
});

test('layered canvas capture renders its source immediately before compositing', () => {
  const fixture = captureFixture();
  const calls = [];
  fixture.output.getContext = () => ({
    clearRect() {},
    drawImage() { calls.push('draw'); }
  });

  createLayeredCanvasCaptureStream({
    layers: [{ id: 'base', width: 640, height: 360 }],
    document: { createElement: () => fixture.output },
    beforeDraw: () => calls.push('render'),
    requestFrame: () => {}
  });

  assert.deepEqual(calls, ['render', 'draw']);
});
