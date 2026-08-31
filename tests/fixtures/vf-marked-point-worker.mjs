import {
  parentPort,
  workerData,
} from 'node:worker_threads';

import {
  conditionChild,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
  sampleMarkedPointCell2Reference,
} from '../../web/vf-ui/vf-marked-point-candidates.mjs';

const node = conditionChild(
  createConditionedRoot(workerData.identity),
  workerData.child,
);

parentPort.postMessage(workerData.cells.map((cell) => ({
  cell,
  candidates: sampleMarkedPointCell2Reference(node, cell, workerData.options),
})));
