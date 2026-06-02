from __future__ import annotations

import json
import subprocess
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
FLOW_JS = REPO / "web" / "vf-ui" / "vf-runtime-flow.js"


def test_runtime_packet_flow_quiesces_after_bootstrap() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync({json.dumps(str(FLOW_JS))}, "utf8");
const sandbox = {{
  console,
  Array,
  Promise,
  fetch: function() {{}},
  setInterval: function() {{ return 1; }},
  clearInterval: function() {{}}
}};
sandbox.window = sandbox;

vm.runInNewContext(source, sandbox, {{ filename: "vf-runtime-flow.js" }});

const packetQueue = [
  [{{ seq: 1, kind: "scene.replace", payload: {{ commands: [] }} }}],
  [],
  [],
  []
];

const state = {{
  packetRuntimeState: "bootstrap-only",
  packetIdlePolls: 0,
  runtimePacketsSeen: false,
  lastRuntimePacketSeq: 0,
  packetModeActive: false,
  legacyFallbackActive: false,
  runtimePacketsInFlight: false
}};

const flow = sandbox.VfRuntimeFlow.createFlow({{
  config: {{
    packetPollMs: 16,
    packetPollIdleMs: 120,
    packetPollSteadyMs: 400,
    packetPollIdleThreshold: 1,
    packetPollSteadyThreshold: 2,
    packetPollQuiesceThreshold: 3
  }},
  createRuntimeDependencies: function() {{ return {{}}; }},
  runtimeLog: function() {{}},
  getRuntimeSource: function() {{
    return {{
      loadPackets: function() {{
        return Promise.resolve(packetQueue.shift());
      }}
    }};
  }},
  applySceneCommands: function() {{}},
  state: state
}});

(async function() {{
  const first = await flow.loadRuntimePackets();
  const second = await flow.loadRuntimePackets();
  const third = await flow.loadRuntimePackets();
  const fourth = await flow.loadRuntimePackets();
  flow.routeRuntimePacket({{ seq: 2, kind: "display.replace", payload: {{}} }});

  process.stdout.write(JSON.stringify({{
    states: [
      first.packetRuntimeState,
      second.packetRuntimeState,
      third.packetRuntimeState,
      fourth.packetRuntimeState,
      flow.getPacketRuntimeState()
    ],
    delays: [
      first.nextPollDelayMs,
      second.nextPollDelayMs,
      third.nextPollDelayMs,
      fourth.nextPollDelayMs,
      flow.getNextPacketPollDelay()
    ],
    packetModeActive: state.packetModeActive,
    runtimePacketsSeen: state.runtimePacketsSeen,
    lastRuntimePacketSeq: state.lastRuntimePacketSeq
  }}));
}})().catch((error) => {{
  console.error(error);
  process.exit(1);
}});
"""

    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )

    payload = json.loads(result.stdout)
    assert payload["states"] == [
        "active-stream",
        "active-stream",
        "active-stream",
        "idle",
        "active-stream",
    ]
    assert payload["delays"] == [16, 120, 400, None, 16]
    assert payload["packetModeActive"] is True
    assert payload["runtimePacketsSeen"] is True
    assert payload["lastRuntimePacketSeq"] == 2


def test_strict_packet_only_display_refresh_never_loads_legacy_display_file() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync({json.dumps(str(FLOW_JS))}, "utf8");
const sandbox = {{
  console,
  Array,
  Promise,
  setInterval: function() {{ return 1; }},
  clearInterval: function() {{}}
}};
sandbox.window = sandbox;

vm.runInNewContext(source, sandbox, {{ filename: "vf-runtime-flow.js" }});

let loadAndRenderCalls = 0;
let redrawCalls = 0;
const state = {{
  packetModeActive: false,
  legacyFallbackActive: true,
  scenePollTimer: 0
}};

const flow = sandbox.VfRuntimeFlow.createFlow({{
  config: {{ strictPacketOnly: true }},
  createRuntimeDependencies: function() {{
    return {{
      display: {{
        loadAndRender: function() {{ loadAndRenderCalls += 1; }},
        redrawCurrentDisplay: function() {{ redrawCalls += 1; }}
      }}
    }};
  }},
  runtimeLog: function() {{}},
  getRuntimeSource: function() {{ return null; }},
  applySceneCommands: function() {{}},
  state: state
}});

flow.displayRefresh();
state.packetModeActive = true;
flow.displayRefresh();

process.stdout.write(JSON.stringify({{
  loadAndRenderCalls,
  redrawCalls
}}));
"""

    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )

    payload = json.loads(result.stdout)
    assert payload["loadAndRenderCalls"] == 0
    assert payload["redrawCalls"] == 1
