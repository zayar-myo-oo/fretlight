/**
 * Synthetic camera frames for testing the neck detector.
 *
 * Kept in src rather than in a test file so a detector playground or a
 * calibration benchmark can render the same scenes the unit tests assert on.
 */

export interface SyntheticNeckOptions {
  readonly width: number;
  readonly height: number;
  /** Neck axis angle in radians, 0 = horizontal. */
  readonly angle?: number;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly bandWidth?: number;
  readonly length?: number;
  readonly strings?: number;
  readonly frets?: number;
  readonly noise?: number;
  readonly seed?: number;
  /** Background clutter: long straight lines that are not the neck. */
  readonly distractorLines?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Renders a fretboard-like scene: a dark band bounded by two parallel edges,
 * filled with bright strings running along it and crossed by bright fret wires.
 */
export function renderSyntheticNeck(options: SyntheticNeckOptions): Uint8ClampedArray {
  const {
    width,
    height,
    angle = 0.12,
    centerX = width / 2,
    centerY = height / 2,
    bandWidth = Math.min(width, height) * 0.22,
    length = Math.max(width, height) * 0.8,
    strings = 4,
    frets = 7,
    noise = 6,
    seed = 3,
    distractorLines = 0,
  } = options;

  const random = mulberry32(seed);
  const image = new Uint8ClampedArray(width * height);

  // Background.
  for (let i = 0; i < image.length; i++) {
    image[i] = 150 + (random() * 2 - 1) * noise;
  }

  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  // Perpendicular to the axis.
  const perpX = -axisY;
  const perpY = axisX;

  const alongOf = (x: number, y: number) => (x - centerX) * axisX + (y - centerY) * axisY;
  const acrossOf = (x: number, y: number) => (x - centerX) * perpX + (y - centerY) * perpY;

  const halfWidth = bandWidth / 2;
  const halfLength = length / 2;

  // The fretboard: a dark band.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const along = alongOf(x, y);
      const across = acrossOf(x, y);
      if (Math.abs(along) <= halfLength && Math.abs(across) <= halfWidth) {
        image[y * width + x] = 42 + (random() * 2 - 1) * noise;
      }
    }
  }

  const plot = (x: number, y: number, value: number) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    image[py * width + px] = value;
  };

  // Strings: bright lines running along the neck.
  for (let s = 0; s < strings; s++) {
    const across = -halfWidth + ((s + 1) / (strings + 1)) * bandWidth;
    for (let t = -halfLength; t <= halfLength; t += 0.5) {
      const x = centerX + axisX * t + perpX * across;
      const y = centerY + axisY * t + perpY * across;
      plot(x, y, 225);
    }
  }

  // Fret wires: bright lines across the neck.
  for (let f = 1; f <= frets; f++) {
    const along = -halfLength + (f / (frets + 1)) * length;
    for (let t = -halfWidth; t <= halfWidth; t += 0.5) {
      const x = centerX + axisX * along + perpX * t;
      const y = centerY + axisY * along + perpY * t;
      plot(x, y, 235);
      plot(x + axisX, y + axisY, 200);
    }
  }

  // Optional clutter: long lines at unrelated angles, to check the detector is
  // not fooled by any strong straight edge in the room.
  for (let d = 0; d < distractorLines; d++) {
    const theta = random() * Math.PI;
    const offsetX = random() * width;
    const offsetY = random() * height;
    for (let t = -Math.max(width, height); t < Math.max(width, height); t += 0.5) {
      plot(offsetX + Math.cos(theta) * t, offsetY + Math.sin(theta) * t, 20);
    }
  }

  return image;
}

/** A frame with no neck in it — background texture and clutter only. */
export function renderEmptyScene(
  width: number,
  height: number,
  seed = 11,
  distractorLines = 3,
): Uint8ClampedArray {
  const random = mulberry32(seed);
  const image = new Uint8ClampedArray(width * height);
  for (let i = 0; i < image.length; i++) image[i] = 120 + random() * 40;

  for (let d = 0; d < distractorLines; d++) {
    const theta = random() * Math.PI;
    const offsetX = random() * width;
    const offsetY = random() * height;
    for (let t = -Math.max(width, height); t < Math.max(width, height); t += 0.5) {
      const px = Math.round(offsetX + Math.cos(theta) * t);
      const py = Math.round(offsetY + Math.sin(theta) * t);
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      image[py * width + px] = 30;
    }
  }
  return image;
}
