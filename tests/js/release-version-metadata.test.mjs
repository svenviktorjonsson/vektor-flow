import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const releaseVersion = "0.4.0";

test("0.4 release metadata is consistent across npm and the native compiler", () => {
  const packageMetadata = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const lockMetadata = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  const driver = readFileSync(
    path.join(root, "compiler", "native", "vkf_driver_artifact_smoke.cpp"),
    "utf8",
  );

  assert.equal(packageMetadata.version, releaseVersion);
  assert.equal(lockMetadata.version, releaseVersion);
  assert.equal(lockMetadata.packages[""].version, releaseVersion);
  assert.match(driver, /vkf_release_version\s*=\s*"0\.4\.0"/);
});

test("0.4 release publication metadata names the candidate without rewriting historical proof", () => {
  const workflow = readFileSync(
    path.join(root, ".github", "workflows", "native-release.yml"),
    "utf8",
  );
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const install = readFileSync(path.join(root, "docs", "install.md"), "utf8");
  const releaseNotes = readFileSync(
    path.join(root, "docs", "releases", `${releaseVersion}.md`),
    "utf8",
  );

  assert.match(workflow, /VKF_RELEASE_VERSION:\s*"0\.4\.0"/);
  assert.match(workflow, /VKF_PROOF_SUFFIX:\s*"040"/);
  assert.match(readme, /VKF 0\.4\.0 is an unsupported experimental preview/);
  assert.match(readme, /## Install VKF 0\.4\.0/);
  assert.match(readme, /releases\/tag\/v0\.4\.0/);
  assert.match(readme, /## 0\.3\.0 Changes/);
  assert.match(install, /0\.4\.0/);
  assert.match(releaseNotes, /^# Vektor Flow 0\.4\.0/m);
});
