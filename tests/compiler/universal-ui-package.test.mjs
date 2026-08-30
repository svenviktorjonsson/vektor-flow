import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const universalVfk = process.env.VKF_UNIVERSAL_BIN;
const workName = `u10-${process.pid}`;
const workRoot = path.join(repositoryRoot, ".work", workName);

function runVkf(args, cwd) {
  return execFileSync(universalVfk, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function sceneBundleEntries(application) {
  const footer = Buffer.from("VKF_SCENE_BUNDLE_END_V1");
  assert.deepEqual(application.subarray(application.length - footer.length), footer);
  const sizeOffset = application.length - footer.length - 8;
  const payloadSize = Number(application.readBigUInt64LE(sizeOffset));
  const payload = application.subarray(sizeOffset - payloadSize, sizeOffset);
  const header = Buffer.from("VKF_SCENE_BUNDLE_V1\n");
  assert.deepEqual(payload.subarray(0, header.length), header);
  let offset = header.length;
  const count = payload.readUInt32LE(offset);
  offset += 4;
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const pathLength = payload.readUInt32LE(offset);
    offset += 4;
    const dataLength = Number(payload.readBigUInt64LE(offset));
    offset += 8;
    const relativePath = payload.subarray(offset, offset + pathLength).toString("utf8");
    offset += pathLength;
    entries.set(relativePath, payload.subarray(offset, offset + dataLength));
    offset += dataLength;
  }
  assert.equal(offset, payload.length);
  return { entries, payload };
}

function fnv1a64Hex(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function processWithImageNameExists(imageName) {
  const listing = execFileSync("tasklist.exe", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return listing.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
}

async function waitFor(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("condition was not met before timeout");
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  try {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    child.kill();
  }
  await waitFor(() => child.exitCode !== null, 10_000);
}

test.after(async () => {
  await rm(workRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test("vkf -b embeds a Display Frame and its static HTML/CSS in one application", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  assert.ok(universalVfk, "VKF_UNIVERSAL_BIN must name the packaged vkf executable");
  assert.equal(path.basename(universalVfk).toLowerCase(), "vkf.exe");
  const packageBin = path.dirname(universalVfk);
  const packageFiles = (await readdir(packageBin)).map((name) => name.toLowerCase());
  assert.deepEqual(packageFiles.filter((name) => name === "vkf.exe"), ["vkf.exe"]);
  assert.equal(packageFiles.includes("vkf-strict.exe"), false);
  for (const helper of ["vkf-ui-package.exe", "vkf-runner.exe", "vkf-native-scene-artifact-stager.exe"]) {
    assert.equal(packageFiles.includes(helper), true, `missing private package helper ${helper}`);
  }
  const sourceRoot = path.join(workRoot, "source");
  const uiRoot = path.join(sourceRoot, "ui");
  const source = path.join(sourceRoot, "app.vkf");
  const output = path.join(sourceRoot, "vf-u10-build-only.exe");
  const html = '<link rel="stylesheet" href="theme.css"><main><button>Apply</button></main>\n';
  const css = "button { color: rgb(12, 34, 56); }\n";
  await mkdir(uiRoot, { recursive: true });
  await Promise.all([
    writeFile(source, [
      ": .ui.display",
      "display: Display(dim:2)",
      "frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])",
      'frame.load("ui/main.html")',
    ].join("\n"), "utf8"),
    writeFile(path.join(uiRoot, "main.html"), html, "utf8"),
    writeFile(path.join(uiRoot, "theme.css"), css, "utf8"),
  ]);

  const stdout = runVkf(["-b", source, "-o", output], sourceRoot);
  assert.match(stdout, /^Built /m);
  assert.equal(existsSync(output), true);
  assert.equal(processWithImageNameExists(path.basename(output)), false, "vkf -b must not open the application");
  const application = await readFile(output);
  const { entries } = sceneBundleEntries(application);
  assert.deepEqual(JSON.parse(entries.get("vf-package-provenance.json")), {
    schema: "vektorflow.internal.ui_package_provenance",
    version: 1,
    compiler: "vkf",
    packager: "vkf-ui-package-v1",
    entry: "sessions/app/vkf-scene.html",
  });
  assert.deepEqual(JSON.parse(entries.get("sessions/app/vf-launch-manifest.json")).schema, "vektor-flow/launch-manifest");
  assert.notEqual([...entries.values()].findIndex((entry) => entry.equals(Buffer.from(html))), -1);
  assert.notEqual([...entries.values()].findIndex((entry) => entry.equals(Buffer.from(css))), -1);
  assert.equal(existsSync(path.join(sourceRoot, ".vkfbuild")), false);

  const missingHelperRoot = path.join(workRoot, "missing-ui-helper");
  const missingHelperVkf = path.join(missingHelperRoot, "vkf.exe");
  const rejectedOutput = path.join(missingHelperRoot, "must-not-exist.exe");
  await mkdir(missingHelperRoot, { recursive: true });
  await copyFile(universalVfk, missingHelperVkf);
  assert.throws(() => execFileSync(missingHelperVkf, ["-b", source, "-o", rejectedOutput], {
    cwd: missingHelperRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }), (error) => {
    assert.match(String(error.stderr), /missing native sibling tool UI packager/u);
    return true;
  });
  assert.equal(existsSync(rejectedOutput), false, "UI packaging failure must not fall back to a headless artifact");
  assert.equal(existsSync(path.join(sourceRoot, ".vkfbuild")), false, "rejected UI packaging must clean private staging state");
});

test("the same vkf keeps ordinary non-UI build behavior", {
  skip: process.platform !== "win32",
  timeout: 30_000,
}, async () => {
  assert.ok(universalVfk, "VKF_UNIVERSAL_BIN must name the packaged vkf executable");
  const sourceRoot = path.join(workRoot, "non-ui");
  const source = path.join(sourceRoot, "answer.vkf");
  const output = path.join(sourceRoot, "answer.exe");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(source, ":: 42\n", "utf8");
  assert.match(runVkf(["-b", source, "-o", output], sourceRoot), /^Built /m);
  assert.equal(existsSync(output), true);
  assert.equal((await readFile(output)).includes(Buffer.from("VKF_SCENE_BUNDLE_END_V1")), false);
  assert.equal(execFileSync(output, { encoding: "utf8", windowsHide: true }).trim(), "42");
  assert.equal(existsSync(path.join(sourceRoot, ".vkfbuild")), false);
});

test("a UI application is deterministic and runs after relocation without its source or helpers", {
  skip: process.platform !== "win32",
  timeout: 90_000,
}, async () => {
  assert.ok(universalVfk, "VKF_UNIVERSAL_BIN must name the packaged vkf executable");
  const sourceRoot = path.join(workRoot, "relocated-source");
  const uiRoot = path.join(sourceRoot, "ui");
  const source = path.join(sourceRoot, "original.vkf");
  const firstOutput = path.join(sourceRoot, "first-name.exe");
  const secondOutput = path.join(sourceRoot, "second-name.exe");
  await mkdir(uiRoot, { recursive: true });
  await Promise.all([
    writeFile(source, [
      ": .ui.display",
      "display: Display(dim:2)",
      "frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])",
      'frame.load("ui/main.html")',
    ].join("\n"), "utf8"),
    writeFile(path.join(uiRoot, "main.html"), `<link rel="stylesheet" href="theme.css"><button>Relocated ${process.pid}</button>\n`, "utf8"),
    writeFile(path.join(uiRoot, "theme.css"), '@import "empty.css";\nbutton { color: rgb(7, 8, 9); background-image: url("assets/icon.svg"); }\n', "utf8"),
    writeFile(path.join(uiRoot, "empty.css"), "", "utf8"),
    mkdir(path.join(uiRoot, "assets"), { recursive: true }).then(() =>
      writeFile(path.join(uiRoot, "assets", "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>\n', "utf8")),
  ]);

  runVkf(["-b", source, "-o", firstOutput], sourceRoot);
  runVkf(["-b", source, "-o", secondOutput], sourceRoot);
  const firstApplication = await readFile(firstOutput);
  assert.deepEqual(firstApplication, await readFile(secondOutput), "same UI graph must package deterministically");
  const { entries, payload } = sceneBundleEntries(firstApplication);
  const emptyCss = [...entries].find(([relative, bytes]) => relative.endsWith("/empty.css") && bytes.length === 0);
  const nestedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>\n');
  assert.ok(emptyCss, "static bundle must retain the empty imported stylesheet");
  assert.notEqual([...entries.values()].findIndex((entry) => entry.equals(nestedSvg)), -1, "static bundle must retain nested SVG bytes");
  const runtimeLocalAppData = process.env.LOCALAPPDATA;
  const appCache = path.join(
    runtimeLocalAppData,
    "vektor-flow",
    "vkf",
    "apps",
    fnv1a64Hex(payload),
  );
  await rm(appCache, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

  const cleanRoot = path.join(workRoot, "clean-relocated-package");
  const relocated = path.join(cleanRoot, "renamed-application.exe");
  await rm(cleanRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await mkdir(cleanRoot, { recursive: true });
  await copyFile(firstOutput, relocated);
  await rm(sourceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  assert.deepEqual(await readdir(cleanRoot), ["renamed-application.exe"]);

  const application = spawn(relocated, [], {
    cwd: cleanRoot,
    env: { ...process.env, LOCALAPPDATA: runtimeLocalAppData, PATH: "" },
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitFor(() => application.exitCode !== null || existsSync(path.join(appCache, "vf-package-provenance.json")));
    assert.equal(application.exitCode, null, "relocated UI application must stay running without source or package helpers");
    assert.deepEqual(
      await readFile(path.join(appCache, "sessions", "original", "vkf-scene.html")),
      entries.get("sessions/original/vkf-scene.html"),
      "the running application must extract its own provenance-selected entry",
    );
  } finally {
    await stopProcess(application);
  }

  const emptyCachePath = path.join(appCache, ...emptyCss[0].split("/"));
  await rm(emptyCachePath, { force: true });
  const repairingApplication = spawn(relocated, [], {
    cwd: cleanRoot,
    env: { ...process.env, LOCALAPPDATA: runtimeLocalAppData, PATH: "" },
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitFor(() => repairingApplication.exitCode !== null || existsSync(emptyCachePath));
    assert.equal(repairingApplication.exitCode, null, "cached bundle repair must preserve application startup");
    assert.equal((await readFile(emptyCachePath)).length, 0, "missing empty resources must be restored from the bundle");
  } finally {
    await stopProcess(repairingApplication);
  }

  const corrupted = Buffer.from(firstApplication);
  const schema = Buffer.from("vektorflow.internal.ui_package_provenance");
  const schemaOffset = corrupted.lastIndexOf(schema);
  assert.notEqual(schemaOffset, -1);
  corrupted[schemaOffset] = "x".charCodeAt(0);
  const corruptExecutable = path.join(cleanRoot, "corrupt-application.exe");
  const { payload: corruptPayload } = sceneBundleEntries(corrupted);
  const corruptCache = path.join(
    runtimeLocalAppData,
    "vektor-flow",
    "vkf",
    "apps",
    fnv1a64Hex(corruptPayload),
  );
  await rm(corruptCache, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await writeFile(corruptExecutable, corrupted);
  assert.throws(() => execFileSync(corruptExecutable, {
    cwd: cleanRoot,
    env: { ...process.env, LOCALAPPDATA: runtimeLocalAppData, PATH: "" },
    stdio: "ignore",
    timeout: 10_000,
    windowsHide: true,
  }));
  assert.equal(existsSync(corruptCache), false, "invalid private provenance must reject before extraction");
  await rm(appCache, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test("vkf app.vkf builds and opens the same native UI application", {
  skip: process.platform !== "win32",
  timeout: 90_000,
}, async () => {
  assert.ok(universalVfk, "VKF_UNIVERSAL_BIN must name the packaged vkf executable");
  const sourceRoot = path.join(workRoot, "open");
  const uiRoot = path.join(sourceRoot, "ui");
  const source = path.join(sourceRoot, "open.vkf");
  const output = path.join(sourceRoot, "u10open.exe");
  await mkdir(uiRoot, { recursive: true });
  await Promise.all([
    writeFile(source, [
      ": .ui.display",
      "display: Display(dim:2)",
      "frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])",
      'frame.load("ui/main.html")',
    ].join("\n"), "utf8"),
    writeFile(path.join(uiRoot, "main.html"), `<button>Opened ${process.pid}</button>\n`, "utf8"),
  ]);
  assert.equal(processWithImageNameExists(path.basename(output)), false);
  const compiler = spawn(universalVfk, [source, "-o", output], {
    cwd: sourceRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitFor(() => compiler.exitCode !== null || processWithImageNameExists(path.basename(output)), 30_000);
    assert.equal(compiler.exitCode, null, "vkf must keep the opened application attached");
    assert.equal(processWithImageNameExists(path.basename(output)), true, "vkf app.vkf must open the built native application");
    assert.equal(existsSync(output), true);
  } finally {
    await stopProcess(compiler);
  }
  const { payload } = sceneBundleEntries(await readFile(output));
  await rm(path.join(
    process.env.LOCALAPPDATA,
    "vektor-flow",
    "vkf",
    "apps",
    fnv1a64Hex(payload),
  ), { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});
