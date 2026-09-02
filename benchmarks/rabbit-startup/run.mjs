import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultScenePath,
  outputDirectoryFor,
  runBenchmark,
} from "./harness.mjs";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const root = process.cwd();
const output = resolve(option("output", ".w/rabbit-startup-evidence/latest.json"));
const pairs = Number(option("pairs", "3"));
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 20) {
  throw new RangeError(`--pairs must be an integer from 1 to 20, got ${pairs}`);
}

const result = await runBenchmark({
  edgePath: option("edge", process.env.VF_EDGE_PATH ||
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"),
  scenePath: option("scene", process.env.VF_RABBIT_SCENE || defaultScenePath(root)),
  gpuMode: option("gpu", process.env.VF_RABBIT_STARTUP_GPU_MODE || "hardware"),
  pairs,
  hostTracePath: option("host-trace", process.env.VKF_STARTUP_TRACE_PATH || ""),
  screenshotPath: option("screenshot", ""),
});

mkdirSync(outputDirectoryFor(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  schema: result.schema,
  output,
  gate: result.gate,
  coldP95Ms: result.cold.p95Ms,
  warmP95Ms: result.warm.p95Ms,
  coldSamples: result.cold.count,
  warmSamples: result.warm.count,
})}\n`);
process.exit(result.gate.pass ? 0 : 1);
