const MAGIC = 1447773766;

function decode(packet) {
  if (!(packet instanceof Float64Array)) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  if (packet[0] === 1447773767 && packet[1] === 1 && packet.length === 6) {
    return { kind: "background", color: packet.slice(2) };
  }
  if (packet[0] !== MAGIC || ![1, 2].includes(packet[1])) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  const rows = packet[2];
  const columns = packet[3];
  const stride = packet[1] === 1 ? 3 : 2;
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1
      || packet.length !== 8 + (rows * columns * stride)) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  return { kind: "geometry", packet, rows, columns, stride };
}

function channel(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function vertex(mesh, row, column) {
  const offset = 8 + (((row * mesh.columns) + column) * mesh.stride);
  return [mesh.packet[offset], mesh.packet[offset + 1]];
}

export function renderInlineResult(canvas, packets) {
  const decoded = packets.map(decode);
  const meshes = decoded.filter(({ kind }) => kind === "geometry");
  const background = decoded.find(({ kind }) => kind === "background");
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
  const project = ([x, y]) => [
    padding + ((x - minX) / spanX) * (canvas.width - (2 * padding)),
    canvas.height - padding - ((y - minY) / spanY) * (canvas.height - (2 * padding)),
  ];
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background
    ? `rgba(${channel(background.color[0])}, ${channel(background.color[1])}, ${channel(background.color[2])}, ${Math.max(0, Math.min(1, background.color[3]))})`
    : "#080d19";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = 2;

  for (const mesh of meshes) {
    context.strokeStyle = `rgba(${channel(mesh.packet[4])}, ${channel(mesh.packet[5])}, ${channel(mesh.packet[6])}, ${Math.max(0, Math.min(1, mesh.packet[7]))})`;
    const drawStrip = (count, pointAt) => {
      context.beginPath();
      for (let index = 0; index < count; index += 1) {
        const [x, y] = project(pointAt(index));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    };
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
