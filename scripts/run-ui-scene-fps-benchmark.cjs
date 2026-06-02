#!/usr/bin/env node
"use strict";

const benchmark = require("../web/vf-ui/vf-ui-scene-fps-benchmark.js");

function parseNumberFlag(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) {
    return fallback;
  }
  const value = Number(match.slice(prefix.length));
  return Number.isFinite(value) ? value : fallback;
}

const frames = parseNumberFlag("frames", 60);
const warmupFrames = parseNumberFlag("warmups", 12);
const payload = benchmark.runUiSceneFpsBenchmark({ frames, warmupFrames });

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`UI scene FPS benchmark (${payload.contract.metric})\n`);
  process.stdout.write(`frames=${payload.frames_per_case} warmups=${payload.warmup_frames_per_case} cases=${payload.summary.cases}\n`);
  for (const scene of payload.cases) {
    process.stdout.write(
      `${scene.name}: ` +
      `p95_fps=${scene.fps_possible.p95_budgeted.toFixed(1)} ` +
      `median_fps=${scene.fps_possible.median.toFixed(1)} ` +
      `frame_p95_ms=${scene.frame_ms.p95.toFixed(3)} ` +
      `objects=${JSON.stringify(scene.object_types)} ` +
      `geom=${scene.geometry.vertices}v/${scene.geometry.edges}e/${scene.geometry.faces}f ` +
      `changes=view:${scene.changes_per_frame.view},object:${scene.changes_per_frame.object} ` +
      `effects=${JSON.stringify(scene.effects)}\n`
    );
  }
  process.stdout.write(
    `summary: min_p95_fps=${payload.summary.min_p95_budgeted_fps.toFixed(1)} ` +
    `median_p95_fps=${payload.summary.median_p95_budgeted_fps.toFixed(1)} ` +
    `max_p95_fps=${payload.summary.max_p95_budgeted_fps.toFixed(1)}\n`
  );
}
