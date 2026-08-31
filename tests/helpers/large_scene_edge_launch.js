function edgeLaunchArgs({ profile, port, url, gpuMode = 'swiftshader' }) {
  if (!['swiftshader', 'hardware'].includes(gpuMode)) {
    throw new RangeError(`large-scene GPU mode must be swiftshader or hardware, got ${gpuMode}`);
  }
  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--allow-file-access-from-files',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--edge-skip-compat-layer-relaunch',
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ];
  if (gpuMode === 'swiftshader') args.splice(6, 0, '--use-angle=swiftshader');
  return args;
}

module.exports = { edgeLaunchArgs };
