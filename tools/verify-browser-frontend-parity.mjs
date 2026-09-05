import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SITE_PAGES, buildSiteDocument } from "./build-site.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadSharedFrontend(directory = process.env.VKF_SHARED_COMPILER_DIR
  ?? path.join(repository, "build/shared-compiler")) {
  const artifacts = path.resolve(directory);
  const bytes = await readFile(path.join(artifacts, "vkf-compiler.wasm"));
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [], "Compiler must have no host imports");
  const { exports: api } = await WebAssembly.instantiate(module);
  api._initialize?.();
  const nativePath = path.join(artifacts, process.platform === "win32"
    ? "vkf-compiler-probe.exe" : "vkf-compiler-probe");
  return {
    wasmSha256: createHash("sha256").update(bytes).digest("hex"),
    browser(source) {
      const encoded = new TextEncoder().encode(source);
      const pointer = api.malloc(encoded.length + 1);
      assert.notEqual(pointer, 0, "Compiler source allocation failed");
      try {
        new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
        new Uint8Array(api.memory.buffer)[pointer + encoded.length] = 0;
        const status = api.vkf_compile_source(pointer, encoded.length);
        const result = JSON.parse(new TextDecoder().decode(new Uint8Array(
          api.memory.buffer, api.vkf_result_pointer(), api.vkf_result_length(),
        )));
        assert.equal(status, result.ok ? 0 : 1, "Compiler status must agree with result");
        return result;
      } finally {
        api.free(pointer);
      }
    },
    native(source) {
      const process = spawnSync(nativePath, [], {
        input: source, encoding: "utf8", timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      });
      assert.equal(process.error, undefined, process.error?.message);
      assert.equal(process.status, 0, process.stderr);
      return JSON.parse(process.stdout);
    },
  };
}

export async function documentationSources(root = repository) {
  const documents = new Set(Object.keys(SITE_PAGES));
  async function addDirectory(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await addDirectory(relative);
      else if (entry.isFile() && entry.name.endsWith(".md")) documents.add(relative);
    }
  }
  await addDirectory("docs/site");
  const pending = [...documents];
  while (pending.length) {
    const document = await buildSiteDocument(root, pending.shift());
    for (const dependency of document.dependencies) {
      if (!documents.has(dependency)) {
        documents.add(dependency);
        pending.push(dependency);
      }
    }
  }
  const entries = [];
  for (const document of [...documents].sort()) {
    const lines = (await readFile(path.join(root, document), "utf8")).replaceAll("\r\n", "\n").split("\n");
    for (let index = 0; index < lines.length; index++) {
      const marker = /^\s*<!-- (live-example|readme-example): ([^>]+?) -->\s*$/u.exec(lines[index]);
      if (marker) {
        const named = marker[2].trim();
        const sourcePath = marker[1] === "live-example" || named.startsWith("examples/")
          ? named : `examples/generated/readme/${named}`;
        entries.push({ document, line: index + 1, kind: marker[1], sourcePath,
          source: await readFile(path.join(root, sourcePath), "utf8") });
        continue;
      }
      const fence = /^\s*(`{3,}|~{3,})(.*)$/u.exec(lines[index]);
      if (!fence) continue;
      const line = index + 1;
      const [language, ...flags] = fence[2].trim().split(/\s+/u);
      const body = [];
      while (++index < lines.length && !lines[index].trimStart().startsWith(fence[1])) body.push(lines[index]);
      if (language === "vkf") entries.push({ document, line, kind: "fence",
        live: flags.includes("live"), source: body.join("\n") });
    }
  }
  return entries;
}

async function main() {
  const sources = await documentationSources();
  const inventoryOnly = process.argv.includes("--inventory-only");
  const compiler = inventoryOnly ? undefined : await loadSharedFrontend();
  const cache = new Map();
  const rows = sources.map(({ source, ...entry }) => {
    const canonical = source.replaceAll("\r\n", "\n").trimEnd();
    const sourceSha256 = createHash("sha256").update(canonical).digest("hex");
    if (!cache.has(sourceSha256)) {
      let result = {};
      if (compiler) {
        const native = compiler.native(canonical);
        const browser = compiler.browser(canonical);
        let parity = true;
        try { assert.deepEqual(browser, native); } catch { parity = false; }
        result = { parity, nativeAccepted: native.ok, browserAccepted: browser.ok,
          ...(!native.ok ? { nativeDiagnostic: native.message } : {}),
          ...(!browser.ok ? { browserDiagnostic: browser.message } : {}) };
      }
      cache.set(sourceSha256, result);
    }
    return { ...entry, sourceSha256, ...cache.get(sourceSha256) };
  });
  const unique = [...cache.values()];
  const report = {
    scope: "Frontend typed IR and diagnostic parity only; program execution is not tested",
    ...(compiler ? { compilerWasmSha256: compiler.wasmSha256 } : {}),
    occurrences: rows.length,
    uniqueSources: unique.length,
    ...(compiler ? {
      parityPassed: unique.filter((row) => row.parity).length,
      nativeAccepted: unique.filter((row) => row.nativeAccepted).length,
      browserAccepted: unique.filter((row) => row.browserAccepted).length,
    } : {}),
    entries: rows,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = process.argv.find((argument) => argument.startsWith("--output="));
  if (output) await writeFile(path.resolve(output.slice("--output=".length)), serialized);
  console.log(serialized.trimEnd());
  if (compiler && (unique.some((row) => !row.parity)
    || (process.argv.includes("--require-success") && unique.some((row) => !row.browserAccepted)))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
