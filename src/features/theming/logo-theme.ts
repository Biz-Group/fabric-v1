export type ExtractedRgb = {
  r: number;
  g: number;
  b: number;
};

type Bucket = {
  score: number;
  weight: number;
  r: number;
  g: number;
  b: number;
};

const SAMPLE_SIZE = 48;

function rgbToHsl(r: number, g: number, b: number): { s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;

  if (max === min) return { s: 0, l };

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  return { s, l };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load organization logo."));
    image.src = src;
  });
}

function bucketKey(r: number, g: number, b: number): string {
  return [r, g, b].map((channel) => Math.round(channel / 24)).join(":");
}

function pickAccentColor(data: Uint8ClampedArray): ExtractedRgb | null {
  const buckets = new Map<string, Bucket>();
  let fallbackWeight = 0;
  let fallbackR = 0;
  let fallbackG = 0;
  let fallbackB = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.25) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { s, l } = rgbToHsl(r, g, b);

    fallbackWeight += alpha;
    fallbackR += r * alpha;
    fallbackG += g * alpha;
    fallbackB += b * alpha;

    if (l > 0.94 && s < 0.16) continue;

    const midtoneBonus = 1 - Math.min(1, Math.abs(l - 0.52) * 1.6);
    const saturationBonus = 0.35 + s * 2.4;
    const alphaWeight = alpha * saturationBonus * (0.6 + midtoneBonus);
    const key = bucketKey(r, g, b);
    const bucket = buckets.get(key) ?? {
      score: 0,
      weight: 0,
      r: 0,
      g: 0,
      b: 0,
    };

    bucket.score += alphaWeight;
    bucket.weight += alphaWeight;
    bucket.r += r * alphaWeight;
    bucket.g += g * alphaWeight;
    bucket.b += b * alphaWeight;
    buckets.set(key, bucket);
  }

  const best = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
  if (best && best.weight > 0) {
    return {
      r: Math.round(best.r / best.weight),
      g: Math.round(best.g / best.weight),
      b: Math.round(best.b / best.weight),
    };
  }

  if (fallbackWeight === 0) return null;
  return {
    r: Math.round(fallbackR / fallbackWeight),
    g: Math.round(fallbackG / fallbackWeight),
    b: Math.round(fallbackB / fallbackWeight),
  };
}

export async function extractLogoAccentRgb(imageUrl: string): Promise<ExtractedRgb> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  const width = Math.max(1, Math.min(SAMPLE_SIZE, image.naturalWidth || SAMPLE_SIZE));
  const height = Math.max(1, Math.min(SAMPLE_SIZE, image.naturalHeight || SAMPLE_SIZE));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Logo color extraction is unavailable.");

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height).data;
  const accent = pickAccentColor(pixels);
  if (!accent) throw new Error("No usable logo pixels were found.");
  return accent;
}