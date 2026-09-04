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
  if (packet[0] !== MAGIC || ![1, 2, 3, 4].includes(packet[1])) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  const rows = packet[2];
  const columns = packet[3];
  const stride = packet[1] === 2 ? 2 : 3;
  const dataOffset = packet[1] === 4 ? 13 : packet[1] === 3 ? 10 : 8;
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1
      || packet.length !== dataOffset + (rows * columns * stride)) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  return {
    kind: "geometry", packet, rows, columns, stride, dataOffset,
    receivesLighting: packet[1] >= 3 && packet[8] === 1,
    castsShadow: packet[1] >= 3 && packet[9] === 1,
    receivesShadow: packet[1] === 4 && packet[10] === 1,
    roughness: packet[1] === 4 ? packet[11] : 1,
    specularStrength: packet[1] === 4 ? packet[12] : 0,
  };
}

function channel(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function vertex(mesh, row, column) {
  const offset = mesh.dataOffset + (((row * mesh.columns) + column) * mesh.stride);
  return [mesh.packet[offset], mesh.packet[offset + 1], mesh.stride === 3 ? mesh.packet[offset + 2] : 0];
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
  if (!mesh.receivesLighting || lights.length === 0) return base;
  const point = vertex(mesh, 0, 0);
  const light = lights[0];
  const distance = Math.hypot(...subtract(light.pos, point));
  const attenuation = distance > light.range ? 0 : light.intensity / Math.max(1, distance * distance);
  const diffuse = attenuation * 0.12 * (1 - (mesh.roughness * 0.25));
  const highlight = mesh.specularStrength * (1 - mesh.roughness) * 0.3;
  const strength = Math.min(1, 0.2 + diffuse + highlight);
  return base.map((value, index) => value * light.color[index] * strength);
}

export function renderInlineResult(canvas, packets) {
  const decoded = packets.map(decode);
  const meshes = decoded.filter(({ kind }) => kind === "geometry");
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
  const drawStrip = (count, pointAt) => {
    context.beginPath();
    for (let index = 0; index < count; index += 1) {
      const [x, y] = project(pointAt(index));
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
  }

  for (const mesh of meshes) {
    const color = litColor(mesh, lights);
    context.strokeStyle = `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${Math.max(0, Math.min(1, mesh.packet[7]))})`;
    for (let row = 0; row < mesh.rows; row += 1) {
      drawStrip(mesh.columns, (column) => vertex(mesh, row, column));
    }
    if (mesh.rows > 1) {
      for (let column = 0; column < mesh.columns; column += 1) {
        drawStrip(mesh.rows, (row) => vertex(mesh, row, column));
      }
    }
  }
}
