const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../../web/vf-ui/vf-native-scene.js"),
  "utf8",
);

assert.match(
  source,
  /var preserveLocalFaceSpace = textureKind === "dice";/u,
  "procedural dice must retain canonical face-space vertices",
);
assert.match(
  source,
  /if \(!hasDynamicTransform && !preserveLocalFaceSpace\) \{/u,
  "a static dice transform must not be baked into its vertex positions",
);
assert.match(
  source,
  /mesh\.center = toVec3\(cube\.center, \[0, 0, 0\]\);[\s\S]*mesh\.rotation = toVec3\(cube\.rotation, \[0, 0, 0\]\);/u,
  "an unbaked die must keep its center and rotation on the mesh model transform",
);

console.log("vf-native-scene dice face-space tests passed");
