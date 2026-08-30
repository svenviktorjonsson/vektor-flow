import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const compiler = process.env.VKF_PROCESS_RUN_COMPILER;
const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(import.meta.dirname, ".work"));
const suffix = process.platform === "win32" ? ".exe" : "";

function captureProcessTree(rootPid) {
  const command = [
    `$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime,CommandLine`,
    `$ids=@([uint32]${rootPid})`,
    "do {$before=$ids.Count; $ids += @($all | Where-Object {$ids -contains $_.ParentProcessId} | ForEach-Object {[uint32]$_.ProcessId}); $ids=@($ids | Select-Object -Unique)} while ($ids.Count -ne $before)",
    "$all | Where-Object {$ids -contains $_.ProcessId} | ConvertTo-Json -Compress",
  ].join("; ");
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

test("public process.run and process.shell synchronously return code, stdout, and stderr", {
  skip: process.platform !== "win32",
  timeout: 30_000,
}, async () => {
  assert.equal(existsSync(compiler), true, "VKF_PROCESS_RUN_COMPILER must name a compiler");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i51-process-"));
  try {
    const source = join(work, "process-run.vkf");
    const artifact = join(work, `process-run${suffix}`);
    writeFileSync(source, [
      "process: .process",
      'run: process.run("cmd.exe", ["/d", "/c", "echo run-out& echo run-err 1>&2& exit /b 7"])',
      'shell: process.shell("echo shell-out& echo shell-err 1>&2& exit /b 9")',
      ":: run.code",
      ":: run.out",
      ":: run.err",
      ":: shell.code",
      ":: shell.out",
      ":: shell.err",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact], {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(compiled.error, undefined, compiled.error?.message);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);

    const runs = [];
    for (let iteration = 0; iteration < 3; iteration += 1) {
      runs.push(await runBounded(artifact, 1_500));
    }
    assert.equal(
      runs.every((result) => !result.timedOut),
      true,
      `generated process artifact did not terminate: ${JSON.stringify(runs.map((result) => ({
        processTree: result.processTree,
        timedOut: result.timedOut,
      })))}`,
    );
    for (const result of runs) {
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(
        result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        ["7", "run-out", "run-err", "9", "shell-out", "shell-err"],
      );
      assert.equal(result.stderr, "");
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
