import assert from "node:assert/strict";
import test from "node:test";

import { mountRetainedSceneResult } from "../../web/inline-retained-scene-view.mjs";

test("README visual output mounts the compiler arena through VfFrame and VfDisplay", () => {
  const appended = [];
  const layer = {
    append(node) { appended.push(node); },
  };
  const frameCalls = [];
  const displayCalls = [];
  const bodyClasses = [];
  const document = {
    createElement(tag) {
      return {
        tag,
        className: "",
        dataset: {},
        style: {},
        append(node) { appended.push(node); },
      };
    },
  };
  const packet = {
    schema: "vektor-flow/retained-scene-arena",
    version: 1,
    metadata: {
      schema: "vektor-flow/retained-scene-arena",
      version: 1,
      scene: { frame: "frame_1", meshes: [] },
    },
    arena: new Uint8Array(),
  };
  const stop = mountRetainedSceneResult(layer, [packet], {
    document,
    VfFrame: {
      mount(target, options) {
        frameCalls.push({ target, options });
        return {
          body: { classList: { add(value) { bodyClasses.push(value); } } },
          root: { remove() { frameCalls.push("removed"); } },
        };
      },
    },
    VfDisplay: {
      renderRetainedSceneArena(value) { displayCalls.push(value); },
    },
  });

  assert.equal(frameCalls.length, 1);
  assert.equal(frameCalls[0].options.id, "frame_1");
  assert.equal(frameCalls[0].options.alpha, 1);
  assert.equal(frameCalls[0].options.frameless, true);
  assert.equal(frameCalls[0].options.draggable, false);
  assert.deepEqual(bodyClasses, ["vf-frame__body--transparent"]);
  assert.deepEqual(displayCalls, [packet]);
  assert.equal(appended[0].className, "readme-example-retained-layer");
  stop();
  assert.equal(frameCalls.at(-1), "removed");
});

test("README visual output rejects packets outside the compiler arena contract", () => {
  assert.throws(() => mountRetainedSceneResult({}, [{ schema: "legacy" }], {
    document: { createElement() { return {}; } },
    VfFrame: { mount() {} },
    VfDisplay: { renderRetainedSceneArena() {} },
  }), /retained scene arena schema/u);
});
