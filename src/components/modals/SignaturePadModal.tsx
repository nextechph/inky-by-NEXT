import React, { useRef, useState, useEffect } from 'react';
import SignaturePad from 'signature_pad';
import { X, PenTool, Type, Upload, History, Check, RotateCcw, ChevronDown, Minus, Plus } from 'lucide-react';
import { saveSignature, getSavedSignatures } from '../../lib/storage';
import { SavedSignature } from '../../types';
import { trimCanvas, processUploadedSignature, combineSignatureAndName } from '../../utils';
import { useToastStore } from '../../store/useToastStore';

import { Dropdown, DropdownOption } from '../ui/Dropdown';

interface SignaturePadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSignature: (dataUrl: string, label: string) => void;
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
  { id: 'thin',   label: 'Fine',   min: 0.8, max: 2.0, lineWeight: 1.5 },
  { id: 'medium', label: 'Medium', min: 1.5, max: 3.5, lineWeight: 2.5 },
  { id: 'thick',  label: 'Bold',   min: 2.8, max: 5.5, lineWeight: 4 },
] as const;

export type StrokeWidthType = typeof STROKE_WIDTH_OPTIONS[number]['id'];

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  isOpen,
  onClose,
  onSelectSignature,
}) => {
  const [activeTab, setActiveTab]       = useState<'draw' | 'type' | 'upload' | 'saved'>('draw');
  const [typedText, setTypedText]       = useState('Your Name');
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0].id);
  const [penColor, setPenColor]         = useState(INK_COLORS[0].value);
  const [strokeWidth, setStrokeWidth]   = useState<StrokeWidthType>('medium');
  const [sigLabel, setSigLabel]                     = useState('');
  const [includePrintedName, setIncludePrintedName] = useState(false);
  const [printedName, setPrintedName]               = useState('');
  const [nameSpacing, setNameSpacing]               = useState<number>(8);
  const [drawnPreview, setDrawnPreview]             = useState<string | null>(null);
  const [sigBottomY, setSigBottomY]                 = useState<number | null>(null);
  const [combinedPreviewUrl, setCombinedPreviewUrl] = useState<string | null>(null);
  const [isDefault, setIsDefault]                   = useState(true);
  const [savedSigs, setSavedSigs]                   = useState<SavedSignature[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigPadRef = useRef<any | null>(null);
  const drawnPointsRef = useRef<any[] | null>(null);

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

  useEffect(() => {
    if (isOpen) {
      setSavedSigs(getSavedSignatures());
      setActiveTab('draw');
      setDrawnPreview(null);
      setSigBottomY(null);
      setCombinedPreviewUrl(null);
    } else {
      drawnPointsRef.current = null;
      setDrawnPreview(null);
      setSigBottomY(null);
      setCombinedPreviewUrl(null);
    }
  }, [isOpen]);

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
        throttle: 0,
      });
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
      sigPadRef.current.on();
    }

    // Restore any existing strokes onto the newly sized canvas
    if (savedData && savedData.length > 0) {
      sigPadRef.current.fromData(savedData);
      try {
        if (canvasRef.current && !sigPadRef.current.isEmpty()) {
          setDrawnPreview(trimCanvas(canvasRef.current, 4));
          const bY = getCanvasBottomY(canvasRef.current);
          setSigBottomY(bY);
        }
      } catch {
        // ignore
      }
    }
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
        sigPadRef.current.fromData(updatedData);
        try {
          if (canvasRef.current && !sigPadRef.current.isEmpty()) {
            setDrawnPreview(trimCanvas(canvasRef.current, 4));
            const bY = getCanvasBottomY(canvasRef.current);
            setSigBottomY(bY);
          }
        } catch {
          // ignore
        }
      }
    }
  };

  const handleStrokeChange = (newWidth: StrokeWidthType) => {
    setStrokeWidth(newWidth);
    const config = STROKE_WIDTH_OPTIONS.find((s) => s.id === newWidth) || STROKE_WIDTH_OPTIONS[1];
    if (sigPadRef.current) {
      sigPadRef.current.minWidth = config.min;
      sigPadRef.current.maxWidth = config.max;
      const data = sigPadRef.current.toData();
      if (data && data.length > 0) {
        const updatedData = data.map((group: any) => ({
          ...group,
          minWidth: config.min,
          maxWidth: config.max,
        }));
        drawnPointsRef.current = updatedData;
        sigPadRef.current.fromData(updatedData);
        try {
          if (canvasRef.current && !sigPadRef.current.isEmpty()) {
            setDrawnPreview(trimCanvas(canvasRef.current, 4));
            const bY = getCanvasBottomY(canvasRef.current);
            setSigBottomY(bY);
          }
        } catch {
          // ignore
        }
      }
    }
  };

  const handleClear = () => {
    sigPadRef.current?.clear();
    drawnPointsRef.current = null;
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

    // Safeguard: handle pointercancel so drawing doesn't freeze
    const handlePointerCancel = () => {
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
        if (canvasRef.current && sigPadRef.current && !sigPadRef.current.isEmpty()) {
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
            nameSpacing
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
  }, [isOpen, includePrintedName, printedName, nameSpacing, activeTab, penColor, typedText, selectedFont, drawnPreview]);

  if (!isOpen) return null;

  const handleSaveAndSelect = async () => {
    let dataUrl = ''; let label = 'Signature';
    const effectiveName = printedName.trim().toUpperCase();
    if (activeTab === 'draw') {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
        useToastStore.getState().showToast('Please draw a signature first', 'warning');
        return;
      }
      dataUrl = trimCanvas(canvasRef.current!, 8);
      label = sigLabel.trim() || (includePrintedName && effectiveName ? effectiveName : 'Drawn Signature');
    } else if (activeTab === 'type') {
      if (!typedText.trim()) {
        useToastStore.getState().showToast('Please enter your name', 'warning');
        return;
      }
      dataUrl = generateTypedDataUrl(typedText);
      label = sigLabel.trim() || (includePrintedName && effectiveName ? effectiveName : `Typed: ${typedText}`);
    }
    if (dataUrl) {
      if (includePrintedName && effectiveName) {
        dataUrl = await combineSignatureAndName(dataUrl, effectiveName, penColor, undefined, nameSpacing);
      }
      saveSignature({ type: activeTab as any, dataUrl, label, isDefault });
      onSelectSignature(dataUrl, label);
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
        const effectiveName = printedName.trim().toUpperCase();
        if (includePrintedName && effectiveName) {
          cleanResult = await combineSignatureAndName(cleanResult, effectiveName, penColor, undefined, nameSpacing);
        }
        const label = sigLabel.trim() || (includePrintedName && effectiveName ? effectiveName : 'Uploaded Signature');
        saveSignature({ type: 'upload', dataUrl: cleanResult, label, isDefault });
        onSelectSignature(cleanResult, label);
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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card-organic animate-slideUp w-full sm:max-w-xl rounded-[1.75rem] sm:rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl"
        style={{
          maxHeight: 'min(96dvh, 880px)',
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
              Create Signature
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
              className="relative rounded-[1.25rem] sm:rounded-[1.5rem] overflow-hidden select-none h-44 xs:h-52 sm:h-64"
              style={{
                background: 'rgba(255,255,255,0.65)',
                border: '2px dashed rgba(93,112,82,0.30)',
                boxShadow: 'inset 0 2px 12px rgba(44,44,36,0.06)',
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
              <button
                onClick={handleClear}
                className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-200 hover:scale-105"
                style={{
                  background: 'rgba(253,252,248,0.85)',
                  color: 'var(--fg-muted)',
                  border: '1px solid var(--border)',
                }}
                aria-label="Clear signature"
              >
                <RotateCcw style={{ height: 11, width: 11 }} />
                <span>Clear</span>
              </button>
            </div>

            {/* Ink color swatches */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--fg-muted)' }}>Ink color</span>
              <div className="flex gap-2.5">
                {INK_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
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

            {/* Stroke thickness selector */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--fg-muted)' }}>Stroke thickness</span>
              <div
                className="flex items-center gap-1 p-1 rounded-full"
                style={{ background: 'var(--bg-stone)', border: '1px solid var(--border-light)' }}
              >
                {STROKE_WIDTH_OPTIONS.map((sw) => {
                  const isActive = strokeWidth === sw.id;
                  return (
                    <button
                      key={sw.id}
                      type="button"
                      onClick={() => handleStrokeChange(sw.id)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all duration-200"
                      style={{
                        background: isActive ? 'var(--moss)' : 'transparent',
                        color: isActive ? '#F3F4F1' : 'var(--fg-muted)',
                        boxShadow: isActive ? '0 2px 8px rgba(93,112,82,0.25)' : 'none',
                      }}
                      aria-pressed={isActive}
                      title={`${sw.label} stroke`}
                    >
                      <span
                        className="rounded-full inline-block"
                        style={{
                          width: 14,
                          height: sw.lineWeight,
                          backgroundColor: isActive ? '#F3F4F1' : 'currentColor',
                        }}
                      />
                      <span>{sw.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Signature Name Input */}
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg-muted)' }}>
                Signature Name <span className="font-normal opacity-70">(optional)</span>
              </label>
              <input
                type="text"
                value={sigLabel}
                onChange={(e) => setSigLabel(e.target.value)}
                className="input-organic h-9 text-xs"
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
                onClick={() => { onSelectSignature(s.dataUrl, s.label); onClose(); }}
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
            <div className="p-3.5 rounded-2xl bg-[var(--bg-stone)] border border-[var(--border-light)] space-y-3">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-xl flex items-center justify-center bg-[var(--moss-dim)] text-[var(--moss)]">
                    <Type style={{ height: 14, width: 14 }} />
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
                <input
                  type="checkbox"
                  checked={includePrintedName}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIncludePrintedName(checked);
                    if (checked && canvasRef.current) {
                      const bY = getCanvasBottomY(canvasRef.current);
                      if (bY !== null) setSigBottomY(bY);
                    }
                  }}
                  className="rounded accent-[var(--moss)] h-4 w-4 cursor-pointer"
                />
              </label>

              {includePrintedName && (
                <div className="space-y-3 pt-2.5 border-t border-[var(--border-light)] animate-fadeIn">
                  <div>
                    <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--fg-muted)' }}>
                      Printed Full Name
                    </label>
                    <input
                      type="text"
                      value={printedName}
                      onChange={(e) => setPrintedName(e.target.value.toUpperCase())}
                      className="input-organic h-9 text-xs font-bold uppercase tracking-wider"
                      placeholder="e.g. JOHN DOE"
                      autoFocus
                    />
                  </div>

                  {/* Name Distance / Spacing Controls */}
                  <div className="space-y-2 p-2.5 rounded-xl bg-white/60 border border-[var(--border-light)]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold" style={{ color: 'var(--fg)' }}>
                          Name Spacing
                        </span>
                        <span className="text-[10px] text-[var(--fg-muted)]">
                          (Distance from signature)
                        </span>
                      </div>
                      <span
                        className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-md"
                        style={{
                          background: 'rgba(93,112,82,0.12)',
                          color: 'var(--moss)',
                        }}
                      >
                        {nameSpacing > 0 ? `+${nameSpacing}px` : `${nameSpacing}px`}
                      </span>
                    </div>

                    {/* Step buttons and slider */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setNameSpacing((prev) => Math.max(-15, prev - 2))}
                        title="Closer to signature"
                        className="h-7 w-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:bg-black/5 active:scale-95 select-none"
                        style={{ border: '1px solid var(--border-light)', color: 'var(--fg)' }}
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={-15}
                        max={35}
                        step={1}
                        value={nameSpacing}
                        onChange={(e) => setNameSpacing(Number(e.target.value))}
                        className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-[var(--moss)] bg-[var(--border-light)]"
                      />
                      <button
                        type="button"
                        onClick={() => setNameSpacing((prev) => Math.min(35, prev + 2))}
                        title="Farther from signature"
                        className="h-7 w-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:bg-black/5 active:scale-95 select-none"
                        style={{ border: '1px solid var(--border-light)', color: 'var(--fg)' }}
                      >
                        +
                      </button>
                    </div>

                    {/* Preset buttons */}
                    <div className="flex items-center justify-between text-[10px] pt-0.5">
                      <span className="text-[10px] text-[var(--fg-muted)] font-medium">
                        ◀ Closer
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setNameSpacing(-6)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                            nameSpacing <= -3
                              ? 'bg-[var(--moss)] text-white shadow-sm'
                              : 'bg-black/5 hover:bg-black/10 text-[var(--fg-muted)]'
                          }`}
                        >
                          Tight (-6px)
                        </button>
                        <button
                          type="button"
                          onClick={() => setNameSpacing(8)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                            nameSpacing >= 4 && nameSpacing <= 14
                              ? 'bg-[var(--moss)] text-white shadow-sm'
                              : 'bg-black/5 hover:bg-black/10 text-[var(--fg-muted)]'
                          }`}
                        >
                          Normal (8px)
                        </button>
                        <button
                          type="button"
                          onClick={() => setNameSpacing(22)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                            nameSpacing >= 18
                              ? 'bg-[var(--moss)] text-white shadow-sm'
                              : 'bg-black/5 hover:bg-black/10 text-[var(--fg-muted)]'
                          }`}
                        >
                          Loose (22px)
                        </button>
                      </div>
                      <span className="text-[10px] text-[var(--fg-muted)] font-medium">
                        Farther ▶
                      </span>
                    </div>
                  </div>

                  {/* Live Mini Preview */}
                  {printedName.trim() && (
                    <div
                      className="p-3 rounded-xl border border-[rgba(93,112,82,0.25)] bg-white/80 flex flex-col items-center justify-center overflow-hidden transition-all duration-100 shadow-sm"
                      style={{ minHeight: 80 }}
                    >
                      <div className="flex items-center justify-between w-full mb-1.5 select-none px-1">
                        <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--fg)] opacity-80">
                          Live Preview (Produced Signature)
                        </span>
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--moss-dim)] text-[var(--moss)]">
                          Exact Output
                        </span>
                      </div>
                      <div className="flex flex-col items-center justify-center w-full">
                        {combinedPreviewUrl ? (
                          <img
                            src={combinedPreviewUrl}
                            alt="Live Preview"
                            className="max-h-24 max-w-[320px] object-contain select-none transition-all duration-75"
                          />
                        ) : activeTab === 'draw' && (!drawnPreview && (!sigPadRef.current || sigPadRef.current.isEmpty())) ? (
                          <div className="text-center py-2">
                            <span
                              className="block italic text-xs mb-1"
                              style={{ color: penColor, fontFamily: 'Caveat, cursive', fontSize: 20 }}
                            >
                              Draw signature on pad above
                            </span>
                            <span
                              className="font-extrabold uppercase tracking-wider text-[11px] text-center select-none block"
                              style={{ color: penColor, fontFamily: 'Inter, system-ui, sans-serif' }}
                            >
                              {printedName.trim().toUpperCase()}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center">
                            <span
                              className="italic text-xs mb-1"
                              style={{ color: penColor, fontFamily: 'Caveat, cursive', fontSize: 22 }}
                            >
                              Sample Signature
                            </span>
                            <span
                              className="font-extrabold uppercase tracking-wider text-[11px] text-center select-none"
                              style={{
                                color: penColor,
                                marginTop: `${nameSpacing}px`,
                                fontFamily: 'Inter, system-ui, sans-serif',
                              }}
                            >
                              {printedName.trim().toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-[var(--fg-muted)] leading-tight">
                    Signature and printed name will be merged into a single element so they stay together on the document.
                  </p>
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
