import {
  createSymbolicKernel,
  loadSymbolicKernel,
} from "../vf-ui/vf-symbolic-kernel-runtime.mjs";

const ENTRY = "compile_tagged_dependency_tape";

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
