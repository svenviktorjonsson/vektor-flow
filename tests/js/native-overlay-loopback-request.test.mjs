import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("native UI loopback server ignores sockets closed before a request", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "native/VfOverlay/main.cpp"),
    "utf8",
  );
  const receiveLoop = source.indexOf("int total = 0;");
  const emptyReceiveGuard = source.indexOf("if (total <= 0)", receiveLoop);
  const requestParse = source.indexOf("sscanf_s(buf", receiveLoop);

  assert.match(source, /char buf\[65536\]\{\}/u);
  assert.ok(receiveLoop >= 0, "loopback receive loop must remain present");
  assert.ok(
    emptyReceiveGuard > receiveLoop && emptyReceiveGuard < requestParse,
    "closed sockets must be rejected before request parsing",
  );
  assert.match(
    source,
    /body\.assign\(bodyStart, static_cast<size_t>\(\(buf \+ total\) - bodyStart\)\)/u,
  );
});
