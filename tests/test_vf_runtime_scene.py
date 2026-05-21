from __future__ import annotations

import json
import subprocess
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
RUNTIME_SCENE_JS = REPO / "web" / "vf-ui" / "vf-runtime-scene.js"


def test_runtime_scene_missing_parent_fails_loudly() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync({json.dumps(str(RUNTIME_SCENE_JS))}, "utf8");
const sandbox = {{
  console,
  setTimeout: function(fn) {{ return 1; }},
  clearTimeout: function() {{}},
  requestAnimationFrame: function(fn) {{ return 1; }},
  getComputedStyle: function() {{
    return {{ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0" }};
  }},
  document: {{
    createElement: function(tag) {{
      return {{
        tagName: tag,
        className: "",
        children: [],
        style: {{}},
        dataset: {{}},
        classList: {{ add: function() {{}}, contains: function() {{ return false; }} }},
        appendChild: function(child) {{ this.children.push(child); return child; }},
        querySelector: function() {{ return null; }},
        getBoundingClientRect: function() {{ return {{ width: 640, height: 480 }}; }}
      }};
    }}
  }}
}};
sandbox.window = sandbox;

vm.runInNewContext(source, sandbox, {{ filename: "vf-runtime-scene.js" }});

const mounts = [];
const layer = {{
  innerHTML: "",
  children: [],
  appendChild: function(child) {{ this.children.push(child); return child; }},
  querySelectorAll: function() {{ return []; }}
}};

const frameApi = {{
  _coerceAlpha: function(value, fallback) {{ return value == null ? fallback : value; }},
  normalizeDockLocationKey: function(key) {{ return key || "tl"; }},
  mount: function(_layer, options) {{
    mounts.push(options.id);
    const root = {{
      dataset: {{}},
      style: {{}},
      classList: {{ add: function() {{}}, contains: function() {{ return false; }} }},
      offsetParent: null,
      parentElement: null,
      querySelector: function() {{ return null; }},
      getBoundingClientRect: function() {{ return {{ width: 640, height: 514 }}; }}
    }};
    const body = {{
      children: [],
      appendChild: function(child) {{ this.children.push(child); return child; }},
      getBoundingClientRect: function() {{ return {{ width: 640, height: 480 }}; }}
    }};
    root.parentElement = layer;
    return {{
      root,
      body,
      syncPointerPassThrough: function() {{}},
      renderTitle: function() {{}}
    }};
  }}
}};

const adapter = sandbox.VfRuntimeScene.createAdapter({{
  createRuntimeDependencies: function() {{ return {{ frame: frameApi, widgets: null }}; }},
  runtimeLog: function() {{}},
  getLayer: function() {{ return layer; }},
  displayRefresh: function() {{}},
  isLegacyFallbackActive: function() {{ return false; }}
}});

try {{
  adapter.applySceneCommands([
    {{
      kind: "frame_upsert",
      payload: {{
        spec: {{
          id: "child-frame",
          parent_id: "missing-parent",
          rect: {{ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }}
        }}
      }}
    }}
  ]);
  process.stdout.write(JSON.stringify({{ ok: true, mounts }}));
}} catch (error) {{
  process.stdout.write(JSON.stringify({{
    ok: false,
    mounts,
    message: String(error && error.message ? error.message : error)
  }}));
}}
"""

    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )

    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["mounts"] == []
    assert "missing-parent" in payload["message"]


def test_runtime_scene_requires_array_commands() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync({json.dumps(str(RUNTIME_SCENE_JS))}, "utf8");
const sandbox = {{
  console,
  setTimeout: function(fn) {{ return 1; }},
  clearTimeout: function() {{}},
  requestAnimationFrame: function(fn) {{ return 1; }},
  window: null
}};
sandbox.window = sandbox;

vm.runInNewContext(source, sandbox, {{ filename: "vf-runtime-scene.js" }});

const adapter = sandbox.VfRuntimeScene.createAdapter({{
  createRuntimeDependencies: function() {{ return {{ frame: {{}}, widgets: null }}; }},
  runtimeLog: function() {{}},
  getLayer: function() {{ return {{ innerHTML: "", querySelectorAll: function() {{ return []; }} }}; }},
  displayRefresh: function() {{}},
  isLegacyFallbackActive: function() {{ return false; }}
}});

try {{
  adapter.applySceneCommands({{ not: "an array" }});
  process.stdout.write(JSON.stringify({{ ok: true }}));
}} catch (error) {{
  process.stdout.write(JSON.stringify({{
    ok: false,
    message: String(error && error.message ? error.message : error)
  }}));
}}
"""

    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )

    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert "expected array" in payload["message"]
