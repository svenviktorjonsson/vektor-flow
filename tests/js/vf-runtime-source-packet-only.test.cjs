const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-source.js"),
  "utf8"
);

assert.ok(source.includes("function strictPacketOnlyEnabled()"));
assert.ok(source.includes("function packetOnlyEnabled()"));
assert.ok(source.includes('runtimeLog("info", "loadPackets: packet-only mode skipped file mirror fallback");'));
assert.ok(source.includes("if (packetOnlyEnabled()) {"));
assert.ok(source.includes('runtimeLog("info", "loadScene: strict packet-only mode skipped scene file bootstrap");'));
assert.ok(source.includes("if (strictPacketOnlyEnabled()) {"));

function createSourceWithFetch(fetchImpl, config) {
  const logs = [];
  const sandbox = {
    Date: { now: () => 1 },
    Promise,
    fetch: fetchImpl,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: "vf-runtime-source.js" });
  const runtimeSource = sandbox.VfRuntimeSource.createSource({
    config: config || {},
    runtimeLog: (level, message) => logs.push({ level, message }),
  });
  return { runtimeSource, logs };
}

(async () => {
  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ packets: [] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned HTTP 503/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ bad: [] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed packet payload/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ packets: [] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned empty packet stream/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          packets: [
            { seq: 2, kind: "scene.replace", payload: { commands: [] } },
            { seq: 2, kind: "scene.replace", payload: { commands: [] } },
          ],
        }),
      }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned non-monotonic packet seq at index 1/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ packets: [{ seq: 1, kind: "legacy.unknown", payload: {} }] }),
      }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned unsupported packet kind legacy\.unknown at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad json")) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: bad json/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ packets: [{ seq: 1, kind: "" }] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed packet at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ packets: [{ seq: 1, kind: "scene.replace" }] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed packet at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ packets: [{ seq: 1, kind: "scene.replace", payload: {} }] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed scene\.replace packet at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ packets: [{ seq: 1, kind: "ui_state.replace", payload: { state: null } }] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed ui_state\.replace packet at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ packets: [{ seq: 1, kind: "display.replace", payload: { display: null } }] }) }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed display\.replace packet at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ packets: [{ seq: 1, kind: "widget.append_text", payload: { frame_id: "f1", widget_id: "w1" } }] }),
      }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed widget\.append_text packet at index 0/
    );
  }

  {
    const { runtimeSource } = createSourceWithFetch(
      () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ packets: [{ seq: 1, kind: "geom.color.patch", payload: { frame_id: "f1", object_id: 0, color: [1, 0, 0, 1] } }] }),
      }),
      { strictPacketOnly: true }
    );
    await assert.rejects(
      () => runtimeSource.loadPackets(),
      /strict packet-only runtime packet source failed: overlay packet API returned malformed geom\.color\.patch packet at index 0/
    );
  }

  {
    const { runtimeSource, logs } = createSourceWithFetch(
      () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ packets: [] }) }),
      { packetOnly: true }
    );
    assert.equal(await runtimeSource.loadPackets(), null);
    assert.ok(logs.some((entry) => entry.message === "loadPackets: packet-only mode skipped file mirror fallback"));
  }

  console.log("vf-runtime-source-packet-only tests passed");
})();
