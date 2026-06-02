interface StitchSize {
  width: number;
  height: number;
}

export interface HorizontalStitchLayout {
  targetHeight: number;
  firstWidth: number;
  secondWidth: number;
  overlapWidth: number;
  secondOffsetX: number;
  canvasWidth: number;
}

interface StitchOptions {
  overlapRatio?: number;
  quality?: number;
}

interface StitchDeps {
  createCanvas?: () => HTMLCanvasElement;
  createImage?: () => HTMLImageElement;
}

const DEFAULT_OVERLAP_RATIO = 0.18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRatio(ratio?: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_OVERLAP_RATIO;
  }

  return clamp(Number(ratio), 0, 0.45);
}

export function computeHorizontalStitchLayout(first: StitchSize, second: StitchSize, overlapRatio = DEFAULT_OVERLAP_RATIO): HorizontalStitchLayout {
  const firstWidth = Math.max(1, Math.round(first.width));
  const firstHeight = Math.max(1, Math.round(first.height));
  const secondWidth = Math.max(1, Math.round(second.width));
  const secondHeight = Math.max(1, Math.round(second.height));
  const ratio = normalizeRatio(overlapRatio);

  const targetHeight = Math.max(1, Math.min(firstHeight, secondHeight));
  const scaledFirstWidth = Math.max(1, Math.round((firstWidth * targetHeight) / firstHeight));
  const scaledSecondWidth = Math.max(1, Math.round((secondWidth * targetHeight) / secondHeight));
  const overlapWidth = Math.max(0, Math.round(Math.min(scaledFirstWidth, scaledSecondWidth) * ratio));
  const secondOffsetX = Math.max(0, scaledFirstWidth - overlapWidth);
  const canvasWidth = Math.max(1, secondOffsetX + scaledSecondWidth);

  return {
    targetHeight,
    firstWidth: scaledFirstWidth,
    secondWidth: scaledSecondWidth,
    overlapWidth,
    secondOffsetX,
    canvasWidth,
  };
}

async function loadImage(dataUrl: string, createImage: () => HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode cue stitch image."));
    image.src = dataUrl;
  });
}

export async function stitchCueImagesWithOverlap(
  firstDataUrl: string,
  secondDataUrl: string,
  options?: StitchOptions,
  deps?: StitchDeps,
): Promise<string> {
  if (!firstDataUrl || !secondDataUrl) {
    return firstDataUrl || secondDataUrl;
  }

  if (typeof document === "undefined") {
    return firstDataUrl;
  }

  try {
    const createImage = deps?.createImage ?? (() => new Image());
    const firstImage = await loadImage(firstDataUrl, createImage);
    const secondImage = await loadImage(secondDataUrl, createImage);

    const layout = computeHorizontalStitchLayout(
      { width: firstImage.naturalWidth, height: firstImage.naturalHeight },
      { width: secondImage.naturalWidth, height: secondImage.naturalHeight },
      options?.overlapRatio,
    );

    const canvas = (deps?.createCanvas ?? (() => document.createElement("canvas")))();
    canvas.width = layout.canvasWidth;
    canvas.height = layout.targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return firstDataUrl;
    }

    ctx.drawImage(firstImage, 0, 0, layout.firstWidth, layout.targetHeight);
    ctx.drawImage(secondImage, layout.secondOffsetX, 0, layout.secondWidth, layout.targetHeight);

    return canvas.toDataURL("image/jpeg", clamp(options?.quality ?? 0.9, 0.6, 0.98));
  } catch {
    return firstDataUrl;
  }
}
