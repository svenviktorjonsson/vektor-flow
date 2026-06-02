const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-flow.js"),
  "utf8"
);

assert.ok(source.includes("function strictPacketOnlyEnabled()"));
assert.ok(source.includes("if (strictPacketOnlyEnabled()) { return Promise.resolve(null); }"));
assert.ok(source.includes("displayRefresh: strict packet-only mode suppressed legacy display file refresh"));
assert.ok(source.includes('runtimeLog("info", "startLegacyFallback: strict packet-only mode suppressed legacy fallback");'));
assert.ok(source.includes("if (strictPacketOnlyEnabled()) {"));

function createFlow(options) {
  const sandbox = {
    Promise,
    fetch: () => Promise.resolve({ ok: true }),
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: "vf-runtime-flow.js" });
  return sandbox.VfRuntimeFlow.createFlow(options || {});
}

(async () => {
  {
    const flow = createFlow({
      config: { strictPacketOnly: true },
      getRuntimeSource: () => ({
        loadPackets: () => Promise.reject(new Error("strict packet-only runtime packet source failed: offline")),
      }),
    });
    await assert.rejects(
      () => flow.loadRuntimePackets(),
      /strict packet-only runtime packet source failed: offline/
    );
  }

  {
    const flow = createFlow({
      config: { strictPacketOnly: true },
      getRuntimeSource: () => null,
    });
    await assert.rejects(
      () => flow.loadRuntimePackets(),
      /strict packet-only runtime packet source failed: runtime source unavailable/
    );
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "scene.replace", payload: {} }),
      /strict packet-only runtime packet routing failed: scene.replace packet missing commands/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = { lastRuntimePacketSeq: 7 };
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 7, kind: "scene.replace", payload: { commands: [] } }),
      /strict packet-only runtime packet routing failed: stale or invalid packet seq/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = { legacyFallbackActive: true };
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({
        display: { applyRuntimePacket() { throw new Error("display offline"); } },
      }),
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 8, kind: "display.replace", payload: { display: {} } }),
      /display offline/
    );
    assert.equal(state.lastRuntimePacketSeq, undefined);
    assert.equal(state.packetModeActive, undefined);
    assert.equal(state.legacyFallbackActive, true);
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "legacy.unknown", payload: {} }),
      /strict packet-only runtime packet routing failed: unsupported packet kind legacy\.unknown/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "ui_state.replace", payload: { state: null } }),
      /strict packet-only runtime packet routing failed: ui_state.replace packet missing state/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({}),
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "display.replace", payload: { display: {} } }),
      /strict packet-only runtime packet routing failed: display.replace packet requires display runtime adapter/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({}),
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "widget.append_text", payload: { frame_id: "f1", widget_id: "w1", text: "x" } }),
      /strict packet-only runtime packet routing failed: widget.append_text packet requires widget runtime adapter/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({ widgets: { applyRuntimePacket() {} } }),
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "widget.append_text", payload: { frame_id: "f1", widget_id: "w1" } }),
      /strict packet-only runtime packet routing failed: widget.append_text packet missing append payload/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const state = {};
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({ display: { applyRuntimePacket() {} } }),
    });
    assert.throws(
      () => flow.routeRuntimePacket({ seq: 1, kind: "geom.color.patch", payload: { frame_id: "f1", object_id: 0, color: [1, 0, 0, 1] } }),
      /strict packet-only runtime packet routing failed: geom.color.patch packet missing color payload/
    );
    assert.equal(state.packetModeActive, undefined);
  }

  {
    const flow = createFlow({
      config: { strictPacketOnly: true },
    });
    assert.throws(
      () => flow.applyRuntimePayload({ packets: [] }),
      /strict packet-only runtime packet routing failed: empty runtime payload packet stream/
    );
    assert.throws(
      () => flow.applyRuntimePayload({ commands: [] }),
      /strict packet-only runtime packet routing failed: legacy scene command payload is not allowed/
    );
  }

  {
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state: { lastRuntimePacketSeq: 5 },
      getRuntimeSource: () => ({
        loadPackets: () => Promise.resolve([{ seq: 5, kind: "scene.replace", payload: { commands: [] } }]),
      }),
    });
    await assert.rejects(
      () => flow.loadRuntimePackets(),
      /strict packet-only runtime packet routing failed: stale or invalid packet seq at index 0/
    );
  }

  {
    const state = { legacyFallbackActive: true };
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({}),
      getRuntimeSource: () => ({
        loadPackets: () => Promise.resolve([{ seq: 1, kind: "display.replace", payload: { display: {} } }]),
      }),
    });
    await assert.rejects(
      () => flow.loadRuntimePackets(),
      /strict packet-only runtime packet routing failed: display.replace packet requires display runtime adapter/
    );
    assert.equal(state.packetModeActive, undefined);
    assert.equal(state.legacyFallbackActive, true);
  }

  {
    const state = {};
    let sceneApplyCount = 0;
    let displayApplyCount = 0;
    const flow = createFlow({
      config: { strictPacketOnly: true },
      state,
      createRuntimeDependencies: () => ({ display: { applyRuntimePacket() { displayApplyCount += 1; } } }),
      applySceneCommands: () => { sceneApplyCount += 1; },
      getRuntimeSource: () => ({
        loadPackets: () => Promise.resolve([
          { seq: 1, kind: "scene.replace", payload: { commands: [{ op: "old" }] } },
          { seq: 2, kind: "display.replace", payload: { display: {} } },
          { seq: 3, kind: "geom.color.patch", payload: { frame_id: "f1", object_id: 1, color: [1, 0, 0, 1] } },
          { seq: 4, kind: "scene.replace", payload: { commands: [{ op: "new" }] } },
        ]),
      }),
    });
    const result = await flow.loadRuntimePackets();
    assert.equal(result.applied, 3);
    assert.equal(state.lastRuntimePacketSeq, 4);
    assert.equal(sceneApplyCount, 1);
    assert.equal(displayApplyCount, 2);
  }

  {
    const flow = createFlow({
      config: { strictPacketOnly: false },
      state: { runtimePacketsSeen: true },
      getRuntimeSource: () => ({
        loadPackets: () => Promise.reject(new Error("offline")),
      }),
    });
    const result = await flow.loadRuntimePackets();
    assert.equal(result.applied, 0);
    assert.equal(result.packetRuntimeState, "bootstrap-only");
  }

  console.log("vf-runtime-flow-packet-only tests passed");
})();
