"use client";

export class CameraPermissionError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "unavailable" | "insecure" | "unsupported",
  ) {
    super(message);
    this.name = "CameraPermissionError";
  }
}

export interface CameraOptions {
  readonly deviceId?: string;
  readonly facingMode?: "user" | "environment";
  readonly width?: number;
  readonly height?: number;
}

/**
 * Camera capture.
 *
 * Requests a modest resolution on purpose: the overlay is drawn in CSS pixels
 * and the motion analysis runs on a heavily downscaled copy, so a 4K stream
 * would cost battery and decode time to produce nothing extra.
 */
export async function openCamera(options: CameraOptions = {}): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const insecure = typeof window !== "undefined" && !window.isSecureContext;
    throw new CameraPermissionError(
      insecure
        ? "Camera access needs a secure context — use https:// or localhost."
        : "This browser does not expose camera input.",
      insecure ? "insecure" : "unsupported",
    );
  }

  const video: MediaTrackConstraints = {
    width: { ideal: options.width ?? 1280 },
    height: { ideal: options.height ?? 720 },
    frameRate: { ideal: 30, max: 30 },
  };
  if (options.deviceId) video.deviceId = { exact: options.deviceId };
  else if (options.facingMode) video.facingMode = options.facingMode;

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new CameraPermissionError(
        "Camera access was blocked. Allow it in your browser's site settings and try again.",
        "denied",
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new CameraPermissionError("No usable camera was found.", "unavailable");
    }
    throw error;
  }
}

export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
}

/**
 * Pulls downscaled frames out of a video element for analysis.
 *
 * Produces greyscale for edges and motion, and a parallel "warmth" channel —
 * 128 + (R - B) — for the neck detector. Greyscale alone cannot tell a dark
 * fretboard from dark blinds, a dark shirt or an unlit television, all of which
 * produced confident false detections on real photographs; wood is warm and
 * those are not. One subtraction per pixel, taken from data already in hand.
 *
 * The sample size is tiny (160x90 by default) because frame differencing does
 * not benefit from resolution — it benefits from running often and cheaply.
 * Drawing the video into a small canvas lets the GPU do the scaling.
 */
export class GreyscaleSampler {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private grey: Uint8ClampedArray;
  private warm: Uint8ClampedArray;

  constructor(
    readonly width = 160,
    readonly height = 90,
  ) {
    this.grey = new Uint8ClampedArray(width * height);
    this.warm = new Uint8ClampedArray(width * height);
  }

  /** Warmth channel from the most recent `sample()`. */
  get warmth(): Uint8ClampedArray {
    return this.warm;
  }

  /** Returns null until the video has real dimensions to sample. */
  sample(video: HTMLVideoElement): Uint8ClampedArray | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    if (!this.context) {
      this.canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(this.width, this.height)
          : Object.assign(document.createElement("canvas"), {
              width: this.width,
              height: this.height,
            });
      this.context = this.canvas.getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!this.context) return null;
    }

    this.context.drawImage(video, 0, 0, this.width, this.height);
    const { data } = this.context.getImageData(0, 0, this.width, this.height);

    // Rec. 601 luma, plus warmth. Integer arithmetic: this runs every frame.
    for (let i = 0, p = 0; i < this.grey.length; i++, p += 4) {
      const r = data[p]!;
      const g = data[p + 1]!;
      const b = data[p + 2]!;
      this.grey[i] = (r * 77 + g * 150 + b * 29) >> 8;
      this.warm[i] = 128 + r - b;
    }
    return this.grey;
  }

  dispose(): void {
    this.canvas = null;
    this.context = null;
  }
}
