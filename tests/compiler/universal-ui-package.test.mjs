import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const universalVfk = process.env.VKF_UNIVERSAL_BIN;
const workRoot = path.join(repositoryRoot, ".work", "040-u10-universal-ui-package");

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
  return entries;
}

function processWithImageNameExists(imageName) {
  const listing = execFileSync("tasklist.exe", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return listing.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
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
  const entries = sceneBundleEntries(application);
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
