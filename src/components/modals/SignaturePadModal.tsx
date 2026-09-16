import React, { useRef, useState, useEffect } from 'react';
import SignaturePad from 'signature_pad';
import { X, PenTool, Type, Upload, History, Check, RotateCcw, ChevronDown, Minus, Plus, ShieldCheck } from 'lucide-react';
import { saveSignature, getSavedSignatures } from '../../lib/storage';
import { SavedSignature } from '../../types';
import { trimCanvas, processUploadedSignature, combineSignatureAndName, separateSignatureAndPrintedName, cacheSignatureMeta } from '../../utils';
import { useToastStore } from '../../store/useToastStore';
import { Dropdown } from '../ui/Dropdown';

interface SignaturePadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSignature: (
    dataUrl: string,
    label: string,
    meta?: {
      rawSignature?: string;
      printedName?: string;
      printedNameScale?: number;
      printedNameSpacing?: number;
    }
  ) => void;
  title?: string;
  initialSignature?: string | null;
  initialRawSignature?: string | null;
  initialPrintedName?: string;
  initialPrintedNameScale?: number;
  initialPrintedNameSpacing?: number;
}

export const AVAILABLE_FONTS = [
  // Professional & Clean
  { id: 'Inter',           name: 'Inter',           style: 'Modern Sans',        group: 'Professional Fonts' },
  { id: 'Geist',           name: 'Geist',           style: 'Clean Geometric',    group: 'Professional Fonts' },
  { id: 'Arial',           name: 'Arial',           style: 'Universal Sans',     group: 'Professional Fonts' },
  { id: 'Times New Roman', name: 'Times New Roman', style: 'Classic Editorial',   group: 'Professional Fonts' },
  { id: 'EB Garamond',     name: 'EB Garamond',     style: 'Book Serif',         group: 'Professional Fonts' },

  // Signature & Cursive Scripts
  { id: 'Dancing Script',  name: 'Dancing Script',  style: 'Classic Cursive',    group: 'Signature Scripts' },
  { id: 'Great Vibes',     name: 'Great Vibes',     style: 'Calligraphy',        group: 'Signature Scripts' },
  { id: 'Caveat',          name: 'Caveat',          style: 'Casual Hand',        group: 'Signature Scripts' },
  { id: 'Sacramento',      name: 'Sacramento',      style: 'Delicate Script',    group: 'Signature Scripts' },
  { id: 'Allura',          name: 'Allura',          style: 'Flourish',           group: 'Signature Scripts' },
  { id: 'Satisfy',         name: 'Satisfy',         style: 'Brush Pen',          group: 'Signature Scripts' },
  { id: 'Alex Brush',      name: 'Alex Brush',      style: 'Flowing Pen',        group: 'Signature Scripts' },
  { id: 'Pacifico',        name: 'Pacifico',        style: 'Bold Retro',         group: 'Signature Scripts' },
  { id: 'Marck Script',    name: 'Marck Script',    style: 'Signature Hand',     group: 'Signature Scripts' },
];

export const SIGNATURE_FONTS = AVAILABLE_FONTS;

const INK_COLORS = [
  { value: '#2C2C24', label: 'Deep Loam'   },
  { value: '#2c3e6a', label: 'Midnight Blue'},
  { value: '#4A3728', label: 'Dark Bark'   },
];

export const STROKE_WIDTH_OPTIONS = [
  { id: 'thin',   label: 'Fine',   min: 1.0, max: 2.2, dotSize: 1.8, lineWeight: 1.5 },
  { id: 'medium', label: 'Medium', min: 2.2, max: 4.8, dotSize: 3.5, lineWeight: 2.5 },
  { id: 'thick',  label: 'Bold',   min: 4.2, max: 8.5, dotSize: 6.2, lineWeight: 4 },
] as const;

export type StrokeWidthType = typeof STROKE_WIDTH_OPTIONS[number]['id'];

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  isOpen,
  onClose,
  onSelectSignature,
  title,
  initialSignature,
  initialRawSignature,
  initialPrintedName,
  initialPrintedNameScale,
  initialPrintedNameSpacing,
}) => {
  const [activeTab, setActiveTab]       = useState<'draw' | 'type' | 'upload' | 'saved'>('draw');
  const [typedText, setTypedText]       = useState('Your Name');
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0].id);
  const [penColor, setPenColor]         = useState(INK_COLORS[0].value);
  const [strokeWidth, setStrokeWidth]   = useState<StrokeWidthType>('medium');
  const [sigLabel, setSigLabel]                     = useState('');
  const [includePrintedName, setIncludePrintedName] = useState(false);
  const [printedName, setPrintedName]               = useState('');
  const [nameFontSizeScale, setNameFontSizeScale]   = useState<number>(1.0);
  const [nameSpacing, setNameSpacing]               = useState<number>(8);
  const [drawnPreview, setDrawnPreview]             = useState<string | null>(null);
  const [sigBottomY, setSigBottomY]                 = useState<number | null>(null);
  const [combinedPreviewUrl, setCombinedPreviewUrl] = useState<string | null>(null);
  const [isDefault, setIsDefault]                   = useState(true);
  const [savedSigs, setSavedSigs]                   = useState<SavedSignature[]>([]);
  const [stylusMode, setStylusMode]                 = useState(true);
  const [stylusDetected, setStylusDetected]         = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigPadRef = useRef<any | null>(null);
  const drawnPointsRef = useRef<any[] | null>(null);
  const initialImageRef = useRef<HTMLImageElement | null>(null);
  const cleanRawSigRef = useRef<string | null>(null);
  const hasClearedFlagRef = useRef(false);

  const stylusModeRef = useRef(stylusMode);
  stylusModeRef.current = stylusMode;

  const stylusDetectedRef = useRef(stylusDetected);
  stylusDetectedRef.current = stylusDetected;

  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTypeRef = useRef<string | null>(null);

  const getCanvasBottomY = (canvas: HTMLCanvasElement | null): number | null => {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    if (!width || !height) return null;
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const { data } = imgData;
      for (let y = height - 1; y >= 0; y--) {
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
          if (data[rowOffset + x * 4 + 3] > 10) {
            const cssHeight = canvas.clientHeight || (height / (window.devicePixelRatio || 1));
            const ratio = height / cssHeight;
            return y / ratio;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  const drawInitialImage = (
    img: HTMLImageElement,
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (!natW || !natH) return;

    // Sized to fit comfortably in the canvas workspace
    const maxW = Math.min(canvasWidth * 0.78, 650);
    const maxH = Math.min(canvasHeight * 0.62, 260);

    const scale = Math.min(maxW / natW, maxH / natH, 2.0);
    const renderW = natW * scale;
    const renderH = natH * scale;

    // Center horizontally
    const x = Math.round((canvasWidth - renderW) / 2);
    // Center vertically above the dashed "Sign on the line" guideline
    const guidelineY = canvasHeight - 38;
    const availableH = guidelineY - 20;
    const y = Math.max(16, Math.round((availableH - renderH) / 2 + 10));

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, renderW, renderH);
    ctx.restore();
  };

  const redrawCanvasContent = (strokes?: any[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = canvas.clientWidth || canvas.offsetWidth;
    const cssH = canvas.clientHeight || canvas.offsetHeight;
    if (cssW <= 0 || cssH <= 0) return;

    ctx.clearRect(0, 0, cssW, cssH);

    let hasContent = false;

    // 1. Draw initial image if present and not explicitly cleared by user
    if (initialImageRef.current && !hasClearedFlagRef.current) {
      drawInitialImage(initialImageRef.current, ctx, cssW, cssH);
      hasContent = true;
    }

    // 2. Re-render any user stroke points on top without clearing underlying image
    const pad = sigPadRef.current;
    const strokeData = strokes !== undefined ? strokes : (pad ? pad.toData() : (drawnPointsRef.current || []));
    if (strokeData && strokeData.length > 0) {
      if (pad) {
        (pad as any)._data = [];
        pad.fromData(strokeData, { clear: false });
      }
      hasContent = true;
    }

    if (pad) {
      (pad as any)._isEmpty = !hasContent;
    }

    if (hasContent) {
      try {
        const preview = trimCanvas(canvas, 4);
        setDrawnPreview(preview);
        const bY = getCanvasBottomY(canvas);
        setSigBottomY(bY);
      } catch {
        // ignore
      }
    } else {
      setDrawnPreview(null);
      setSigBottomY(null);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSavedSigs(getSavedSignatures());
      setActiveTab('draw');
      setDrawnPreview(null);
      setSigBottomY(null);
      setCombinedPreviewUrl(null);
      setStylusDetected(false);
      drawnPointsRef.current = null;
      initialImageRef.current = null;
      cleanRawSigRef.current = null;
      hasClearedFlagRef.current = false;
      sigPadRef.current?.clear();

      if (initialPrintedName) {
        setIncludePrintedName(true);
        setPrintedName(initialPrintedName.toUpperCase());
        if (initialPrintedNameScale !== undefined) setNameFontSizeScale(initialPrintedNameScale);
        if (initialPrintedNameSpacing !== undefined) setNameSpacing(initialPrintedNameSpacing);
      } else {
        setIncludePrintedName(false);
        setPrintedName('');
        setNameFontSizeScale(1.0);
        setNameSpacing(8);
      }

      if (initialRawSignature && typeof initialRawSignature === 'string' && initialRawSignature.trim().length > 0) {
        // Fast lossless path: raw signature is already available, load directly with 100% fidelity
        const cleanRaw = initialRawSignature.trim();
        cleanRawSigRef.current = cleanRaw;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!hasClearedFlagRef.current) {
            initialImageRef.current = img;
            redrawCanvasContent();
          }
        };
        img.onerror = () => {
          console.warn('Failed to load initial raw signature image');
        };
        img.src = cleanRaw;
      } else if (initialSignature && typeof initialSignature === 'string' && initialSignature.trim().length > 0) {
        const sigToProcess = initialSignature.trim();
        if (initialPrintedName && initialPrintedName.trim()) {
          separateSignatureAndPrintedName(sigToProcess, initialPrintedName.trim()).then(
            ({ rawSignature, printedName: detectedName, fontSizeScale, nameSpacing: detectedSpacing, detected }) => {
              if (hasClearedFlagRef.current) return;

              cleanRawSigRef.current = rawSignature;

              if (detected && detectedName && !initialPrintedName) {
                setIncludePrintedName(true);
                setPrintedName(detectedName.toUpperCase());
                if (fontSizeScale) setNameFontSizeScale(fontSizeScale);
                if (detectedSpacing !== undefined) setNameSpacing(detectedSpacing);
              }

              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                if (!hasClearedFlagRef.current) {
                  initialImageRef.current = img;
                  redrawCanvasContent();
                }
              };
              img.onerror = () => {
                console.warn('Failed to load initial signature image');
              };
              img.src = rawSignature;
            }
          );
        } else {
          // No printed name: pure signature, load directly without cutting
          cleanRawSigRef.current = sigToProcess;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            if (!hasClearedFlagRef.current) {
              initialImageRef.current = img;
              redrawCanvasContent();
            }
          };
          img.onerror = () => {
            console.warn('Failed to load initial signature image');
          };
          img.src = sigToProcess;
        }
      }
    } else {
      drawnPointsRef.current = null;
      initialImageRef.current = null;
      cleanRawSigRef.current = null;
      hasClearedFlagRef.current = false;
      setDrawnPreview(null);
      setSigBottomY(null);
      setCombinedPreviewUrl(null);
      activePointerIdRef.current = null;
      activePointerTypeRef.current = null;
    }
  }, [isOpen, initialSignature, initialRawSignature, initialPrintedName, initialPrintedNameScale, initialPrintedNameSpacing]);

  const initOrResizePad = (force = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Never resize or wipe buffer while user is in the middle of drawing a stroke
    if (sigPadRef.current && (sigPadRef.current as any)._drawingStroke) {
      return;
    }

    const cssWidth = canvas.clientWidth || canvas.offsetWidth;
    const cssHeight = canvas.clientHeight || canvas.offsetHeight;

    if (cssWidth <= 0 || cssHeight <= 0) {
      return;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const targetW = Math.round(cssWidth * ratio);
    const targetH = Math.round(cssHeight * ratio);

    // If pad exists and canvas dimensions match within 2px, avoid resetting canvas buffer
    if (!force && sigPadRef.current && Math.abs(canvas.width - targetW) <= 2 && Math.abs(canvas.height - targetH) <= 2) {
      sigPadRef.current.on();
      return;
    }

    // Save existing drawn strokes before resetting canvas size
    const savedData = sigPadRef.current
      ? sigPadRef.current.toData()
      : (drawnPointsRef.current || []);

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
    }

    const strokeConfig = STROKE_WIDTH_OPTIONS.find((s) => s.id === strokeWidth) || STROKE_WIDTH_OPTIONS[1];

    if (!sigPadRef.current) {
      const pad = new SignaturePad(canvas, {
        penColor,
        minWidth: strokeConfig.min,
        maxWidth: strokeConfig.max,
        dotSize: strokeConfig.dotSize,
        throttle: 0,
        velocityFilterWeight: 0.7,
      });

      // Dynamic ink width calculation for stylus pressure and smooth speed dynamics
      (pad as any)._strokeWidth = function (velocity: number, options: any) {
        const lastGroup = this._data[this._data.length - 1];
        const lastPoint = lastGroup?.points[lastGroup.points.length - 1];

        // Active capacitive styluses (Apple Pencil, Samsung S-Pen, Surface Pen) report true pressure (0.01 - 1.0)
        if (
          lastPoint &&
          typeof lastPoint.pressure === 'number' &&
          lastPoint.pressure > 0.01 &&
          lastPoint.pressure <= 1.0 &&
          Math.abs(lastPoint.pressure - 0.5) > 0.02
        ) {
          if (!stylusDetectedRef.current) {
            stylusDetectedRef.current = true;
            setStylusDetected(true);
          }
          const p = Math.pow(lastPoint.pressure, 0.75);
          const v = 1 / (1 + velocity * 0.2);
          const dynamic = p * 0.75 + v * 0.25;
          return options.minWidth + (options.maxWidth - options.minWidth) * dynamic;
        }

        // Mouse, trackpad, or finger touch:
        // Use smooth velocity factor so stroke thickness naturally reflects the selected size
        // instead of collapsing instantly to minWidth
        const speedFactor = 1 / (1 + velocity * 0.22);
        const dynamic = Math.max(0.15, Math.min(1.0, speedFactor));
        return options.minWidth + (options.maxWidth - options.minWidth) * dynamic;
      };

      pad.addEventListener('endStroke', () => {
        drawnPointsRef.current = pad.toData();
        try {
          if (canvasRef.current && !pad.isEmpty()) {
            setDrawnPreview(trimCanvas(canvasRef.current, 4));
            const bY = getCanvasBottomY(canvasRef.current);
            setSigBottomY(bY);
          }
        } catch {
          // ignore
        }
      });
      sigPadRef.current = pad;
    } else {
      sigPadRef.current.penColor = penColor;
      sigPadRef.current.minWidth = strokeConfig.min;
      sigPadRef.current.maxWidth = strokeConfig.max;
      sigPadRef.current.dotSize = strokeConfig.dotSize;
      sigPadRef.current.on();
    }

    // Restore existing content (initial image + drawn strokes) onto the newly sized canvas
    redrawCanvasContent(savedData);
  };

  const handleColorChange = (newColor: string) => {
    setPenColor(newColor);
    if (sigPadRef.current) {
      sigPadRef.current.penColor = newColor;
      const data = sigPadRef.current.toData();
      if (data && data.length > 0) {
        const updatedData = data.map((group: any) => ({
          ...group,
          penColor: newColor,
        }));
        drawnPointsRef.current = updatedData;
        redrawCanvasContent(updatedData);
      }
    }
  };

  const handleStrokeChange = (newWidth: StrokeWidthType) => {
    setStrokeWidth(newWidth);
    const config = STROKE_WIDTH_OPTIONS.find((s) => s.id === newWidth) || STROKE_WIDTH_OPTIONS[1];
    if (sigPadRef.current) {
      sigPadRef.current.minWidth = config.min;
      sigPadRef.current.maxWidth = config.max;
      sigPadRef.current.dotSize = config.dotSize;
      const data = sigPadRef.current.toData();
      if (data && data.length > 0) {
        const updatedData = data.map((group: any) => ({
          ...group,
          minWidth: config.min,
          maxWidth: config.max,
          dotSize: config.dotSize,
        }));
        drawnPointsRef.current = updatedData;
        redrawCanvasContent(updatedData);
      }
    }
  };

  const handleClear = () => {
    hasClearedFlagRef.current = true;
    initialImageRef.current = null;
    cleanRawSigRef.current = null;
    drawnPointsRef.current = null;
    sigPadRef.current?.clear();
    setDrawnPreview(null);
    setSigBottomY(null);
    setCombinedPreviewUrl(null);
  };

  const handleTabChange = (newTab: 'draw' | 'type' | 'upload' | 'saved') => {
    if (activeTab === 'draw' && sigPadRef.current && !sigPadRef.current.isEmpty()) {
      drawnPointsRef.current = sigPadRef.current.toData();
    }
    setActiveTab(newTab);
    if (newTab === 'draw') {
      setTimeout(() => {
        initOrResizePad(true);
      }, 30);
      setTimeout(() => {
        initOrResizePad(false);
      }, 120);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    let resizeObserver: ResizeObserver | null = null;
    let animTimer: any = null;
    let retryTimer: any = null;

    const setupWithRetry = (count = 0) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth || canvas.offsetWidth;
      const h = canvas.clientHeight || canvas.offsetHeight;
      if (w > 0 && h > 0) {
        initOrResizePad(true);
      } else if (count < 10) {
        retryTimer = setTimeout(() => setupWithRetry(count + 1), 40);
      }
    };

    setupWithRetry(0);

    const rafId = requestAnimationFrame(() => {
      initOrResizePad(false);
    });

    // Wait for slideUp animation to settle, then verify dimensions
    animTimer = setTimeout(() => {
      initOrResizePad(false);
    }, 380);

    const canvas = canvasRef.current;
    if (canvas && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width } = entry.contentRect;
          if (width > 0 && canvas) {
            const currentW = canvas.width / (window.devicePixelRatio || 1);
            if (Math.abs(width - currentW) > 5) {
              initOrResizePad(false);
            }
          }
        }
      });
      resizeObserver.observe(canvas);
    }

    // ── Capacitive Stylus & Palm Rejection Event Handlers ──
    const handlePointerDownCapture = (e: PointerEvent) => {
      const isPen = e.pointerType === 'pen';
      if (isPen) {
        stylusDetectedRef.current = true;
        setStylusDetected(true);
        activePointerTypeRef.current = 'pen';
        activePointerIdRef.current = e.pointerId;
      }

      // If active stylus is drawing, drop any secondary touch/palm contacts
      if (activePointerTypeRef.current === 'pen' && !isPen) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      if (stylusModeRef.current) {
        // Multi-touch rejection: if another pointer is already drawing, reject new contact
        if (activePointerIdRef.current !== null && activePointerIdRef.current !== e.pointerId) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }

        // Palm contact area rejection: large contact geometry (> 34px) is a resting palm
        if (e.pointerType === 'touch' && ((e.width && e.width > 34) || (e.height && e.height > 34))) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }

        // Reject non-primary touch events
        if (e.isPrimary === false && !isPen) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
      }

      activePointerIdRef.current = e.pointerId;
      if (!isPen) {
        activePointerTypeRef.current = e.pointerType;
      }

      try {
        canvas?.setPointerCapture(e.pointerId);
      } catch {}
    };

    const handlePointerMoveCapture = (e: PointerEvent) => {
      if (activePointerTypeRef.current === 'pen' && e.pointerType !== 'pen') {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      if (e.pointerType === 'pen' && !stylusDetectedRef.current) {
        stylusDetectedRef.current = true;
        setStylusDetected(true);
      }
    };

    const handlePointerUpCapture = (e: PointerEvent) => {
      if (e.pointerId === activePointerIdRef.current) {
        activePointerIdRef.current = null;
        activePointerTypeRef.current = null;
        try {
          if (canvas?.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch {}
      }
    };

    // iOS Safari Apple Pencil touch event palm rejection
    const handleTouchStartCapture = (e: TouchEvent) => {
      let hasStylus = false;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i] as any;
        if (t.touchType === 'stylus') {
          hasStylus = true;
          stylusDetectedRef.current = true;
          setStylusDetected(true);
          break;
        }
      }

      if (stylusModeRef.current && e.touches.length > 1) {
        if (hasStylus) {
          const changedTouch = e.changedTouches[0] as any;
          if (changedTouch.touchType !== 'stylus') {
            e.stopImmediatePropagation();
            return;
          }
        } else {
          const changedTouch = e.changedTouches[0];
          if (changedTouch !== e.touches[0]) {
            e.stopImmediatePropagation();
            return;
          }
        }
      }
    };

    const handleTouchMoveCapture = (e: TouchEvent) => {
      if (stylusModeRef.current && e.touches.length > 1) {
        const hasStylus = Array.from(e.touches).some((t: any) => (t as any).touchType === 'stylus');
        if (hasStylus) {
          const changed = e.changedTouches[0] as any;
          if (changed.touchType !== 'stylus') {
            e.stopImmediatePropagation();
            return;
          }
        }
      }
    };

    if (canvas) {
      canvas.addEventListener('pointerdown', handlePointerDownCapture, { capture: true });
      canvas.addEventListener('pointermove', handlePointerMoveCapture, { capture: true });
      canvas.addEventListener('pointerup', handlePointerUpCapture, { capture: true });
      canvas.addEventListener('touchstart', handleTouchStartCapture, { capture: true, passive: false });
      canvas.addEventListener('touchmove', handleTouchMoveCapture, { capture: true, passive: false });
    }

    // Safeguard: handle pointercancel so drawing doesn't freeze
    const handlePointerCancel = () => {
      activePointerIdRef.current = null;
      activePointerTypeRef.current = null;
      if (sigPadRef.current) {
        (sigPadRef.current as any)._drawingStroke = false;
        sigPadRef.current.on();
      }
    };
    if (canvas) {
      canvas.addEventListener('pointercancel', handlePointerCancel);
    }

    const handleWindowResize = () => {
      initOrResizePad(false);
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(animTimer);
      clearTimeout(retryTimer);
      window.removeEventListener('resize', handleWindowResize);
      if (resizeObserver) resizeObserver.disconnect();
      if (canvas) {
        canvas.removeEventListener('pointerdown', handlePointerDownCapture, { capture: true });
        canvas.removeEventListener('pointermove', handlePointerMoveCapture, { capture: true });
        canvas.removeEventListener('pointerup', handlePointerUpCapture, { capture: true });
        canvas.removeEventListener('touchstart', handleTouchStartCapture, { capture: true });
        canvas.removeEventListener('touchmove', handleTouchMoveCapture, { capture: true });
        canvas.removeEventListener('pointercancel', handlePointerCancel);
      }
      if (sigPadRef.current) {
        sigPadRef.current.off();
        sigPadRef.current = null;
      }
    };
  }, [isOpen]);

  const generateTypedDataUrl = (text: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `600 88px '${selectedFont}', cursive`;
    ctx.fillStyle = penColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    return trimCanvas(canvas, 12);
  };

  useEffect(() => {
    if (!isOpen || !includePrintedName || !printedName.trim()) {
      setCombinedPreviewUrl(null);
      return;
    }
    let isMounted = true;
    const updateCombined = async () => {
      let baseSig = '';
      if (activeTab === 'draw') {
        const hasNewStrokes = Boolean(drawnPointsRef.current && drawnPointsRef.current.length > 0);
        if (hasNewStrokes && canvasRef.current) {
          baseSig = trimCanvas(canvasRef.current, 8);
        } else if (cleanRawSigRef.current) {
          baseSig = cleanRawSigRef.current;
        } else if (canvasRef.current && sigPadRef.current && !sigPadRef.current.isEmpty()) {
          baseSig = trimCanvas(canvasRef.current, 8);
        }
      } else if (activeTab === 'type') {
        if (typedText.trim()) {
          baseSig = generateTypedDataUrl(typedText);
        }
      }
      if (baseSig) {
        try {
          const combined = await combineSignatureAndName(
            baseSig,
            printedName.trim(),
            penColor,
            undefined,
            nameSpacing,
            nameFontSizeScale
          );
          if (isMounted) {
            setCombinedPreviewUrl(combined);
          }
        } catch {
          if (isMounted) setCombinedPreviewUrl(null);
        }
      } else {
        if (isMounted) setCombinedPreviewUrl(null);
      }
    };
    updateCombined();
    return () => {
      isMounted = false;
    };
  }, [isOpen, includePrintedName, printedName, nameSpacing, nameFontSizeScale, activeTab, penColor, typedText, selectedFont, drawnPreview]);

  if (!isOpen) return null;

  const handleSaveAndSelect = async () => {
    let dataUrl = ''; let label = 'Signature';
    const effectiveName = printedName.trim().toUpperCase();
    let rawSig = '';

    if (activeTab === 'draw') {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
        useToastStore.getState().showToast('Please draw a signature first', 'warning');
        return;
      }
      const hasNewStrokes = Boolean(drawnPointsRef.current && drawnPointsRef.current.length > 0);
      if (!hasNewStrokes && cleanRawSigRef.current) {
        rawSig = cleanRawSigRef.current;
      } else if (!hasNewStrokes && initialSignature && !hasClearedFlagRef.current && !(includePrintedName && effectiveName)) {
        rawSig = initialSignature;
      } else {
        rawSig = trimCanvas(canvasRef.current!, 8);
      }
      dataUrl = rawSig;
      label = sigLabel.trim() || (includePrintedName && effectiveName ? effectiveName : 'Drawn Signature');
    } else if (activeTab === 'type') {
      if (!typedText.trim()) {
        useToastStore.getState().showToast('Please enter your name', 'warning');
        return;
      }
      rawSig = generateTypedDataUrl(typedText);
      dataUrl = rawSig;
      label = sigLabel.trim() || (includePrintedName && effectiveName ? effectiveName : `Typed: ${typedText}`);
    }

    if (dataUrl) {
      const metaToSave = {
        rawSignature: rawSig,
        printedName: includePrintedName && effectiveName ? effectiveName : undefined,
        printedNameScale: includePrintedName && effectiveName ? nameFontSizeScale : undefined,
        printedNameSpacing: includePrintedName && effectiveName ? nameSpacing : undefined,
      };

      if (includePrintedName && effectiveName) {
        dataUrl = await combineSignatureAndName(rawSig, effectiveName, penColor, undefined, nameSpacing, nameFontSizeScale);
      }

      cacheSignatureMeta(dataUrl, {
        rawSignature: rawSig,
        printedName: includePrintedName && effectiveName ? effectiveName : undefined,
        fontSizeScale: nameFontSizeScale,
        nameSpacing,
      });

      saveSignature({
        type: activeTab as any,
        dataUrl,
        rawSignature: rawSig,
        printedName: includePrintedName && effectiveName ? effectiveName : undefined,
        printedNameScale: includePrintedName && effectiveName ? nameFontSizeScale : undefined,
        printedNameSpacing: includePrintedName && effectiveName ? nameSpacing : undefined,
        label,
        isDefault,
      });

      onSelectSignature(dataUrl, label, metaToSave);
      onClose();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const rawResult = event.target?.result as string;
      if (rawResult) {
        let cleanResult = await processUploadedSignature(rawResult);
        const rawSig = cleanResult;
        const effectiveName = printedName.trim().toUpperCase();
        const metaToSave = {
          rawSignature: rawSig,
          printedName: includePrintedName && effectiveName ? effectiveName : undefined,
          printedNameScale: includePrintedName && effectiveName ? nameFontSizeScale : undefined,
          printedNameSpacing: includePrintedName && effectiveName ? nameSpacing : undefined,
        };
        if (includePrintedName && effectiveName) {
          cleanResult = await combineSignatureAndName(rawSig, effectiveName, penColor, undefined, nameSpacing, nameFontSizeScale);
        }
        cacheSignatureMeta(cleanResult, {
          rawSignature: rawSig,
          printedName: includePrintedName && effectiveName ? effectiveName : undefined,
          fontSizeScale: nameFontSizeScale,
          nameSpacing,
        });
        const label = sigLabel.trim() || (includePrintedName && effectiveName ? effectiveName : 'Uploaded Signature');
        saveSignature({
          type: 'upload',
          dataUrl: cleanResult,
          rawSignature: rawSig,
          printedName: includePrintedName && effectiveName ? effectiveName : undefined,
          printedNameScale: includePrintedName && effectiveName ? nameFontSizeScale : undefined,
          printedNameSpacing: includePrintedName && effectiveName ? nameSpacing : undefined,
          label,
          isDefault,
        });
        onSelectSignature(cleanResult, label, metaToSave);
        onClose();
      }
    };
    reader.readAsDataURL(file);
  };

  const tabs = [
    { id: 'draw',   label: 'Draw',            icon: <PenTool style={{ height: 14, width: 14 }} /> },
    { id: 'type',   label: 'Type',            icon: <Type    style={{ height: 14, width: 14 }} /> },
    { id: 'upload', label: 'Upload',          icon: <Upload  style={{ height: 14, width: 14 }} /> },
    ...(savedSigs.length > 0
      ? [{ id: 'saved', label: 'Past Signatures', icon: <History style={{ height: 14, width: 14 }} /> }]
      : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fadeIn"
      style={{ background: 'rgba(44,44,36,0.50)', backdropFilter: 'blur(10px)' }}
    >
      <div
        className="card-organic animate-slideUp w-full max-w-[96vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl rounded-[1.75rem] sm:rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl transition-all duration-300"
        style={{
          maxHeight: 'min(96dvh, 920px)',
          minHeight: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-light)' }}
        >
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div
              className="h-8 sm:h-9 w-8 sm:w-9 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--moss-dim)' }}
            >
              <PenTool style={{ height: 16, width: 16, color: 'var(--moss)' }} />
            </div>
            <h3 className="font-display font-bold text-base sm:text-lg" style={{ color: 'var(--fg)' }}>
              {title || 'Create Signature'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 cursor-pointer"
            style={{ background: 'var(--bg-stone)', color: 'var(--fg-muted)' }}
            aria-label="Close"
          >
            <X style={{ height: 15, width: 15 }} />
          </button>
        </div>

        {/* Tab Bar — pill segment */}
        <div className="px-3 sm:px-4 pt-2.5 sm:pt-3 pb-1 shrink-0">
          <div
            className="flex gap-1 p-1 rounded-full overflow-x-auto no-scrollbar"
            style={{ background: 'var(--bg-stone)' }}
            role="tablist"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => handleTabChange(tab.id as any)}
                className="flex-1 flex items-center justify-center gap-1 sm:gap-1.5 py-1.5 sm:py-2 px-1.5 sm:px-3 rounded-full text-xs font-bold transition-all duration-200 shrink-0 cursor-pointer"
                style={{
                  background: activeTab === tab.id ? 'var(--moss)' : 'transparent',
                  color: activeTab === tab.id ? '#F3F4F1' : 'var(--fg-muted)',
                  boxShadow: activeTab === tab.id ? '0 4px 12px rgba(93,112,82,0.25)' : 'none',
                }}
              >
                {tab.icon}
                <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab Body */}
        <div
          className="p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 min-h-0"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--moss) rgba(0,0,0,0.06)',
          }}
        >

          {/* ── Draw ─────────────────────────────────────── */}
          <div
            className="space-y-3"
            style={{ display: activeTab === 'draw' ? 'block' : 'none' }}
          >
            {/* Canvas well */}
            <div
              className="relative rounded-[1.25rem] sm:rounded-[1.75rem] overflow-hidden select-none h-72 xs:h-80 sm:h-96 md:h-[400px] lg:h-[440px]"
              style={{
                background: 'rgba(255,255,255,0.72)',
                border: '2px dashed rgba(93,112,82,0.32)',
                boxShadow: 'inset 0 2px 14px rgba(44,44,36,0.06)',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              <canvas
                ref={canvasRef}
                className="w-full h-full cursor-crosshair block"
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  background: 'transparent',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              />

              {/* Floating controls toolbar on the side of signature creation */}
              <div
                className="absolute left-2.5 sm:left-4 top-2.5 sm:top-4 z-20 flex flex-col items-center gap-2 p-1.5 sm:p-2 rounded-2xl sm:rounded-[1.25rem] shadow-lg select-none"
                style={{
                  background: 'rgba(253, 252, 248, 0.90)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(93, 112, 82, 0.22)',
                  boxShadow: '0 8px 24px -4px rgba(44, 44, 36, 0.12), 0 2px 6px rgba(44, 44, 36, 0.05)',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Ink Color Swatches */}
                <div className="flex flex-col items-center gap-1.5 sm:gap-2">
                  {INK_COLORS.map((c) => {
                    const isColorActive = penColor === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => handleColorChange(c.value)}
                        title={c.label}
                        aria-label={`Ink color: ${c.label}`}
                        aria-pressed={isColorActive}
                        className="h-6 w-6 sm:h-7 sm:w-7 rounded-full transition-all duration-200 hover:scale-110 cursor-pointer flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: c.value,
                          boxShadow: isColorActive
                            ? '0 0 0 2px #FDFAF4, 0 0 0 4px var(--moss)'
                            : '0 1px 3px rgba(0,0,0,0.12)',
                          transform: isColorActive ? 'scale(1.08)' : 'scale(1)',
                        }}
                      >
                        {isColorActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-white/90 block shadow-sm" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Subtle Divider between color and thickness */}
                <div
                  className="w-5 h-[1px] my-0.5"
                  style={{ background: 'rgba(93, 112, 82, 0.22)' }}
                />

                {/* Stroke Thickness Selector: Dots differing in thickness */}
                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  {STROKE_WIDTH_OPTIONS.map((sw) => {
                    const isActive = strokeWidth === sw.id;
                    // Dot diameter: Fine=5px, Medium=9px, Bold=14px
                    const dotSize = sw.id === 'thin' ? 5 : sw.id === 'medium' ? 9 : 14;
                    return (
                      <button
                        key={sw.id}
                        type="button"
                        onClick={() => handleStrokeChange(sw.id)}
                        title={`${sw.label} stroke thickness`}
                        aria-label={`${sw.label} stroke`}
                        aria-pressed={isActive}
                        className="h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shrink-0"
                        style={{
                          background: isActive ? 'rgba(93, 112, 82, 0.12)' : 'transparent',
                          boxShadow: isActive ? '0 0 0 1.5px var(--moss)' : 'none',
                        }}
                      >
                        <span
                          className="rounded-full transition-all duration-200 block"
                          style={{
                            width: dotSize,
                            height: dotSize,
                            backgroundColor: isActive ? penColor : 'var(--fg-muted)',
                            opacity: isActive ? 1 : 0.45,
                            transform: isActive ? 'scale(1.08)' : 'scale(1)',
                          }}
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Subtle Divider between thickness and stylus */}
                <div
                  className="w-5 h-[1px] my-0.5"
                  style={{ background: 'rgba(93, 112, 82, 0.22)' }}
                />

                {/* Capacitive Stylus & Palm Rejection Mode Button */}
                <button
                  type="button"
                  onClick={() => setStylusMode((prev) => !prev)}
                  title={
                    stylusMode
                      ? 'Stylus Mode & Palm Rejection: Active (ignoring palm touches)'
                      : 'Enable Stylus Mode & Palm Rejection'
                  }
                  aria-label="Stylus mode and palm rejection"
                  aria-pressed={stylusMode}
                  className="h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shrink-0 relative"
                  style={{
                    background: stylusMode ? 'rgba(93, 112, 82, 0.14)' : 'transparent',
                    boxShadow: stylusMode ? '0 0 0 1.5px var(--moss)' : 'none',
                  }}
                >
                  <PenTool
                    style={{
                      height: 13,
                      width: 13,
                      color: stylusMode ? 'var(--moss)' : 'var(--fg-muted)',
                      opacity: stylusMode ? 1 : 0.45,
                      transform: 'rotate(-45deg)',
                    }}
                  />
                  {stylusDetected && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
                      style={{ background: 'var(--moss)', boxShadow: '0 0 0 1.5px #FDFAF4' }}
                      title="Stylus pen active"
                    />
                  )}
                </button>
              </div>

              {/* Stylus active badge */}
              {stylusDetected && (
                <div
                  className="absolute top-2.5 sm:top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold select-none pointer-events-none transition-all duration-300 animate-fadeIn"
                  style={{
                    background: 'rgba(253, 252, 248, 0.92)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    color: 'var(--moss)',
                    border: '1px solid rgba(93, 112, 82, 0.25)',
                    boxShadow: '0 2px 8px rgba(44, 44, 36, 0.08)',
                  }}
                >
                  <ShieldCheck style={{ height: 12, width: 12 }} />
                  <span>Stylus Connected • Palm Rejection Active</span>
                </div>
              )}

              {/* Clear Canvas button */}
              <button
                onClick={handleClear}
                className="absolute top-2.5 sm:top-4 right-2.5 sm:right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 hover:scale-105 cursor-pointer shadow-sm"
                style={{
                  background: 'rgba(253,252,248,0.90)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  color: 'var(--fg-muted)',
                  border: '1px solid rgba(93, 112, 82, 0.20)',
                  boxShadow: '0 2px 8px rgba(44,44,36,0.06)',
                }}
                aria-label="Clear signature"
              >
                <RotateCcw style={{ height: 12, width: 12 }} />
                <span>Clear</span>
              </button>

              {/* Faint signature guideline in negative space */}
              <div
                className="absolute bottom-8 sm:bottom-10 left-10 sm:left-14 right-10 sm:right-14 pointer-events-none select-none flex items-center gap-2.5 transition-opacity duration-300"
                style={{
                  opacity: drawnPreview || (drawnPointsRef.current && drawnPointsRef.current.length > 0) ? 0 : 0.28,
                }}
              >
                <span
                  className="font-serif italic text-base sm:text-lg select-none"
                  style={{ color: 'var(--moss)' }}
                >
                  ×
                </span>
                <div
                  className="flex-1 border-b border-dashed"
                  style={{ borderColor: 'var(--moss)' }}
                />
                <span
                  className="text-[10px] sm:text-xs font-semibold tracking-wider uppercase select-none opacity-80"
                  style={{ color: 'var(--moss)' }}
                >
                  Sign on the line
                </span>
              </div>
            </div>

            {/* Signature Name Input */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 pt-1">
              <label className="text-xs font-bold shrink-0" style={{ color: 'var(--fg-muted)' }}>
                Signature Name <span className="font-normal opacity-70">(optional)</span>:
              </label>
              <input
                type="text"
                value={sigLabel}
                onChange={(e) => setSigLabel(e.target.value)}
                className="input-organic h-8 sm:h-9 text-xs flex-1"
                placeholder="e.g. My Formal Signature, Initial…"
              />
            </div>
          </div>

          {/* ── Type ─────────────────────────────────────── */}
          <div
            className="space-y-4"
            style={{ display: activeTab === 'type' ? 'block' : 'none' }}
          >
            <div>
              <label className="block text-xs font-bold mb-2" style={{ color: 'var(--fg-muted)' }}>
                Your Name
              </label>
              <input
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                className="input-organic"
                placeholder="Full name…"
              />
            </div>

            {/* Custom Redesigned Font Dropdown */}
            <div>
              <Dropdown
                label="Signature Font Style"
                value={selectedFont}
                onChange={(val) => setSelectedFont(String(val))}
                options={AVAILABLE_FONTS.map((f) => ({
                  value: f.id,
                  label: f.name,
                  sublabel: f.style,
                  group: f.group,
                  fontFamily: f.id,
                }))}
              />
            </div>

            {/* Preview card */}
            <div>
              <span className="block text-xs font-bold mb-2" style={{ color: 'var(--fg-muted)' }}>
                Preview — {selectedFont}
              </span>
              <div
                className="w-full p-5 rounded-[1.5rem] flex flex-col items-center justify-center overflow-hidden transition-all duration-150"
                style={{
                  background: 'rgba(255,255,255,0.60)',
                  border: '2px solid rgba(93,112,82,0.20)',
                  boxShadow: 'inset 0 2px 10px rgba(44,44,36,0.05)',
                  minHeight: 110,
                }}
              >
                <span
                  className="text-center select-none py-2"
                  style={{ fontFamily: selectedFont, color: penColor, fontSize: 44, lineHeight: 1.2 }}
                >
                  {typedText || 'Your Name'}
                </span>
              </div>
            </div>

            {/* Ink color row */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--fg-muted)' }}>Ink color</span>
              <div className="flex gap-2.5">
                {INK_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => handleColorChange(c.value)}
                    title={c.label}
                    className="h-7 w-7 rounded-full transition-all duration-200 hover:scale-110"
                    style={{
                      backgroundColor: c.value,
                      outline: penColor === c.value ? `3px solid var(--moss)` : '3px solid transparent',
                      outlineOffset: 2,
                    }}
                    aria-label={c.label}
                    aria-pressed={penColor === c.value}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ── Upload ───────────────────────────────────── */}
          <div
            className="space-y-3"
            style={{ display: activeTab === 'upload' ? 'block' : 'none' }}
          >
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg-muted)' }}>
                Signature Name <span className="font-normal opacity-70">(optional)</span>
              </label>
              <input
                type="text"
                value={sigLabel}
                onChange={(e) => setSigLabel(e.target.value)}
                className="input-organic h-9 text-xs"
                placeholder="e.g. Uploaded Signature, Stamp…"
              />
            </div>

            <label
              className="flex flex-col items-center justify-center gap-3 p-8 rounded-[1.5rem] cursor-pointer transition-all duration-300 hover:scale-[1.01]"
              style={{
                background: 'rgba(255,255,255,0.60)',
                border: '2px dashed rgba(93,112,82,0.35)',
                boxShadow: 'inset 0 2px 10px rgba(44,44,36,0.05)',
              }}
            >
              <div
                className="h-12 w-12 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--moss-dim)' }}
              >
                <Upload style={{ height: 22, width: 22, color: 'var(--moss)' }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold" style={{ color: 'var(--fg)' }}>Upload signature image</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                  PNG with transparent background works best
                </p>
              </div>
              <span className="btn-ghost btn-sm">Browse File</span>
              <input type="file" accept="image/png,image/jpeg" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* ── Saved ────────────────────────────────────── */}
          <div
            className="space-y-2 max-h-60 overflow-y-auto pr-1"
            style={{ display: activeTab === 'saved' ? 'block' : 'none' }}
          >
            {savedSigs.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onSelectSignature(s.dataUrl, s.label, {
                    rawSignature: s.rawSignature,
                    printedName: s.printedName,
                    printedNameScale: s.printedNameScale,
                    printedNameSpacing: s.printedNameSpacing,
                  });
                  onClose();
                }}
                className="card-organic w-full p-3 rounded-[1.5rem] flex items-center justify-between transition-all duration-300"
              >
                <img src={s.dataUrl} alt={s.label} className="h-10 max-w-[200px] object-contain" />
                <div className="text-right ml-3">
                  <span className="text-xs font-semibold block" style={{ color: 'var(--fg-muted)' }}>
                    {s.label}
                  </span>
                  {s.isDefault && <span className="badge-moss text-[10px] mt-0.5">Default</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Signature over Printed Name option */}
          {activeTab !== 'saved' && (
            <div
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                includePrintedName
                  ? 'bg-[var(--surface)] border-[var(--moss)]/30 shadow-xs'
                  : 'bg-[var(--bg-stone)]/60 border-[var(--border-light)] hover:border-[var(--border)]'
              }`}
            >
              {/* Header Toggle */}
              <div
                onClick={() => {
                  const nextVal = !includePrintedName;
                  setIncludePrintedName(nextVal);
                  if (nextVal && canvasRef.current) {
                    const bY = getCanvasBottomY(canvasRef.current);
                    if (bY !== null) setSigBottomY(bY);
                  }
                }}
                className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-lg flex items-center justify-center bg-[var(--moss-dim)] text-[var(--moss)]">
                    <Type style={{ height: 13, width: 13 }} />
                  </div>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: 'var(--fg)' }}>
                      Signature over printed name
                    </span>
                    <span className="text-[10px] block" style={{ color: 'var(--fg-muted)' }}>
                      Add your printed full name under the signature
                    </span>
                  </div>
                </div>

                {/* Minimalist Switch Toggle */}
                <div
                  className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${
                    includePrintedName ? 'bg-[var(--moss)]' : 'bg-black/15'
                  }`}
                  role="switch"
                  aria-checked={includePrintedName}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out my-0.5 ${
                      includePrintedName ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </div>

              {/* Collapsible Content */}
              {includePrintedName && (
                <div className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-[var(--border-light)]/60 animate-fadeIn">
                  {/* Name Input */}
                  <input
                    type="text"
                    value={printedName}
                    onChange={(e) => setPrintedName(e.target.value.toUpperCase())}
                    className="w-full h-8.5 px-3 rounded-xl bg-white/90 border border-[var(--border-light)] focus:border-[var(--moss)] text-xs font-bold uppercase tracking-wider text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-muted)]/50 placeholder:font-normal placeholder:normal-case shadow-2xs"
                    placeholder="Enter printed full name..."
                    autoFocus
                  />

                  {/* Slim Minimalist Size Row */}
                  <div className="flex items-center justify-between gap-2 bg-white/50 px-2.5 py-1.5 rounded-xl border border-[var(--border-light)]/60 text-xs">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-bold text-[var(--fg-muted)]">Size</span>
                      <span className="text-[10px] font-mono font-bold text-[var(--moss)] bg-[var(--moss-dim)] px-1.5 py-0.5 rounded-md">
                        {Math.round(nameFontSizeScale * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {[
                        { label: 'Small',  scale: 0.8 },
                        { label: 'Normal', scale: 1.0 },
                        { label: 'Large',  scale: 1.25 },
                        { label: 'XL',     scale: 1.5 },
                      ].map((preset) => {
                        const isActive = Math.abs(nameFontSizeScale - preset.scale) < 0.05;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setNameFontSizeScale(preset.scale)}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                              isActive
                                ? 'bg-[var(--moss)] text-white shadow-2xs'
                                : 'bg-black/5 hover:bg-black/10 text-[var(--fg-muted)]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Slim Minimalist Spacing Row - 100% responsive, never cut off */}
                  <div className="flex items-center justify-between gap-2 bg-white/50 px-2.5 py-1.5 rounded-xl border border-[var(--border-light)]/60 text-xs">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-bold text-[var(--fg-muted)]">Spacing</span>
                      <span className="text-[10px] font-mono font-bold text-[var(--moss)] bg-[var(--moss-dim)] px-1.5 py-0.5 rounded-md">
                        {nameSpacing > 0 ? `+${nameSpacing}px` : `${nameSpacing}px`}
                      </span>
                    </div>

                    <input
                      type="range"
                      min={-15}
                      max={35}
                      step={1}
                      value={nameSpacing}
                      onChange={(e) => setNameSpacing(Number(e.target.value))}
                      className="flex-1 min-w-0 h-1 mx-1.5 rounded-full appearance-none cursor-pointer accent-[var(--moss)] bg-[var(--border-light)]"
                    />

                    {/* Quick Presets: Tight, Normal, Loose */}
                    <div className="flex items-center gap-1 shrink-0">
                      {[
                        { label: 'Tight', val: -6 },
                        { label: 'Normal', val: 8 },
                        { label: 'Loose', val: 22 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setNameSpacing(preset.val)}
                          className={`px-1.5 sm:px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                            (preset.val === -6 && nameSpacing <= -3) ||
                            (preset.val === 8 && nameSpacing >= -2 && nameSpacing <= 14) ||
                            (preset.val === 22 && nameSpacing >= 15)
                              ? 'bg-[var(--moss)] text-white shadow-2xs'
                              : 'bg-black/5 hover:bg-black/10 text-[var(--fg-muted)]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Minimal Live Output Preview */}
                  {printedName.trim() && (
                    <div className="rounded-xl border border-dashed border-[var(--border-light)] bg-white/70 p-2 flex items-center justify-center relative min-h-[60px] max-h-[90px] overflow-hidden select-none">
                      <span className="absolute top-1 right-2 text-[8px] font-bold uppercase tracking-wider text-[var(--fg-muted)] opacity-60">
                        Preview
                      </span>
                      {combinedPreviewUrl ? (
                        <img
                          src={combinedPreviewUrl}
                          alt="Signature preview"
                          className="max-h-16 max-w-[280px] object-contain select-none transition-all duration-75"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center">
                          <span
                            className="italic text-xs leading-none"
                            style={{ color: penColor, fontFamily: 'Caveat, cursive', fontSize: 18 }}
                          >
                            {activeTab === 'draw' && (!drawnPreview && (!sigPadRef.current || sigPadRef.current.isEmpty()))
                              ? 'Signature'
                              : 'Sample Signature'}
                          </span>
                          <span
                            className="font-extrabold uppercase tracking-wider select-none block leading-tight font-sans"
                            style={{
                              color: penColor,
                              marginTop: `${Math.max(2, nameSpacing + 4)}px`,
                              fontSize: `${Math.round(11 * nameFontSizeScale)}px`,
                            }}
                          >
                            {printedName.trim()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Save as default checkbox */}
          {activeTab !== 'saved' && activeTab !== 'upload' && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded accent-[#5D7052]"
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--fg-muted)' }}>
                Save as default for one-tap placement
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 sm:px-5 py-2.5 sm:py-3.5 flex items-center justify-end gap-2 sm:gap-3 shrink-0 border-t border-[var(--border-light)] bg-[var(--surface)]"
        >
          <button
            onClick={onClose}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--fg-muted)' }}
          >
            Cancel
          </button>
          {activeTab !== 'saved' && activeTab !== 'upload' && (
            <button onClick={handleSaveAndSelect} className="btn-primary btn-sm">
              <Check style={{ height: 14, width: 14 }} />
              <span>Use Signature</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
