import { parentPort, workerData } from 'node:worker_threads';

import {
  deriveDemandStream,
  sampleDemandStreamU32,
} from '../../web/vf-ui/vf-demand-random.mjs';

const stream = deriveDemandStream(workerData.identity);
parentPort.postMessage(
  workerData.samples.map((sample) => sampleDemandStreamU32(stream, sample)),
);
