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
