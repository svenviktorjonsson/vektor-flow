import * as THREE from 'three';

import { INDICATOR_PROTOCOL } from '../protocol.mjs';
import { installWebGlFixtureTracker } from '../retention-ledger.mjs';

export const THREE_VERSION = THREE.REVISION;

export function threeOrbitPosition(frame) {
  const angle = 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames;
  return [3 * Math.sin(angle), 0, 3 * Math.cos(angle)];
}

export function threePrimitiveForPointSize(pointSizePx) {
  return pointSizePx === 1 ? 'instanced-discrete-point-quad' : 'points';
}

function readWebGlRgba(gl, width, height) {
  const bottomUp = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
  const rgba = new Uint8Array(bottomUp.length);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * width * 4;
    rgba.set(bottomUp.subarray(source, source + width * 4), y * width * 4);
  }
  return rgba;
}

export function createThreeAdapter(host, fixture, options = {}) {
  const viewport = options.viewport ?? INDICATOR_PROTOCOL.viewport;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = viewport;
  Object.assign(canvas.style, { width: `${viewport[0]}px`, height: `${viewport[1]}px` });
  host.replaceChildren(canvas);
  let tracker;
  let renderer;
  let gl;
  let geometry;
  let material;
  let points;
  let scene;
  let camera;
  let retainedPositions;
  let retainedColors;
  let positionAttributeName;
  let colorAttributeName;
  let cameraUniformWrites = 0;

  function render(frame) {
    camera.position.fromArray(threeOrbitPosition(frame));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }

  return Object.freeze({
    id: 'three-js-webgl2',
    version: `r${THREE_VERSION}`,
    async initialize(lane) {
      const started = performance.now();
      tracker = installWebGlFixtureTracker(3_000_000);
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(viewport[0], viewport[1], false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 1);
      gl = renderer.getContext();
      const primitive = threePrimitiveForPointSize(lane.pointSizePx);
      if (primitive === 'instanced-discrete-point-quad') {
        geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
          -1, -1, 0, 1, -1, 0, 1, 1, 0,
          -1, -1, 0, 1, 1, 0, -1, 1, 0,
        ]), 3));
        const positionAttribute = new THREE.InstancedBufferAttribute(fixture.positions, 3);
        const colorAttribute = new THREE.InstancedBufferAttribute(fixture.colors, 4, true);
        retainedPositions = positionAttribute.array;
        retainedColors = colorAttribute.array;
        positionAttributeName = 'instancePosition';
        colorAttributeName = 'instanceColor';
        geometry.setAttribute(positionAttributeName, positionAttribute);
        geometry.setAttribute(colorAttributeName, colorAttribute);
        geometry.instanceCount = fixture.pointCount;
        material = new THREE.RawShaderMaterial({
          transparent: true,
          depthTest: true,
          depthWrite: true,
          blending: THREE.NormalBlending,
          uniforms: {
            carrierSize: { value: 3 },
            viewport: { value: new THREE.Vector2(viewport[0], viewport[1]) },
          },
          vertexShader: `
            precision highp float;
            uniform float carrierSize;
            uniform vec2 viewport;
            uniform mat4 projectionMatrix;
            uniform mat4 modelViewMatrix;
            attribute vec3 position;
            attribute vec3 instancePosition;
            attribute vec4 instanceColor;
            varying vec2 pointCenterPixels;
            varying vec4 pointColor;
            void main() {
              pointColor = instanceColor;
              vec4 center = projectionMatrix * modelViewMatrix * vec4(instancePosition, 1.0);
              pointCenterPixels = (center.xy / center.w * 0.5 + 0.5) * viewport;
              center.xy += position.xy * (carrierSize / viewport) * center.w;
              gl_Position = center;
            }
          `,
          fragmentShader: `
            precision highp float;
            varying vec2 pointCenterPixels;
            varying vec4 pointColor;
            void main() {
              if (floor(gl_FragCoord.x) != floor(pointCenterPixels.x)
                  || floor(gl_FragCoord.y) != floor(pointCenterPixels.y)) discard;
              gl_FragColor = pointColor;
            }
          `,
        });
        points = new THREE.Mesh(geometry, material);
      } else {
        geometry = new THREE.BufferGeometry();
        const positionAttribute = new THREE.BufferAttribute(fixture.positions, 3);
        const colorAttribute = new THREE.Uint8BufferAttribute(fixture.colors, 4, true);
        retainedPositions = positionAttribute.array;
        retainedColors = colorAttribute.array;
        positionAttributeName = 'position';
        colorAttributeName = 'color';
        geometry.setAttribute(positionAttributeName, positionAttribute);
        geometry.setAttribute(colorAttributeName, colorAttribute);
        geometry.computeBoundingSphere();
        material = new THREE.RawShaderMaterial({
        vertexColors: true,
        transparent: true,
        depthTest: true,
        depthWrite: true,
        blending: THREE.NormalBlending,
        uniforms: { pointSize: { value: lane.pointSizePx } },
        vertexShader: `
          precision highp float;
          uniform float pointSize;
          uniform mat4 projectionMatrix;
          uniform mat4 modelViewMatrix;
          attribute vec3 position;
          attribute vec4 color;
          varying vec4 pointColor;
          void main() {
            pointColor = color;
            gl_PointSize = pointSize;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          precision highp float;
          varying vec4 pointColor;
          void main() {
            vec2 local = gl_PointCoord - vec2(0.5);
            float radial = length(local) * 2.0;
            if (radial > 1.0) discard;
            gl_FragColor = pointColor;
          }
        `,
        });
        points = new THREE.Points(geometry, material);
      }
      points.frustumCulled = false;
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      scene.add(points);
      const halfHeight = INDICATOR_PROTOCOL.renderState.orthographicHalfHeight;
      const halfWidth = halfHeight * viewport[0] / viewport[1];
      camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.05, 500);
      render(0);
      gl.finish();
      tracker.markInitialized();
      return {
        firstVisibleMs: performance.now() - started,
        uploadBytes: fixture.byteLength,
        estimatedGpuBytes: fixture.byteLength + viewport[0] * viewport[1] * 8,
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        backend: `Three.js r${THREE_VERSION} WebGL2 ${primitive}`,
        timestampMode: 'unsupported by WebGL adapter',
        sampleCount: gl.getParameter(gl.SAMPLES),
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
        shaderDiagnostics: renderer.info.programs.map((program) => program.diagnostics ?? null),
      };
    },
    async submitFrame(frame) {
      render(frame);
      cameraUniformWrites += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames };
    },
    async completeGpu() { gl.finish(); },
    async drainGpu() { gl.finish(); },
    async capture(frame) {
      gl.finish();
      return {
        frame,
        width: viewport[0],
        height: viewport[1],
        rgba: readWebGlRgba(gl, viewport[0], viewport[1]),
      };
    },
    retainedEvidence() {
      return {
        ...tracker.evidence(),
        cameraUniformWritesAfterInitialize: cameraUniformWrites,
        cameraUniformBytesAfterInitialize: cameraUniformWrites * 128,
        fixtureBufferIdentityStable: geometry?.getAttribute(positionAttributeName)?.array === retainedPositions
          && geometry?.getAttribute(colorAttributeName)?.array === retainedColors,
      };
    },
    async destroy() {
      try {
        geometry?.dispose();
        material?.dispose();
        renderer?.dispose();
        renderer?.forceContextLoss();
      } finally {
        tracker?.restore();
      }
    },
  });
}
