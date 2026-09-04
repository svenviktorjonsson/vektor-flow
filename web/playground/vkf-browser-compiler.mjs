import {
  createSymbolicKernel,
  loadSymbolicKernel,
} from "../vf-ui/vf-symbolic-kernel-runtime.mjs";

const ENTRY = "compile_tagged_dependency_tape";
const RUN_ENTRY = "run_tagged_browser_source";
const FORBIDDEN_CAPABILITIES = Object.freeze([
  [/(?:^|[^\p{L}\p{N}_])(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/iu, "network"],
  [/(?:^|[^\p{L}\p{N}_])(?:network|http|server|socket)\s*\./iu, "network"],
  [/(?:^|[^\p{L}\p{N}_])(?:filesystem|file|io)\s*\./iu, "filesystem"],
  [/(?:^|[^\p{L}\p{N}_])process\s*\./iu, "process"],
]);

function assertBrowserCapabilities(source) {
  const match = FORBIDDEN_CAPABILITIES.find(([pattern]) => pattern.test(source));
  if (match) {
    throw new Error(`browser runtime does not expose ${match[1]} capability`);
  }
}

function wrapKernel(kernel) {
  return Object.freeze({
    compile(source) {
      if (typeof source !== "string") {
        throw new TypeError("browser compiler source must be a string");
      }
      try {
        return kernel.invokeValue(ENTRY, [source]);
      } catch (cause) {
        throw new Error("browser compiler rejected the VKF source", { cause });
      }
      assertBrowserCapabilities(source);
    },
    run(source) {
      if (typeof source !== "string") {
        throw new TypeError("browser compiler source must be a string");
      }
      assertBrowserCapabilities(source);
      try {
        const initial = kernel.invokeValue(RUN_ENTRY, [source, -1]);
        if (initial?.kind !== "visual_stream") return initial;
        const packetRecords = [];
        if (Array.isArray(initial.background) && initial.background.length === 4) {
          packetRecords.push({ magic: 1447773767, version: 1, color: initial.background });
        }
        for (let index = 0; index < initial.packet_count; index += 1) {
          packetRecords.push(kernel.invokeValue(RUN_ENTRY, [source, index]));
        }
        return Object.freeze({ kind: "visual", packet_records: packetRecords });
      } catch (cause) {
        throw new Error("browser compiler could not run the VKF source", { cause });
      }
    },
  });
}

export function createBrowserCompiler({ instance, manifest }) {
  return wrapKernel(createSymbolicKernel({ instance, manifest }));
}

export async function loadBrowserCompiler({ wasm, manifest }) {
  return wrapKernel(await loadSymbolicKernel({ wasm, manifest }));
}

export const PACKAGED_BROWSER_COMPILER_URLS = Object.freeze({
  wasm: new URL("./artifacts/vkf-browser-compiler.wasm", import.meta.url),
  manifest: new URL("./artifacts/vkf-browser-compiler.json", import.meta.url),
});

export function loadPackagedBrowserCompiler(options = {}) {
  return loadBrowserCompiler({
    wasm: options.wasm ?? PACKAGED_BROWSER_COMPILER_URLS.wasm,
    manifest: options.manifest ?? PACKAGED_BROWSER_COMPILER_URLS.manifest,
  });
}
