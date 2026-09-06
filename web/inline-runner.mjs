const WASM_URL = new URL("./playground/artifacts/vkf-shared-compiler.wasm", import.meta.url);
const WORKER_URL = new URL("./inline-runner-worker.mjs", import.meta.url);

function resultPackets(output) {
  if (Array.isArray(output?.retained_scene_arenas) && output.retained_scene_arenas.length > 0) {
    if (!output.retained_scene_arenas.every((packet) =>
      packet?.schema === "vektor-flow/retained-scene-arena"
      && packet.version === 1
      && packet.arena instanceof Uint8Array)) {
      throw new TypeError("browser compiler returned an invalid retained scene arena");
    }
    return output.retained_scene_arenas;
  }
  return null;
}

export function createInlineRunner({
  compileModule = globalThis.WebAssembly?.compile,
  fetchImpl = globalThis.fetch,
  WorkerClass = globalThis.Worker,
  timeoutMs = 2_000,
} = {}) {
  if (typeof compileModule !== "function"
      || typeof fetchImpl !== "function"
      || typeof WorkerClass !== "function") {
    throw new Error("inline browser execution is unavailable in this environment");
  }
  const compilerModule = fetchImpl(WASM_URL).then((response) => {
    if (!response.ok) throw new Error("browser compiler WASM is unavailable");
    return response.arrayBuffer();
  }).then(compileModule);
  let sequence = 0;

  return Object.freeze({
    async run(source) {
      if (typeof source !== "string") throw new TypeError("inline VKF source must be a string");
      const module = await compilerModule;
      const worker = new WorkerClass(WORKER_URL, { type: "module", name: "vkf-inline-runner" });
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.terminate();
          callback();
        };
        const timer = setTimeout(() => finish(() => reject(
          new Error("VKF execution timed out; worker terminated"),
        )), timeoutMs);
        worker.onerror = () => finish(() => reject(new Error("VKF execution worker failed")));
        worker.onmessage = ({ data }) => {
          if (data?.id !== id) return;
          if (data.status === "error") {
            finish(() => reject(new Error(data.message)));
            return;
          }
          finish(() => {
            try {
              resolve({ output: data.output, packets: resultPackets(data.output) });
            } catch (error) {
              reject(error);
            }
          });
        };
        worker.postMessage({ type: "run", id, source, module });
      });
    },
  });
}
