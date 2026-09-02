import {
  adaptWoodCutMaterialToTriangleFacesReference,
  attachWoodSpectralPresentationGpuReference,
} from "./vf-wood-material-renderer-packet.mjs";
import {
  presentWoodPolarizationVisibleReference,
} from "./vf-wood-polarization-presentation.mjs";
import {
  integrateWoodPolarizationVisibleReference,
} from "./vf-wood-polarization-visible.mjs";
import {
  createWoodSpectralPresentationGpuDescriptorReference,
} from "./vf-wood-spectral-presentation-gpu.mjs";

export function lowerProceduralWoodSpectralRendererReference(
  material,
  {
    polarization,
    polarizationGpuOutput,
    exposureStops,
    triangleBudget,
  },
) {
  const visible = integrateWoodPolarizationVisibleReference(
    polarization,
    polarizationGpuOutput,
  );
  const presentation = presentWoodPolarizationVisibleReference(
    visible,
    { exposureStops },
  );
  const descriptor =
    createWoodSpectralPresentationGpuDescriptorReference(
      polarization,
      presentation,
    );
  const trianglePacket = adaptWoodCutMaterialToTriangleFacesReference(
    material,
    { triangleBudget },
  );
  const rendererPacket = attachWoodSpectralPresentationGpuReference(
    trianglePacket,
    descriptor,
  );
  return Object.freeze({
    kind: "procedural-wood-spectral-lowering:v1",
    sourceMaterial: material,
    sourcePolarization: polarization,
    visible,
    presentation,
    descriptor,
    rendererPacket,
  });
}
