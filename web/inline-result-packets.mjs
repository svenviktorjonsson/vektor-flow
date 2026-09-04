export function materializeVisualOutput(output) {
  if (output?.kind !== "visual") return output;
  if (!Array.isArray(output.packet_values) || output.packet_values.length === 0
      || output.packet_values.length > 256) {
    throw new TypeError("browser compiler returned an invalid visual packet envelope");
  }
  const packets = output.packet_values.map((values) => {
    if (!Array.isArray(values) || values.length < 11 || values.length > 1_000_008
        || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new TypeError("browser compiler returned an invalid visual packet");
    }
    const [magic, version, rows, columns] = values;
    if (magic !== 1447773766 || version !== 1
        || !Number.isInteger(rows) || rows < 1
        || !Number.isInteger(columns) || columns < 1
        || values.length !== 8 + (rows * columns * 3)) {
      throw new TypeError("browser compiler returned an invalid visual packet");
    }
    return Float64Array.from(values);
  });
  return Object.freeze({ kind: "visual", packets });
}
