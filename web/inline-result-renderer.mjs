const MAGIC = 1447773766;

function decode(packet) {
  if (!(packet instanceof Float64Array)) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  if (packet[0] === 1447773767 && packet[1] === 1 && packet.length === 6) {
    return { kind: "background", color: packet.slice(2) };
  }
  if (packet[0] === 1447773768 && packet[1] === 1 && packet.length === 12) {
    return {
      kind: "camera", pos: packet.slice(2, 5), target: packet.slice(5, 8),
      up: packet.slice(8, 11), fov: packet[11],
    };
  }
  if (packet[0] === 1447773769 && packet[1] === 1 && packet.length === 16) {
    return {
      kind: "light", pos: packet.slice(2, 5), target: packet.slice(5, 8),
      color: packet.slice(8, 12), intensity: packet[12], range: packet[13],
      castsShadow: packet[14] === 1, sourceRadius: packet[15], type: "point",
    };
  }
  if (packet[0] === 1447773777 && packet[1] === 1 && packet.length === 18
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && !Array.from(packet.slice(2, 5)).every((value, index) => value === packet[5 + index])
      && Array.from(packet.slice(8, 12)).every((value) => value >= 0 && value <= 1)
      && packet[12] > 0 && packet[13] > 0
      && packet[14] > 0 && packet[15] > packet[14] && packet[15] < 90
      && [0, 1].includes(packet[16]) && packet[17] >= 0) {
    return {
      kind: "light", type: "spot",
      pos: packet.slice(2, 5), target: packet.slice(5, 8),
      color: packet.slice(8, 12), intensity: packet[12], range: packet[13],
      innerConeDeg: packet[14], outerConeDeg: packet[15],
      castsShadow: packet[16] === 1, sourceRadius: packet[17],
    };
  }
  if (packet[0] === 1447773780 && packet[1] === 1 && packet.length === 8
      && Number.isInteger(packet[2]) && packet[2] >= 1 && packet[2] <= 240
      && packet[3] > 0 && packet[4] === 1 && [0, 1].includes(packet[5])
      && packet[6] > 0 && packet[7] === 1) {
    return {
      kind: "timing", fps: packet[2], durationSeconds: packet[3],
      boundary: "repeat", showLightMarkers: packet[5] === 1,
      lightMarkerSize: packet[6], aspect: "equal",
    };
  }
  if (packet[0] === 1447773781 && packet[1] === 1 && packet.length === 21
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && Number.isInteger(packet[2]) && packet[2] >= 0 && packet[3] > 0
      && Array.from(packet.slice(10, 14)).every((value) => value >= 0 && value <= 1)
      && packet[14] > 0 && packet[15] > 0 && [0, 1].includes(packet[16])
      && [0, 1].includes(packet[17]) && packet[18] >= 0 && packet[19] > 0
      && packet[20] === 1) {
    return {
      kind: "orbitLight", idCode: packet[2], radius: packet[3], height: packet[4],
      theta: packet[5], angularVelocity: packet[6], target: packet.slice(7, 10),
      color: packet.slice(10, 14), intensity: packet[14], range: packet[15],
      castsShadow: packet[16] === 1, showMarker: packet[17] === 1,
      sourceRadius: packet[18], spread: packet[19], type: "point",
    };
  }
  if (packet[0] === 1447773782 && packet[1] === 1 && packet.length === 17
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && Array.from(packet.slice(2, 6)).every((value) => Number.isInteger(value) && value >= 0)
      && packet[4] === packet[5]
      && Array.from(packet.slice(6, 10)).every((value) => value >= 0 && value <= 1)
      && packet[10] > 0 && packet[11] > 0 && [0, 1].includes(packet[12])
      && packet[13] === 0 && packet[14] >= 0 && packet[15] > 0 && packet[16] === 1) {
    return {
      kind: "projectedLight", idCode: packet[2], sourceCode: packet[3],
      mirrorCode: packet[4], apertureCode: packet[5], color: packet.slice(6, 10),
      intensity: packet[10], range: packet[11], castsShadow: packet[12] === 1,
      showMarker: false, sourceRadius: packet[14], spread: packet[15], type: "projected",
    };
  }
  if (packet[0] === 1447773774 && packet[1] === 1 && packet.length === 10
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && Array.from(packet.slice(4, 8)).every((value) => value >= 0 && value <= 1)
      && packet[8] > 0 && packet[9] > 0) {
    return {
      kind: "particle", position: packet.slice(2, 4),
      color: packet.slice(4, 8), size: packet[8], mass: packet[9],
    };
  }
  if (packet[0] === 1447773775 && packet[1] === 1) {
    const vertexCount = packet[2];
    const indexCount = packet[3];
    const dataOffset = 8;
    const indexOffset = dataOffset + (vertexCount * 10);
    if (!Number.isInteger(vertexCount) || vertexCount < 1
        || !Number.isInteger(indexCount) || indexCount < 2 || indexCount % 2 !== 0
        || packet.length !== indexOffset + indexCount
        || !Array.from(packet.slice(4)).every(Number.isFinite)
        || !Array.from(packet.slice(indexOffset)).every((value) => Number.isInteger(value)
          && value >= 0 && value < vertexCount)) {
      throw new TypeError("inline renderer received an invalid field mesh packet");
    }
    return {
      kind: "fieldMesh", packet, vertexCount, indexCount,
      dataOffset, indexOffset, color: packet.slice(4, 8),
    };
  }
  if (packet[0] === 1447773776 && packet[1] === 1 && packet.length === 14
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && packet[5] > 0
      && Array.from(packet.slice(6, 10)).every((value) => value >= 0 && value <= 1)
      && packet[10] >= 0 && packet[10] <= 1
      && packet[11] >= 0 && packet[11] <= 1
      && [0, 1].includes(packet[12]) && [0, 1].includes(packet[13])) {
    return {
      kind: "cube", center: packet.slice(2, 5), size: packet[5],
      color: packet.slice(6, 10), roughness: packet[10],
      specularStrength: packet[11], castsShadow: packet[12] === 1,
      receivesShadow: packet[13] === 1,
      rotation: Float64Array.from([0, 0, 0]), texture: null,
    };
  }
  if (packet[0] === 1447773776 && packet[1] === 2 && packet.length === 29
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && packet[5] > 0
      && Array.from(packet.slice(6, 10)).every((value) => value >= 0 && value <= 1)
      && packet[10] >= 0 && packet[10] <= 1
      && packet[11] >= 0 && packet[11] <= 1
      && [0, 1].includes(packet[12]) && [0, 1].includes(packet[13])
      && packet[17] === 1447773778 && packet[18] === 1 && packet[19] === 1
      && Array.from(packet.slice(20, 28)).every((value) => value >= 0 && value <= 1)
      && packet[28] >= 0 && packet[28] <= 32) {
    return {
      kind: "cube", center: packet.slice(2, 5), size: packet[5],
      color: packet.slice(6, 10), roughness: packet[10],
      specularStrength: packet[11], castsShadow: packet[12] === 1,
      receivesShadow: packet[13] === 1, rotation: packet.slice(14, 17),
      texture: {
        kind: "dice", colorA: packet.slice(20, 24), colorB: packet.slice(24, 28),
        graphWidthPx: packet[28],
      },
    };
  }
  if (packet[0] === 1447773779 && packet[1] === 2 && packet.length === 58
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && Number.isInteger(packet[2]) && packet[2] >= 0
      && packet[6] > 0 && packet[7] > 0
      && Array.from(packet.slice(11, 15)).every((value) => value >= 0 && value <= 1)
      && [0, 1].includes(packet[15]) && [0, 1].includes(packet[16])
      && [0, 1].includes(packet[17]) && packet[18] >= 0 && packet[18] <= 1
      && packet[19] >= 0 && packet[19] <= 1 && [0, 1].includes(packet[20])
      && [0, 1].includes(packet[36]) && packet[41] === 1 && packet[42] === 1
      && packet[43] >= 0 && packet[43] <= 1 && packet[44] === 1 && packet[45] === 1
      && packet[46] === 1 && packet[47] === 1 && packet[48] > 0 && packet[48] < 180
      && packet[49] === 0 && packet[50] === 0 && packet[51] === 1
      && Number.isInteger(packet[52]) && Number.isInteger(packet[53])
      && packet[54] === 1 && packet[55] === 1 && packet[56] === 0 && packet[57] === 1) {
    const texture = packet[20] === 1 ? {
      kind: packet[21], scale: packet.slice(22, 24),
      colorA: packet.slice(24, 28), colorB: packet.slice(28, 32),
      roughness: packet[32], bladeLength: packet[33],
      clumpDensity: packet[34], microShadow: packet[35],
    } : null;
    const optical = packet[36] === 1 ? {
      alpha: packet[37], transparent: packet[38] === 1,
      depthWrite: packet[39] === 1, reflectivity: packet[40],
    } : null;
    const surfaceSystem = {
      kind: packet[42], reflectivity: packet[43], reverseFacing: true, flipY: true,
      scale: packet.slice(46, 48), cameraFov: packet[48], cameraUp: packet.slice(49, 52),
      frameCode: packet[52], meshCode: packet[53], reflectEyeOnly: true,
      lockApertureCamera: true, controlsEnabled: false,
    };
    if ((packet[20] === 0 && Array.from(packet.slice(21, 36)).some((value) => value !== 0))
        || (texture && (![1, 2].includes(texture.kind)
          || texture.scale.some((value) => value <= 0)))
        || (packet[36] === 0 && Array.from(packet.slice(37, 41)).some((value) => value !== 0))
        || (optical && (optical.alpha < 0 || optical.alpha > 1
          || optical.reflectivity < 0 || optical.reflectivity > 1))) {
      throw new TypeError("inline renderer received an invalid linked native surface packet");
    }
    const surface = {
      center: packet.slice(3, 6), size: packet.slice(6, 8), rotation: packet.slice(8, 11),
    };
    return {
      kind: "geometry", packet, rows: 2, columns: 2, stride: 3, dataOffset: 0,
      points: rectangleCorners(surface), color: packet.slice(11, 15), nativeSurface: true,
      receivesLighting: packet[15] === 1, castsShadow: packet[16] === 1,
      receivesShadow: packet[17] === 1, roughness: packet[18],
      specularStrength: packet[19], texture, optical, surfaceSystem,
      idCode: packet[2], noBackfaceSpecular: true,
    };
  }
  if (packet[0] === 1447773779 && packet[1] === 1 && packet.length === 56
      && Array.from(packet.slice(2)).every(Number.isFinite)
      && packet[5] > 0 && packet[6] > 0
      && Array.from(packet.slice(10, 14)).every((value) => value >= 0 && value <= 1)
      && [0, 1].includes(packet[14]) && [0, 1].includes(packet[15])
      && [0, 1].includes(packet[16])
      && packet[17] >= 0 && packet[17] <= 1
      && packet[18] >= 0 && packet[18] <= 1
      && [0, 1].includes(packet[19]) && [0, 1].includes(packet[35])
      && [0, 1].includes(packet[40])) {
    const texture = packet[19] === 1 ? {
      kind: packet[20], scale: packet.slice(21, 23),
      colorA: packet.slice(23, 27), colorB: packet.slice(27, 31),
      roughness: packet[31], bladeLength: packet[32],
      clumpDensity: packet[33], microShadow: packet[34],
    } : null;
    const optical = packet[35] === 1 ? {
      alpha: packet[36], transparent: packet[37] === 1,
      depthWrite: packet[38] === 1, reflectivity: packet[39],
    } : null;
    const surfaceSystem = packet[40] === 1 ? {
      kind: packet[41], reflectivity: packet[42],
      reverseFacing: packet[43] === 1, flipY: packet[44] === 1,
      scale: packet.slice(45, 47), cameraFov: packet[47],
      cameraUp: packet.slice(48, 51), frameCode: packet[51], meshCode: packet[52],
      reflectEyeOnly: packet[53] === 1,
      lockApertureCamera: packet[54] === 1,
      controlsEnabled: packet[55] === 1,
    } : null;
    const emptyPayload = (present, start, stop) => present === 1
      || Array.from(packet.slice(start, stop)).every((value) => value === 0);
    if (!emptyPayload(packet[19], 20, 35)
        || (texture && (![1, 2].includes(texture.kind)
          || texture.scale.some((value) => value <= 0)
          || Array.from(packet.slice(23, 31)).some((value) => value < 0 || value > 1)))
        || !emptyPayload(packet[35], 36, 40)
        || (optical && (optical.alpha < 0 || optical.alpha > 1
          || ![0, 1].includes(packet[37]) || ![0, 1].includes(packet[38])
          || optical.reflectivity < 0 || optical.reflectivity > 1))
        || !emptyPayload(packet[40], 41, 56)
        || (surfaceSystem && (surfaceSystem.kind !== 1
          || surfaceSystem.reflectivity < 0 || surfaceSystem.reflectivity > 1
          || !surfaceSystem.reverseFacing || !surfaceSystem.flipY
          || surfaceSystem.scale[0] !== 1 || surfaceSystem.scale[1] !== 1
          || surfaceSystem.cameraFov <= 0 || surfaceSystem.cameraFov >= 180
          || surfaceSystem.cameraUp[0] !== 0 || surfaceSystem.cameraUp[1] !== 0
          || surfaceSystem.cameraUp[2] !== 1
          || !Number.isInteger(surfaceSystem.frameCode) || surfaceSystem.frameCode < 0
          || surfaceSystem.frameCode > 0xffffffff
          || !Number.isInteger(surfaceSystem.meshCode) || surfaceSystem.meshCode < 0
          || surfaceSystem.meshCode > 0xffffffff
          || !surfaceSystem.reflectEyeOnly || !surfaceSystem.lockApertureCamera
          || surfaceSystem.controlsEnabled
          || !optical || surfaceSystem.reflectivity !== optical.reflectivity))) {
      throw new TypeError("inline renderer received an invalid native surface packet");
    }
    const surface = {
      center: packet.slice(2, 5), size: packet.slice(5, 7),
      rotation: packet.slice(7, 10),
    };
    return {
      kind: "geometry", packet, rows: 2, columns: 2, stride: 3, dataOffset: 0,
      points: rectangleCorners(surface), color: packet.slice(10, 14), nativeSurface: true,
      receivesLighting: packet[14] === 1, castsShadow: packet[15] === 1,
      receivesShadow: packet[16] === 1, roughness: packet[17],
      specularStrength: packet[18], texture, optical, surfaceSystem,
    };
  }
  if (packet[0] !== MAGIC || ![1, 2, 3, 4, 5, 6, 7].includes(packet[1])) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  const rows = packet[2];
  const columns = packet[3];
  const stride = packet[1] === 2 ? 2 : 3;
  const dataOffset = packet[1] === 7 ? 32 : packet[1] === 6 ? 17
    : packet[1] === 5 ? 28 : packet[1] === 4 ? 13 : packet[1] === 3 ? 10 : 8;
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1
      || packet.length !== dataOffset + (rows * columns * stride)) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  const texture = packet[1] === 5 ? {
    kind: packet[13], scale: packet.slice(14, 16),
    colorA: packet.slice(16, 20), colorB: packet.slice(20, 24),
    roughness: packet[24], bladeLength: packet[25],
    clumpDensity: packet[26], microShadow: packet[27],
  } : null;
  if (texture && ![1, 2].includes(texture.kind)) {
    throw new TypeError("inline renderer received an invalid texture packet");
  }
  const optical = packet[1] === 6 || packet[1] === 7 ? {
    alpha: packet[13], transparent: packet[14] === 1,
    depthWrite: packet[15] === 1, reflectivity: packet[16],
  } : null;
  const surfaceSystem = packet[1] === 7 ? {
    kind: packet[17], reflectivity: packet[18],
    reverseFacing: packet[19] === 1, flipY: packet[20] === 1,
    scale: packet.slice(21, 23), cameraFov: packet[23],
    cameraUp: packet.slice(24, 27), frameCode: packet[27], meshCode: packet[28],
    reflectEyeOnly: packet[29] === 1,
    lockApertureCamera: packet[30] === 1,
    controlsEnabled: packet[31] === 1,
  } : null;
  if (surfaceSystem && (surfaceSystem.kind !== 1
      || !Number.isFinite(surfaceSystem.reflectivity)
      || surfaceSystem.reflectivity < 0 || surfaceSystem.reflectivity > 1
      || !surfaceSystem.reverseFacing || !surfaceSystem.flipY
      || surfaceSystem.scale[0] !== 1 || surfaceSystem.scale[1] !== 1
      || !Number.isFinite(surfaceSystem.cameraFov)
      || surfaceSystem.cameraFov <= 0 || surfaceSystem.cameraFov >= 180
      || surfaceSystem.cameraUp[0] !== 0 || surfaceSystem.cameraUp[1] !== 0
      || surfaceSystem.cameraUp[2] !== 1
      || !Number.isInteger(surfaceSystem.frameCode) || surfaceSystem.frameCode < 0
      || surfaceSystem.frameCode > 0xffffffff
      || !Number.isInteger(surfaceSystem.meshCode) || surfaceSystem.meshCode < 0
      || surfaceSystem.meshCode > 0xffffffff
      || !surfaceSystem.reflectEyeOnly || !surfaceSystem.lockApertureCamera
      || surfaceSystem.controlsEnabled)) {
    throw new TypeError("inline renderer received an invalid surface system packet");
  }
  return {
    kind: "geometry", packet, rows, columns, stride, dataOffset,
    receivesLighting: packet[1] >= 3 && packet[8] === 1,
    castsShadow: packet[1] >= 3 && packet[9] === 1,
    receivesShadow: packet[1] >= 4 && packet[10] === 1,
    roughness: packet[1] >= 4 ? packet[11] : 1,
    specularStrength: packet[1] >= 4 ? packet[12] : 0,
    texture, optical, surfaceSystem,
  };
}

function channel(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function vertex(mesh, row, column) {
  if (mesh.points) return mesh.points[(row * mesh.columns) + column];
  const offset = mesh.dataOffset + (((row * mesh.columns) + column) * mesh.stride);
  return [mesh.packet[offset], mesh.packet[offset + 1], mesh.stride === 3 ? mesh.packet[offset + 2] : 0];
}

function fieldVertex(mesh, index) {
  const offset = mesh.dataOffset + (index * 10);
  return {
    position: mesh.packet.slice(offset, offset + 3),
    color: mesh.packet.slice(offset + 6, offset + 10),
  };
}

function rotateEuler(point, rotation) {
  const radians = Array.from(rotation, (value) => value * Math.PI / 180);
  const [sinX, sinY, sinZ] = radians.map(Math.sin);
  const [cosX, cosY, cosZ] = radians.map(Math.cos);
  const [x, y, z] = point;
  const afterX = [x, (y * cosX) - (z * sinX), (y * sinX) + (z * cosX)];
  const afterY = [
    (afterX[0] * cosY) + (afterX[2] * sinY),
    afterX[1],
    (-afterX[0] * sinY) + (afterX[2] * cosY),
  ];
  return [
    (afterY[0] * cosZ) - (afterY[1] * sinZ),
    (afterY[0] * sinZ) + (afterY[1] * cosZ),
    afterY[2],
  ];
}

function cubeCorners(cube) {
  const half = cube.size / 2;
  return [
    [-half, -half, -half], [half, -half, -half],
    [-half, half, -half], [half, half, -half],
    [-half, -half, half], [half, -half, half],
    [-half, half, half], [half, half, half],
  ].map((corner) => rotateEuler(corner, cube.rotation)
    .map((value, index) => value + cube.center[index]));
}

function rectangleCorners(surface) {
  const halfWidth = surface.size[0] / 2;
  const halfHeight = surface.size[1] / 2;
  return [
    [-halfWidth, -halfHeight, 0], [halfWidth, -halfHeight, 0],
    [-halfWidth, halfHeight, 0], [halfWidth, halfHeight, 0],
  ].map((corner) => rotateEuler(corner, surface.rotation)
    .map((value, index) => value + surface.center[index]));
}

const dicePips = (value) => {
  const low = 0.26;
  const mid = 0.5;
  const high = 0.74;
  const patterns = {
    1: [[mid, mid]],
    2: [[low, low], [high, high]],
    3: [[low, low], [mid, mid], [high, high]],
    4: [[low, low], [high, low], [low, high], [high, high]],
    5: [[low, low], [high, low], [mid, mid], [low, high], [high, high]],
    6: [[low, low], [low, mid], [low, high], [high, low], [high, mid], [high, high]],
  };
  return patterns[value];
};

function facePoint(points, u, v) {
  const top = mix(points[0], points[1], u);
  const bottom = mix(points[3], points[2], u);
  return mix(top, bottom, v);
}

const subtract = (left, right) => left.map((value, index) => value - right[index]);
const dot = (left, right) => left.reduce((sum, value, index) => sum + (value * right[index]), 0);
const cross = (left, right) => [
  (left[1] * right[2]) - (left[2] * right[1]),
  (left[2] * right[0]) - (left[0] * right[2]),
  (left[0] * right[1]) - (left[1] * right[0]),
];
const normalize = (value) => {
  const length = Math.hypot(...value);
  return value.map((component) => component / Math.max(length, 1e-9));
};

function mirrorPlane(mesh) {
  if (mesh.rows < 2 || mesh.columns < 2) {
    throw new TypeError("inline renderer received a collapsed mirror surface");
  }
  const origin = vertex(mesh, 0, 0);
  const across = subtract(vertex(mesh, 0, mesh.columns - 1), origin);
  const upward = subtract(vertex(mesh, mesh.rows - 1, 0), origin);
  const crossed = cross(across, upward);
  if (Math.hypot(...crossed) < 1e-9) {
    throw new TypeError("inline renderer received a collapsed mirror surface");
  }
  return { origin, normal: normalize(crossed) };
}

function reflectAcrossPlane(point, plane) {
  const distance = dot(subtract(point, plane.origin), plane.normal);
  return point.map((value, index) => value - (2 * distance * plane.normal[index]));
}

function cameraProjector(camera, canvas) {
  const forward = normalize(subtract(camera.target, camera.pos));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const focal = 1 / Math.tan((camera.fov * Math.PI) / 360);
  const aspect = canvas.width / canvas.height;
  return (point) => {
    const relative = subtract(point, camera.pos);
    const depth = Math.max(dot(relative, forward), 1e-6);
    return [
      canvas.width * (0.5 + ((dot(relative, right) * focal) / (2 * aspect * depth))),
      canvas.height * (0.5 - ((dot(relative, up) * focal) / (2 * depth))),
    ];
  };
}

function litColor(mesh, lights) {
  const base = mesh.color
    ? Array.from(mesh.color.slice(0, 3))
    : [mesh.packet[4], mesh.packet[5], mesh.packet[6]];
  const reflected = mesh.optical
    ? base.map((value) => value + ((1 - value) * mesh.optical.reflectivity * 0.35))
    : base;
  if (!mesh.receivesLighting || lights.length === 0) return reflected;
  const point = vertex(mesh, 0, 0);
  const light = lights[0];
  const distance = Math.hypot(...subtract(light.pos, point));
  const attenuation = distance > light.range
    ? 0 : (light.intensity / Math.max(1, distance * distance)) * lightConeFactor(light, point);
  const diffuse = attenuation * 0.12 * (1 - (mesh.roughness * 0.25));
  const highlight = mesh.specularStrength * (1 - mesh.roughness) * 0.3;
  const strength = Math.min(1, 0.2 + diffuse + highlight);
  return reflected.map((value, index) => value * light.color[index] * strength);
}

function lightConeFactor(light, point) {
  if (light.type !== "spot") return 1;
  const direction = normalize(subtract(light.target, light.pos));
  const toPoint = normalize(subtract(point, light.pos));
  const cosine = Math.max(-1, Math.min(1, dot(direction, toPoint)));
  const angle = Math.acos(cosine) * 180 / Math.PI;
  if (angle <= light.innerConeDeg) return 1;
  if (angle >= light.outerConeDeg) return 0;
  const t = (light.outerConeDeg - angle) / (light.outerConeDeg - light.innerConeDeg);
  return t * t * (3 - (2 * t));
}

function mix(left, right, amount) {
  return left.map((value, index) => value + ((right[index] - value) * amount));
}

function bilinear(mesh, u, v) {
  const top = mix(vertex(mesh, 0, 0), vertex(mesh, 0, mesh.columns - 1), u);
  const bottom = mix(
    vertex(mesh, mesh.rows - 1, 0),
    vertex(mesh, mesh.rows - 1, mesh.columns - 1),
    u,
  );
  return mix(top, bottom, v);
}

function rgba(color) {
  return `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${Math.max(0, Math.min(1, color[3]))})`;
}

function drawTexture(context, project, mesh) {
  if (!mesh.texture || mesh.rows < 2 || mesh.columns < 2) return;
  const cellsX = Math.max(1, Math.min(64, Math.round(mesh.texture.scale[0])));
  const cellsY = Math.max(1, Math.min(64, Math.round(mesh.texture.scale[1])));
  for (let row = 0; row < cellsY; row += 1) {
    for (let column = 0; column < cellsX; column += 1) {
      const u0 = column / cellsX;
      const u1 = (column + 1) / cellsX;
      const v0 = row / cellsY;
      const v1 = (row + 1) / cellsY;
      let color = ((row + column) % 2 === 0)
        ? mesh.texture.colorA : mesh.texture.colorB;
      if (mesh.texture.kind === 2) {
        const phase = Math.sin(
          ((column + 1) * 12.9898 * mesh.texture.clumpDensity)
          + ((row + 1) * 78.233 * mesh.texture.bladeLength),
        ) * 43758.5453;
        const variation = Math.abs(phase) % 1;
        const shade = 1 - (mesh.texture.microShadow * (0.1 + (0.35 * (1 - variation))));
        color = mix(mesh.texture.colorA, mesh.texture.colorB, 0.12 + (variation * 0.82))
          .map((value, index) => index === 3 ? value : value * shade);
      }
      context.fillStyle = rgba(color);
      context.beginPath();
      [bilinear(mesh, u0, v0), bilinear(mesh, u1, v0),
        bilinear(mesh, u1, v1), bilinear(mesh, u0, v1)].forEach((point, index) => {
        const [x, y] = project(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.fill();
    }
  }
}

export function renderInlineResult(canvas, packets, timeMs = 0) {
  const decoded = packets.map(decode);
  const meshes = decoded.filter(({ kind }) => kind === "geometry");
  const particles = decoded.filter(({ kind }) => kind === "particle");
  const fieldMeshes = decoded.filter(({ kind }) => kind === "fieldMesh");
  const cubes = decoded.filter(({ kind }) => kind === "cube");
  const background = decoded.find(({ kind }) => kind === "background");
  const camera = decoded.find(({ kind }) => kind === "camera");
  const timing = decoded.find(({ kind }) => kind === "timing") || null;
  const elapsedMs = timing
    ? ((Math.max(0, Number(timeMs) || 0) % (timing.durationSeconds * 1000)))
    : Math.max(0, Number(timeMs) || 0);
  const orbitLights = decoded.filter(({ kind }) => kind === "orbitLight").map((light) => {
    const angle = light.theta + (light.angularVelocity * elapsedMs / 1000);
    return {
      ...light, kind: "light",
      pos: Float64Array.from([
        light.target[0] + (Math.cos(angle) * light.radius),
        light.target[1] + (Math.sin(angle) * light.radius),
        light.target[2] + light.height,
      ]),
    };
  });
  const lights = [...decoded.filter(({ kind }) => kind === "light"), ...orbitLights];
  const projectedLights = decoded.filter(({ kind }) => kind === "projectedLight").map((light) => {
    const source = orbitLights.find(({ idCode }) => idCode === light.sourceCode);
    const mirror = meshes.find(({ idCode, surfaceSystem }) => (
      idCode === light.mirrorCode && surfaceSystem?.meshCode === light.mirrorCode
    ));
    if (!source || !mirror) {
      throw new TypeError("inline reflected light references unavailable source geometry");
    }
    const plane = mirrorPlane(mirror);
    return {
      ...light, source, mirror, plane,
      pos: Float64Array.from(reflectAcrossPlane(source.pos, plane)),
      target: Float64Array.from(reflectAcrossPlane(source.target, plane)),
    };
  });
  const points = meshes.flatMap((mesh) => Array.from(
    { length: mesh.rows * mesh.columns },
    (_, index) => vertex(mesh, Math.floor(index / mesh.columns), index % mesh.columns),
  ));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const padding = 18;
  const fitProject = ([x, y]) => [
    padding + ((x - minX) / spanX) * (canvas.width - (2 * padding)),
    canvas.height - padding - ((y - minY) / spanY) * (canvas.height - (2 * padding)),
  ];
  const project = camera ? cameraProjector(camera, canvas) : fitProject;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background
    ? `rgba(${channel(background.color[0])}, ${channel(background.color[1])}, ${channel(background.color[2])}, ${Math.max(0, Math.min(1, background.color[3]))})`
    : "#080d19";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = 2;
  const drawStrip = (count, pointAt, projector = project) => {
    context.beginPath();
    for (let index = 0; index < count; index += 1) {
      const [x, y] = projector(pointAt(index));
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  };

  const drawProjectedApertures = (receiver) => {
    if (projectedLights.length === 0) return;
    const receiverPlane = mirrorPlane(receiver);
    for (const light of projectedLights) {
      const footprint = [
        vertex(light.mirror, 0, 0),
        vertex(light.mirror, 0, light.mirror.columns - 1),
        vertex(light.mirror, light.mirror.rows - 1, light.mirror.columns - 1),
        vertex(light.mirror, light.mirror.rows - 1, 0),
      ].map((corner) => {
        const ray = subtract(corner, light.pos);
        const denominator = dot(ray, receiverPlane.normal);
        if (Math.abs(denominator) < 1e-9) {
          throw new TypeError("inline reflected aperture is parallel to its receiver");
        }
        const distance = dot(subtract(receiverPlane.origin, light.pos), receiverPlane.normal)
          / denominator;
        if (distance <= 0) {
          throw new TypeError("inline reflected aperture points away from its receiver");
        }
        return light.pos.map((value, index) => value + (distance * ray[index]));
      });
      const screen = footprint.map(project);
      const center = screen.reduce(
        (sum, point) => [sum[0] + point[0] / screen.length, sum[1] + point[1] / screen.length],
        [0, 0],
      );
      const radius = Math.max(2, ...screen.map((point) => Math.hypot(
        point[0] - center[0], point[1] - center[1],
      )));
      context.save();
      context.beginPath();
      screen.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.clip();
      const gradient = context.createRadialGradient(
        center[0], center[1], 0, center[0], center[1], radius * light.spread,
      );
      const strength = Math.min(0.72, light.intensity / 120);
      gradient.addColorStop(0, rgba([...light.color.slice(0, 3), strength]));
      gradient.addColorStop(0.72, rgba([...light.color.slice(0, 3), strength * 0.55]));
      gradient.addColorStop(1, rgba([...light.color.slice(0, 3), 0]));
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
  };

  const shadowLight = lights.find(({ castsShadow }) => castsShadow);
  const receiver = meshes.find(({ receivesShadow }) => receivesShadow);
  if (shadowLight && receiver) {
    const receiverZ = vertex(receiver, 0, 0)[2];
    const shadowPoint = (point) => {
      const denominator = point[2] - shadowLight.pos[2];
      const scale = Math.abs(denominator) < 1e-9
        ? 0 : (receiverZ - shadowLight.pos[2]) / denominator;
      return shadowLight.pos.map((value, index) => value + (scale * (point[index] - value)));
    };
    context.strokeStyle = `rgba(0, 0, 0, ${Math.max(0.18, 0.48 - shadowLight.sourceRadius)})`;
    for (const caster of meshes.filter(({ castsShadow }) => castsShadow)) {
      for (let row = 0; row < caster.rows; row += 1) {
        drawStrip(caster.columns, (column) => shadowPoint(vertex(caster, row, column)));
      }
    }
    for (const cube of cubes.filter(({ castsShadow }) => castsShadow)) {
      const corners = cubeCorners(cube);
      drawStrip(4, (index) => shadowPoint(corners[[4, 5, 7, 6][index]]));
    }
  }

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex];
    if (mesh.surfaceSystem) {
      if (!camera) {
        throw new TypeError("inline mirror renderer requires a retained camera packet");
      }
      const plane = mirrorPlane(mesh);
      const mirrorCamera = {
        pos: reflectAcrossPlane(camera.pos, plane),
        target: reflectAcrossPlane(camera.target, plane),
        up: mesh.surfaceSystem.cameraUp,
        fov: mesh.surfaceSystem.cameraFov,
      };
      const mirrorProject = cameraProjector(mirrorCamera, canvas);
      context.save();
      context.beginPath();
      [
        vertex(mesh, 0, 0),
        vertex(mesh, 0, mesh.columns - 1),
        vertex(mesh, mesh.rows - 1, mesh.columns - 1),
        vertex(mesh, mesh.rows - 1, 0),
      ].forEach((point, index) => {
        const [x, y] = project(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.clip();
      context.fillStyle = background
        ? rgba(background.color)
        : "#080d19";
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const reflected of meshes.slice(0, meshIndex)) {
        const color = litColor(reflected, lights);
        const sourceAlpha = reflected.optical?.transparent
          ? reflected.optical.alpha : (reflected.color?.[3] ?? reflected.packet[7]);
        const alpha = Math.max(0, Math.min(
          1, sourceAlpha * mesh.surfaceSystem.reflectivity,
        ));
        context.strokeStyle = `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${alpha})`;
        if (reflected.nativeSurface) {
          context.fillStyle = `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${alpha})`;
          context.beginPath();
          [
            vertex(reflected, 0, 0), vertex(reflected, 0, reflected.columns - 1),
            vertex(reflected, reflected.rows - 1, reflected.columns - 1),
            vertex(reflected, reflected.rows - 1, 0),
          ].forEach((point, index) => {
            const [x, y] = mirrorProject(point);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
          context.fill();
        }
        for (let row = 0; row < reflected.rows; row += 1) {
          drawStrip(
            reflected.columns,
            (column) => vertex(reflected, row, column),
            mirrorProject,
          );
        }
        if (reflected.rows > 1) {
          for (let column = 0; column < reflected.columns; column += 1) {
            drawStrip(
              reflected.rows,
              (row) => vertex(reflected, row, column),
              mirrorProject,
            );
          }
        }
      }
      context.restore();
    }
    if (mesh.nativeSurface) {
      const surfaceColor = litColor(mesh, lights);
      const surfaceAlpha = mesh.optical?.transparent
        ? mesh.optical.alpha : mesh.color[3];
      context.fillStyle = `rgba(${channel(surfaceColor[0])}, ${channel(surfaceColor[1])}, ${channel(surfaceColor[2])}, ${Math.max(0, Math.min(1, surfaceAlpha))})`;
      context.beginPath();
      [vertex(mesh, 0, 0), vertex(mesh, 0, mesh.columns - 1),
        vertex(mesh, mesh.rows - 1, mesh.columns - 1),
        vertex(mesh, mesh.rows - 1, 0)].forEach((point, index) => {
        const [x, y] = project(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.fill();
    }
    drawTexture(context, project, mesh);
    if (mesh.receivesShadow) drawProjectedApertures(mesh);
    const color = litColor(mesh, lights);
    const alpha = mesh.optical?.transparent
      ? mesh.optical.alpha : (mesh.color?.[3] ?? mesh.packet[7]);
    context.strokeStyle = `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${Math.max(0, Math.min(1, alpha))})`;
    for (let row = 0; row < mesh.rows; row += 1) {
      drawStrip(mesh.columns, (column) => vertex(mesh, row, column));
    }
    if (mesh.rows > 1) {
      for (let column = 0; column < mesh.columns; column += 1) {
        drawStrip(mesh.rows, (row) => vertex(mesh, row, column));
      }
    }
  }
  const worldScale = Math.min(canvas.width, canvas.height) * (4 / 15);
  for (const particle of particles) {
    const x = (canvas.width / 2) + (particle.position[0] * worldScale);
    const y = (canvas.height / 2) - (particle.position[1] * worldScale);
    context.fillStyle = rgba(particle.color);
    context.beginPath();
    context.arc(x, y, particle.size * worldScale / 2, 0, Math.PI * 2);
    context.fill();
  }
  if (fieldMeshes.length > 0 && !camera) {
    throw new TypeError("inline field mesh renderer requires a retained camera packet");
  }
  for (const fieldMesh of fieldMeshes) {
    for (let index = 0; index < fieldMesh.indexCount; index += 2) {
      const first = fieldVertex(fieldMesh, fieldMesh.packet[fieldMesh.indexOffset + index]);
      const second = fieldVertex(fieldMesh, fieldMesh.packet[fieldMesh.indexOffset + index + 1]);
      const color = fieldMesh.color.map((value, channelIndex) => (
        value * ((first.color[channelIndex] + second.color[channelIndex]) / 2)
      ));
      context.strokeStyle = rgba(color);
      context.beginPath();
      const [firstX, firstY] = project(first.position);
      const [secondX, secondY] = project(second.position);
      context.moveTo(firstX, firstY);
      context.lineTo(secondX, secondY);
      context.stroke();
    }
  }
  if (cubes.length > 0 && !camera) {
    throw new TypeError("inline native cube renderer requires a retained camera packet");
  }
  const cubeFaces = [
    [0, 1, 3, 2], [4, 6, 7, 5],
    [0, 4, 5, 1], [2, 3, 7, 6],
    [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  const diceFaceValues = [6, 1, 5, 2, 4, 3];
  for (const cube of cubes) {
    const corners = cubeCorners(cube);
    const baseColor = cube.texture?.kind === "dice" ? cube.texture.colorA : cube.color;
    const light = lights[0];
    const distance = light ? Math.hypot(...subtract(light.pos, cube.center)) : 1;
    const diffuse = light ? Math.min(
      0.72,
      light.intensity / Math.max(1, distance * distance) * 0.1 * lightConeFactor(light, cube.center),
    ) : 0.25;
    const gloss = cube.specularStrength * (1 - cube.roughness) * 0.4;
    const orderedFaces = cubeFaces.map((face, faceIndex) => ({
      face,
      faceIndex,
      distance: face.reduce((sum, cornerIndex) => (
        sum + Math.hypot(...subtract(corners[cornerIndex], camera.pos))
      ), 0) / face.length,
    })).sort((left, right) => right.distance - left.distance);
    for (const { face, faceIndex } of orderedFaces) {
      const orientation = 0.58 + ((faceIndex % 3) * 0.11);
      const strength = Math.min(1, orientation + diffuse + gloss);
      const color = baseColor.map((value, index) => index === 3 ? value : value * strength);
      context.fillStyle = rgba(color);
      context.strokeStyle = rgba(color.map((value, index) => index === 3 ? value : value * 0.75));
      context.beginPath();
      face.forEach((cornerIndex, index) => {
        const [x, y] = project(corners[cornerIndex]);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.fill();
      context.stroke();
      if (cube.texture?.kind === "dice") {
        const projected = face.map((cornerIndex) => project(corners[cornerIndex]));
        const pips = dicePips(diceFaceValues[faceIndex]);
        if (cube.texture.graphWidthPx > 0 && pips.length > 1) {
          context.strokeStyle = rgba(cube.texture.colorB);
          context.lineWidth = cube.texture.graphWidthPx;
          context.beginPath();
          pips.forEach(([u, v], index) => {
            const [x, y] = facePoint(projected, u, v);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.stroke();
        }
        const edge = Math.min(
          Math.hypot(projected[1][0] - projected[0][0], projected[1][1] - projected[0][1]),
          Math.hypot(projected[3][0] - projected[0][0], projected[3][1] - projected[0][1]),
        );
        context.fillStyle = rgba(cube.texture.colorB);
        for (const [u, v] of pips) {
          const [x, y] = facePoint(projected, u, v);
          context.beginPath();
          context.arc(x, y, Math.max(1, edge * 0.065), 0, Math.PI * 2);
          context.fill();
        }
        context.lineWidth = 2;
      }
    }
  }
  if (timing?.showLightMarkers) {
    for (const light of lights.filter(({ showMarker }) => showMarker)) {
      const [x, y] = project(light.pos);
      context.fillStyle = rgba(light.color);
      context.beginPath();
      context.arc(
        x, y,
        Math.max(2, timing.lightMarkerSize * 12 * Math.max(0.5, light.sourceRadius * 5)),
        0, Math.PI * 2,
      );
      context.fill();
    }
  }
  return timing;
}
