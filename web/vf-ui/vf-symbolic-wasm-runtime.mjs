const REQUIRED_EXPORTS = [
  "memory",
  "vkf_symbolic_input_ptr",
  "vkf_symbolic_input_capacity",
  "vkf_symbolic_input_len",
  "vkf_symbolic_set_input_len",
  "vkf_symbolic_output_ptr",
  "vkf_symbolic_output_capacity",
  "vkf_symbolic_output_len",
  "vkf_symbolic_trace",
];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function assertExports(exportsObject) {
  for (const name of REQUIRED_EXPORTS) {
    if (name === "memory") {
      if (!(exportsObject[name] instanceof WebAssembly.Memory)) {
        throw new TypeError('VKF symbolic WASM export "memory" is required');
      }
    } else if (typeof exportsObject[name] !== "function") {
      throw new TypeError(`VKF symbolic WASM export "${name}" is required`);
    }
  }
}

function checkedRange(exportsObject, pointer, length, capacity, operation) {
  if (
    !Number.isInteger(pointer) ||
    pointer < 0 ||
    !Number.isInteger(length) ||
    length < 0 ||
    !Number.isInteger(capacity) ||
    capacity < 0 ||
    length > capacity ||
    pointer + capacity > exportsObject.memory.buffer.byteLength
  ) {
    throw new RangeError(`${operation} returned an invalid WASM memory range`);
  }
}

export function createSymbolicWasmTextChannel(options = {}) {
  const exportsObject = options.exports ?? options.instance?.exports ?? options;
  assertExports(exportsObject);

  return Object.freeze({
    transfer(source, operation = exportsObject.vkf_symbolic_trace) {
      if (typeof source !== "string") {
        throw new TypeError("transfer(source) requires a string");
      }
      if (typeof operation !== "function") {
        throw new TypeError("transfer(source, operation) requires a WASM export function");
      }

      const bytes = encoder.encode(source);
      const inputPointer = exportsObject.vkf_symbolic_input_ptr();
      const inputCapacity = exportsObject.vkf_symbolic_input_capacity();
      checkedRange(exportsObject, inputPointer, bytes.byteLength, inputCapacity, "symbolic input");
      new Uint8Array(exportsObject.memory.buffer, inputPointer, bytes.byteLength).set(bytes);

      const acceptedLength = exportsObject.vkf_symbolic_set_input_len(bytes.byteLength);
      if (acceptedLength !== bytes.byteLength || exportsObject.vkf_symbolic_input_len() !== bytes.byteLength) {
        throw new RangeError("symbolic input exceeds the VKF WASM input capacity");
      }

      operation();

      const outputPointer = exportsObject.vkf_symbolic_output_ptr();
      const outputLength = exportsObject.vkf_symbolic_output_len();
      const outputCapacity = exportsObject.vkf_symbolic_output_capacity();
      checkedRange(exportsObject, outputPointer, outputLength, outputCapacity, "symbolic output");
      return decoder.decode(
        new Uint8Array(exportsObject.memory.buffer, outputPointer, outputLength),
      );
    },
  });
}

async function instantiateSource(source, imports) {
  if (source instanceof WebAssembly.Instance) {
    return source;
  }
  if (source instanceof WebAssembly.Module) {
    return WebAssembly.instantiate(source, imports);
  }

  let input = source;
  if (typeof source === "string" || source instanceof URL) {
    input = await fetch(source);
  }
  if (input instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        const result = await WebAssembly.instantiateStreaming(input.clone(), imports);
        return result.instance;
      } catch {
        input = await input.arrayBuffer();
      }
    } else {
      input = await input.arrayBuffer();
    }
  }

  const result = await WebAssembly.instantiate(input, imports);
  return result instanceof WebAssembly.Instance ? result : result.instance;
}

export async function loadSymbolicWasmTextChannel(source, options = {}) {
  const instance = await instantiateSource(source, options.imports ?? {});
  return createSymbolicWasmTextChannel({ instance });
}

export const SYMBOLIC_TEXT_WASM_ABI_EXPORTS = Object.freeze([...REQUIRED_EXPORTS]);
