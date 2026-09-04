export function materializeVisualOutput(output) {
  if (output?.kind !== "visual") return output;
  if (!Array.isArray(output.packet_records) || output.packet_records.length === 0
      || output.packet_records.length > 256) {
    throw new TypeError("browser compiler returned an invalid visual packet envelope");
  }
  const finiteVector = (values, length) => Array.isArray(values)
    && values.length === length
    && values.every((value) => typeof value === "number" && Number.isFinite(value));
  const packets = output.packet_records.map((record) => {
    if (record?.magic === 1447773767 && record.version === 1 && finiteVector(record.color, 4)) {
      return Float64Array.from([record.magic, record.version, ...record.color]);
    }
    if (record?.magic !== 1447773766 || record.version !== 3
        || !Number.isInteger(record.rows) || record.rows < 1
        || !Number.isInteger(record.columns) || record.columns < 1
        || record.rows * record.columns > 500_000
        || !finiteVector(record.color, 4)
        || !Array.isArray(record.x) || record.x.length !== record.rows
        || !Array.isArray(record.y) || record.y.length !== record.rows) {
      throw new TypeError("browser compiler returned an invalid visual packet");
    }
    const values = [record.magic, 2, record.rows, record.columns, ...record.color];
    for (let row = 0; row < record.rows; row += 1) {
      if (!finiteVector(record.x[row], record.columns)
          || !finiteVector(record.y[row], record.columns)) {
        throw new TypeError("browser compiler returned an invalid visual packet");
      }
      for (let column = 0; column < record.columns; column += 1) {
        values.push(record.x[row][column], record.y[row][column]);
      }
    }
    return Float64Array.from(values);
  });
  return Object.freeze({ kind: "visual", packets });
}
