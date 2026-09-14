// Inky Utility Helpers (matching Worklane src/utils.ts pattern)
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString();
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trims transparent and blank whitespace around drawn/typed canvas signatures
 * to ensure they retain their natural size without empty wasted margins.
 */
export function trimCanvas(canvas: HTMLCanvasElement, padding = 8): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const isWhite = r > 245 && g > 245 && b > 245;

      if (alpha > 20 && !isWhite) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If completely empty, return original dataUrl
  if (maxX === -1) {
    return canvas.toDataURL('image/png');
  }

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropW = Math.min(width - cropX, maxX - minX + padding * 2);
  const cropH = Math.min(height - cropY, maxY - minY + padding * 2);

  const trimmed = document.createElement('canvas');
  trimmed.width = cropW;
  trimmed.height = cropH;
  const trimmedCtx = trimmed.getContext('2d');
  if (!trimmedCtx) return canvas.toDataURL('image/png');

  trimmedCtx.drawImage(
    canvas,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH
  );

  return trimmed.toDataURL('image/png');
}

/**
 * Normalizes an uploaded signature image:
 * - Turns paper/white backgrounds into transparent
 * - Trims away empty borders so signature retains its true proportions
 */
export function processUploadedSignature(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        // Near-white paper background removal
        if (r > 230 && g > 230 && b > 230) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      resolve(trimCanvas(canvas, 8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Combines a signature image with a printed name underneath ("Signature over Printed Name")
 * Clean format: signature on top, printed name directly below without divider line, clear legible font.
 */
export async function combineSignatureAndName(
  sigDataUrl: string,
  name: string,
  textColor: string,
  fontFamily = 'Inter, system-ui, -apple-system, sans-serif',
  nameSpacing = 8
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // 1. Measure the exact bounding box of visible pixels in the signature image
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        resolve(sigDataUrl);
        return;
      }
      tempCtx.drawImage(img, 0, 0);

      let minX = img.width;
      let minY = img.height;
      let maxX = 0;
      let maxY = 0;
      let hasPixels = false;
      try {
        const imgData = tempCtx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            if (data[(y * img.width + x) * 4 + 3] > 10) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              hasPixels = true;
            }
          }
        }
      } catch {
        // ignore
      }

      const exactCropW = hasPixels ? Math.max(1, maxX - minX + 1) : img.width;
      const exactCropH = hasPixels ? Math.max(1, maxY - minY + 1) : img.height;
      const cropSrcX = hasPixels ? minX : 0;
      const cropSrcY = hasPixels ? minY : 0;

      // Ensure crisp high-DPI resolution without over-scaling large signatures
      const scale = exactCropW < 500 ? Math.min(2.5, 700 / exactCropW) : 1;
      const sigW = Math.round(exactCropW * scale);
      const sigH = Math.round(exactCropH * scale);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sigDataUrl);
        return;
      }

      const cleanName = name.trim().toUpperCase();
      const nameLen = Math.max(cleanName.length, 3);

      // 1. Proportional font size from signature height (~22% to 26% of signature height)
      const targetFromHeight = sigH * 0.24;

      // 2. Proportional font size from signature width (so text spans roughly 50% to 65% of signature width)
      const targetFromWidth = (sigW * 0.58) / (nameLen * 0.60);

      // Balanced font size: start with targetFromHeight, scale up if signature is wide
      let fontSize = Math.max(targetFromHeight, targetFromWidth * 0.8);

      // Width cap: text shouldn't be excessively wider than signature
      const maxAllowedWidth = Math.max(sigW * 1.08, sigW + 40);
      const estWidth = nameLen * 0.60 * fontSize;
      if (estWidth > maxAllowedWidth) {
        fontSize = maxAllowedWidth / (nameLen * 0.60);
      }

      // Height cap: font size shouldn't exceed 36% of signature height, unless signature is very flat
      const maxAllowedHeight = Math.max(sigH * 0.36, sigW * 0.09);
      if (fontSize > maxAllowedHeight) {
        fontSize = maxAllowedHeight;
      }

      // Minimum floor to ensure crisp legibility
      fontSize = Math.max(Math.round(fontSize), 20);

      // Measure precise text width with canvas context
      ctx.font = `700 ${fontSize}px ${fontFamily}`;
      let textMetrics = ctx.measureText(cleanName);
      let textWidth = textMetrics.width;

      // Refinement: if measured text exceeds maxAllowedWidth, scale down precisely
      if (textWidth > maxAllowedWidth && textWidth > 0) {
        fontSize = Math.max(Math.round(fontSize * (maxAllowedWidth / textWidth)), 18);
        ctx.font = `700 ${fontSize}px ${fontFamily}`;
        textMetrics = ctx.measureText(cleanName);
        textWidth = textMetrics.width;
      }

      // Exact cap-height / ascent and descent
      const actualAscent = textMetrics.actualBoundingBoxAscent || fontSize * 0.72;
      const actualDescent = textMetrics.actualBoundingBoxDescent || fontSize * 0.22;

      // Responsive gap between signature bottom and printed name top
      // nameSpacing is visual CSS slider value (default 8, range -15 to +35)
      const baseGap = fontSize * 0.28;
      const spacingOffset = (nameSpacing - 8) * (fontSize / 24);
      const gap = Math.round(baseGap + spacingOffset);

      const paddingX = Math.round(fontSize * 0.5);
      const contentWidth = Math.max(sigW, textWidth);
      const totalWidth = contentWidth + paddingX * 2;

      const sigTop = Math.round(fontSize * 0.15);
      const sigBottom = sigTop + sigH;
      const textBaselineY = sigBottom + gap + actualAscent;
      const textBottom = textBaselineY + actualDescent;

      const totalHeight = Math.max(sigBottom + fontSize * 0.2, textBottom + fontSize * 0.3);

      canvas.width = Math.round(totalWidth);
      canvas.height = Math.round(totalHeight);

      // Re-apply context styles after resizing canvas
      ctx.font = `700 ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // 1. Draw signature tightly cropped, centered horizontally
      const sigX = (totalWidth - sigW) / 2;
      ctx.drawImage(
        tempCanvas,
        cropSrcX,
        cropSrcY,
        exactCropW,
        exactCropH,
        sigX,
        sigTop,
        sigW,
        sigH
      );

      // 2. Draw printed name with exact gap
      ctx.fillText(cleanName, totalWidth / 2, textBaselineY);

      resolve(trimCanvas(canvas, 6));
    };
    img.onerror = () => resolve(sigDataUrl);
    img.src = sigDataUrl;
  });
}


