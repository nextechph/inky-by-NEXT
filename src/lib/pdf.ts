// Inky PDF Utilities & Client-Side Flattening
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { SignatureField } from '../types';

export interface PageDimensions {
  width: number;
  height: number;
  pageNumber: number;
}

/**
 * Normalizes screen drag/drop coordinates to percentage values (0-100)
 */
export function calculateNormalizedCoords(
  clientX: number,
  clientY: number,
  containerRect: DOMRect
): { x: number; y: number } {
  const relativeX = clientX - containerRect.left;
  const relativeY = clientY - containerRect.top;

  const pctX = Math.max(0, Math.min(100, (relativeX / containerRect.width) * 100));
  const pctY = Math.max(0, Math.min(100, (relativeY / containerRect.height) * 100));

  return {
    x: Number(pctX.toFixed(2)),
    y: Number(pctY.toFixed(2)),
  };
}

/**
 * Inspects PDF page count and sizes using pdf-lib
 */
export async function getPdfInfo(pdfBytes: Uint8Array): Promise<{ pageCount: number; pages: PageDimensions[] }> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfDoc.getPageCount();
  const pages: PageDimensions[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();
    pages.push({
      pageNumber: i + 1,
      width,
      height,
    });
  }

  return { pageCount, pages };
}

/**
 * Renders text to a high-resolution transparent PNG image in the browser,
 * perfectly matching CSS font family, font-weight, size, and center alignment.
 */
async function renderTextToPng(
  text: string,
  widthPt: number,
  heightPt: number,
  fontFamily: string = 'Inter',
  colorHex: string = '#2C2C24'
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;

  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch {
    // Ignore font loading errors
  }

  // 4x DPR provides crisp 288 DPI print-quality resolution in the exported PDF
  const dpr = 4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(widthPt * dpr));
  canvas.height = Math.max(1, Math.round(heightPt * dpr));

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const cleanFamily = (fontFamily || 'Inter').replace(/['"]/g, '');
  const isCursive =
    cleanFamily.includes('Dancing') ||
    cleanFamily.includes('Caveat') ||
    cleanFamily.includes('Script') ||
    cleanFamily.includes('Brush') ||
    cleanFamily.includes('Vibes');

  // Proportional font sizing:
  // 10.5pt matches standard 12px (text-xs) in the editor;
  // 11.5pt for cursive gives equal visual weight.
  const basePt = isCursive ? 11.5 : 10.5;
  let targetPt = Math.min(basePt, heightPt * 0.65);
  targetPt = Math.max(5, targetPt);

  let fontPx = targetPt * dpr;
  const fontWeight = isCursive ? '700' : '600';
  const fontSpec = `${fontWeight} ${fontPx}px "${cleanFamily}", cursive, sans-serif`;

  try {
    if (document.fonts && document.fonts.load) {
      await document.fonts.load(fontSpec);
    }
  } catch {
    // Ignore
  }

  ctx.font = fontSpec;

  const lines = text.split('\n');
  const maxLineWidth = widthPt * dpr * 0.94;

  // Scale down font size if text exceeds container width
  let widest = 0;
  lines.forEach((line) => {
    const w = ctx.measureText(line).width;
    if (w > widest) widest = w;
  });

  if (widest > maxLineWidth && widest > 0) {
    const scaleFactor = maxLineWidth / widest;
    fontPx = Math.max(5 * dpr, fontPx * scaleFactor);
    ctx.font = `${fontWeight} ${fontPx}px "${cleanFamily}", cursive, sans-serif`;
  }

  ctx.fillStyle = colorHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineHeightPx = fontPx * 1.25;
  const totalHeight = lines.length * lineHeightPx;
  const startY = (canvas.height - totalHeight) / 2 + lineHeightPx / 2;

  lines.forEach((line, idx) => {
    ctx.fillText(line, canvas.width / 2, startY + idx * lineHeightPx);
  });

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const ab = reader.result as ArrayBuffer;
        resolve(new Uint8Array(ab));
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

/**
 * Flattens signatures, initials, and date fields into PDF bytes directly in the browser
 */
export async function flattenPdfSignatures(
  pdfBytes: Uint8Array,
  fields: SignatureField[],
  options?: { signerName?: string; signerEmail?: string }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);
  const pageCount = pdfDoc.getPageCount();

  for (const field of fields) {
    if (!field.value || !field.value.trim()) continue;
    const pageIndex = field.pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pageCount) continue;

    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const x = (field.x / 100) * pageWidth;
    const w = (field.width / 100) * pageWidth;
    const h = (field.height / 100) * pageHeight;
    // In PDF coordinate system, (0,0) is bottom-left, whereas canvas (0,0) is top-left
    const y = pageHeight - ((field.y / 100) * pageHeight) - h;

    if (field.value.startsWith('data:image')) {
      try {
        // Signature, initials, or drawn/uploaded stamp image
        const base64Data = field.value.split(',')[1] || field.value;
        const binStr = atob(base64Data);
        const len = binStr.length;
        const imgBytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          imgBytes[i] = binStr.charCodeAt(i);
        }
        const isJpg =
          field.value.startsWith('data:image/jpeg') || field.value.startsWith('data:image/jpg');
        const img = isJpg ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);

        // Preserve aspect ratio (contain within bounding box)
        const imgAspect = img.width / img.height;
        const boxAspect = w / h;

        let drawW = w;
        let drawH = h;
        if (imgAspect > boxAspect) {
          drawW = w;
          drawH = w / imgAspect;
        } else {
          drawH = h;
          drawW = h * imgAspect;
        }

        // Center within field bounding box
        const drawX = x + (w - drawW) / 2;
        const drawY = y + (h - drawH) / 2;

        page.drawImage(img, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });
      } catch (err) {
        console.error('Failed to embed signature image:', err);
      }
    } else {
      // Text, date, name, or text-based field
      const textPngBytes = await renderTextToPng(field.value, w, h, field.fontFamily || 'Inter');
      if (textPngBytes) {
        try {
          const textImg = await pdfDoc.embedPng(textPngBytes);
          page.drawImage(textImg, {
            x,
            y,
            width: w,
            height: h,
          });
          continue;
        } catch (err) {
          console.error('Failed to embed text PNG image:', err);
        }
      }

      // Graceful fallback if canvas rendering is unavailable
      const fontSize = Math.min(10.5, Math.max(7, h * 0.65));
      let selectedPdfFont = helvetica;
      const ff = (field.fontFamily || '').toLowerCase();
      if (ff.includes('times') || ff.includes('garamond') || ff.includes('serif')) {
        selectedPdfFont = timesRoman;
      } else if (ff.includes('courier') || ff.includes('mono')) {
        selectedPdfFont = courier;
      }
      const textWidth = selectedPdfFont.widthOfTextAtSize(field.value, fontSize);
      const textX = x + Math.max(0, (w - textWidth) / 2);
      const textY = y + (h - fontSize) / 2;
      page.drawText(field.value, {
        x: textX,
        y: textY,
        size: fontSize,
        font: selectedPdfFont,
        color: rgb(44 / 255, 44 / 255, 36 / 255),
      });
    }
  }

  // Metadata & lightweight audit stamp
  pdfDoc.setProducer('Inky E-Signature App (Local Edition)');
  pdfDoc.setModificationDate(new Date());

  return await pdfDoc.save();
}
