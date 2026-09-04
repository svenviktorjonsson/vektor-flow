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
  const materializeTexture = (texture) => {
    if (texture == null || (Array.isArray(texture) && texture.length === 0)) return null;
    const keys = [
      "blade_length", "clump_density", "color_a", "color_b", "kind", "magic",
      "micro_shadow", "roughness", "scale", "version",
    ];
    if (!texture || typeof texture !== "object" || Array.isArray(texture)
        || Object.keys(texture).sort().join("\0") !== keys.join("\0")
        || texture.magic !== 1447773770 || texture.version !== 1
        || (texture.kind !== "checker" && texture.kind !== "grass")
        || !finiteVector(texture.scale, 2) || texture.scale.some((value) => value <= 0)
        || !finiteVector(texture.color_a, 4) || !finiteVector(texture.color_b, 4)
        || !finiteNumber(texture.roughness) || texture.roughness < 0 || texture.roughness > 1
        || !finiteNumber(texture.blade_length) || !finiteNumber(texture.clump_density)
        || !finiteNumber(texture.micro_shadow) || texture.micro_shadow < 0 || texture.micro_shadow > 1
        || (texture.kind === "grass"
          && (texture.blade_length <= 0 || texture.clump_density <= 0))) {
      throw new TypeError("browser compiler returned an invalid texture packet");
    }
    return [
      texture.kind === "checker" ? 1 : 2,
      ...texture.scale, ...texture.color_a, ...texture.color_b,
      texture.roughness, texture.blade_length, texture.clump_density, texture.micro_shadow,
    ];
  };
  const materializeOptical = (optical) => {
    if (optical == null || (Array.isArray(optical) && optical.length === 0)) return null;
    const keys = ["alpha", "depth_write", "magic", "reflectivity", "transparent", "version"];
    if (!optical || typeof optical !== "object" || Array.isArray(optical)
        || Object.keys(optical).sort().join("\0") !== keys.join("\0")
        || optical.magic !== 1447773771 || optical.version !== 1
        || !finiteNumber(optical.alpha) || optical.alpha < 0 || optical.alpha > 1
        || typeof optical.transparent !== "boolean" || typeof optical.depth_write !== "boolean"
        || !finiteNumber(optical.reflectivity)
        || optical.reflectivity < 0 || optical.reflectivity > 1
        || (optical.alpha !== 1 && !optical.transparent)
        || (!optical.depth_write && !optical.transparent)) {
      throw new TypeError("browser compiler returned an invalid optical packet");
    }
    return [
      optical.alpha, optical.transparent ? 1 : 0,
      optical.depth_write ? 1 : 0, optical.reflectivity,
    ];
  };
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
    if (record?.magic !== 1447773766 || record.version !== 5
        || !Number.isInteger(record.rows) || record.rows < 1
        || !Number.isInteger(record.columns) || record.columns < 1
        || record.rows * record.columns > 500_000
        || !finiteVector(record.color, 4)
        || !Array.isArray(record.x) || record.x.length !== record.rows
        || !Array.isArray(record.y) || record.y.length !== record.rows
        || !Array.isArray(record.z) || record.z.length !== record.rows
        || typeof record.receives_lighting !== "boolean"
        || typeof record.casts_shadow !== "boolean"
        || typeof record.receives_shadow !== "boolean"
        || !finiteNumber(record.roughness) || record.roughness < 0 || record.roughness > 1
        || !finiteNumber(record.specular_strength)
        || record.specular_strength < 0 || record.specular_strength > 1) {
      throw new TypeError("browser compiler returned an invalid visual packet");
    }
    const texture = materializeTexture(record.texture);
    const optical = materializeOptical(record.optical);
    if (texture && optical) {
      throw new TypeError("browser compiler returned unsupported combined material packets");
    }
    const values = [
      record.magic, optical ? 6 : texture ? 5 : 4,
      record.rows, record.columns, ...record.color,
      record.receives_lighting ? 1 : 0, record.casts_shadow ? 1 : 0,
      record.receives_shadow ? 1 : 0, record.roughness, record.specular_strength,
    ];
    if (texture) values.push(...texture);
    if (optical) values.push(...optical);
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
