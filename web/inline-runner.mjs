const WASM_URL = new URL("./playground/artifacts/vkf-shared-compiler.wasm", import.meta.url);
const MANIFEST_URL = new URL("./playground/artifacts/vkf-browser-compiler.json", import.meta.url);
const WORKER_URL = new URL("./inline-runner-worker.mjs", import.meta.url);

function resultPackets(output) {
  if (!Array.isArray(output?.packets) || output.packets.length === 0) return null;
  if (!output.packets.every((packet) => packet instanceof ArrayBuffer || ArrayBuffer.isView(packet))) {
    throw new TypeError("browser compiler returned an invalid UI packet buffer");
  }
  return output.packets;
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
  const assets = Promise.all([
    fetchImpl(WASM_URL).then((response) => {
      if (!response.ok) throw new Error("browser compiler WASM is unavailable");
      return response.arrayBuffer();
    }).then(compileModule),
    fetchImpl(MANIFEST_URL).then((response) => {
      if (!response.ok) throw new Error("browser compiler manifest is unavailable");
      return response.json();
    }),
  ]);
  let sequence = 0;

  return Object.freeze({
    async run(source) {
      if (typeof source !== "string") throw new TypeError("inline VKF source must be a string");
      const [module, manifest] = await assets;
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
        worker.postMessage({ type: "run", id, source, module, manifest });
      });
    },
  });
}
