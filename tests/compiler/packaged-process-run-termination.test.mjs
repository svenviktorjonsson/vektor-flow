import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packagedBin = process.env.VKF_PACKAGED_BIN
  ? resolve(process.env.VKF_PACKAGED_BIN)
  : "";
const compiler = join(packagedBin, "vkf.exe");
const suffix = process.platform === "win32" ? ".exe" : "";

function captureProcessTree(rootPid) {
  const command = [
    "$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime,CommandLine;",
    "$ids=@([uint32]" + rootPid + ");",
    "do {$before=$ids.Count; $ids += @($all | Where-Object {$ids -contains $_.ParentProcessId} | ForEach-Object {[uint32]$_.ProcessId}); $ids=@($ids | Select-Object -Unique)} while ($ids.Count -ne $before);",
    "$all | Where-Object {$ids -contains $_.ProcessId} | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return result.stdout.trim() || result.stderr.trim() || "<process tree unavailable>";
}

async function runBounded(executable, timeoutMs) {
  const child = spawn(executable, [], {
    cwd: dirname(executable),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  return await new Promise((resolveRun) => {
    let timedOut = false;
    let processTree = "";
    const timer = setTimeout(() => {
      timedOut = true;
      processTree = captureProcessTree(child.pid);
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 5_000,
        windowsHide: true,
      });
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, processTree, signal, stderr, stdout, timedOut });
    });
  });
}

test("packaged process.run and process.shell return after their children terminate", {
  skip: process.platform !== "win32",
  timeout: 30_000,
}, async () => {
  assert.ok(packagedBin, "VKF_PACKAGED_BIN must name the packaged compiler directory");
  const workParent = join(root, "build", "040-u10a-process-run-work");
  mkdirSync(workParent, { recursive: true });
  const work = mkdtempSync(join(workParent, "case-"));
  try {
    const source = join(work, "process-exit.vkf");
    const artifact = join(work, `process-exit${suffix}`);
    writeFileSync(source, [
      "process: .process",
      'result: process.run("cmd.exe", ["/d", "/c", "exit /b 7"])',
      'shellResult: process.shell("exit /b 9")',
      ":: result.code",
      ":: shellResult.code",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
    assert.equal(compiled.error, undefined, String(compiled.error));
    assert.equal(compiled.status, 0, compiled.stderr);
    const results = [];
    for (let iteration = 0; iteration < 3; iteration += 1) {
      results.push(await runBounded(artifact, 750));
    }
    assert.equal(
      results.every((result) => !result.timedOut),
      true,
      `CPU-spin repetitions=${JSON.stringify(results.map((result, index) => ({
        iteration: index + 1,
        processTree: result.processTree,
        timedOut: result.timedOut,
      })))}`,
    );
    for (const result of results) {
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split(/\r?\n/), ["7", "9"]);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
