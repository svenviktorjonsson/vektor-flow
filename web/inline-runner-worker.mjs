import { createSharedCompiler } from "./playground/vkf-shared-compiler.mjs";
import { materializeVisualOutput } from "./inline-result-packets.mjs";

const NO_HOST_IMPORTS = Object.freeze({});

export function runInlineWorkerRequest(data) {
  if (data?.type !== "run" || typeof data.source !== "string") {
    throw new TypeError("invalid inline worker request");
  }
  try {
    const module = data.module;
    if (!(module instanceof WebAssembly.Module)) {
      throw new Error("browser compiler module is unavailable");
    }
    if (WebAssembly.Module.imports(module).length !== 0) {
      throw new Error("browser compiler requested forbidden host imports");
    }
    const instance = new WebAssembly.Instance(module, NO_HOST_IMPORTS);
    const compiler = createSharedCompiler({ instance });
    const output = materializeVisualOutput(compiler.run(data.source));
    return { id: data.id, status: "ok", output };
  } catch (error) {
    return {
      id: data.id,
      status: "error",
      message: error instanceof Error ? error.message : "VKF execution failed",
    };
  }
}

globalThis.onmessage = ({ data }) => {
  const response = runInlineWorkerRequest(data);
  const transfers = response.output?.packets
    ? response.output.packets.map((packet) => packet.buffer)
    : [];
  globalThis.postMessage(response, transfers);
};
