import { normalizeColorScale } from './vf-color-scale.mjs';

export function createColorbarPresentation({
  id = '',
  colorScale = {},
  colormapPoints = []
} = {}) {
  const scale = normalizeColorScale(colorScale);
  const ticks = formatColorbarTicks(scale.domain);
  const gradient = createVerticalColormapGradient(colormapPoints, scale.mode);
  const repeated = scale.mode === 'cyclic' ? ', repeated cyclically' : '';
  return Object.freeze({
    id: String(id),
    colorScale: scale,
    gradient,
    ticks,
    ariaLabel: `Color scale from ${ticks.minimum} to ${ticks.maximum}${repeated}`
  });
}

export function formatColorbarTicks(domain = [0, 1]) {
  const [minimum, maximum] = normalizeColorScale({ domain }).domain;
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  const useScientific = magnitude >= 1e7 || (magnitude > 0 && magnitude < 1e-5);
  const digits = stableFractionDigits(maximum - minimum);
  const format = useScientific
    ? (value) => normalizeExponent(value.toExponential(2))
    : (value) => normalizeNegativeZero(value.toFixed(digits));
  return Object.freeze({ minimum: format(minimum), maximum: format(maximum) });
}

export function createVerticalColormapGradient(points = [], mode = 'clamp') {
  const normalized = normalizeColormapPoints(points);
  if (normalized.length === 0) {
    return 'linear-gradient(to top, transparent 0%, transparent 100%)';
  }
  const stops = normalized.map((point) =>
    `${cssColor(point)} ${formatPercentage(point.pos)}`);
  if (mode === 'cyclic') {
    stops.push(`${cssColor(normalized[0])} 100%`);
  } else {
    if (normalized[0].pos > 0) stops.unshift(`${cssColor(normalized[0])} 0%`);
    if (normalized.at(-1).pos < 1) {
      stops.push(`${cssColor(normalized.at(-1))} 100%`);
    }
  }
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

export function createColorbarGestureController({ minimumSeparation = 1 } = {}) {
  if (!(Number.isFinite(minimumSeparation) && minimumSeparation > 0)) {
    throw new RangeError('colorbar gesture minimumSeparation must be positive');
  }
  let baseline = null;
  let current = null;

  function begin({ domain, extent, contacts } = {}) {
    const normalizedDomain = normalizeColorScale({ domain }).domain;
    const normalizedExtent = validExtent(extent);
    const normalizedContacts = contactPair(contacts);
    requireSeparated(normalizedContacts, minimumSeparation);
    baseline = Object.freeze({
      domain: normalizedDomain,
      extent: normalizedExtent,
      contacts: normalizedContacts
    });
    current = normalizedDomain;
    return current;
  }

  function update({ extent = baseline?.extent, contacts } = {}) {
    if (!baseline) throw new Error('colorbar gesture has not begun');
    const normalizedExtent = validExtent(extent);
    const moved = contactPair(contacts, baseline.contacts.map(({ pointerId }) => pointerId));
    const startById = new Map(
      baseline.contacts.map((contact) => [contact.pointerId, contact])
    );
    const [first, second] = moved;
    const startFirst = startById.get(first.pointerId);
    const startSecond = startById.get(second.pointerId);
    const distance = second.position - first.position;
    if (Math.abs(distance) < minimumSeparation) return current;

    const baselineSpan = baseline.domain[1] - baseline.domain[0];
    const firstValue = baseline.domain[0]
      + startFirst.position / baseline.extent * baselineSpan;
    const secondValue = baseline.domain[0]
      + startSecond.position / baseline.extent * baselineSpan;
    const nextSpan = (secondValue - firstValue) * normalizedExtent / distance;
    if (!(Number.isFinite(nextSpan) && nextSpan > 0)) return current;
    const minimum = firstValue - first.position / normalizedExtent * nextSpan;
    current = normalizeColorScale({ domain: [minimum, minimum + nextSpan] }).domain;
    return current;
  }

  function end() {
    const result = current;
    baseline = null;
    current = null;
    return result;
  }

  function cancel() {
    const result = baseline?.domain ?? null;
    baseline = null;
    current = null;
    return result;
  }

  return Object.freeze({ begin, update, end, cancel });
}

export function createColorbarView({
  document: documentRef = globalThis.document,
  onDomainChange = () => {},
  gestureController = createColorbarGestureController()
} = {}) {
  if (!documentRef?.createElement) {
    throw new TypeError('createColorbarView requires a DOM document');
  }
  if (typeof onDomainChange !== 'function') {
    throw new TypeError('onDomainChange must be a function');
  }

  const root = documentRef.createElement('figure');
  const maximumTick = documentRef.createElement('span');
  const gradient = documentRef.createElement('div');
  const minimumTick = documentRef.createElement('span');
  let binding = null;
  let destroyed = false;

  root.className = 'vf-colorbar';
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.style.cssText = [
    'display:grid',
    'grid-template-rows:auto minmax(96px,1fr) auto',
    'justify-items:end',
    'gap:4px',
    'margin:0',
    'touch-action:none',
    'user-select:none'
  ].join(';');
  gradient.className = 'vf-colorbar__gradient';
  gradient.setAttribute('role', 'img');
  gradient.tabIndex = 0;
  gradient.style.cssText = [
    'width:28px',
    'min-height:96px',
    'border:1px solid currentColor',
    'box-sizing:border-box'
  ].join(';');
  maximumTick.className = 'vf-colorbar__tick vf-colorbar__tick--maximum';
  minimumTick.className = 'vf-colorbar__tick vf-colorbar__tick--minimum';
  maximumTick.style.fontVariantNumeric = 'tabular-nums';
  minimumTick.style.fontVariantNumeric = 'tabular-nums';
  root.append(maximumTick, gradient, minimumTick);

  const pointerBinding = bindPointerGestures(root, {
    gestureController,
    getBinding: () => binding,
    onDomainChange: publishDomain
  });

  function update(nextBinding) {
    assertAlive();
    if (!nextBinding) return hide();
    const presentation = createColorbarPresentation(nextBinding);
    binding = Object.freeze({
      id: presentation.id,
      colorScale: presentation.colorScale,
      colormapPoints: Object.freeze([...(nextBinding.colormapPoints ?? [])])
    });
    root.hidden = false;
    root.dataset.colorbarId = presentation.id;
    root.setAttribute('aria-label', presentation.ariaLabel);
    gradient.setAttribute('aria-label', presentation.ariaLabel);
    gradient.style.background = presentation.gradient;
    maximumTick.textContent = presentation.ticks.maximum;
    minimumTick.textContent = presentation.ticks.minimum;
    return presentation;
  }

  function hide() {
    assertAlive();
    binding = null;
    root.hidden = true;
    root.removeAttribute('data-colorbar-id');
    return null;
  }

  function publishDomain(domain, committed) {
    if (!binding || !domain) return;
    const colorScale = normalizeColorScale({
      ...binding.colorScale,
      domain
    });
    binding = Object.freeze({ ...binding, colorScale });
    const presentation = update(binding);
    onDomainChange(colorScale, Object.freeze({
      id: binding.id,
      committed,
      presentation
    }));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    pointerBinding.destroy();
    binding = null;
    root.remove();
  }

  function assertAlive() {
    if (destroyed) throw new Error('colorbar view is destroyed');
  }

  return Object.freeze({ element: root, update, hide, destroy });
}

function bindPointerGestures(element, {
  gestureController,
  getBinding,
  onDomainChange
}) {
  const activePointers = new Map();

  function gestureInput() {
    const current = getBinding();
    if (!current || activePointers.size !== 2) return null;
    const bounds = element.getBoundingClientRect();
    return Object.freeze({
      domain: current.colorScale.domain,
      extent: bounds.height,
      contacts: Object.freeze([...activePointers.values()].map((event) =>
        Object.freeze({
          pointerId: event.pointerId,
          position: bounds.bottom - event.clientY
        })))
    });
  }

  function consume(event) {
    if (activePointers.size < 2) return false;
    event.preventDefault();
    event.stopPropagation();
    for (const pointerId of activePointers.keys()) {
      element.setPointerCapture?.(pointerId);
    }
    return true;
  }

  function pointerDown(event) {
    activePointers.set(event.pointerId, event);
    if (!consume(event)) return;
    const input = gestureInput();
    if (input) onDomainChange(gestureController.begin(input), false);
  }

  function pointerMove(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, event);
    if (!consume(event)) return;
    const input = gestureInput();
    if (input) onDomainChange(gestureController.update(input), false);
  }

  function finish(cancelled, event) {
    if (!activePointers.has(event.pointerId)) return;
    const wasGesture = consume(event);
    if (wasGesture) {
      onDomainChange(
        cancelled ? gestureController.cancel() : gestureController.end(),
        !cancelled
      );
    }
    activePointers.delete(event.pointerId);
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  }

  const listeners = {
    pointerdown: pointerDown,
    pointermove: pointerMove,
    pointerup: (event) => finish(false, event),
    pointercancel: (event) => finish(true, event)
  };
  for (const [type, listener] of Object.entries(listeners)) {
    element.addEventListener(type, listener);
  }

  return Object.freeze({
    destroy() {
      for (const [type, listener] of Object.entries(listeners)) {
        element.removeEventListener(type, listener);
      }
      activePointers.clear();
    }
  });
}

function normalizeColormapPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => Number.isFinite(point?.pos) && Array.isArray(point?.color))
    .map((point) => Object.freeze({
      pos: clamp(point.pos, 0, 1),
      color: Object.freeze([0, 1, 2].map((index) =>
        Math.round(clamp(Number(point.color[index]), 0, 255)))),
      alpha: clamp(Number.isFinite(point.alpha) ? point.alpha : 1, 0, 1)
    }))
    .sort((left, right) => left.pos - right.pos);
}

function stableFractionDigits(span) {
  if (!Number.isFinite(span) || span <= 0) return 2;
  return clamp(Math.ceil(-Math.log10(span)) + 2, 2, 8);
}

function cssColor(point) {
  const [red, green, blue] = point.color;
  return `rgba(${red}, ${green}, ${blue}, ${Number(point.alpha.toFixed(4))})`;
}

function formatPercentage(position) {
  return `${Number((position * 100).toFixed(4))}%`;
}

function normalizeNegativeZero(value) {
  return /^-0(?:\.0+)?$/.test(value) ? value.slice(1) : value;
}

function normalizeExponent(value) {
  return value.replace('e+', 'e');
}

function validExtent(extent) {
  if (!(Number.isFinite(extent) && extent > 0)) {
    throw new RangeError('colorbar gesture extent must be positive');
  }
  return extent;
}

function contactPair(contacts, requiredIds = null) {
  if (!Array.isArray(contacts) || contacts.length !== 2) {
    throw new TypeError('colorbar gesture requires exactly two contacts');
  }
  const pair = contacts.map((contact) => {
    if (contact?.pointerId == null || !Number.isFinite(contact.position)) {
      throw new TypeError('colorbar contacts require pointerId and finite position');
    }
    return Object.freeze({
      pointerId: contact.pointerId,
      position: contact.position
    });
  });
  if (pair[0].pointerId === pair[1].pointerId) {
    throw new TypeError('colorbar contacts require distinct pointer ids');
  }
  if (requiredIds) {
    const ids = new Set(pair.map(({ pointerId }) => pointerId));
    if (requiredIds.some((pointerId) => !ids.has(pointerId))) {
      throw new TypeError('colorbar gesture contacts changed');
    }
  }
  return Object.freeze(pair);
}

function requireSeparated(contacts, minimumSeparation) {
  if (Math.abs(contacts[1].position - contacts[0].position) < minimumSeparation) {
    throw new RangeError('colorbar gesture contacts are too close');
  }
}

function clamp(value, minimum, maximum) {
  const finite = Number.isFinite(value) ? value : minimum;
  return Math.max(minimum, Math.min(maximum, finite));
}
