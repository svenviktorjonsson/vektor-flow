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
    const scale = attenuation * spot;
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
