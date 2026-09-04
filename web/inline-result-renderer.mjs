const MAGIC = 1447773766;

function decode(packet) {
  if (!(packet instanceof Float64Array) || packet[0] !== MAGIC || packet[1] !== 1) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  const rows = packet[2];
  const columns = packet[3];
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1
      || packet.length !== 8 + (rows * columns * 3)) {
    throw new TypeError("inline renderer received an invalid retained geometry packet");
  }
  return { packet, rows, columns };
}

function channel(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function vertex(mesh, row, column) {
  const offset = 8 + (((row * mesh.columns) + column) * 3);
  return [mesh.packet[offset], mesh.packet[offset + 1]];
}

export function renderInlineResult(canvas, packets) {
  const meshes = packets.map(decode);
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
  context.fillStyle = "#080d19";
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
