"use client";

/**
 * Audio input selection.
 *
 * An honest note on the two "input types": the browser does not distinguish a
 * built-in microphone from a USB audio interface — both arrive as `audioinput`
 * devices through the same `getUserMedia` call, and both feed the *same*
 * downstream pipeline. There is no second implementation here and there must
 * never be one.
 *
 * The distinction is still worth surfacing, for two reasons that are real:
 *
 *  - **Finding the device.** A player with an interface plugged in wants to pick
 *    it, and "Scarlett Solo USB" buried in a flat list next to "MacBook Pro
 *    Microphone" is a worse experience than a type filter.
 *  - **Noise floor.** A DI signal from an interface is clean, so the gate can
 *    sit lower and catch quiet playing. A room microphone needs a higher floor
 *    or it spends the whole session analysing air conditioning.
 */
export type InputType = "microphone" | "audio_interface";

export interface AudioInputDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly groupId: string;
  /** Best guess at what kind of device this is. */
  readonly type: InputType;
  readonly isDefault: boolean;
}

/** Substrings that indicate an external interface rather than a built-in mic. */
const INTERFACE_HINTS = [
  "usb", "audio interface", "scarlett", "focusrite", "presonus", "audiobox",
  "behringer", "ur22", "steinberg", "motu", "apogee", "universal audio",
  "volt", "komplete audio", "audient", "id4", "id14", "zoom", "tascam",
  "line 6", "helix", "pod", "boss", "katana", "rocksmith", "guitar", "bass",
  "di box", "interface", "m-audio", "akai", "roland",
];

const BUILT_IN_HINTS = ["macbook", "built-in", "internal", "webcam", "display audio", "iphone"];

/**
 * Classify a device from its label.
 *
 * A heuristic, and labelled as one: device naming is entirely up to the vendor
 * and the OS. It only chooses which group a device appears under, so being wrong
 * costs the user one dropdown change and nothing else. Never let it silently
 * exclude a device.
 */
export function classifyDevice(label: string): InputType {
  const lower = label.toLowerCase();
  if (BUILT_IN_HINTS.some((hint) => lower.includes(hint))) return "microphone";
  if (INTERFACE_HINTS.some((hint) => lower.includes(hint))) return "audio_interface";
  return "microphone";
}

export async function listInputs(): Promise<AudioInputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({
      deviceId: device.deviceId,
      // Labels are empty until permission has been granted at least once.
      label: device.label || "Audio input",
      groupId: device.groupId,
      type: classifyDevice(device.label),
      isDefault: device.deviceId === "default" || device.deviceId === "",
    }));
}

/** Devices of one type, with everything still reachable from the other list. */
export function devicesOfType(
  devices: readonly AudioInputDevice[],
  type: InputType,
): AudioInputDevice[] {
  const matching = devices.filter((device) => device.type === type);
  // Never strand the user: if the heuristic found nothing of this type, show
  // everything rather than an empty dropdown they cannot escape from.
  return matching.length > 0 ? matching : [...devices];
}

/**
 * Watch for devices appearing and disappearing.
 *
 * Interfaces get unplugged mid-session, and a session that silently stops
 * working is worse than one that says the device went away.
 */
export function watchDevices(onChange: (devices: AudioInputDevice[]) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
    return () => {};
  }
  const handler = () => {
    void listInputs().then(onChange);
  };
  navigator.mediaDevices.addEventListener("devicechange", handler);
  return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
}

/**
 * Detection tuning that genuinely differs by input type.
 *
 * A DI signal has no room in it, so the gate can sit much lower and still never
 * trigger on nothing — which means quiet playing and long decays keep working.
 * A room microphone at the same threshold would analyse the fridge.
 */
export function noiseFloorFor(type: InputType): number {
  return type === "audio_interface" ? 0.0035 : 0.009;
}
