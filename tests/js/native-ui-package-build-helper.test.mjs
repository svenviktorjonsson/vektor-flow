import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test(
  "native UI package build avoids MSBuild file tracking in deep worktrees",
  { skip: process.platform !== "win32" },
  () => {
    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        "scripts/build-native-ui-package.ps1",
        "-PlanOnly",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.generator, "Ninja");
    assert.equal(plan.compilerEnvironment, "MSVC");
    assert.equal(plan.avoidsMsbuildFileTracker, true);
    assert.equal(plan.usesShortRepositoryPath, true);
    assert.equal(plan.buildDirectory, "build/v");
    assert.equal(plan.packageUiBinaryDirectory, "build/v");
    assert.ok(plan.legacyMsbuildScratchPathLength > 260);
    assert.ok(plan.mappedCMakeScratchPathLength < 200);
    assert.equal(plan.minimumNinjaVersion, "1.11.0");
    assert.equal(plan.pinnedNinjaVersion, "1.12.1");
    assert.equal(
      plan.pinnedNinjaArchiveSha256,
      "f550fec705b6d6ff58f2db3c374c2277a37691678d6aba463adcbb129108467a",
    );
  },
);
