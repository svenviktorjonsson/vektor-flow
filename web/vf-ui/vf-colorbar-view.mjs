import { normalizeColorScale } from './vf-color-scale.mjs';
import axis2dTicks from './vf-axis2d-ticks.mjs';

export function createColorbarPresentation({
  id = '',
  labelLatex = 'c',
  classification = 'scalar-field',
  colorScale = {},
  colormapPoints = []
} = {}) {
  const scale = normalizeColorScale(colorScale);
  const isComplex = classification === 'complex-field';
  const editableDomain = isComplex ? scale.magnitudeDomain : scale.domain;
  const ticks = formatColorbarTicks(editableDomain);
  const axisTicks = createColorbarAxisTicks(editableDomain);
  const gradient = isComplex
    ? createHorizontalColormapGradient(colormapPoints)
    : createVerticalColormapGradient(colormapPoints, scale.mode);
  const repeated = scale.mode === 'cyclic' ? ', repeated cyclically' : '';
  return Object.freeze({
    id: String(id),
    classification: isComplex ? 'complex-field' : 'scalar-field',
    isComplex,
    labelLatex: String(labelLatex || 'c'),
    colorScale: scale,
    gradient,
    ticks,
    axisTicks,
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

export function createColorbarAxisTicks(domain = [0, 1], {
  extent = 240,
  targetSpacing = 52
} = {}) {
  const [minimum, maximum] = normalizeColorScale({ domain }).domain;
  const pixelExtent = Math.max(1, Number(extent) || 240);
  const step = axis2dTicks.chooseAxisTickStep(
    (maximum - minimum) / pixelExtent,
    targetSpacing,
    [1, 2, 5],
    targetSpacing * 0.72,
    targetSpacing * 1.45
  );
  const values = axis2dTicks.axisTickValuesForMode(
    minimum, maximum, step, null, 'linear', false, [1, 2, 5],
    pixelExtent, targetSpacing, targetSpacing * 0.72, targetSpacing * 1.45
  );
  const span = maximum - minimum;
  return Object.freeze(values.map((value) => Object.freeze({
    value,
    unit: (value - minimum) / span,
    label: axis2dTicks.formatAxisTickLabel(value, step),
    latex: colorbarTickLatex(axis2dTicks.formatAxisTickLabel(value, step))
  })));
}

export function createHorizontalColormapGradient(points = []) {
  const normalized = normalizeColormapPoints(points);
  if (normalized.length === 0) return 'linear-gradient(to right, transparent 0%, transparent 100%)';
  const stops = normalized.map((point) =>
    `${cssColor({ ...point, alpha: 1 })} ${formatPercentage(point.pos)}`);
  stops.push(`${cssColor({ ...normalized[0], alpha: 1 })} 100%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function panColorbarDomain(domain, deltaPosition, extent) {
  const [minimum, maximum] = normalizeColorScale({ domain }).domain;
  const size = validExtent(extent);
  const delta = Number(deltaPosition);
  if (!Number.isFinite(delta)) throw new TypeError('colorbar pan delta must be finite');
  const shift = -delta / size * (maximum - minimum);
  return Object.freeze([minimum + shift, maximum + shift]);
}

export function zoomColorbarDomain(domain, anchorPosition, extent, factor) {
  const [minimum, maximum] = normalizeColorScale({ domain }).domain;
  const size = validExtent(extent);
  const anchor = clamp(Number(anchorPosition) / size, 0, 1);
  const zoom = Number(factor);
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError('colorbar zoom factor must be positive');
  }
  const span = maximum - minimum;
  const anchorValue = minimum + anchor * span;
  const nextSpan = span * zoom;
  const nextMinimum = anchorValue - anchor * nextSpan;
  return Object.freeze([nextMinimum, nextMinimum + nextSpan]);
}

export function createColorbarView({
  document: documentRef = globalThis.document,
  onDomainChange = () => {},
  renderLabel = (element, latex) => { element.textContent = latex; },
  gestureController = createColorbarGestureController()
} = {}) {
  if (!documentRef?.createElement) {
    throw new TypeError('createColorbarView requires a DOM document');
  }
  if (typeof onDomainChange !== 'function') {
    throw new TypeError('onDomainChange must be a function');
  }
  if (typeof renderLabel !== 'function') {
    throw new TypeError('renderLabel must be a function');
  }

  const root = documentRef.createElement('figure');
  const panel = documentRef.createElement('div');
  const axis = documentRef.createElement('div');
  const gradient = documentRef.createElement('div');
  const phaseAxis = documentRef.createElement('div');
  const labelViewport = documentRef.createElement('figcaption');
  const axisLabel = documentRef.createElement('span');
  let binding = null;
  let destroyed = false;

  root.className = 'vf-colorbar';
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.style.cssText = [
    'display:block',
    'margin:0',
    'touch-action:none',
    'user-select:none'
  ].join(';');
  panel.className = 'vf-colorbar__panel';
  panel.style.cssText = [
    'display:grid',
    'grid-template-columns:minmax(32px,auto) 40px 52px',
    'grid-template-rows:minmax(96px,1fr)',
    'align-items:center',
    'gap:0',
    'height:100%'
  ].join(';');
  axis.className = 'vf-colorbar__axis';
  axis.style.cssText = 'position:relative;height:100%;min-height:96px';
  gradient.className = 'vf-colorbar__gradient';
  gradient.setAttribute('role', 'img');
  gradient.tabIndex = 0;
  gradient.style.cssText = [
    'width:40px',
    'min-height:96px',
    'border:1px solid currentColor',
    'box-sizing:border-box',
    'touch-action:none',
    'user-select:none'
  ].join(';');
  labelViewport.className = 'vf-colorbar__label-viewport';
  phaseAxis.className = 'vf-colorbar__phase-axis';
  phaseAxis.hidden = true;
  axisLabel.className = 'vf-colorbar__label';
  labelViewport.append(axisLabel);
  panel.append(axis, gradient, phaseAxis, labelViewport);
  root.append(panel);

  const pointerBinding = bindPointerGestures(gradient, {
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
      labelLatex: presentation.labelLatex,
      classification: presentation.classification,
      isComplex: presentation.isComplex,
      editableDomain: presentation.isComplex
        ? presentation.colorScale.magnitudeDomain
        : presentation.colorScale.domain,
      colorScale: presentation.colorScale,
      colormapPoints: Object.freeze([...(nextBinding.colormapPoints ?? [])])
    });
    root.hidden = false;
    root.dataset.colorbarId = presentation.id;
    root.classList?.toggle?.('vf-colorbar--complex', presentation.isComplex);
    root.setAttribute('aria-label', presentation.ariaLabel);
    gradient.setAttribute('aria-label', presentation.ariaLabel);
    gradient.style.background = presentation.isComplex ? '' : presentation.gradient;
    gradient.style.setProperty?.('--vf-complex-phase-gradient', presentation.gradient);
    panel.style.gridTemplateColumns = presentation.isComplex
      ? 'minmax(32px,auto) 80px 52px'
      : 'minmax(32px,auto) 40px 52px';
    panel.style.gridTemplateRows = presentation.isComplex
      ? 'minmax(96px,1fr) 24px'
      : 'minmax(96px,1fr)';
    gradient.style.width = presentation.isComplex ? '80px' : '40px';
    renderAxisTicks(axis, createColorbarAxisTicks(
      presentation.colorScale.domain,
      { extent: gradient.getBoundingClientRect?.().height || 240 }
    ), documentRef, renderLabel);
    if (presentation.isComplex) {
      renderAxisTicks(axis, createColorbarAxisTicks(
        presentation.colorScale.magnitudeDomain,
      { extent: gradient.getBoundingClientRect?.().height || 240 }
      ), documentRef, renderLabel);
      phaseAxis.hidden = false;
      renderPhaseTicks(phaseAxis, documentRef, renderLabel);
    } else {
      phaseAxis.hidden = true;
      phaseAxis.replaceChildren?.();
    }
    renderLabel(axisLabel, presentation.labelLatex);
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
      [binding.isComplex ? 'magnitudeDomain' : 'domain']: domain
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
  onDomainChange,
  getInteractionBounds = () => element.getBoundingClientRect()
}) {
  const activePointers = new Map();
  let singlePointerBaseline = null;

  function gestureInput() {
    const current = getBinding();
    if (!current || activePointers.size !== 2) return null;
    const bounds = getInteractionBounds();
    return Object.freeze({
      domain: current.editableDomain,
      extent: bounds.height,
      contacts: Object.freeze([...activePointers.values()].map((event) =>
        Object.freeze({
          pointerId: event.pointerId,
          position: bounds.bottom - event.clientY
        })))
    });
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function pointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointers.set(event.pointerId, event);
    consume(event);
    element.setPointerCapture?.(event.pointerId);
    if (activePointers.size === 2) {
      singlePointerBaseline = null;
      const input = gestureInput();
      if (input) onDomainChange(gestureController.begin(input), false);
      return;
    }
    if (event.pointerType !== 'touch') {
      const bounds = getInteractionBounds();
      singlePointerBaseline = Object.freeze({
        pointerId: event.pointerId,
        domain: getBinding()?.editableDomain,
        extent: bounds.height,
        position: bounds.bottom - event.clientY
      });
    }
  }

  function pointerMove(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, event);
    consume(event);
    if (activePointers.size === 2) {
      const input = gestureInput();
      if (input) onDomainChange(gestureController.update(input), false);
      return;
    }
    if (singlePointerBaseline?.pointerId === event.pointerId) {
      const bounds = getInteractionBounds();
      const position = bounds.bottom - event.clientY;
      onDomainChange(panColorbarDomain(
        singlePointerBaseline.domain,
        position - singlePointerBaseline.position,
        singlePointerBaseline.extent
      ), false);
    }
  }

  function finish(cancelled, event) {
    if (!activePointers.has(event.pointerId)) return;
    consume(event);
    if (activePointers.size === 2) {
      onDomainChange(
        cancelled ? gestureController.cancel() : gestureController.end(),
        !cancelled
      );
    } else if (singlePointerBaseline?.pointerId === event.pointerId) {
      onDomainChange(
        cancelled ? singlePointerBaseline.domain : getBinding()?.editableDomain,
        !cancelled
      );
    }
    singlePointerBaseline = null;
    activePointers.delete(event.pointerId);
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  }

  function wheel(event) {
    const current = getBinding();
    if (!current) return;
    consume(event);
    const bounds = getInteractionBounds();
    const deltaUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
    const delta = clamp(Number(event.deltaY) * deltaUnit, -1000, 1000);
    const factor = Math.exp(delta * 0.001);
    onDomainChange(zoomColorbarDomain(
      current.editableDomain,
      bounds.bottom - event.clientY,
      bounds.height,
      factor
    ), true);
  }

  const listeners = {
    pointerdown: pointerDown,
    pointermove: pointerMove,
    pointerup: (event) => finish(false, event),
    pointercancel: (event) => finish(true, event),
    wheel
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
      singlePointerBaseline = null;
    }
  });
}

function renderAxisTicks(axis, ticks, documentRef, renderLabel) {
  if (axis.replaceChildren) axis.replaceChildren();
  else axis.children.length = 0;
  for (const tick of ticks) {
    const node = documentRef.createElement('span');
    node.className = 'vf-colorbar__tick';
    renderLabel(node, tick.latex);
    node.style.cssText = [
      'position:absolute',
      'right:0',
      `bottom:${tick.unit * 100}%`,
      'transform:translateY(50%)',
      'font-variant-numeric:tabular-nums'
    ].join(';');
    axis.append(node);
  }
}

function renderPhaseTicks(axis, documentRef, renderLabel) {
  if (axis.replaceChildren) axis.replaceChildren();
  else axis.children.length = 0;
  for (const tick of [
    { unit: 0, latex: '0' },
    { unit: 0.5, latex: '\\pi' },
    { unit: 1, latex: '2\\pi' }
  ]) {
    const node = documentRef.createElement('span');
    node.className = 'vf-colorbar__phase-tick';
    renderLabel(node, tick.latex);
    node.style.cssText = [
      'position:absolute',
      `left:${tick.unit * 100}%`,
      'top:0',
      'transform:translateX(-50%)',
      'white-space:nowrap'
    ].join(';');
    axis.append(node);
  }
}

function colorbarTickLatex(label) {
  const normalized = String(label).replaceAll('−', '-');
  const scientific = normalized.match(/^(.+?)[eE]([+-]?\d+)$/);
  return scientific
    ? `${scientific[1]}\\times 10^{${Number(scientific[2])}}`
    : normalized;
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
