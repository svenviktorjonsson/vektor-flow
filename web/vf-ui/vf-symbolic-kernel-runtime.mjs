const TAG = Object.freeze({
  null: 0,
  boolean: 1,
  number: 2,
  string: 3,
  array: 4,
  record: 5,
});

const SLOT_SIZE = 16;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class SymbolicKernelHandle {
  constructor(kernel, pointer) {
    this.kernel = kernel;
    this.pointer = pointer;
    Object.freeze(this);
  }
}

function requireFunction(exportsObject, name) {
  if (typeof exportsObject[name] !== "function") {
    throw new TypeError(`VKF symbolic kernel export "${name}" is required`);
  }
  return exportsObject[name];
}

function validateManifest(manifest) {
  if (
    manifest?.schema !== "vektor-flow.symbolic-kernel"
    || !manifest.functions
    || typeof manifest.functions !== "object"
  ) {
    throw new TypeError("invalid VKF symbolic kernel manifest");
  }
  return manifest;
}

async function responseJson(source) {
  if (
    source
    && typeof source === "object"
    && !(source instanceof Response)
    && !(source instanceof URL)
  ) {
    return source;
  }
  const response = typeof source === "string" || source instanceof URL
    ? await fetch(source)
    : source;
  if (!(response instanceof Response) || !response.ok) {
    throw new Error("could not load VKF symbolic kernel manifest");
  }
  return response.json();
}

async function instantiate(source, imports = {}) {
  if (source instanceof WebAssembly.Instance) return source;
  if (source instanceof WebAssembly.Module) {
    return WebAssembly.instantiate(source, imports);
  }
  let input = source;
  if (typeof input === "string" || input instanceof URL) input = await fetch(input);
  if (input instanceof Response) {
    try {
      const result = await WebAssembly.instantiateStreaming(input.clone(), imports);
      return result.instance;
    } catch {
      input = await input.arrayBuffer();
    }
  }
  const result = await WebAssembly.instantiate(input, imports);
  return result instanceof WebAssembly.Instance ? result : result.instance;
}

export function createSymbolicKernel({ instance, manifest }) {
  if (!(instance instanceof WebAssembly.Instance)) {
    throw new TypeError("VKF symbolic kernel requires a WebAssembly.Instance");
  }
  const metadata = validateManifest(manifest);
  const exportsObject = instance.exports;
  if (!(exportsObject.memory instanceof WebAssembly.Memory)) {
    throw new TypeError('VKF symbolic kernel export "memory" is required');
  }
  const argumentPointer = requireFunction(exportsObject, "vkf_vm_arguments_ptr");
  const argumentCapacity = requireFunction(exportsObject, "vkf_vm_arguments_capacity");
  const resultPointer = requireFunction(exportsObject, "vkf_vm_results_ptr");
  const allocate = requireFunction(exportsObject, "vkf_vm_alloc");
  const invokeWasm = requireFunction(exportsObject, "vkf_vm_invoke");
  const slotSize = requireFunction(exportsObject, "vkf_vm_value_slot_size")();
  if (slotSize !== SLOT_SIZE) {
    throw new RangeError(`unsupported VKF value slot size ${slotSize}`);
  }

  const dataView = () => new DataView(exportsObject.memory.buffer);
  const bytes = () => new Uint8Array(exportsObject.memory.buffer);

  function checkedRange(pointer, length, operation) {
    if (
      !Number.isInteger(pointer)
      || pointer < 0
      || !Number.isInteger(length)
      || length < 0
      || pointer + length > exportsObject.memory.buffer.byteLength
    ) {
      throw new RangeError(`${operation} addressed invalid WASM memory`);
    }
  }

  function allocateBytes(length) {
    const pointer = allocate(length);
    checkedRange(pointer, length, "VKF allocation");
    return pointer;
  }

  function writeValue(pointer, value) {
    checkedRange(pointer, SLOT_SIZE, "VKF argument");
    const view = dataView();
    bytes().fill(0, pointer, pointer + SLOT_SIZE);
    if (value instanceof SymbolicKernelHandle) {
      if (value.kernel !== kernel) {
        throw new TypeError("symbolic handles cannot cross kernel instances");
      }
      checkedRange(value.pointer, SLOT_SIZE, "VKF handle");
      bytes().copyWithin(pointer, value.pointer, value.pointer + SLOT_SIZE);
      return;
    }
    if (value == null) {
      view.setUint32(pointer, TAG.null, true);
      return;
    }
    if (typeof value === "boolean") {
      view.setUint32(pointer, TAG.boolean, true);
      view.setUint32(pointer + 8, value ? 1 : 0, true);
      return;
    }
    if (typeof value === "number") {
      view.setUint32(pointer, TAG.number, true);
      view.setFloat64(pointer + 8, value, true);
      return;
    }
    if (typeof value === "string") {
      const encoded = textEncoder.encode(value);
      const textPointer = allocateBytes(encoded.byteLength);
      bytes().set(encoded, textPointer);
      const current = dataView();
      current.setUint32(pointer, TAG.string, true);
      current.setUint32(pointer + 4, encoded.byteLength, true);
      current.setUint32(pointer + 8, textPointer, true);
      return;
    }
    if (Array.isArray(value)) {
      const entriesPointer = allocateBytes(value.length * 4);
      const current = dataView();
      current.setUint32(pointer, TAG.array, true);
      current.setUint32(pointer + 4, value.length, true);
      current.setUint32(pointer + 8, entriesPointer, true);
      value.forEach((entry, index) => {
        const entryPointer = allocateBytes(SLOT_SIZE);
        writeValue(entryPointer, entry);
        dataView().setUint32(entriesPointer + index * 4, entryPointer, true);
      });
      return;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value);
      const entriesPointer = allocateBytes(entries.length * 8);
      const current = dataView();
      current.setUint32(pointer, TAG.record, true);
      current.setUint32(pointer + 4, entries.length, true);
      current.setUint32(pointer + 8, entriesPointer, true);
      entries.forEach(([key, entry], index) => {
        const keyPointer = allocateBytes(SLOT_SIZE);
        const valuePointer = allocateBytes(SLOT_SIZE);
        writeValue(keyPointer, key);
        writeValue(valuePointer, entry);
        const entryPointer = entriesPointer + index * 8;
        dataView().setUint32(entryPointer, keyPointer, true);
        dataView().setUint32(entryPointer + 4, valuePointer, true);
      });
      return;
    }
    throw new TypeError(
      "VKF arguments must use the tagged scalar, array, record, or handle ABI",
    );
  }

  function decodeValue(pointer, active = new Set()) {
    checkedRange(pointer, SLOT_SIZE, "VKF result");
    if (active.has(pointer)) {
      throw new TypeError("cyclic VKF values cannot cross the browser ABI");
    }
    const view = dataView();
    const tag = view.getUint32(pointer, true);
    const length = view.getUint32(pointer + 4, true);
    const payload = view.getUint32(pointer + 8, true);
    if (tag === TAG.null) return null;
    if (tag === TAG.boolean) return payload !== 0;
    if (tag === TAG.number) return view.getFloat64(pointer + 8, true);
    if (tag === TAG.string) {
      checkedRange(payload, length, "VKF UTF-8 result");
      return textDecoder.decode(bytes().subarray(payload, payload + length));
    }
    if (tag !== TAG.array && tag !== TAG.record) {
      throw new TypeError(`unknown VKF value tag ${tag}`);
    }
    active.add(pointer);
    try {
      if (tag === TAG.array) {
        checkedRange(payload, length * 4, "VKF array result");
        return Array.from({ length }, (_, index) =>
          decodeValue(view.getUint32(payload + index * 4, true), active)
        );
      }
      checkedRange(payload, length * 8, "VKF record result");
      const record = Object.create(null);
      for (let index = 0; index < length; index += 1) {
        const entry = payload + index * 8;
        const key = decodeValue(view.getUint32(entry, true), active);
        if (typeof key !== "string") {
          throw new TypeError("VKF record keys must be strings");
        }
        record[key] = decodeValue(view.getUint32(entry + 4, true), active);
      }
      return Object.freeze(record);
    } finally {
      active.delete(pointer);
    }
  }

  function retain(pointer) {
    const retained = allocateBytes(SLOT_SIZE);
    checkedRange(pointer, SLOT_SIZE, "VKF retained result");
    bytes().copyWithin(retained, pointer, pointer + SLOT_SIZE);
    return new SymbolicKernelHandle(kernel, retained);
  }

  function recordFieldPointer(pointer, field) {
    checkedRange(pointer, SLOT_SIZE, "VKF record handle");
    const view = dataView();
    if (view.getUint32(pointer, true) !== TAG.record) {
      throw new TypeError("VKF handle does not contain a record");
    }
    const length = view.getUint32(pointer + 4, true);
    const payload = view.getUint32(pointer + 8, true);
    checkedRange(payload, length * 8, "VKF record handle entries");
    for (let index = 0; index < length; index += 1) {
      const entry = payload + index * 8;
      const keyPointer = view.getUint32(entry, true);
      if (decodeValue(keyPointer) === field) {
        return view.getUint32(entry + 4, true);
      }
    }
    throw new RangeError(`VKF record does not contain field "${field}"`);
  }

  function retainField(handle, field) {
    if (!(handle instanceof SymbolicKernelHandle) || handle.kernel !== kernel) {
      throw new TypeError("retainField requires a handle from this kernel");
    }
    return retain(recordFieldPointer(handle.pointer, field));
  }

  function invoke(name, args = []) {
    const signature = metadata.functions[name];
    if (!signature) throw new RangeError(`unknown VKF function "${name}"`);
    if (args.length !== signature.parameters) {
      throw new RangeError(
        `${name} expects ${signature.parameters} arguments, got ${args.length}`,
      );
    }
    if (args.length > argumentCapacity()) {
      throw new RangeError("VKF argument capacity exceeded");
    }
    const base = argumentPointer();
    args.forEach((value, index) => writeValue(base + index * SLOT_SIZE, value));
    const status = invokeWasm(signature.index, args.length);
    if (status !== 0) {
      throw new Error(`VKF invocation "${name}" failed with status ${status}`);
    }
    const pointer = resultPointer();
    return Object.freeze({
      value: decodeValue(pointer),
      handle: retain(pointer),
    });
  }

  const kernel = Object.freeze({
    invoke,
    compile(source) {
      return invoke("symbolic_compile", [source]);
    },
    evaluate(program, x, y) {
      return invoke("symbolic_program_evaluate", [program, x, y]).value;
    },
    compileWithContext(source, context, clip = null) {
      return invoke("symbolic_compile_with_context", [source, context, clip]);
    },
    createWorkspace() {
      return invoke("symbolic_workspace", []);
    },
    workspaceCompile(workspace, source, context, clip = null) {
      const result = invoke(
        "symbolic_workspace_compile",
        [workspace, source, context, clip],
      );
      return Object.freeze({
        value: result.value,
        handle: result.handle,
        workspace: retainField(result.handle, "workspace"),
        program: retainField(result.handle, "program"),
      });
    },
    workspaceEvaluate(workspace, handle, x, y, z = 0, t = 0) {
      return invoke(
        "symbolic_workspace_evaluate",
        [workspace, handle, x, y, z, t],
      ).value;
    },
    evaluateAt(program, x, y, z, t, context, workspace) {
      return invoke(
        "symbolic_program_evaluate_at",
        [program, x, y, z, t, context, workspace],
      ).value;
    },
    plot(program, workspace, view, style, revision) {
      return invoke(
        "symbolic_plot",
        [program, workspace, view, style, revision],
      ).value;
    },
    get memory() {
      return exportsObject.memory;
    },
    decode(handle) {
      if (!(handle instanceof SymbolicKernelHandle) || handle.kernel !== kernel) {
        throw new TypeError("decode requires a handle from this kernel");
      }
      return decodeValue(handle.pointer);
    },
  });
  return kernel;
}

export async function loadSymbolicKernel({
  wasm,
  manifest,
  imports = {},
}) {
  const [instance, metadata] = await Promise.all([
    instantiate(wasm, imports),
    responseJson(manifest),
  ]);
  return createSymbolicKernel({ instance, manifest: metadata });
}

export const PACKAGED_SYMBOLIC_KERNEL_URLS = Object.freeze({
  wasm: new URL("./artifacts/vkf-symbolic-kernel.wasm", import.meta.url),
  manifest: new URL("./artifacts/vkf-symbolic-kernel.json", import.meta.url),
});

export function loadPackagedSymbolicKernel(options = {}) {
  return loadSymbolicKernel({
    wasm: options.wasm ?? PACKAGED_SYMBOLIC_KERNEL_URLS.wasm,
    manifest: options.manifest ?? PACKAGED_SYMBOLIC_KERNEL_URLS.manifest,
    imports: options.imports ?? {},
  });
}

export const SYMBOLIC_KERNEL_VALUE_ABI = Object.freeze({
  tags: TAG,
  slotSize: SLOT_SIZE,
});
