export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_ENCODED_LENGTH = 1_300_000;

/// Chain compositing operations. The fax bitmap is greyscale (255 = paper,
/// 0 = ink), so each op has a distinct collaborative posture:
///   stamp      — darken/min: your dark ink asserts over the chain.
///   ghost      — bitwise XOR: a hidden layer that only reveals where marks
///                interact (mirrors the XOR basis of the ECIES tray envelope).
///   illuminate — lighten/max: bright marks glow through dark areas.
export type ChainOp = 'stamp' | 'ghost' | 'illuminate';

export const CHAIN_OPS: { id: ChainOp; label: string; raw: string; hint: string }[] = [
  { id: 'ghost', label: 'Ghost', raw: 'Xor', hint: 'A hidden layer revealed only where marks interact (XOR).' },
  { id: 'illuminate', label: 'Illuminate', raw: 'Or', hint: 'Add light — bright marks glow through dark areas.' },
  { id: 'stamp', label: 'Stamp', raw: 'Copy', hint: 'Assert your ink over the chain (darken).' },
];

function stripDataUri(value: string): string {
  const comma = value.indexOf(',');
  return comma >= 0 ? value.slice(comma + 1) : value;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for compositing.'));
    img.src = src;
  });
}

/// Composite an overlay image onto a base fax bitmap using a chain operation.
/// Both are reduced to greyscale, scaled to the base dimensions, then combined
/// pixel-by-pixel. Returns a fax-sized JPEG (base64 + preview data URI).
export async function compositeChain(baseSrc: string, overlaySrc: string, op: ChainOp, negative = false): Promise<{ base64: string; preview: string; sizeKb: number }> {
  const [base, overlay] = await Promise.all([loadImage(baseSrc), loadImage(overlaySrc)]);
  const width = Math.max(1, base.naturalWidth || base.width);
  const height = Math.max(1, base.naturalHeight || base.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot operate the image processor.');

  ctx.drawImage(base, 0, 0, width, height);
  const baseData = ctx.getImageData(0, 0, width, height);

  // Draw the overlay WITHOUT stretching: preserve its aspect ratio and scale so
  // it fits entirely within the underlying fax (contain), centered. Areas not
  // covered stay white (paper) so they are neutral for every operation.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const ow = Math.max(1, overlay.naturalWidth || overlay.width);
  const oh = Math.max(1, overlay.naturalHeight || overlay.height);
  const containScale = Math.min(width / ow, height / oh);
  const dw = ow * containScale;
  const dh = oh * containScale;
  ctx.drawImage(overlay, (width - dw) / 2, (height - dh) / 2, dw, dh);
  const overData = ctx.getImageData(0, 0, width, height);

  if (negative) {
    const o = overData.data;
    for (let i = 0; i < o.length; i += 4) {
      o[i] = 255 - o[i];
      o[i + 1] = 255 - o[i + 1];
      o[i + 2] = 255 - o[i + 2];
      // alpha untouched
    }
  }

  const out = ctx.createImageData(width, height);
  const b = baseData.data;
  const o = overData.data;
  const r = out.data;
  for (let i = 0; i < b.length; i += 4) {
    const bg = Math.round(b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114);
    const og = Math.round(o[i] * 0.299 + o[i + 1] * 0.587 + o[i + 2] * 0.114);
    let v: number;
    if (op === 'stamp') v = Math.min(bg, og);
    else if (op === 'ghost') v = (bg ^ og) & 0xff;
    else v = Math.max(bg, og);
    r[i] = v;
    r[i + 1] = v;
    r[i + 2] = v;
    r[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);

  let dataUri = canvas.toDataURL('image/jpeg', 0.76);
  // Re-encode at lower quality if the composite exceeds the fax size cap.
  let quality = 0.76;
  while (stripDataUri(dataUri).length > MAX_ENCODED_LENGTH && quality > 0.4) {
    quality -= 0.12;
    dataUri = canvas.toDataURL('image/jpeg', quality);
  }
  const base64 = stripDataUri(dataUri);
  if (!base64 || base64.length > MAX_ENCODED_LENGTH) throw new Error('The composite could not be reduced to fax size.');
  return { base64, preview: dataUri, sizeKb: Math.round(base64.length * 0.75 / 1024) };
}

export async function prepareImage(file: File): Promise<{ base64: string; preview: string; sizeKb: number }> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Source image exceeds the 20MB intake limit.');
  const bitmap = await createImageBitmap(file);
  const initialScale = Math.min(1, 1728 / bitmap.width, 2200 / bitmap.height);
  let scale = initialScale;
  let dataUri = '';

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(320, Math.round(bitmap.width * scale));
    canvas.height = Math.max(400, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot operate the image processor.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const grey = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
      pixels.data[index] = grey;
      pixels.data[index + 1] = grey;
      pixels.data[index + 2] = grey;
    }
    context.putImageData(pixels, 0, 0);
    dataUri = canvas.toDataURL('image/jpeg', 0.76);
    if (stripDataUri(dataUri).length <= MAX_ENCODED_LENGTH) break;
    scale *= 0.8;
  }
  bitmap.close();
  const base64 = stripDataUri(dataUri);
  if (!base64 || base64.length > MAX_ENCODED_LENGTH) throw new Error('The image could not be reduced to fax size.');
  return { base64, preview: dataUri, sizeKb: Math.round(base64.length * 0.75 / 1024) };
}
