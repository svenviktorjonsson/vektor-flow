export function materializeVisualOutput(output) {
  if (output?.kind !== "visual") return output;
  if (!Array.isArray(output.packet_records) || output.packet_records.length === 0
      || output.packet_records.length > 256) {
    throw new TypeError("browser compiler returned an invalid visual packet envelope");
  }
  const finiteVector = (values, length) => Array.isArray(values)
    && values.length === length
    && values.every((value) => typeof value === "number" && Number.isFinite(value));
  const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const packets = output.packet_records.map((record) => {
    if (record?.magic === 1447773767 && record.version === 1 && finiteVector(record.color, 4)) {
      return Float64Array.from([record.magic, record.version, ...record.color]);
    }
    if (record?.magic === 1447773768 && record.version === 1
        && finiteVector(record.pos, 3) && finiteVector(record.target, 3)
        && finiteVector(record.up, 3) && finiteNumber(record.fov)
        && record.fov > 0 && record.fov < 180) {
      return Float64Array.from([
        record.magic, record.version, ...record.pos, ...record.target, ...record.up, record.fov,
      ]);
    }
    if (record?.magic === 1447773769 && record.version === 1
        && finiteVector(record.pos, 3) && finiteVector(record.target, 3)
        && finiteVector(record.color, 4) && finiteNumber(record.intensity)
        && finiteNumber(record.range) && typeof record.casts_shadow === "boolean"
        && finiteNumber(record.source_radius) && record.intensity > 0 && record.range > 0) {
      return Float64Array.from([
        record.magic, record.version, ...record.pos, ...record.target, ...record.color,
        record.intensity, record.range, record.casts_shadow ? 1 : 0, record.source_radius,
      ]);
    }
    if (record?.magic !== 1447773766 || record.version !== 4
        || !Number.isInteger(record.rows) || record.rows < 1
        || !Number.isInteger(record.columns) || record.columns < 1
        || record.rows * record.columns > 500_000
        || !finiteVector(record.color, 4)
        || !Array.isArray(record.x) || record.x.length !== record.rows
        || !Array.isArray(record.y) || record.y.length !== record.rows
        || !Array.isArray(record.z) || record.z.length !== record.rows
        || typeof record.receives_lighting !== "boolean"
        || typeof record.casts_shadow !== "boolean") {
      throw new TypeError("browser compiler returned an invalid visual packet");
    }
    const values = [
      record.magic, 3, record.rows, record.columns, ...record.color,
      record.receives_lighting ? 1 : 0, record.casts_shadow ? 1 : 0,
    ];
    for (let row = 0; row < record.rows; row += 1) {
      if (!finiteVector(record.x[row], record.columns)
          || !finiteVector(record.y[row], record.columns)
          || !finiteVector(record.z[row], record.columns)) {
        throw new TypeError("browser compiler returned an invalid visual packet");
      }
      for (let column = 0; column < record.columns; column += 1) {
        values.push(record.x[row][column], record.y[row][column], record.z[row][column]);
      }
    }
    return Float64Array.from(values);
  });
  return Object.freeze({ kind: "visual", packets });
}
