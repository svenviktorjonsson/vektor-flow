import {
  cameraRangesForFrame,
  createBrowserPeerAdapter,
  fixtureView,
  installLargeBufferUploadTracker,
  prepareHost,
} from './browser-common.mjs';

export const VTK_JS_VERSION = '36.10.0';

export function vtkXyzPositions(points, pointCount) {
  if (!(points instanceof Float32Array) || points.length < pointCount * 2) {
    throw new TypeError('VTK.js positions must contain packed float32 x/y values');
  }
  const xyz = new Float32Array(pointCount * 3);
  for (let index = 0; index < pointCount; index += 1) {
    xyz[index * 3] = points[index * 2];
    xyz[index * 3 + 1] = points[index * 2 + 1];
  }
  return xyz;
}

export function createVtkJsLargeSceneAdapter(host, workload, options = {}) {
  prepareHost(host, workload);
  const fixture = fixtureView(workload, options.fixtureBytes);
  const tracker = options.tracker ?? installLargeBufferUploadTracker(workload.pointCount * 4);
  let vtk = null;
  let generic = null;
  let actor = null;

  function setCamera(frame) {
    const ranges = cameraRangesForFrame(workload, frame);
    const aspect = workload.viewport[0] / workload.viewport[1];
    const camera = generic.getRenderer().getActiveCamera();
    camera.setParallelProjection(true);
    camera.setParallelScale((ranges.y[1] - ranges.y[0]) / 2);
    camera.setPosition(ranges.offset[0] * aspect, ranges.offset[1], 1);
    camera.setFocalPoint(ranges.offset[0] * aspect, ranges.offset[1], 0);
    camera.setViewUp(0, 1, 0);
    camera.setClippingRange(0.1, 10);
  }

  return createBrowserPeerAdapter({
    version: VTK_JS_VERSION,
    host,
    workload,
    fixture,
    tracker,
    async initializeImpl() {
      if (!options.dependencies) {
        await import('@kitware/vtk.js/Rendering/Profiles/Geometry.js');
        await import('@kitware/vtk.js/Rendering/OpenGL/SphereMapper.js');
      }
      vtk = options.dependencies ?? {
        GenericRenderWindow: (await import('@kitware/vtk.js/Rendering/Misc/GenericRenderWindow.js')).default,
        PolyData: (await import('@kitware/vtk.js/Common/DataModel/PolyData.js')).default,
        SphereMapper: (await import('@kitware/vtk.js/Rendering/Core/SphereMapper.js')).default,
        Actor: (await import('@kitware/vtk.js/Rendering/Core/Actor.js')).default,
      };
      generic = vtk.GenericRenderWindow.newInstance({
        listenWindowResize: false,
        background: workload.backgroundRgba.slice(0, 3).map((value) => value / 255),
      });
      generic.setContainer(host);
      generic.resize();
      generic.getApiSpecificRenderWindow().setSize(...workload.viewport);
      const polyData = vtk.PolyData.newInstance();
      polyData.getPoints().setData(vtkXyzPositions(fixture.points, workload.pointCount), 3);
      const mapper = vtk.SphereMapper.newInstance({
        radius: workload.pointDiameterPixels / workload.viewport[1],
      });
      mapper.setInputData(polyData);
      actor = vtk.Actor.newInstance();
      actor.setMapper(mapper);
      actor.setScale(workload.viewport[0] / workload.viewport[1], 1, 1);
      const property = actor.getProperty();
      property.setColor(...workload.pointRgba.slice(0, 3).map((value) => value / 255));
      property.setOpacity(workload.pointRgba[3] / 255);
      property.setAmbient(1);
      property.setDiffuse(0);
      property.setSpecular(0);
      generic.getRenderer().addActor(actor);
      setCamera(0);
      generic.getRenderWindow().render();
    },
    async renderFrameImpl(frame) {
      setCamera(frame);
      generic.getRenderWindow().render();
    },
    debugImpl() {
      const renderer = generic?.getRenderer();
      const camera = renderer?.getActiveCamera();
      return {
        actors: renderer?.getActors?.().length,
        visible: actor?.getVisibility?.(),
        bounds: actor?.getBounds?.(),
        camera: camera ? {
          position: camera.getPosition(),
          focalPoint: camera.getFocalPoint(),
          parallelScale: camera.getParallelScale(),
          clippingRange: camera.getClippingRange(),
        } : null,
      };
    },
    async destroyImpl() { generic?.delete(); },
  });
}
