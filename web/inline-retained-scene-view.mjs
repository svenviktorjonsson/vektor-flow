function retainedPacket(packet) {
  return packet
    && packet.schema === "vektor-flow/retained-scene-arena"
    && packet.version === 1
    && packet.metadata?.schema === "vektor-flow/retained-scene-arena"
    && packet.metadata?.version === 1
    && typeof packet.metadata?.scene?.frame === "string"
    && packet.arena instanceof Uint8Array;
}

export function mountRetainedSceneResult(container, packets, {
  document = globalThis.document,
  VfFrame = globalThis.VfFrame,
  VfDisplay = globalThis.VfDisplay,
} = {}) {
  if (!Array.isArray(packets) || packets.length === 0 ||
      !packets.every(retainedPacket)) {
    throw new TypeError("retained scene arena schema is missing or unsupported");
  }
  if (!container || typeof container.append !== "function" ||
      !document || typeof document.createElement !== "function" ||
      !VfFrame || typeof VfFrame.mount !== "function" ||
      !VfDisplay || typeof VfDisplay.renderRetainedSceneArena !== "function") {
    throw new Error("native VfFrame/VfDisplay retained renderer is unavailable");
  }
  const layer = document.createElement("div");
  layer.className = "readme-example-retained-layer";
  container.append(layer);
  const frames = [];
  for (const packet of packets) {
    const frame = VfFrame.mount(layer, {
      id: packet.metadata.scene.frame,
      title: "",
      frameless: true,
      draggable: false,
      dockable: false,
      resizable: false,
      closable: false,
      alpha: 1,
    });
    frame?.body?.classList?.add("vf-frame__body--transparent");
    frames.push(frame);
    VfDisplay.renderRetainedSceneArena(packet);
  }
  return () => {
    for (const frame of frames) frame?.root?.remove?.();
    layer.remove?.();
  };
}
