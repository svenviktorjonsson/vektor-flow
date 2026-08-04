export const ColorScaleMode = Object.freeze({
  CLAMP: 'clamp',
  CYCLIC: 'cyclic',
});

const DEFAULT_DOMAIN = Object.freeze([0, 1]);

export function normalizeColorScale(spec = {}) {
  const domain = normalizeDomain(spec.domain, 'domain');
  const magnitudeDomain = normalizeDomain(spec.magnitudeDomain, 'magnitudeDomain');
  const mode = spec.mode ?? ColorScaleMode.CLAMP;
  if (mode !== ColorScaleMode.CLAMP && mode !== ColorScaleMode.CYCLIC) {
    throw new TypeError(`Unsupported color scale mode: ${String(mode)}`);
  }
  return Object.freeze({ domain, magnitudeDomain, mode });
}

export function normalizeColorScaleValue(value, spec = {}) {
  const scale = normalizeColorScale(spec);
  return normalizeValue(value, scale.domain, scale.mode);
}

export function mapComplexColorScale(value, spec = {}) {
  const scale = normalizeColorScale(spec);
  const real = finiteNumber(value?.real, 'real');
  const imaginary = finiteNumber(value?.imaginary, 'imaginary');
  const phase = Math.atan2(imaginary, real);
  const magnitude = Math.hypot(real, imaginary);
  return Object.freeze({
    phase,
    position: applyMode((phase + Math.PI) / (2 * Math.PI), scale.mode),
    magnitude,
    alpha: normalizeValue(magnitude, scale.magnitudeDomain, ColorScaleMode.CLAMP),
  });
}

function normalizeDomain(domain = DEFAULT_DOMAIN, name) {
  if (!Array.isArray(domain) || domain.length !== 2) {
    throw new TypeError(`${name} must be a [min, max] pair`);
  }
  const min = finiteNumber(domain[0], `${name}[0]`);
  const max = finiteNumber(domain[1], `${name}[1]`);
  if (!(max > min)) throw new RangeError(`${name} max must be greater than min`);
  return Object.freeze([min, max]);
}

function normalizeValue(value, domain, mode) {
  const numeric = finiteNumber(value, 'value');
  return applyMode((numeric - domain[0]) / (domain[1] - domain[0]), mode);
}

function applyMode(value, mode) {
  if (mode === ColorScaleMode.CYCLIC) return ((value % 1) + 1) % 1;
  return Math.min(1, Math.max(0, value));
}

function finiteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
