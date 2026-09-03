# 0.4.1 compiled rabbit startup baseline

Status: reproducible diagnostic baseline; the 500 ms release gate is RED.

## Scope

The staged compiled Stanford Bunny scene contains the compiler-emitted WASM,
WGSL, scene arena, parameter arena, two reflection depths for the floor and
upright mirror, shadows, reflected lighting, spectral emission, and Stokes
polarization transport. Edge runs fully off-screen with hardware WebGPU.

The benchmark measures process spawn through atomic reveal after the first GPU
submission completes. A new profile is used for the cold sample. The warm
sample starts a new Edge process after a graceful shutdown and reuses that
profile.

## Command

```powershell
node benchmarks/rabbit-startup/run.mjs `
  --pairs=1 `
  --scene=.w/program-polarized-v3-stage/sessions/app/vkf-scene.html `
  --output=.w/rabbit-startup-evidence/polarized-v3-graceful-warm.json
```

## Hardware result

Recorded on 2026-09-02 in the current Windows x64 development environment:

| Sample | Reveal | Navigation | Pipeline creation | GPU closure |
| --- | ---: | ---: | ---: | ---: |
| Cold profile | 6,162.0 ms | 1,006.7 ms | 1,868.9 ms | 3,731.9 ms |
| Warm profile | 2,632.0 ms | 949.6 ms | 54.2 ms | 937.9 ms |

Both samples were fully rendered, reported no runtime errors, closed the full
compiled dependency/reflection contract, and produced the same screenshot
SHA-256:

```text
737491b3c80fa173ed0367008d9b15c0eb0cd7fded1c744dcbefd98f4e2a97ae
```

The result does not pass the 500 ms gate. Cold pipeline compilation remains a
major renderer cost. Warm pipeline creation is already small; the warm result
shows that fresh Edge/WebGPU startup is now the dominant measured floor.

## Harness correction

The first warm measurements were invalid because PowerShell expanded the
short Windows profile path (`VIKTOR~1.JON`) before comparing it with Edge's
literal command line. Cleanup therefore failed to identify its own process,
and the following launch collided with the still-running profile.

The harness now compares the exact profile spelling used at process launch,
waits for `Browser.close` to finish, and only force-kills a process tree after
revalidating both its profile and debugging port. The focused contract suite
passes 14/14, and the real cold/warm pair completes with distinct processes.
