export interface PixelImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type HashImageInput = Uint8Array | PixelImage;

const CANONICAL_WIDTH = 32;
const CANONICAL_HEIGHT = 32;
const DCT_SIZE = 8;
const HASH_BIT_LENGTH = DCT_SIZE * DCT_SIZE;

export function computeHash(image: HashImageInput): string {
  const grayscale = toCanonicalGrayscale(image);
  const dct = computeDct2d(grayscale, CANONICAL_WIDTH, CANONICAL_HEIGHT);
  const coefficients = collectTopLeftCoefficients(dct, DCT_SIZE);
  const median = getMedian(coefficients.slice(1));
  const bits = coefficients.map((value) => (value >= median ? '1' : '0')).join('');
  return binaryToHex(bits);
}

export function compareHashes(hashA: string, hashB: string): number {
  const normalizedA = normalizeHashToBinary(hashA);
  const normalizedB = normalizeHashToBinary(hashB);

  if (normalizedA.length !== normalizedB.length) {
    throw new Error('Hash lengths must match for Hamming distance comparison.');
  }

  let distance = 0;
  for (let index = 0; index < normalizedA.length; index += 1) {
    if (normalizedA[index] !== normalizedB[index]) {
      distance += 1;
    }
  }

  return distance;
}

export function isSameEdition(hashA: string, hashB: string, tolerance = 10): boolean {
  return compareHashes(hashA, hashB) <= tolerance;
}

function toCanonicalGrayscale(input: HashImageInput): number[] {
  const source = toGrayscale(input);
  if (source.width === CANONICAL_WIDTH && source.height === CANONICAL_HEIGHT) {
    return source.pixels;
  }

  return resizeNearestNeighbor(source.pixels, source.width, source.height, CANONICAL_WIDTH, CANONICAL_HEIGHT);
}

function toGrayscale(input: HashImageInput): { width: number; height: number; pixels: number[] } {
  if (isPixelImage(input)) {
    return {
      width: input.width,
      height: input.height,
      pixels: rgbaToGrayscale(input.data, input.width, input.height)
    };
  }

  return {
    width: CANONICAL_WIDTH,
    height: CANONICAL_HEIGHT,
    pixels: byteStreamToGrayscale(input, CANONICAL_WIDTH * CANONICAL_HEIGHT)
  };
}

function isPixelImage(value: HashImageInput): value is PixelImage {
  return typeof value === 'object' && !(value instanceof Uint8Array) && 'width' in value && 'height' in value && 'data' in value;
}

function rgbaToGrayscale(data: Uint8Array, width: number, height: number): number[] {
  const totalPixels = width * height;
  const expectedRgbaLength = totalPixels * 4;
  const pixels: number[] = new Array(totalPixels);

  if (data.length >= expectedRgbaLength) {
    for (let index = 0; index < totalPixels; index += 1) {
      const rgbaOffset = index * 4;
      const red = data[rgbaOffset];
      const green = data[rgbaOffset + 1];
      const blue = data[rgbaOffset + 2];
      pixels[index] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    }
    return pixels;
  }

  const fallback = byteStreamToGrayscale(data, totalPixels);
  for (let index = 0; index < totalPixels; index += 1) {
    pixels[index] = fallback[index];
  }

  return pixels;
}

function byteStreamToGrayscale(data: Uint8Array, totalPixels: number): number[] {
  if (data.length === 0) {
    return new Array(totalPixels).fill(0);
  }

  const pixels = new Array<number>(totalPixels);
  const stride = data.length / totalPixels;

  for (let index = 0; index < totalPixels; index += 1) {
    const sampleStart = Math.floor(index * stride);
    const sampleEnd = Math.max(sampleStart + 1, Math.floor((index + 1) * stride));

    let sum = 0;
    let count = 0;
    for (let cursor = sampleStart; cursor < sampleEnd && cursor < data.length; cursor += 1) {
      sum += data[cursor];
      count += 1;
    }

    pixels[index] = count > 0 ? Math.round(sum / count) : data[sampleStart % data.length];
  }

  return pixels;
}

function resizeNearestNeighbor(
  source: number[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): number[] {
  const resized = new Array<number>(targetWidth * targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth));
      resized[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX];
    }
  }

  return resized;
}

function computeDct2d(source: number[], width: number, height: number): number[] {
  const result = new Array<number>(width * height).fill(0);

  for (let u = 0; u < width; u += 1) {
    const alphaU = u === 0 ? Math.sqrt(1 / width) : Math.sqrt(2 / width);
    for (let v = 0; v < height; v += 1) {
      const alphaV = v === 0 ? Math.sqrt(1 / height) : Math.sqrt(2 / height);
      let sum = 0;

      for (let x = 0; x < width; x += 1) {
        const cosX = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * width));
        for (let y = 0; y < height; y += 1) {
          const cosY = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * height));
          sum += source[y * width + x] * cosX * cosY;
        }
      }

      result[v * width + u] = alphaU * alphaV * sum;
    }
  }

  return result;
}

function collectTopLeftCoefficients(dct: number[], size: number): number[] {
  const coefficients: number[] = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      coefficients.push(dct[y * CANONICAL_WIDTH + x]);
    }
  }

  return coefficients;
}

function getMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  return sorted[midpoint];
}

function normalizeHashToBinary(hash: string): string {
  const normalized = hash.trim().toLowerCase();

  if (/^[01]+$/.test(normalized) && normalized.length === HASH_BIT_LENGTH) {
    return normalized;
  }

  if (/^[01]+$/.test(normalized) && normalized.length !== HASH_BIT_LENGTH / 4) {
    if (normalized.length !== HASH_BIT_LENGTH) {
      throw new Error(`Binary hash must be ${HASH_BIT_LENGTH} bits.`);
    }
  }

  if (/^[0-9a-f]+$/.test(normalized)) {
    if (normalized.length !== HASH_BIT_LENGTH / 4) {
      throw new Error(`Hex hash must be ${HASH_BIT_LENGTH / 4} chars.`);
    }

    return normalized
      .split('')
      .map((char) => Number.parseInt(char, 16).toString(2).padStart(4, '0'))
      .join('');
  }

  throw new Error('Unsupported hash format. Use 64-bit binary or 16-char hex.');
}

function binaryToHex(binary: string): string {
  if (binary.length !== HASH_BIT_LENGTH || !/^[01]+$/.test(binary)) {
    throw new Error(`Binary hash must be ${HASH_BIT_LENGTH} bits.`);
  }

  let hex = '';
  for (let index = 0; index < binary.length; index += 4) {
    const nibble = binary.slice(index, index + 4);
    hex += Number.parseInt(nibble, 2).toString(16);
  }

  return hex;
}
