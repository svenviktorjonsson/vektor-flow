import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const helperPath = path.join(
  repositoryRoot,
  "scripts/internal/native-release-smoke-lifecycle.ps1",
);

async function waitForPath(target, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await access(target);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  assert.fail(`timed out waiting for ${target}`);
}

test(
  "smoke cleanup waits for a test-owned profile lock to release",
  // Cold PowerShell startup can exceed ten seconds under a saturated Windows
  // test run. The cleanup itself remains bounded by its 30 x 50 ms policy.
  { skip: process.platform !== "win32", timeout: 30_000 },
  async () => {
    const testRoot = await mkdtemp(path.join(repositoryRoot, ".work-g00j-"));
    const profile = path.join(testRoot, "renamed.exe.WebView2");
    const lockPath = path.join(profile, "EBWebView", "lockfile");
    const readyPath = path.join(testRoot, "ready");
    const lockerScript = path.join(testRoot, "hold-lock.ps1");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "locked", "utf8");
    await writeFile(
      lockerScript,
      [
        "$stream = [System.IO.File]::Open($env:VKF_LOCK_PATH, 'Open', 'ReadWrite', 'None')",
        "Set-Content -LiteralPath $env:VKF_READY_PATH -Value ready",
        "Start-Sleep -Milliseconds 750",
        "$stream.Dispose()",
      ].join("\n"),
      "utf8",
    );

    const locker = spawn("pwsh", ["-NoProfile", "-File", lockerScript], {
      env: {
        ...process.env,
        VKF_LOCK_PATH: lockPath,
        VKF_READY_PATH: readyPath,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await waitForPath(readyPath);
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          ". $env:VKF_HELPER_PATH; Remove-VkfPackageSmokePath -Path $env:VKF_PROFILE_PATH -ExpectedRoot $env:VKF_TEST_ROOT -Attempts 30 -RetryMilliseconds 50",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            VKF_HELPER_PATH: helperPath,
            VKF_PROFILE_PATH: profile,
            VKF_TEST_ROOT: testRoot,
          },
          windowsHide: true,
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      await assert.rejects(access(profile));
    } finally {
      locker.kill();
      await rm(testRoot, { recursive: true, force: true, maxRetries: 8 });
    }
  },
);

test(
  "smoke cleanup refuses paths outside its isolated root",
  { skip: process.platform !== "win32" },
  async () => {
    const testRoot = await mkdtemp(path.join(repositoryRoot, ".work-g00j-root-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "vkf-g00j-outside-"));
    const outsideFile = path.join(outsideRoot, "user-owned.txt");
    await writeFile(outsideFile, "keep", "utf8");
    try {
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          ". $env:VKF_HELPER_PATH; Remove-VkfPackageSmokePath -Path $env:VKF_OUTSIDE_PATH -ExpectedRoot $env:VKF_TEST_ROOT",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            VKF_HELPER_PATH: helperPath,
            VKF_OUTSIDE_PATH: outsideFile,
            VKF_TEST_ROOT: testRoot,
          },
          windowsHide: true,
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stderr}\n${result.stdout}`,
        /must stay inside the isolated smoke root/u,
      );
      assert.equal(await readFile(outsideFile, "utf8"), "keep");
    } finally {
      await rm(testRoot, { recursive: true, force: true, maxRetries: 8 });
      await rm(outsideRoot, { recursive: true, force: true, maxRetries: 8 });
    }
  },
);

test(
  "smoke cleanup tolerates an owned process that exited before inspection",
  { skip: process.platform !== "win32" },
  async () => {
    const testRoot = await mkdtemp(path.join(repositoryRoot, ".work-g00j-exit-"));
    const profile = path.join(testRoot, "renamed.exe.WebView2");
    await mkdir(profile, { recursive: true });
    try {
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          [
            ". $env:VKF_HELPER_PATH",
            "$process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', 'exit 0') -WindowStyle Hidden -PassThru",
            "$process.WaitForExit()",
            "Stop-VkfPackageSmokeProcess -Process $process -ExpectedExecutable $env:VKF_EXPECTED_EXE -ProfilePath $env:VKF_PROFILE_PATH -ExpectedRoot $env:VKF_TEST_ROOT",
          ].join("; "),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            VKF_EXPECTED_EXE: path.join(testRoot, "renamed.exe"),
            VKF_HELPER_PATH: helperPath,
            VKF_PROFILE_PATH: profile,
            VKF_TEST_ROOT: testRoot,
          },
          windowsHide: true,
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      await assert.rejects(access(profile));
    } finally {
      await rm(testRoot, { recursive: true, force: true, maxRetries: 8 });
    }
  },
);

test(
  "WebView cleanup matches only the exact test-owned profile",
  { skip: process.platform !== "win32" },
  () => {
    const profile = path.join(repositoryRoot, ".work", "runtime-v1");
    const child = path.join(profile, "EBWebView");
    const sibling = `${profile}0`;
    const command = [
      ". $env:VKF_HELPER_PATH",
      "$exact = Test-VkfWebViewProfileCommandLine -CommandLine $env:VKF_EXACT_COMMAND -ProfilePath $env:VKF_PROFILE_PATH",
      "$child = Test-VkfWebViewProfileCommandLine -CommandLine $env:VKF_CHILD_COMMAND -ProfilePath $env:VKF_PROFILE_PATH",
      "$sibling = Test-VkfWebViewProfileCommandLine -CommandLine $env:VKF_SIBLING_COMMAND -ProfilePath $env:VKF_PROFILE_PATH",
      "if (-not $exact -or -not $child -or $sibling) { exit 1 }",
    ].join("; ");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        VKF_CHILD_COMMAND: `msedgewebview2.exe --user-data-dir="${child}" --type=renderer`,
        VKF_EXACT_COMMAND: `msedgewebview2.exe --user-data-dir="${profile}" --type=gpu-process`,
        VKF_HELPER_PATH: helperPath,
        VKF_PROFILE_PATH: profile,
        VKF_SIBLING_COMMAND: `msedgewebview2.exe --user-data-dir="${sibling}" --type=gpu-process`,
      },
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  },
);

test("portable packaging uses bounded hidden smoke-process cleanup", async () => {
  const helper = await readFile(helperPath, "utf8");
  const source = await readFile(
    path.join(repositoryRoot, "scripts/package-native-release.ps1"),
    "utf8",
  );
  assert.match(source, /native-release-smoke-lifecycle\.ps1/u);
  assert.match(source, /Stop-VkfPackageSmokeProcess/u);
  assert.match(source, /-ExpectedExecutable \$relocatedUi/u);
  assert.match(source, /-ProfilePath \$relocatedProfile/u);
  assert.match(
    source,
    /\$uiLocalAppData\s*=\s*Join-Path\s+\$smokeRoot\s+"localappdata"/u,
    "the isolated runtime cache must stay inside the repository-owned smoke root",
  );
  assert.match(
    source,
    /\$relocatedProfile\s*=\s*Join-Path\s+\$uiLocalAppData\s+"vektor-flow\/webview2\/runtime-v1"/u,
    "cleanup must target the shared WebView profile actually used by the native host",
  );
  assert.match(
    source,
    /Stop-VkfPackageSmokeProcess\s+`?\s*-Process\s+\$openedProcess[\s\S]+?-ProfilePath\s+\$uiWebViewProfile/u,
    "the attached-open proof must drain its WebView profile before relocation",
  );
  assert.match(source, /Start-Process[^\n]+-WindowStyle Hidden/u);
  assert.doesNotMatch(source, /Get-Process\s+-Name\s+(?:msedge|msedgewebview2)/iu);
  assert.match(
    source,
    /installed_runtime\.vkf/u,
    "independent native runtime checks should share one compiler startup",
  );
  assert.doesNotMatch(
    source,
    /installed_(?:io|collections_errors|system|process|regex)\.vkf/u,
  );
  assert.match(helper, /function\s+Stop-VkfPackageProfileProcesses/u);
  assert.match(helper, /msedgewebview2\.exe/iu);
  assert.match(helper, /\.CommandLine/u);
  assert.match(
    helper,
    /Stop-VkfPackageProfileProcesses[\s\S]+?-ProfilePath\s+\$profileFullPath/u,
    "owned app shutdown must drain detached WebView children for the exact profile",
  );
});
