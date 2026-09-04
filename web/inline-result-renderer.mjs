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
      castsShadow: packet[14] === 1, sourceRadius: packet[15],
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
      || surfaceSystem.frameCode !== 3398114705 || surfaceSystem.meshCode !== 801718722
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

function cubeCorners(cube) {
  const half = cube.size / 2;
  return [
    [-half, -half, -half], [half, -half, -half],
    [-half, half, -half], [half, half, -half],
    [-half, -half, half], [half, -half, half],
    [-half, half, half], [half, half, half],
  ].map((corner) => corner.map((value, index) => value + cube.center[index]));
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
  const base = [mesh.packet[4], mesh.packet[5], mesh.packet[6]];
  const reflected = mesh.optical
    ? base.map((value) => value + ((1 - value) * mesh.optical.reflectivity * 0.35))
    : base;
  if (!mesh.receivesLighting || lights.length === 0) return reflected;
  const point = vertex(mesh, 0, 0);
  const light = lights[0];
  const distance = Math.hypot(...subtract(light.pos, point));
  const attenuation = distance > light.range ? 0 : light.intensity / Math.max(1, distance * distance);
  const diffuse = attenuation * 0.12 * (1 - (mesh.roughness * 0.25));
  const highlight = mesh.specularStrength * (1 - mesh.roughness) * 0.3;
  const strength = Math.min(1, 0.2 + diffuse + highlight);
  return reflected.map((value, index) => value * light.color[index] * strength);
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

export function renderInlineResult(canvas, packets) {
  const decoded = packets.map(decode);
  const meshes = decoded.filter(({ kind }) => kind === "geometry");
  const particles = decoded.filter(({ kind }) => kind === "particle");
  const fieldMeshes = decoded.filter(({ kind }) => kind === "fieldMesh");
  const cubes = decoded.filter(({ kind }) => kind === "cube");
  const background = decoded.find(({ kind }) => kind === "background");
  const camera = decoded.find(({ kind }) => kind === "camera");
  const lights = decoded.filter(({ kind }) => kind === "light");
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
          ? reflected.optical.alpha : reflected.packet[7];
        const alpha = Math.max(0, Math.min(
          1, sourceAlpha * mesh.surfaceSystem.reflectivity,
        ));
        context.strokeStyle = `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${alpha})`;
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
    drawTexture(context, project, mesh);
    const color = litColor(mesh, lights);
    const alpha = mesh.optical?.transparent ? mesh.optical.alpha : mesh.packet[7];
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
  for (const cube of cubes) {
    const corners = cubeCorners(cube);
    const light = lights[0];
    const distance = light ? Math.hypot(...subtract(light.pos, cube.center)) : 1;
    const diffuse = light ? Math.min(0.72, light.intensity / Math.max(1, distance * distance) * 0.1) : 0.25;
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
      const color = cube.color.map((value, index) => index === 3 ? value : value * strength);
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
    }
  }
}
