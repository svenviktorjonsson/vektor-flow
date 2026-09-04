import { createBrowserCompiler } from "./playground/vkf-browser-compiler.mjs";

const NO_HOST_IMPORTS = Object.freeze({});

globalThis.onmessage = async ({ data }) => {
  if (data?.type !== "run" || typeof data.source !== "string") return;
  try {
    const module = new WebAssembly.Module(data.wasm);
    if (WebAssembly.Module.imports(module).length !== 0) {
      throw new Error("browser compiler requested forbidden host imports");
    }
    const instance = new WebAssembly.Instance(module, NO_HOST_IMPORTS);
    const compiler = createBrowserCompiler({ instance, manifest: data.manifest });
    const output = compiler.run(data.source);
    globalThis.postMessage({ id: data.id, status: "ok", output });
  } catch (error) {
    globalThis.postMessage({
      id: data.id,
      status: "error",
      message: error instanceof Error ? error.message : "VKF execution failed",
    });
  }
};
