function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveViewDepth(worldPosition, cameraPosition, cameraForward) {
  const dx = finite(worldPosition?.[0]) - finite(cameraPosition?.[0]);
  const dy = finite(worldPosition?.[1]) - finite(cameraPosition?.[1]);
  const dz = finite(worldPosition?.[2]) - finite(cameraPosition?.[2]);
  const fx = finite(cameraForward?.[0]);
  const fy = finite(cameraForward?.[1]);
  const fz = finite(cameraForward?.[2], 1);
  const forwardLength = Math.hypot(fx, fy, fz);
  const inverseLength = forwardLength > 1e-6 ? 1 / forwardLength : 1;
  return (dx * fx * inverseLength) +
    (dy * fy * inverseLength) +
    (dz * (forwardLength > 1e-6 ? fz * inverseLength : 1));
}

function sliceCoordinate(value, minimum, maximum, count) {
  const normalized = (value - minimum) / (maximum - minimum);
  return Math.min(count - 1, Math.max(0, Math.floor(normalized * count)));
}

export function clusterIndexForReceiver({
  ndc,
  worldPosition,
  cameraPosition,
  cameraForward,
  grid
}) {
  const xSlices = Math.max(1, finite(grid?.xSlices, 1) | 0);
  const ySlices = Math.max(1, finite(grid?.ySlices, 1) | 0);
  const depthSlices = Math.max(1, finite(grid?.depthSlices, 1) | 0);
  const nearDepth = Math.max(Number.EPSILON, finite(grid?.nearDepth, 0.05));
  const farDepth = Math.max(nearDepth + Number.EPSILON, finite(grid?.farDepth, 500));
  const x = sliceCoordinate(finite(ndc?.[0]), -1, 1, xSlices);
  const y = sliceCoordinate(finite(ndc?.[1]), -1, 1, ySlices);
  const viewDepth = Math.min(farDepth, Math.max(nearDepth,
    positiveViewDepth(worldPosition, cameraPosition, cameraForward)));
  const logarithmicDepth = Math.log(viewDepth / nearDepth) / Math.log(farDepth / nearDepth);
  const z = Math.min(depthSlices - 1, Math.max(0, Math.floor(logarithmicDepth * depthSlices)));
  return ((z * ySlices) + y) * xSlices + x;
}

function normalize3(value) {
  const x = finite(value?.[0]);
  const y = finite(value?.[1]);
  const z = finite(value?.[2]);
  const length = Math.max(Math.hypot(x, y, z), 1e-6);
  return [x / length, y / length, z / length];
}

function dot3(a, b) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function subtract3(a, b) {
  return [
    finite(a?.[0]) - finite(b?.[0]),
    finite(a?.[1]) - finite(b?.[1]),
    finite(a?.[2]) - finite(b?.[2])
  ];
}

function cross2(a, b, point) {
  return ((b[0] - a[0]) * (point[1] - a[1])) -
    ((b[1] - a[1]) * (point[0] - a[0]));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - (2 * t));
}

function lightAttenuation(distance, intensity, range) {
  const base = Math.max(finite(intensity), 0) / Math.max(distance * distance, 1);
  if (range <= 1e-6) return base;
  if (distance >= range) return 0;
  const x = Math.min(1, Math.max(0, distance / range));
  const fade = 1 - (x * x);
  return base * fade * fade;
}

function spotlightFactor(light, pointDirection) {
  const kindCode = finite(light?.kindCode);
  if (kindCode < 0.5 || kindCode > 1.5) return 1;
  const coneDirection = normalize3(light?.direction);
  const inner = Math.max(finite(light?.innerConeCos, -1), finite(light?.outerConeCos, -1));
  const outer = Math.min(finite(light?.innerConeCos, -1), finite(light?.outerConeCos, -1));
  return smoothstep(outer, inner, dot3(coneDirection, normalize3(pointDirection)));
}

function edgeOcclusion(side, edgeLength, softness) {
  const signedDistance = side / Math.max(edgeLength, 1e-6);
  if (softness <= 1e-6) return signedDistance >= 0 ? 1 : 0;
  return smoothstep(-softness, softness, signedDistance);
}

export function projectedApertureFactor(light, worldPosition) {
  const kindCode = finite(light?.kindCode);
  if (kindCode < 1.5 || kindCode >= 2.5) return 1;
  const aperture = light?.projectedAperture;
  const points = Array.isArray(aperture?.points) ? aperture.points.slice(0, 8) : [];
  if (points.length < 3) return 0;

  const lightPosition = light?.position || [0, 0, 0];
  const planePoint = aperture?.planePoint || [0, 0, 0];
  const planeNormal = normalize3(aperture?.planeNormal || [0, 0, 1]);
  const uAxis = normalize3(aperture?.uAxis || [1, 0, 0]);
  const vAxis = normalize3(aperture?.vAxis || [0, 1, 0]);
  const ray = subtract3(worldPosition, lightPosition);
  const denominator = dot3(planeNormal, ray);
  if (Math.abs(denominator) <= 1e-6) return 0;
  const t = dot3(subtract3(planePoint, lightPosition), planeNormal) / denominator;
  if (t <= 1e-4 || t >= 1 - 1e-4) return 0;

  const hit = [0, 1, 2].map((index) => finite(lightPosition[index]) + (t * ray[index]));
  const relative = subtract3(hit, planePoint);
  const local = [dot3(relative, uAxis), dot3(relative, vAxis)];
  const lightToPlane = Math.max(Math.abs(dot3(subtract3(planePoint, lightPosition), planeNormal)), 1e-4);
  const lightSide = dot3(subtract3(lightPosition, planePoint), planeNormal);
  const pointSide = dot3(subtract3(worldPosition, planePoint), planeNormal);
  const receiverSide = -Math.sign(lightSide) * pointSide;
  const clipEpsilon = Math.max(0, finite(aperture?.clipEpsilon));
  if (receiverSide <= clipEpsilon) return 0;
  const receiverGap = Math.max(0, receiverSide - clipEpsilon);
  const softness = Math.max(0, finite(light?.sourceRadius)) *
    (receiverGap / lightToPlane) * Math.max(0, finite(light?.spread, 1));

  if (points.length === 4) {
    const xs = points.map((point) => finite(point?.[0]));
    const ys = points.map((point) => finite(point?.[1]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const insideX = smoothstep(minX, minX + softness, local[0]) *
      (1 - smoothstep(maxX - softness, maxX, local[0]));
    const insideY = smoothstep(minY, minY + softness, local[1]) *
      (1 - smoothstep(maxY - softness, maxY, local[1]));
    return insideX * insideY;
  }

  let positive = 1;
  let negative = 1;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index].map((value) => finite(value));
    const b = points[(index + 1) % points.length].map((value) => finite(value));
    const side = cross2(a, b, local);
    const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    positive *= edgeOcclusion(side, edgeLength, softness);
    negative *= edgeOcclusion(-side, edgeLength, softness);
  }
  return Math.max(positive, negative);
}

function geometryEmitterFactor(light, lightDirection) {
  if (finite(light?.kindCode) < 2.5) return 1;
  const facing = dot3(normalize3(light?.direction), lightDirection.map(component => -component));
  const sided = light?.geometryTwoSided === true ? Math.abs(facing) : Math.max(facing, 0);
  return Math.max(0, finite(light?.geometryArea)) * sided;
}

export function evaluateClusteredDirectLights({
  lights,
  receiver,
  lightIds,
  skipLightIdsBelow = 0
}) {
  const diffuse = [0, 0, 0];
  const specular = [0, 0, 0];
  const source = Array.isArray(lights) ? lights : [];
  const ids = lightIds == null ? source.map((_, index) => index) : Array.from(lightIds);
  const world = receiver?.worldPosition || [0, 0, 0];
  const normal = normalize3(receiver?.normal || [0, 0, 1]);
  const camera = receiver?.cameraPosition || [0, 0, 1];
  const view = normalize3([
    finite(camera[0]) - finite(world[0]),
    finite(camera[1]) - finite(world[1]),
    finite(camera[2]) - finite(world[2])
  ]);
  const base = receiver?.baseColor || [1, 1, 1];
  const alpha = finite(receiver?.alpha, 1);
  const specularScale = finite(receiver?.specularScale, 1);
  const specularStrength = finite(receiver?.specularStrength, 1);

  for (const rawId of ids) {
    const id = Number(rawId) >>> 0;
    if (id < skipLightIdsBelow || id >= source.length) continue;
    const light = source[id] || {};
    const position = light.position || [0, 0, 0];
    const toLight = [
      finite(position[0]) - finite(world[0]),
      finite(position[1]) - finite(world[1]),
      finite(position[2]) - finite(world[2])
    ];
    const distance = Math.max(Math.hypot(...toLight), 1e-6);
    const lightDirection = toLight.map((component) => component / distance);
    const attenuation = lightAttenuation(distance, light.intensity, finite(light.range));
    const spot = spotlightFactor(light, lightDirection.map((component) => -component));
    const aperture = projectedApertureFactor(light, world);
    const geometry = geometryEmitterFactor(light, lightDirection);
    const scale = attenuation * spot * aperture * geometry;
    const diffuseFactor = Math.max(dot3(normal, lightDirection), 0);
    const halfVector = normalize3([
      lightDirection[0] + view[0],
      lightDirection[1] + view[1],
      lightDirection[2] + view[2]
    ]);
    const specularFactor = Math.pow(Math.max(dot3(normal, halfVector), 0), 40);
    for (let channel = 0; channel < 3; channel += 1) {
      const color = finite(light.color?.[channel]);
      diffuse[channel] += scale * diffuseFactor * color * finite(base[channel]);
      if (finite(light.kindCode) < 1.5) {
        specular[channel] += scale * specularFactor * color *
          (1.8 * specularScale * alpha * specularStrength);
      }
    }
  }

  return { diffuse, specular };
}

export function shadeClusteredReceiver({ lights, receiver, lightIds }) {
  const alpha = finite(receiver?.alpha, 1);
  const base = receiver?.baseColor || [1, 1, 1];
  const direct = evaluateClusteredDirectLights({ lights, receiver, lightIds });
  const rgb = [0, 1, 2].map((channel) =>
    (((0.1 * finite(base[channel])) + direct.diffuse[channel]) * alpha) +
      direct.specular[channel]
  );
  return { rgb, alpha };
}
