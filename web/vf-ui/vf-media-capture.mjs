export function createSceneMediaCapture(options = {}) {
  const requestStream = options.requestStream || ((request) => requestSceneCaptureStream({
    ...request,
    fallbackCanvas: options.fallbackCanvas,
    frameRate: options.frameRate
  }));
  const captureFrame = options.captureFrame || captureVideoFrame;
  const createRecorder = options.createRecorder || defaultRecorder;
  const wait = options.wait || delay;
  const setClean = options.setClean || (() => {});
  let movie = null;

  async function screenshot({ delayMs = 0 } = {}) {
    if (movie) throw new Error('A movie capture is already active');
    const stream = await requestStream({ kind: 'image' });
    setClean(true, 'image');
    try {
      await wait(Math.max(0, Number(delayMs) || 0));
      return await captureFrame(stream, options);
    } finally {
      stopStream(stream);
      setClean(false, 'image');
    }
  }

  async function startMovie({ delayMs = 0 } = {}) {
    if (movie) return false;
    const stream = await requestStream({ kind: 'video' });
    setClean(true, 'video');
    try {
      await wait(Math.max(0, Number(delayMs) || 0));
      const recording = createRecorder(stream, options);
      movie = { stream, recording };
      recording.start();
      return true;
    } catch (error) {
      stopStream(stream);
      setClean(false, 'video');
      throw error;
    }
  }

  async function stopMovie() {
    if (!movie) return null;
    const active = movie;
    movie = null;
    try {
      return await active.recording.stop();
    } finally {
      stopStream(active.stream);
      setClean(false, 'video');
    }
  }

  function cancel() {
    if (!movie) return false;
    const active = movie;
    movie = null;
    active.recording.cancel?.();
    stopStream(active.stream);
    setClean(false, 'video');
    return true;
  }

  return Object.freeze({
    screenshot,
    startMovie,
    stopMovie,
    cancel,
    get recording() { return movie != null; }
  });
}

export async function copyCapturedMedia(blob, {
  clipboard = globalThis.navigator?.clipboard,
  ClipboardItemClass = globalThis.ClipboardItem,
  fallbackText = ''
} = {}) {
  if (clipboard?.write && ClipboardItemClass) {
    try {
      await clipboard.write([new ClipboardItemClass({ [blob.type]: blob })]);
      return 'blob';
    } catch (error) {
      if (!clipboard?.writeText || !fallbackText) throw error;
    }
  }
  if (clipboard?.writeText && fallbackText) {
    await clipboard.writeText(fallbackText);
    return 'url';
  }
  throw new Error('Media clipboard is unavailable');
}

export function writeCapturedMediaDrag(dataTransfer, { blob, url, filename }) {
  if (!dataTransfer || !url) return false;
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData('text/uri-list', url);
  dataTransfer.setData('DownloadURL', `${blob.type}:${filename}:${url}`);
  return true;
}

export function downloadCapturedMedia({ url, filename }, documentRef = globalThis.document) {
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

export async function requestSceneCaptureStream({
  kind = 'image',
  mediaDevices = globalThis.navigator?.mediaDevices,
  fallbackCanvas = null,
  frameRate = 60
} = {}) {
  const canvas = typeof fallbackCanvas === 'function' ? fallbackCanvas() : fallbackCanvas;
  if (kind === 'video' && canvas?.captureStream) return canvas.captureStream(frameRate);
  if (mediaDevices?.getDisplayMedia) {
    return mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', cursor: 'never' },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude'
    });
  }
  if (canvas?.captureStream) return canvas.captureStream(frameRate);
  throw new Error('Scene capture is unavailable');
}

async function captureVideoFrame(stream, options = {}) {
  const documentRef = options.document || globalThis.document;
  const video = documentRef.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  await nextPaint();
  const canvas = documentRef.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  video.srcObject = null;
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Screenshot encoding failed')),
    'image/png'
  ));
}

function defaultRecorder(stream, options = {}) {
  const Recorder = options.MediaRecorderClass || globalThis.MediaRecorder;
  if (!Recorder) throw new Error('Movie capture is unavailable');
  const mimeType = supportedMovieType(Recorder);
  const recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  let stopped = null;
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) chunks.push(event.data);
  });
  return {
    start() { recorder.start(250); },
    stop() {
      stopped ||= new Promise((resolve, reject) => {
        recorder.addEventListener('error', () => reject(recorder.error || new Error('Movie capture failed')), { once: true });
        recorder.addEventListener('stop', () => resolve(new Blob(chunks, {
          type: recorder.mimeType || mimeType || 'video/webm'
        })), { once: true });
        recorder.stop();
      });
      return stopped;
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
    }
  };
}

function supportedMovieType(Recorder) {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((type) => typeof Recorder.isTypeSupported !== 'function' || Recorder.isTypeSupported(type)) || '';
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nextPaint() {
  return new Promise((resolve) => (globalThis.requestAnimationFrame || setTimeout)(resolve));
}
