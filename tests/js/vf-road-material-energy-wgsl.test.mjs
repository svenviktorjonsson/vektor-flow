import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shaderUrl = new URL(
  '../../native/material/vf_road_material_energy.wgsl',
  import.meta.url,
);

function f32(value) {
  return Math.fround(value);
}

function dielectricF0(ior) {
  const ratio = f32(f32(ior - 1) / f32(ior + 1));
  return f32(ratio * ratio);
}

function evaluate(sample, cosine) {
  const aggregateF0 = dielectricF0(f32(1.56));
  const binderF0 = dielectricF0(f32(1.52));
  const waterF0 = dielectricF0(f32(4 / 3));
  const dryF0 = f32(
    f32(sample.aggregate * aggregateF0)
      + f32(sample.binder * binderF0),
  );
  const surfaceF0 = f32(
    dryF0 + f32(sample.water * f32(waterF0 - dryF0)),
  );
  const oneMinusCosine = f32(1 - cosine);
  const square = f32(oneMinusCosine * oneMinusCosine);
  const fourth = f32(square * square);
  const fifth = f32(fourth * oneMinusCosine);
  const fresnel = f32(
    surfaceF0 + f32(f32(1 - surfaceF0) * fifth),
  );
  return [surfaceF0, ...sample.albedo.map((albedo) => f32(
    fresnel + f32(f32(1 - fresnel) * albedo),
  ))];
}

test('road energy WGSL has exact native f32 reference outputs', async () => {
  const source = await readFile(shaderUrl, 'utf8');
  assert.match(source, /fn vkf_road_dielectric_f0\(/u);
  assert.match(source, /fn vkf_road_material_white_furnace\(/u);
  assert.match(source, /aggregate_fraction\s*\*\s*aggregate_f0/u);
  assert.match(source, /binder_fraction\s*\*\s*binder_f0/u);
  assert.match(source, /water_coverage\s*\*\s*\(water_f0\s*-\s*dry_f0\)/u);
  assert.match(source, /fresnel\s*\+\s*\(vec3<f32>\(1\.0\)\s*-\s*fresnel\)\s*\*\s*albedo/u);

  const sample = {
    aggregate: f32(0.55),
    binder: f32(0.35),
    water: f32(0.70),
    albedo: [f32(0.05), f32(0.04), f32(0.03)],
  };
  const values = [1, 0.75, 0.5, 0.25, 0]
    .flatMap((cosine) => evaluate(sample, f32(cosine)));
  const bytes = Buffer.from(new Float32Array(values).buffer);
  assert.equal(
    bytes.toString('hex'),
    '8c55da3c1e419a3df851863da6c5643d'
      + '8c55da3c8e1a9c3d6430883d758c683d'
      + '8c55da3c166fd53d691fc23dbdcfae3d'
      + '8c55da3c8be9963e811c933e784f8f3e'
      + '8c55da3c0000803f0000803f0000803f',
  );
});
