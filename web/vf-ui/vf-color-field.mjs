const FALLBACK_RGB = Object.freeze([128, 128, 128]);
const SOURCE_EPSILON = 1e-12;

export function compileColorFieldExpressionGlsl(ast) {
  const result = emitColorFieldGlsl(ast);
  if (!result) throw new TypeError('Unsupported VKF color-field expression AST');
  return result;
}

export function colorFieldQuadWorldFrame({ left, top, width, height, screenToWorld }) {
  if (typeof screenToWorld !== 'function') throw new TypeError('screenToWorld is required');
  const origin = screenToWorld([left, top]);
  const xEnd = screenToWorld([left + width, top]);
  const yEnd = screenToWorld([left, top + height]);
  return Object.freeze({
    origin: Object.freeze([...origin]),
    spanX: Object.freeze(subtractPoint(xEnd, origin)),
    spanY: Object.freeze(subtractPoint(yEnd, origin)),
  });
}

function emitColorFieldGlsl(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'number') {
    const value = Number(node.value);
    if (!Number.isFinite(value)) return null;
    const text = String(value);
    return /[.eE]/.test(text) ? text : `${text}.0`;
  }
  if (node.kind === 'variable') {
    if (['x', 'y', 'r', 'phi', 't', 'n', 'N'].includes(node.name)) return node.name;
    if (node.name === 'pi') return '3.141592653589793';
    return null;
  }
  if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
    const operand = emitColorFieldGlsl(node.operand);
    return operand ? `(${node.op}${operand})` : null;
  }
  if (node.kind === 'binary') {
    const left = emitColorFieldGlsl(node.left);
    const right = emitColorFieldGlsl(node.right);
    if (!left || !right) return null;
    if (node.op === '^') return `pow(${left},${right})`;
    return ['+', '-', '*', '/'].includes(node.op) ? `(${left}${node.op}${right})` : null;
  }
  if (node.kind === 'call' && Array.isArray(node.args)) {
    const name = {
      abs:'abs', acos:'acos', asin:'asin', atan:'atan', atan2:'atan', ceil:'ceil',
      cos:'cos', exp:'exp', floor:'floor', ln:'log', log:'log', max:'max', min:'min',
      pow:'pow', round:'round', sign:'sign', sin:'sin', sqrt:'sqrt', tan:'tan'
    }[node.name];
    const args = node.args.map(emitColorFieldGlsl);
    return name && args.every(Boolean) ? `${name}(${args.join(',')})` : null;
  }
  return null;
}

export function pointSourceRgb(point, sourcePoints, colors, weightEvaluator) {
  const channels = colors.map(parseCssRgb);
  const exactSource = sourcePoints.findIndex((source) =>
    distance(point, source) <= SOURCE_EPSILON
  );
  if (exactSource >= 0) return [...(channels[exactSource] || FALLBACK_RGB)];
  return normalizedWeightedRgb(
    sourcePoints.map(([x, y]) => positiveWeight(weightEvaluator, {
      x: point[0] - x,
      y: point[1] - y,
    })),
    channels,
  );
}

export function segmentSourceRgb(point, segments, colors, weightEvaluator) {
  return normalizedWeightedRgb(
    segments.map((segment) => positiveWeight(weightEvaluator, {
      r: Math.max(1e-9, pointToSegmentDistance(point, segment)),
    })),
    colors.map(parseCssRgb),
  );
}

export function evaluateColorFieldRgb(point, field = {}) {
  if (field.kind === 'point-distance') {
    return pointSourceRgb(point, field.points || [], field.colors || [], field.weightEvaluator);
  }
  if (field.kind === 'edge-distance' || field.kind === 'segment-distance') {
    return segmentSourceRgb(point, field.segments || [], field.colors || [], field.weightEvaluator);
  }
  throw new TypeError(`Unsupported color field kind: ${String(field.kind)}`);
}

export function evaluateColorFieldRgba(point, field = {}) {
  if (field.kind === 'coordinate-colormap') {
    if (typeof field.worldToLocal !== 'function'
      || typeof field.evaluator !== 'function'
      || typeof field.sampler !== 'function') {
      throw new TypeError('coordinate-colormap requires worldToLocal, evaluator, and sampler');
    }
    const local = field.worldToLocal(point);
    const sampled = field.sampler(clamp01(evaluatedNumber(field.evaluator, {
      x: local?.[0],
      y: local?.[1],
    }, 0)));
    return normalizedRgba(sampled);
  }
  if (field.kind === 'scalar-grid-colormap') {
    if (typeof field.sampler !== 'function') {
      throw new TypeError('scalar-grid-colormap requires a sampler');
    }
    return normalizedRgba(field.sampler(normalizedScalarGridValue(point, field.grid)));
  }
  return [...evaluateColorFieldRgb(point, field), 255];
}

function normalizedScalarGridValue(point, grid = {}) {
  const shape = grid.shape || [];
  const columns = positiveInteger(shape[0], 'grid columns');
  const rows = positiveInteger(shape[1], 'grid rows');
  const values = Array.from(grid.values || [], Number);
  if (values.length !== columns * rows || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('scalar grid values must match its shape');
  }
  const xBounds = grid.bounds?.x || [0, 1];
  const yBounds = grid.bounds?.y || [0, 1];
  const xSpan = Number(xBounds[1]) - Number(xBounds[0]);
  const ySpan = Number(yBounds[1]) - Number(yBounds[0]);
  if (!(xSpan > 0) || !(ySpan > 0)) throw new RangeError('scalar grid bounds must increase');
  const x = clamp01((Number(point?.[0]) - Number(xBounds[0])) / xSpan) * (columns - 1);
  const y = clamp01((Number(point?.[1]) - Number(yBounds[0])) / ySpan) * (rows - 1);
  const x0 = Math.floor(x), x1 = Math.min(columns - 1, x0 + 1);
  const y0 = Math.floor(y), y1 = Math.min(rows - 1, y0 + 1);
  const mix = (left, right, amount) => left + (right - left) * amount;
  const low = mix(values[x0 + columns * y0], values[x1 + columns * y0], x - x0);
  const high = mix(values[x0 + columns * y1], values[x1 + columns * y1], x - x0);
  const value = mix(low, high, y - y0);
  const domain = grid.domain || [Math.min(...values), Math.max(...values)];
  const span = Number(domain[1]) - Number(domain[0]);
  return span > 0 ? clamp01((value - Number(domain[0])) / span) : 0;
}

export function rasterizeColorField({ width, height, pointAt, field }) {
  const columns = positiveInteger(width, 'width');
  const rows = positiveInteger(height, 'height');
  if (typeof pointAt !== 'function') throw new TypeError('pointAt must be a function');
  const rgba = new Uint8ClampedArray(columns * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const rgbaValue = evaluateColorFieldRgba(pointAt(x, y), field);
      const offset = (y * columns + x) * 4;
      rgba[offset] = rgbaValue[0];
      rgba[offset + 1] = rgbaValue[1];
      rgba[offset + 2] = rgbaValue[2];
      rgba[offset + 3] = rgbaValue[3];
    }
  }
  return rgba;
}

function evaluatedNumber(evaluator, variables, fallback) {
  try {
    const value = Number(evaluator(variables));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function normalizedRgba(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [...FALLBACK_RGB, 255];
  return [0, 1, 2, 3].map((index) => Math.round(Math.min(255, Math.max(0,
    Number(value[index] ?? (index === 3 ? 255 : FALLBACK_RGB[index])) || 0
  ))));
}

export function createCanvasColorFieldRenderer({ canvas, context, screenToWorld }) {
  if (!canvas || !context || typeof screenToWorld !== 'function') {
    throw new TypeError('canvas, context, and screenToWorld are required');
  }
  const rasterCache = new WeakMap();
  const keyedRasterCache = new Map();
  return Object.freeze({
    draw({ targetContext, field, screenPoints = [], targetSize = [] }) {
      if (!targetContext || !screenPoints.length) return false;
      const left = Math.max(0, Math.floor(Math.min(...screenPoints.map(([x]) => x))));
      const top = Math.max(0, Math.floor(Math.min(...screenPoints.map(([, y]) => y))));
      const right = Math.min(targetSize[0] ?? Infinity, Math.ceil(Math.max(...screenPoints.map(([x]) => x))));
      const bottom = Math.min(targetSize[1] ?? Infinity, Math.ceil(Math.max(...screenPoints.map(([, y]) => y))));
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return false;
      canvas.width = width;
      canvas.height = height;
      const image = context.createImageData(width, height);
      const origin = screenToWorld([left + 0.5, top + 0.5]);
      const xStepPoint = screenToWorld([left + 1.5, top + 0.5]);
      const yStepPoint = screenToWorld([left + 0.5, top + 1.5]);
      const xStep = [xStepPoint[0] - origin[0], xStepPoint[1] - origin[1]];
      const yStep = [yStepPoint[0] - origin[0], yStepPoint[1] - origin[1]];
      const signaturePoints = field?.kind === 'coordinate-colormap'
        ? [origin, xStepPoint, yStepPoint].map((point) => field.worldToLocal(point))
        : [origin, xStepPoint, yStepPoint];
      const signatureOrigin = signaturePoints[0];
      const signatureXStep = subtractPoint(signaturePoints[1], signatureOrigin);
      const signatureYStep = subtractPoint(signaturePoints[2], signatureOrigin);
      const signature = [width, height, ...signatureOrigin, ...signatureXStep, ...signatureYStep];
      const keyed = field?.cacheKey != null && field?.contentKey != null;
      const rasterKey = keyed
        ? `${field.cacheKey}\u0000${field.contentKey}\u0000${signature.join(',')}`
        : null;
      const cached = keyed
        ? keyedRasterCache.get(rasterKey)
        : field && typeof field === 'object' ? rasterCache.get(field) : null;
      const cacheHit = cached
        && (!keyed || cached.contentKey === field.contentKey)
        && sameNumbers(cached.signature, signature);
      const rgba = cacheHit
        ? cached.rgba
        : rasterizeColorField({
            width,
            height,
            field,
            pointAt: (x, y) => [
              origin[0] + x * xStep[0] + y * yStep[0],
              origin[1] + x * xStep[1] + y * yStep[1],
            ],
          });
      if (field && typeof field === 'object' && !cacheHit) {
        const entry = { signature, rgba, contentKey: field.contentKey };
        if (keyed) setBoundedCache(keyedRasterCache, rasterKey, entry);
        else rasterCache.set(field, entry);
      }
      image.data.set(rgba);
      context.putImageData(image, 0, 0);
      targetContext.drawImage(canvas, left, top);
      return true;
    },
  });
}

// Geometry fields are rendered by VKF's GPU path.  This is deliberately a
// separate renderer: callers must not silently fall back to per-pixel JS.
export function gpuColorFieldFragmentSource(expression) {
  return `#version 300 es
    precision highp float; in vec2 uv; out vec4 outColor;
    uniform vec2 origin, stepX, stepY, localOrigin, localStepX, localStepY; uniform float t,n,N; uniform int count; uniform int kind;
    uniform vec2 sourceP[32]; uniform vec4 sourceC[32]; uniform vec2 segA[32], segB[32];
    uniform sampler2D cmap, scalarGrid; uniform vec2 gridOrigin, gridSize;
    float evaluate(float x,float y,float r,float phi){ return float(${expression}); }
    vec4 blendPoint(vec2 q){ vec4 c=vec4(0.); float total=0.;
      for(int i=0;i<32;i++){ if(i>=count) break; vec2 d=q-sourceP[i]; float r=length(d); float w=max(0.,evaluate(d.x,d.y,r,atan(d.y,d.x))); c+=sourceC[i]*w; total+=w; }
      return total>0. ? c/total : sourceC[0]; }
    vec4 blendEdge(vec2 q){ vec4 c=vec4(0.); float total=0.;
      for(int i=0;i<32;i++){ if(i>=count) break; vec2 d=segB[i]-segA[i]; float h=clamp(dot(q-segA[i],d)/max(dot(d,d),1e-12),0.,1.); float r=distance(q,segA[i]+h*d); float w=max(0.,evaluate(r,0.,r,0.)); c+=sourceC[i]*w; total+=w; }
      return total>0. ? c/total : sourceC[0]; }
    vec4 coordinateMap(vec2 screenUv){ vec2 local=localOrigin+screenUv.x*localStepX+screenUv.y*localStepY; float v=clamp(evaluate(local.x,local.y,length(local),atan(local.y,local.x)),0.,1.); return texture(cmap,vec2(v,.5)); }
    vec4 scalarGridMap(vec2 q){ vec2 fieldUv=clamp((q-gridOrigin)/gridSize,vec2(0.),vec2(1.)); return texture(cmap,vec2(texture(scalarGrid,fieldUv).r,.5)); }
    void main(){ vec2 screenUv=vec2(uv.x,1.-uv.y); vec2 q=origin+screenUv.x*stepX+screenUv.y*stepY; outColor=kind==0?blendPoint(q):(kind==1?blendEdge(q):(kind==3?scalarGridMap(q):coordinateMap(screenUv))); }`;
}

export function createGpuColorFieldRenderer({ canvas, screenToWorld }) {
  if (!canvas || typeof screenToWorld !== 'function') {
    throw new TypeError('canvas and screenToWorld are required');
  }
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: true });
  if (!gl) throw new Error('gpu_color_field_unavailable');
  const vertexSource = `#version 300 es
    in vec2 p; out vec2 uv; void main(){ uv=p*.5+.5; gl_Position=vec4(p,0.,1.); }`;
  const programCache = new Map();
  const programFor = (expression) => {
    const key = expression || 'x';
    if (programCache.has(key)) return programCache.get(key);
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, gpuColorFieldFragmentSource(key));
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (name) => gl.getUniformLocation(program, name);
    const bundle = { program, uniforms: { origin:loc('origin'), stepX:loc('stepX'), stepY:loc('stepY'), t:loc('t'), n:loc('n'), N:loc('N'), count:loc('count'), kind:loc('kind'), sourceP:loc('sourceP'), sourceC:loc('sourceC'), segA:loc('segA'), segB:loc('segB'), localOrigin:loc('localOrigin'), localStepX:loc('localStepX'), localStepY:loc('localStepY'), cmap:loc('cmap'), scalarGrid:loc('scalarGrid'), gridOrigin:loc('gridOrigin'), gridSize:loc('gridSize') } };
    programCache.set(key, bundle);
    return bundle;
  };
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const cmapTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, cmapTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const scalarGridTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, scalarGridTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return Object.freeze({
    draw({ targetContext, field, screenPoints = [], targetSize = [] }) {
      if (!targetContext || screenPoints.length < 3) return false;
      const left=Math.max(0,Math.floor(Math.min(...screenPoints.map(([x])=>x))));
      const top=Math.max(0,Math.floor(Math.min(...screenPoints.map(([,y])=>y))));
      const right=Math.min(targetSize[0]??canvas.width,Math.ceil(Math.max(...screenPoints.map(([x])=>x))));
      const bottom=Math.min(targetSize[1]??canvas.height,Math.ceil(Math.max(...screenPoints.map(([,y])=>y))));
      const width=right-left,height=bottom-top; if(width<=0||height<=0)return false;
      const evaluator = field.kind === 'coordinate-colormap'
        ? field.evaluatorGlsl
        : field.kind === 'scalar-grid-colormap' ? 'x' : field.weightEvaluator?.__colorModeGlsl;
      if (!evaluator) throw new Error('gpu_color_field_expression_unavailable');
      const { program, uniforms } = programFor(evaluator);
      canvas.width=width; canvas.height=height; gl.viewport(0,0,width,height); gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer); const p=gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
      const { origin, spanX, spanY } = colorFieldQuadWorldFrame({
        left, top, width, height, screenToWorld,
      });
      const sx=[origin[0]+spanX[0],origin[1]+spanX[1]], sy=[origin[0]+spanY[0],origin[1]+spanY[1]];
      gl.uniform2f(uniforms.origin, ...origin); gl.uniform2f(uniforms.stepX, ...spanX); gl.uniform2f(uniforms.stepY, ...spanY);
      const localOrigin=typeof field.worldToLocal==='function'?field.worldToLocal(origin):origin;
      const localX=typeof field.worldToLocal==='function'?field.worldToLocal(sx):sx;
      const localY=typeof field.worldToLocal==='function'?field.worldToLocal(sy):sy;
      gl.uniform2f(uniforms.localOrigin, ...localOrigin); gl.uniform2f(uniforms.localStepX, localX[0]-localOrigin[0],localX[1]-localOrigin[1]); gl.uniform2f(uniforms.localStepY, localY[0]-localOrigin[0],localY[1]-localOrigin[1]);
      const variables = field.kind === 'coordinate-colormap'
        ? field.evaluatorVariables || {}
        : field.weightEvaluator?.__colorModeVariables || {};
      gl.uniform1f(uniforms.t, Number(field.time || 0));
      gl.uniform1f(uniforms.n, Number(variables.n || 0));
      gl.uniform1f(uniforms.N, Math.max(1, Number(variables.N || 1)));
      if (field.kind === 'coordinate-colormap') {
        const rgba = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i += 1) {
          const sample = field.sampler?.(i / 255) || [128,128,128,255];
          for (let channel = 0; channel < 4; channel += 1) rgba[i * 4 + channel] = Math.round(Math.max(0, Math.min(255, Number(sample[channel] ?? (channel === 3 ? 255 : 128)))));
        }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cmapTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        gl.uniform1i(uniforms.cmap, 0);
      }
      if (field.kind === 'scalar-grid-colormap') {
        const grid = field.grid || {};
        const columns = positiveInteger(grid.shape?.[0], 'grid columns');
        const rows = positiveInteger(grid.shape?.[1], 'grid rows');
        const values = Array.from(grid.values || [], Number);
        if (values.length !== columns * rows || values.some((value) => !Number.isFinite(value))) {
          throw new TypeError('scalar grid values must match its shape');
        }
        const domain = grid.domain || [Math.min(...values), Math.max(...values)];
        const span = Number(domain[1]) - Number(domain[0]);
        const normalized = new Uint8Array(values.map((value) => Math.round(255 * (span > 0
          ? clamp01((value - Number(domain[0])) / span)
          : 0))));
        const xBounds = grid.bounds?.x || [0, 1], yBounds = grid.bounds?.y || [0, 1];
        gl.uniform2f(uniforms.gridOrigin, Number(xBounds[0]), Number(yBounds[0]));
        gl.uniform2f(uniforms.gridSize, Number(xBounds[1]) - Number(xBounds[0]), Number(yBounds[1]) - Number(yBounds[0]));
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, scalarGridTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, columns, rows, 0, gl.RED, gl.UNSIGNED_BYTE, normalized);
        gl.uniform1i(uniforms.scalarGrid, 1);
        const rgba = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i += 1) {
          const sample = field.sampler?.(i / 255) || [128,128,128,255];
          for (let channel = 0; channel < 4; channel += 1) rgba[i * 4 + channel] = Math.round(Math.max(0, Math.min(255, Number(sample[channel] ?? (channel === 3 ? 255 : 128)))));
        }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cmapTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        gl.uniform1i(uniforms.cmap, 0);
      }
      const colors=(field.colors||[]).map(parseCssRgba).slice(0,32); const n=Math.max(1,colors.length); gl.uniform1i(uniforms.count,n); gl.uniform1i(uniforms.kind,field.kind==='point-distance'?0:(field.kind==='edge-distance'?1:(field.kind==='scalar-grid-colormap'?3:2)));
      const points=(field.points||[]).slice(0,32).flat(); gl.uniform2fv(uniforms.sourceP,new Float32Array(points.length?points:[0,0]));
      gl.uniform4fv(uniforms.sourceC,new Float32Array((colors.length?colors:[[.5,.5,.5,1]]).flat().concat(new Array(Math.max(0,32-colors.length)*4).fill(0))));
      const a=(field.segments||[]).map(s=>s[0]).slice(0,32).flat(), b=(field.segments||[]).map(s=>s[1]).slice(0,32).flat(); gl.uniform2fv(uniforms.segA,new Float32Array(a.length?a:[0,0])); gl.uniform2fv(uniforms.segB,new Float32Array(b.length?b:[0,0]));
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4); targetContext.drawImage(canvas,left,top); return true;
    }
  });
}

function compile(gl, type, source) { const shader=gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader); if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; }
function parseCssRgba(value){
  const source=String(value||'').trim();
  const hex=source.match(/^#([0-9a-f]{6})$/i);
  if(hex)return [0,1,2].map(i=>parseInt(hex[1].slice(i*2,i*2+2),16)/255).concat(1);
  const rgb=source.match(/^rgba?\(([^)]+)\)/i);
  if(rgb){
    const channels=rgb[1].match(/[\d.]+/g)?.slice(0,3);
    if(channels?.length===3)return channels.map(Number).map(v=>v>1?v/255:v).concat(1);
  }
  return [.5,.5,.5,1];
}

function subtractPoint(point, origin) {
  return [point[0] - origin[0], point[1] - origin[1]];
}

function setBoundedCache(cache, key, value, maximumSize = 64) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maximumSize) cache.delete(cache.keys().next().value);
}

function sameNumbers(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizedWeightedRgb(weights, colors) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return [...(colors[0] || FALLBACK_RGB)];
  return [0, 1, 2].map((channel) => Math.round(colors.reduce(
    (sum, color, index) => sum + (color?.[channel] ?? FALLBACK_RGB[channel]) * weights[index],
    0,
  ) / total));
}

function positiveWeight(evaluator, variables) {
  if (typeof evaluator !== 'function') return 0;
  try {
    const value = Number(evaluator(variables));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function pointToSegmentDistance(point, [from, to]) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared <= Number.EPSILON
    ? 0
    : Math.max(0, Math.min(1, (
        (point[0] - from[0]) * dx + (point[1] - from[1]) * dy
      ) / lengthSquared));
  return distance(point, [from[0] + dx * projection, from[1] + dy * projection]);
}

function parseCssRgb(value) {
  const source = String(value || '').trim();
  const shortHex = source.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) return [...shortHex[1]].map((digit) => parseInt(digit + digit, 16));
  const hex = source.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 1, 2].map((index) => parseInt(hex[1].slice(index * 2, index * 2 + 2), 16));
  const rgb = source.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  return rgb ? rgb.slice(1, 4).map(Number) : [...FALLBACK_RGB];
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive integer`);
  return number;
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
