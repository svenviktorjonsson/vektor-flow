import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLayeredScreenScene,
  SCREEN_SCENE_LAYER
} from '../../web/vf-ui/vf-layered-screen-scene.mjs';

test('layered scene commits faces, edges, vertices, overlays, then selection', () => {
  let committed = [];
  const scene = createLayeredScreenScene({
    retained: {
      replace: (records) => { committed = records; },
      commit: () => true,
      invalidate() {}
    }
  });
  scene.beginFrame();
  scene.primitive('root', 'selected', { kind: 'edge' }, { selection: true });
  scene.primitive('root', 'vertex', { kind: 'vertex' });
  scene.primitive('root', 'face', { kind: 'face' });
  scene.primitive('root', 'overlay', { kind: 'edge' }, { overlay: true });
  scene.primitive('root', 'edge', { kind: 'edge' });
  assert.equal(scene.commit({}), true);
  assert.deepEqual(committed.map(([id]) => id), [
    'root:face', 'root:edge', 'root:vertex', 'root:overlay', 'root:selection:selected'
  ]);
  assert.equal(SCREEN_SCENE_LAYER.SELECTION, 4);
});
