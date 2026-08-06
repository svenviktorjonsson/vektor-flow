export const POINTER_DOWN_ACTIONS = Object.freeze({
  AUTHOR: 'author',
  SECONDARY: 'secondary',
  IGNORE: 'ignore'
});

export const SELECTION_INTERACTION_INTENTS = Object.freeze({
  SELECT_ALL: 'selection.all.request',
  SECONDARY_STARTED: 'selection.secondary.begin',
  SECONDARY_MOVED: 'selection.secondary.move',
  SECONDARY_COMMITTED: 'selection.secondary.commit',
  SECONDARY_CANCELLED: 'selection.secondary.cancel'
});

export const SELECTION_INTERACTION_EFFECTS = Object.freeze({
  SELECT_ALL: 'selection.all',
  CANCEL: 'selection.cancel',
  MARQUEE_BEGIN: 'selection.marquee.begin',
  MARQUEE_UPDATE: 'selection.marquee.update',
  MARQUEE_COMMIT: 'selection.marquee.commit',
  MARQUEE_CANCEL: 'selection.marquee.cancel'
});

export function pointerDownAction({ pointerType, button } = {}) {
  if (button == null || button === 0) return POINTER_DOWN_ACTIONS.AUTHOR;
  if (pointerType === 'mouse' && button === 2) return POINTER_DOWN_ACTIONS.SECONDARY;
  return POINTER_DOWN_ACTIONS.IGNORE;
}

export function createSelectionInteractionFsm({ dragThreshold = 4 } = {}) {
  const threshold = finiteNonNegative(dragThreshold, 'dragThreshold');
  let active = null;

  function dispatch(intent = {}) {
    if (intent.type === SELECTION_INTERACTION_INTENTS.SELECT_ALL) {
      return [{
        type: SELECTION_INTERACTION_EFFECTS.SELECT_ALL,
        reason: intent.reason || intent.type
      }];
    }
    if (intent.type === SELECTION_INTERACTION_INTENTS.SECONDARY_STARTED) {
      active = {
        pointerId: normalizedPointerId(intent.pointerId),
        origin: point(intent.screen),
        current: point(intent.screen),
        operation: intent.operation || 'replace',
        dragging: false
      };
      return [];
    }
    if (!matches(active, intent.pointerId)) return [];
    if (intent.type === SELECTION_INTERACTION_INTENTS.SECONDARY_MOVED) {
      active.current = point(intent.screen);
      const rectangle = normalizedRectangle(active.origin, active.current);
      if (!active.dragging) {
        if (distance(active.origin, active.current) < threshold) return [];
        active.dragging = true;
        return [marqueeEffect(SELECTION_INTERACTION_EFFECTS.MARQUEE_BEGIN, active, rectangle)];
      }
      return [marqueeEffect(SELECTION_INTERACTION_EFFECTS.MARQUEE_UPDATE, active, rectangle)];
    }
    if (intent.type === SELECTION_INTERACTION_INTENTS.SECONDARY_COMMITTED) {
      active.current = point(intent.screen, active.current);
      const completed = active;
      active = null;
      return completed.dragging
        ? [marqueeEffect(
            SELECTION_INTERACTION_EFFECTS.MARQUEE_COMMIT,
            completed,
            normalizedRectangle(completed.origin, completed.current)
          )]
        : [{ type: SELECTION_INTERACTION_EFFECTS.CANCEL, reason: 'pointer.secondary' }];
    }
    if (intent.type === SELECTION_INTERACTION_INTENTS.SECONDARY_CANCELLED) {
      const cancelled = active;
      active = null;
      return cancelled.dragging
        ? [marqueeEffect(
            SELECTION_INTERACTION_EFFECTS.MARQUEE_CANCEL,
            cancelled,
            normalizedRectangle(cancelled.origin, cancelled.current)
          )]
        : [];
    }
    throw new RangeError(`Unknown selection interaction intent: ${String(intent.type)}`);
  }

  function snapshot() {
    return active
      ? Object.freeze({
          active: true,
          pointerId: active.pointerId,
          operation: active.operation,
          dragging: active.dragging,
          rectangle: normalizedRectangle(active.origin, active.current)
        })
      : Object.freeze({ active: false, pointerId: null, operation: null, dragging: false, rectangle: null });
  }

  return Object.freeze({ dispatch, snapshot });
}

function marqueeEffect(type, active, rectangle) {
  return {
    type,
    pointerId: active.pointerId,
    operation: active.operation,
    rectangle
  };
}

function matches(active, pointerId) {
  return active?.pointerId === normalizedPointerId(pointerId);
}

function normalizedPointerId(pointerId) {
  return pointerId ?? null;
}

function point(value, fallback = null) {
  if (Array.isArray(value) && value.length >= 2
    && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return [value[0], value[1]];
  }
  if (fallback) return [...fallback];
  throw new TypeError('Selection interaction requires a finite screen point.');
}

function normalizedRectangle(a, b) {
  return Object.freeze({
    left: Math.min(a[0], b[0]),
    top: Math.min(a[1], b[1]),
    right: Math.max(a[0], b[0]),
    bottom: Math.max(a[1], b[1])
  });
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function finiteNonNegative(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be finite and non-negative.`);
  return number;
}
