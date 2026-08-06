import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POINTER_DOWN_ACTIONS,
  SELECTION_INTERACTION_EFFECTS,
  SELECTION_INTERACTION_INTENTS,
  createSelectionInteractionFsm,
  pointerDownAction
} from '../../web/vf-ui/vf-selection-interaction.mjs';

test('normalizes secondary mouse input without authoring geometry', () => {
  assert.equal(pointerDownAction({ pointerType: 'mouse', button: 0 }), POINTER_DOWN_ACTIONS.AUTHOR);
  assert.equal(pointerDownAction({ pointerType: 'mouse', button: 2 }), POINTER_DOWN_ACTIONS.SECONDARY);
  assert.equal(pointerDownAction({ pointerType: 'touch', button: 2 }), POINTER_DOWN_ACTIONS.IGNORE);
});

test('secondary click cancels while secondary drag commits a marquee', () => {
  const fsm = createSelectionInteractionFsm({ dragThreshold: 4 });
  fsm.dispatch({
    type: SELECTION_INTERACTION_INTENTS.SECONDARY_STARTED,
    pointerId: 7,
    screen: [10, 20],
    operation: 'replace'
  });
  assert.deepEqual(fsm.dispatch({
    type: SELECTION_INTERACTION_INTENTS.SECONDARY_COMMITTED,
    pointerId: 7,
    screen: [11, 21]
  }), [{ type: SELECTION_INTERACTION_EFFECTS.CANCEL, reason: 'pointer.secondary' }]);

  fsm.dispatch({
    type: SELECTION_INTERACTION_INTENTS.SECONDARY_STARTED,
    pointerId: 8,
    screen: [30, 40],
    operation: 'union'
  });
  assert.deepEqual(fsm.dispatch({
    type: SELECTION_INTERACTION_INTENTS.SECONDARY_MOVED,
    pointerId: 8,
    screen: [42, 55]
  }), [{
    type: SELECTION_INTERACTION_EFFECTS.MARQUEE_BEGIN,
    pointerId: 8,
    operation: 'union',
    rectangle: { left: 30, top: 40, right: 42, bottom: 55 }
  }]);
  assert.deepEqual(fsm.dispatch({
    type: SELECTION_INTERACTION_INTENTS.SECONDARY_COMMITTED,
    pointerId: 8,
    screen: [44, 58]
  }), [{
    type: SELECTION_INTERACTION_EFFECTS.MARQUEE_COMMIT,
    pointerId: 8,
    operation: 'union',
    rectangle: { left: 30, top: 40, right: 44, bottom: 58 }
  }]);
});

test('select all is a canonical selection effect', () => {
  const fsm = createSelectionInteractionFsm();
  assert.deepEqual(fsm.dispatch({
    type: SELECTION_INTERACTION_INTENTS.SELECT_ALL,
    reason: 'keyboard.select-all'
  }), [{
    type: SELECTION_INTERACTION_EFFECTS.SELECT_ALL,
    reason: 'keyboard.select-all'
  }]);
});
