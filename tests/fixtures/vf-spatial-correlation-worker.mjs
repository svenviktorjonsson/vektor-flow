import {
  parentPort,
  workerData,
} from 'node:worker_threads';

import {
  conditionChild,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from '../../web/vf-ui/vf-spatial-correlation.mjs';

const node = conditionChild(
  createConditionedRoot(workerData.identity),
  workerData.child,
);

parentPort.postMessage(workerData.queries.map(({ index, position }) => ({
  index,
  value: sampleSpatialCorrelation2Reference(node, position, workerData.options),
})));
