import assert from "node:assert/strict";
import test from "node:test";

import {
  CIE_1931_2_DEGREE_DATASET,
  integrateSpectralVisibleColorReference,
} from "../../web/vf-ui/vf-spectral-visible-color.mjs";

const tolerance = 1.0e-9;

test(
  "CIE integration maps visible radiance to bounded XYZ and linear RGB",
  () => {
    const equalEnergy = integrateSpectralVisibleColorReference([
      { wavelengthNm: 380, radiance: 1.0 },
      { wavelengthNm: 780, radiance: 1.0 },
    ]);
    const blueBand = integrateSpectralVisibleColorReference([
      { wavelengthNm: 440, radiance: 0.0 },
      { wavelengthNm: 450, radiance: 1.0 },
      { wavelengthNm: 460, radiance: 0.0 },
    ]);
    const infrared = integrateSpectralVisibleColorReference([
      { wavelengthNm: 850, radiance: 1.0 },
      { wavelengthNm: 900, radiance: 1.0 },
    ]);

    assert.equal(equalEnergy.kind, "spectral-visible-color:v1");
    assert.equal(
      equalEnergy.observer,
      "CIE 1931 2 degree standard colorimetric observer",
    );
    assert.equal(CIE_1931_2_DEGREE_DATASET.doi, "10.25039/CIE.DS.xvudnb9b");
    assert.equal(CIE_1931_2_DEGREE_DATASET.stepNm, 5);
    assert.ok(Math.abs(equalEnergy.unclippedXyz[1] - 1.0) <= tolerance);
    for (const channel of equalEnergy.xyz) {
      assert.ok(channel >= 0.0);
      assert.ok(channel <= 1.0);
    }
    for (const channel of equalEnergy.linearRgb) {
      assert.ok(channel >= 0.0);
      assert.ok(channel <= 1.0);
    }
    assert.ok(blueBand.linearRgb[2] > blueBand.linearRgb[0]);
    assert.ok(blueBand.linearRgb[2] > blueBand.linearRgb[1]);
    assert.deepEqual(infrared.xyz, [0.0, 0.0, 0.0]);
    assert.deepEqual(infrared.linearRgb, [0.0, 0.0, 0.0]);
    assert.equal(infrared.visibleRadianceIntegral, 0.0);
    assert.equal(infrared.infraredRadianceIntegral, 50.0);

    assert.throws(
      () => integrateSpectralVisibleColorReference([
        { wavelengthNm: 600, radiance: 0.5 },
        { wavelengthNm: 500, radiance: 0.5 },
      ]),
      /strictly ascending/u,
    );
    assert.throws(
      () => integrateSpectralVisibleColorReference([
        { wavelengthNm: 500, radiance: -0.1 },
        { wavelengthNm: 600, radiance: 0.5 },
      ]),
      /radiance must be from 0 through 1/u,
    );
  },
);
