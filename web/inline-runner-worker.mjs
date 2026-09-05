import { createBrowserCompiler } from "./playground/vkf-browser-compiler.mjs";
import { materializeVisualOutput } from "./inline-result-packets.mjs";

const NO_HOST_IMPORTS = Object.freeze({});

globalThis.onmessage = ({ data }) => {
  if (data?.type !== "run" || typeof data.source !== "string") return;
  try {
    const module = data.module;
    if (!(module instanceof WebAssembly.Module)) {
      throw new Error("browser compiler module is unavailable");
    }
    if (WebAssembly.Module.imports(module).length !== 0) {
      throw new Error("browser compiler requested forbidden host imports");
    }
    const instance = new WebAssembly.Instance(module, NO_HOST_IMPORTS);
    const compiler = createBrowserCompiler({ instance, manifest: data.manifest });
    const output = materializeVisualOutput(compiler.run(data.source));
    const transfers = output?.packets
      ? output.packets.map((packet) => packet.buffer)
      : [];
    globalThis.postMessage({ id: data.id, status: "ok", output }, transfers);
  } catch (error) {
    globalThis.postMessage({
      id: data.id,
      status: "error",
      message: error instanceof Error ? error.message : "VKF execution failed",
    });
  }
};
