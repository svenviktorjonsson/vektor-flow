import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createColorbarGestureController,
  createColorbarPresentation,
  createColorbarView,
  createVerticalColormapGradient,
  formatColorbarTicks,
} from '../../web/vf-ui/vf-colorbar-view.mjs';

const contacts = (first, second, reverse = false) => {
  const pair = [
    { pointerId: 1, position: first },
    { pointerId: 2, position: second },
  ];
  return reverse ? pair.reverse() : pair;
};

function valueAt(domain, position, extent = 100) {
  return domain[0] + position / extent * (domain[1] - domain[0]);
}

test('colorbar presentation renders stable ticks and a vertical cyclic gradient', () => {
  const presentation = createColorbarPresentation({
    id: 'field-1',
    colorScale: { domain: [-2, 2], mode: 'cyclic' },
    colormapPoints: [
      { pos: 0, color: [255, 0, 0], alpha: 1 },
      { pos: 0.5, color: [0, 0, 255], alpha: 0.5 },
    ],
  });

  assert.deepEqual(presentation.ticks, { minimum: '-2.00', maximum: '2.00' });
  assert.match(presentation.gradient, /^linear-gradient\(to top,/);
  assert.match(presentation.gradient, /rgba\(255, 0, 0, 1\) 100%/);
  assert.match(presentation.ariaLabel, /repeated cyclically$/);
  assert.equal(
    createVerticalColormapGradient([], 'clamp'),
    'linear-gradient(to top, transparent 0%, transparent 100%)'
  );
  assert.deepEqual(formatColorbarTicks([0, 0.000001]), {
    minimum: '0.00e0',
    maximum: '1.00e-6',
  });
});

test('axis-neutral gesture pans while preserving both touched scalar values', () => {
  const gesture = createColorbarGestureController();
  gesture.begin({ domain: [0, 1], extent: 100, contacts: contacts(25, 75) });
  const domain = gesture.update({ contacts: contacts(35, 85) });

  assert.ok(Math.abs(domain[0] + 0.1) < 1e-12);
  assert.ok(Math.abs(domain[1] - 0.9) < 1e-12);
  assert.ok(Math.abs(valueAt(domain, 35) - 0.25) < 1e-12);
  assert.ok(Math.abs(valueAt(domain, 85) - 0.75) < 1e-12);
  assert.deepEqual(gesture.end(), domain);
});

test('axis-neutral gesture zooms independent of contact array order', () => {
  const gesture = createColorbarGestureController();
  gesture.begin({ domain: [-1, 1], extent: 100, contacts: contacts(25, 75) });
  const domain = gesture.update({ contacts: contacts(0, 100, true) });

  assert.ok(Math.abs(domain[0] + 0.5) < 1e-12);
  assert.ok(Math.abs(domain[1] - 0.5) < 1e-12);
  assert.ok(Math.abs(valueAt(domain, 0) + 0.5) < 1e-12);
  assert.ok(Math.abs(valueAt(domain, 100) - 0.5) < 1e-12);
});

test('DOM colorbar updates, hides, destroys, and publishes two-pointer domains', () => {
  const document = createFakeDocument();
  const changes = [];
  const view = createColorbarView({
    document,
    onDomainChange: (scale, metadata) => changes.push({ scale, metadata }),
  });
  const presentation = view.update({
    id: 'scalar-field',
    colorScale: { domain: [0, 1], magnitudeDomain: [0, 4], mode: 'cyclic' },
    colormapPoints: [
      { pos: 0, color: [0, 0, 0], alpha: 1 },
      { pos: 1, color: [255, 255, 255], alpha: 1 },
    ],
  });

  assert.equal(view.element.hidden, false);
  assert.equal(view.element.dataset.colorbarId, 'scalar-field');
  assert.equal(presentation.colorScale.mode, 'cyclic');

  view.element.dispatch('pointerdown', pointer(1, 75));
  view.element.dispatch('pointerdown', pointer(2, 25));
  view.element.dispatch('pointermove', pointer(1, 65));
  view.element.dispatch('pointermove', pointer(2, 15));
  view.element.dispatch('pointerup', pointer(1, 65));

  const last = changes.at(-1);
  assert.equal(last.metadata.committed, true);
  assert.equal(last.scale.mode, 'cyclic');
  assert.deepEqual(last.scale.magnitudeDomain, [0, 4]);
  assert.ok(Math.abs(last.scale.domain[0] + 0.1) < 1e-12);
  assert.ok(Math.abs(last.scale.domain[1] - 0.9) < 1e-12);

  assert.equal(view.hide(), null);
  assert.equal(view.element.hidden, true);
  assert.equal(view.element.dataset.colorbarId, undefined);
  view.destroy();
  assert.equal(view.element.removed, true);
  assert.throws(() => view.update({}), /destroyed/);
});

function pointer(pointerId, clientY) {
  return {
    pointerId,
    clientY,
    preventDefault() {},
    stopPropagation() {},
  };
}

function createFakeDocument() {
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.hidden = false;
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.captured = new Set();
    this.children = [];
    this.removed = false;
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'data-colorbar-id') delete this.dataset.colorbarId;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 100, height: 100 };
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
  }

  remove() {
    this.removed = true;
  }
}
