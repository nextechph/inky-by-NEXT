import React, { useEffect, useState, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  FileCheck2,
  PenTool,
  Calendar,
  Type,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Send,
  Download,
  AlertCircle,
  ShieldCheck,
  Leaf,
  User,
  Move,
  Plus,
  PlusCircle,
  ChevronDown,
  Trash2,
  Home,
  FileSignature,
  Pencil,
} from 'lucide-react';
import { deliveryService } from '../services/deliveryService';
import { Recipient, Document, SignatureField, SavedSignature } from '../types';
import { SignaturePadModal } from './modals/SignaturePadModal';
import { useToastStore } from '../store/useToastStore';
import { getSignerColor, TEXT_FONT_OPTIONS } from './PdfViewer';
import { Dropdown } from './ui/Dropdown';
import { FastTextInput } from './ui/FastTextInput';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import * as storage from '../lib/storage';
import { getSavedSignatures, getDefaultSignature, getLocalPdfBlob } from '../lib/storage';
import { flattenPdfSignatures } from '../lib/pdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface SignerPortalProps {
  token: string;
  onBack?: () => void;
}

export const SignerPortal: React.FC<SignerPortalProps> = ({ token, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<{
    recipient: Recipient;
    document: Document;
    fields: SignatureField[];
    pdfBlob: Blob | null;
  } | null>(null);

  // PDF render state
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.15);
  const userZoomedRef = useRef<boolean>(false);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Dynamic fields state (starts with context.fields, supports signer adding fields on the fly)
  const [fields, setFields] = useState<SignatureField[]>([]);
  // Local field value changes by this signer
  const [fieldValues, setFieldValues] = useState<Record<string, { value: string; fontFamily?: string }>>({});
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);
  const [recentSignature, setRecentSignature] = useState<SavedSignature | null>(() => {
    return getDefaultSignature() || getSavedSignatures()[0] || null;
  });
  const [activeSigFieldId, setActiveSigFieldId] = useState<string | null>(null);
  const [pendingAddCoords, setPendingAddCoords] = useState<{ x: number; y: number } | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>({ x: 0, y: 0, width: 0, height: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<{ allComplete: boolean; message: string } | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [canvasMountedVersion, setCanvasMountedVersion] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (node) {
      setCanvasMountedVersion((v) => v + 1);
    }
  }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sigDropdownRef = useRef<HTMLDivElement | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [isSigDropdownOpen, setIsSigDropdownOpen] = useState(false);
  const hasDraggedRef = useRef(false);
  const dragJustEndedRef = useRef(false);
  const isPinchingRef = useRef<boolean>(false);
  const pinchDataRef = useRef<{
    initialDist: number;
    initialScale: number;
    factor: number;
    midClientX: number;
    midClientY: number;
    originX: number;
    originY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sigDropdownRef.current && !sigDropdownRef.current.contains(e.target as Node)) {
        setIsSigDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSigDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Load context on mount / when token changes
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setContext(null);
    setFields([]);
    setFieldValues({});
    setSelectedFieldId(null);
    setSubmittedResult(null);
    setIsReopening(false);

    deliveryService.getSignerContext(token)
      .then((ctx) => {
        if (!isMounted) return;
        setContext(ctx);
        if (ctx) {
          setFields(ctx.fields);
          // Initialize already-filled fields
          const initial: Record<string, { value: string; fontFamily?: string }> = {};
          ctx.fields.forEach((f) => {
            if (f.value) initial[f.id] = { value: f.value, fontFamily: f.fontFamily };
          });
          setFieldValues(initial);
        }
      })
      .catch((err) => {
        console.error('Failed to load signing session', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [token]);

  // Realtime subscription for live field updates from other signers
  useEffect(() => {
    if (!context?.document?.id || !isSupabaseConfigured() || !supabase) return;

    const channelName = `signer-fields-${context.document.id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'signature_fields',
          filter: `document_id=eq.${context.document.id}`,
        },
        (payload: any) => {
          const updated = payload.new;
          if (updated && updated.value) {
            setFieldValues((prev) => ({
              ...prev,
              [updated.id]: { value: updated.value, fontFamily: updated.font_family },
            }));
            setFields((prev) =>
              prev.map((f) =>
                f.id === updated.id
                  ? { ...f, value: updated.value, fontFamily: updated.font_family }
                  : f
              )
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signature_fields',
          filter: `document_id=eq.${context.document.id}`,
        },
        (payload: any) => {
          const inserted = payload.new;
          if (inserted) {
            setFields((prev) => {
              if (prev.some((f) => f.id === inserted.id)) return prev;
              return [
                ...prev,
                {
                  id: inserted.id,
                  documentId: inserted.document_id,
                  pageNumber: inserted.page_number,
                  x: inserted.x,
                  y: inserted.y,
                  width: inserted.width,
                  height: inserted.height,
                  fieldType: inserted.field_type,
                  value: inserted.value,
                  fontFamily: inserted.font_family,
                  required: inserted.required,
                  signerId: inserted.signer_id,
                  signerEmail: inserted.signer_email,
                  signerOrder: inserted.signer_order,
                  signerName: inserted.signer_name,
                },
              ];
            });
            if (inserted.value) {
              setFieldValues((prev) => ({
                ...prev,
                [inserted.id]: { value: inserted.value, fontFamily: inserted.font_family },
              }));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [context?.document?.id]);

  const getContainerFitScale = useCallback((unscaledWidth: number, unscaledHeight: number) => {
    let availW = window.innerWidth - 20;
    let availH = window.innerHeight - 200;

    if (scrollContainerRef.current) {
      const rect = scrollContainerRef.current.getBoundingClientRect();
      if (rect.width > 50) availW = rect.width - (window.innerWidth < 640 ? 16 : 32);
      if (rect.height > 50) availH = rect.height - (window.innerWidth < 640 ? 16 : 32);
    }

    const scaleW = availW / unscaledWidth;
    const scaleH = availH / unscaledHeight;

    if (window.innerWidth < 640) {
      // Fit both width and height so it fits any phone screen perfectly
      const fit = Math.min(scaleW, scaleH);
      return Math.round(Math.min(1.15, Math.max(0.25, fit)) * 100) / 100;
    }

    return Math.round(Math.min(1.4, Math.max(0.5, scaleW)) * 100) / 100;
  }, []);

  // Load PDF Document when pdfBlob is available, with cloud & local fallbacks
  useEffect(() => {
    let isMounted = true;

    const loadPdf = async () => {
      try {
        let blob = context?.pdfBlob;

        // Fallback 1: download from Supabase storage if file_path is known
        if (!blob && context?.document?.filePath && isSupabaseConfigured() && supabase) {
          try {
            const { data } = await supabase.storage.from('documents').download(context.document.filePath);
            if (data) blob = data;
          } catch (e) {
            console.warn('Supabase storage download fallback notice:', e);
          }
        }

        // Fallback 2: local storage
        if (!blob && context?.document?.id) {
          try {
            const localBlob = await getLocalPdfBlob(context.document.id);
            if (localBlob) blob = localBlob;
          } catch (e) {
            console.warn('Local storage pdf blob fallback notice:', e);
          }
        }

        if (!blob) return;

        const arrayBuffer = await blob.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          try {
            const firstPage = await doc.getPage(1);
            const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
            const fitScale = getContainerFitScale(unscaledViewport.width, unscaledViewport.height);
            setScale(fitScale);
          } catch (scaleErr) {
            console.warn('Error calculating mobile fit scale in signer portal:', scaleErr);
          }
          setCanvasMountedVersion((v) => v + 1);
        }
      } catch (err) {
        console.error('Error rendering PDF:', err);
      }
    };

    if (context) {
      loadPdf();
    }
    return () => { isMounted = false; };
  }, [context?.pdfBlob, context?.document?.id, context?.document?.filePath, getContainerFitScale]);

  useEffect(() => {
    if (!scrollContainerRef.current || !pdfDoc) return;
    const observer = new ResizeObserver(() => {
      if (window.innerWidth >= 640) return;
      if (userZoomedRef.current) return;
      pdfDoc.getPage(currentPage).then((page: any) => {
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const fitScale = getContainerFitScale(unscaledViewport.width, unscaledViewport.height);
        setScale(fitScale);
      }).catch(() => {});
    });
    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, [pdfDoc, currentPage, getContainerFitScale]);

  // Render current PDF page - re-runs immediately when canvas mounts, page changes, scale changes, or when reopening/editing
  useEffect(() => {
    let renderTask: any = null;
    let isMounted = true;

    const renderPage = async () => {
      const canvas = canvasRef.current;
      if (!pdfDoc || !canvas) return;
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (!isMounted) return;

        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setCanvasDimensions({ width: viewport.width, height: viewport.height });

        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', err);
        }
      }
    };

    renderPage();
    return () => {
      isMounted = false;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfDoc, currentPage, scale, canvasMountedVersion, isReopening, submittedResult]);

  // Mobile double-tap to zoom in / reset to fit
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  const handleDocumentTouchEnd = useCallback((e: React.TouchEvent) => {
    if (isPinchingRef.current || draggingFieldId || isResizing) return;
    if (e.changedTouches.length !== 1) return;

    const touch = e.changedTouches[0];
    const now = Date.now();
    const prev = lastTapRef.current;
    const timeDiff = now - prev.time;
    const dist = Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y);

    if (timeDiff > 50 && timeDiff < 320 && dist < 35) {
      // Double-tap detected!
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      if (pdfDoc) {
        pdfDoc.getPage(currentPage).then((page: any) => {
          const unscaled = page.getViewport({ scale: 1.0 });
          const fitScale = getContainerFitScale(unscaled.width, unscaled.height);

          if (scale > fitScale * 1.25) {
            // Already zoomed in -> reset to fit screen
            userZoomedRef.current = false;
            setScale(fitScale);
          } else {
            // Zoom in focused on tap point (~1.75x)
            userZoomedRef.current = true;
            const newScale = Math.min(2.5, Math.round(fitScale * 1.75 * 100) / 100);
            setScale(newScale);

            if (scrollContainerRef.current) {
              const scrollEl = scrollContainerRef.current;
              const scrollRect = scrollEl.getBoundingClientRect();
              const clickRelX = touch.clientX - scrollRect.left;
              const clickRelY = touch.clientY - scrollRect.top;
              const factor = newScale / scale;
              const newLeft = (scrollEl.scrollLeft + clickRelX) * factor - clickRelX;
              const newTop = (scrollEl.scrollTop + clickRelY) * factor - clickRelY;

              requestAnimationFrame(() => {
                scrollEl.scrollLeft = Math.max(0, newLeft);
                scrollEl.scrollTop = Math.max(0, newTop);
              });
            }
          }
        });
      }
    } else {
      lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
    }
  }, [pdfDoc, currentPage, scale, draggingFieldId, isResizing, getContainerFitScale]);

  // Mobile pinch-to-zoom touch gesture handling (GPU-accelerated 60fps transform)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const startPinch = (t1: Touch, t2: Touch) => {
      if (!containerRef.current || !scrollContainerRef.current) return;
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      if (dist < 10) return;

      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const rect = containerRef.current.getBoundingClientRect();
      const originX = midX - rect.left;
      const originY = midY - rect.top;

      isPinchingRef.current = true;
      pinchDataRef.current = {
        initialDist: dist,
        initialScale: scale,
        factor: 1,
        midClientX: midX,
        midClientY: midY,
        originX,
        originY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      };

      containerRef.current.style.transformOrigin = `${originX}px ${originY}px`;
      containerRef.current.style.transition = 'none';
      containerRef.current.style.willChange = 'transform';
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startPinch(e.touches[0], e.touches[1]);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        if (!isPinchingRef.current || !pinchDataRef.current) {
          startPinch(e.touches[0], e.touches[1]);
        }
        if (isPinchingRef.current && pinchDataRef.current) {
          if (e.cancelable) e.preventDefault();
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          const factor = currentDist / pinchDataRef.current.initialDist;
          pinchDataRef.current.factor = factor;

          if (containerRef.current) {
            containerRef.current.style.transform = `scale(${factor})`;
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (isPinchingRef.current && e.touches.length < 2) {
        isPinchingRef.current = false;
        const data = pinchDataRef.current;
        pinchDataRef.current = null;
        if (!data || !containerRef.current) return;

        const factor = data.factor;
        if (Math.abs(factor - 1) < 0.02) {
          containerRef.current.style.transform = '';
          containerRef.current.style.transformOrigin = '';
          containerRef.current.style.willChange = 'auto';
          return;
        }

        const targetScale = Math.min(3.0, Math.max(0.35, Math.round(data.initialScale * factor * 100) / 100));
        userZoomedRef.current = true;

        containerRef.current.style.transform = '';
        containerRef.current.style.transformOrigin = '';
        containerRef.current.style.willChange = 'auto';

        const scrollRect = el.getBoundingClientRect();
        const relMidX = data.midClientX - scrollRect.left;
        const relMidY = data.midClientY - scrollRect.top;
        const newScrollLeft = (data.scrollLeft + relMidX) * factor - relMidX;
        const newScrollTop  = (data.scrollTop  + relMidY) * factor - relMidY;

        setScale(targetScale);

        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft = Math.max(0, newScrollLeft);
            scrollContainerRef.current.scrollTop  = Math.max(0, newScrollTop);
          }
        });
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scale]);

  // Dragging event handlers for mouse & touch
  const startDrag = (fieldId: string, clientX: number, clientY: number, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    if (isResizing) return;
    setSelectedFieldId(fieldId);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const currentFields = fieldsRef.current;
    const field = currentFields.find((f) => f.id === fieldId);
    if (!field) return;

    const fieldPxX = (field.x / 100) * rect.width;
    const fieldPxY = (field.y / 100) * rect.height;

    hasDraggedRef.current = false;
    dragJustEndedRef.current = false;
    setDraggingFieldId(fieldId);
    setDragOffset({
      x: clientX - rect.left - fieldPxX,
      y: clientY - rect.top - fieldPxY,
    });
  };

  const onDragMove = (clientX: number, clientY: number) => {
    if (!draggingFieldId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const currentFields = fieldsRef.current;
    const field = currentFields.find((f) => f.id === draggingFieldId);
    if (!field) return;

    const mouseX = clientX - rect.left - dragOffset.x;
    const mouseY = clientY - rect.top - dragOffset.y;

    const pctX = Math.max(0, Math.min(100 - field.width, (mouseX / rect.width) * 100));
    const pctY = Math.max(0, Math.min(100 - field.height, (mouseY / rect.height) * 100));

    hasDraggedRef.current = true;

    setFields((prev) =>
      prev.map((f) =>
        f.id === draggingFieldId
          ? { ...f, x: Math.round(pctX * 10) / 10, y: Math.round(pctY * 10) / 10 }
          : f
      )
    );
  };

  // Corner Resizing event handlers
  const startResize = (fieldId: string, clientX: number, clientY: number, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    const field = fieldsRef.current.find((f) => f.id === fieldId);
    if (!field) return;

    setIsResizing(true);
    setSelectedFieldId(fieldId);
    setResizeStart({
      x: clientX,
      y: clientY,
      width: field.width,
      height: field.height,
    });
  };

  const onResizeMove = (clientX: number, clientY: number) => {
    if (!isResizing || !selectedFieldId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const currentFields = fieldsRef.current;
    const field = currentFields.find((f) => f.id === selectedFieldId);
    if (!field) return;

    const deltaX = ((clientX - resizeStart.x) / rect.width) * 100;
    const deltaY = ((clientY - resizeStart.y) / rect.height) * 100;

    const minWidth = 8;
    const maxWidth = Math.min(85, 100 - field.x);
    const newWidth = Math.max(minWidth, Math.min(maxWidth, resizeStart.width + deltaX));

    const aspect = resizeStart.width / (resizeStart.height || 1);
    const newHeight = field.fieldType === 'signature' || field.fieldType === 'initials'
      ? Math.max(3, Math.min(50, newWidth / aspect))
      : Math.max(3, Math.min(50, resizeStart.height + deltaY));

    setFields((prev) =>
      prev.map((f) =>
        f.id === selectedFieldId
          ? {
              ...f,
              width: Math.round(newWidth * 10) / 10,
              height: Math.round(newHeight * 10) / 10,
            }
          : f
      )
    );
  };

  useEffect(() => {
    if (!draggingFieldId && !isResizing) return;

    const handlePointerMove = (e: MouseEvent) => {
      if (isResizing) {
        onResizeMove(e.clientX, e.clientY);
      } else if (draggingFieldId) {
        onDragMove(e.clientX, e.clientY);
      }
    };
    const handlePointerUp = () => {
      if (hasDraggedRef.current) {
        dragJustEndedRef.current = true;
        setTimeout(() => {
          dragJustEndedRef.current = false;
          hasDraggedRef.current = false;
        }, 200);
      }
      setDraggingFieldId(null);
      setIsResizing(false);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        if (isResizing) {
          onResizeMove(e.touches[0].clientX, e.touches[0].clientY);
        } else if (draggingFieldId) {
          onDragMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }
    };
    const handleTouchEnd = () => {
      if (hasDraggedRef.current) {
        dragJustEndedRef.current = true;
        setTimeout(() => {
          dragJustEndedRef.current = false;
          hasDraggedRef.current = false;
        }, 200);
      }
      setDraggingFieldId(null);
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [draggingFieldId, isResizing, resizeStart, selectedFieldId, dragOffset]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[var(--bg)]">
        <div className="text-center space-y-4">
          <div className="h-12 w-12 rounded-full border-3 border-[var(--terracotta)] border-t-transparent animate-spin mx-auto" />
          <p className="font-display font-medium text-sm text-[var(--fg-muted)]">
            Loading secure signing portal...
          </p>
        </div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
        <div className="card-organic max-w-md w-full p-8 text-center space-y-4 rounded-[2.5rem]">
          <div className="h-16 w-16 rounded-[1.5rem] flex items-center justify-center mx-auto bg-red-100/60 dark:bg-red-950/40">
            <AlertCircle className="h-8 w-8 text-[#A85448]" />
          </div>
          <h3 className="font-display font-bold text-xl text-[var(--fg)]">
            Signing Link Invalid or Expired
          </h3>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
            This secure signing invitation is either invalid or has already expired. Please request a new link from the document sender.
          </p>
        </div>
      </div>
    );
  }

  const { recipient, document: doc } = context;

  const handleGoHome = () => {
    if (onBack) {
      onBack();
    } else {
      window.location.href = '/';
    }
  };

  const handleDownloadSignedPdf = async () => {
    let baseBlob = context?.pdfBlob;

    // Fallback 1: download from Supabase storage if file_path is known
    if (!baseBlob && context?.document?.filePath && isSupabaseConfigured() && supabase) {
      try {
        const { data } = await supabase.storage.from('documents').download(context.document.filePath);
        if (data) baseBlob = data;
      } catch (e) {
        console.warn('Supabase storage download fallback notice:', e);
      }
    }

    // Fallback 2: local storage
    if (!baseBlob && doc?.id) {
      try {
        const localBlob = await getLocalPdfBlob(doc.id);
        if (localBlob) baseBlob = localBlob;
      } catch (e) {
        console.warn('Local storage pdf blob fallback notice:', e);
      }
    }

    if (!baseBlob) {
      useToastStore.getState().showToast('Original PDF file data not available', 'error');
      return;
    }

    setIsExporting(true);
    try {
      // 1. Merge latest fields with current fieldValues
      const mergedFields: SignatureField[] = fields.map((f) => {
        const local = fieldValues[f.id];
        return {
          ...f,
          value: local?.value ?? f.value ?? '',
          fontFamily: local?.fontFamily ?? f.fontFamily,
        };
      });

      // 2. Read arrayBuffer from baseBlob
      const arrayBuffer = await baseBlob.arrayBuffer();
      const rawBytes = new Uint8Array(arrayBuffer);

      // 3. Flatten signatures, dates, and text onto the PDF
      const signedBytes = await flattenPdfSignatures(rawBytes, mergedFields, {
        signerName: recipient?.name,
        signerEmail: recipient?.email,
      });

      // 4. Cache into local storage
      if (doc?.id) {
        try {
          await storage.storeSignedPdfBytes(doc.id, signedBytes);
        } catch (_e) {
          // non-critical
        }
      }

      // 5. Trigger download
      const safeTitle = (doc.title || 'signed_document').replace(/\.pdf$/i, '');
      const blob = new Blob([signedBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      useToastStore.getState().showToast('Signed PDF exported successfully!', 'success');
    } catch (err: any) {
      console.error('Failed to export signed PDF:', err);
      useToastStore.getState().showToast(err.message || 'Failed to export signed PDF', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPdf = handleDownloadSignedPdf;

  // Check if this recipient already signed previously (and hasn't chosen to reopen/edit)
  if (recipient.status === 'signed' && !submittedResult && !isReopening) {
    return (
      <div
        onClick={handleGoHome}
        className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)] cursor-pointer"
        title="Click anywhere to return to home page"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="card-organic max-w-md w-full p-8 text-center space-y-5 rounded-[2.5rem] animate-fadeIn cursor-default shadow-xl border border-[var(--border-light)]"
        >
          <div className="h-16 w-16 rounded-[1.5rem] flex items-center justify-center mx-auto bg-[var(--moss-dim)]">
            <CheckCircle2 className="h-8 w-8 text-[var(--moss)]" />
          </div>
          <div>
            <h3 className="font-display font-bold text-xl text-[var(--fg)]">
              Document Already Signed
            </h3>
            <p className="text-xs text-[var(--fg-muted)] mt-1.5 leading-relaxed">
              Hello <strong>{recipient.name}</strong>, you have already completed your signature on <strong>"{doc.title}"</strong>.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[var(--bg-stone)] border border-[var(--border-light)] text-xs text-left space-y-1">
            <div className="flex justify-between">
              <span className="text-[var(--fg-muted)]">Signed By:</span>
              <span className="font-bold text-[var(--fg)]">{recipient.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--fg-muted)]">Email:</span>
              <span className="text-[var(--fg)]">{recipient.email}</span>
            </div>
            {recipient.signedAt && (
              <div className="flex justify-between">
                <span className="text-[var(--fg-muted)]">Timestamp:</span>
                <span className="text-[var(--fg)]">{new Date(recipient.signedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
          <div className="pt-2 flex flex-col gap-2.5">
            <button
              onClick={() => {
                setIsReopening(true);
                setCanvasMountedVersion((v) => v + 1);
              }}
              className="btn-primary w-full justify-center text-xs py-3 flex items-center gap-2 shadow-sm cursor-pointer"
              style={{ background: 'var(--moss)' }}
            >
              <Pencil className="h-4 w-4" />
              <span>Reopen & Edit Signature</span>
            </button>

            {context.pdfBlob && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadSignedPdf();
                }}
                disabled={isExporting}
                className="btn-outline w-full justify-center text-xs py-2.5 flex items-center gap-2 cursor-pointer"
              >
                {isExporting ? (
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--moss)] border-t-transparent" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>{isExporting ? 'Generating Signed PDF...' : 'Download Signed Document'}</span>
              </button>
            )}

            <button
              onClick={handleGoHome}
              className="btn-ghost w-full justify-center text-xs py-2 flex items-center gap-2 opacity-80 hover:opacity-100 cursor-pointer"
            >
              <Home className="h-4 w-4" />
              <span>Back to Home Page</span>
            </button>
          </div>
          <p className="text-[10px] text-[var(--fg-muted)] opacity-70">
            Click anywhere outside or a button above to proceed
          </p>
        </div>
      </div>
    );
  }

  // Check if successfully submitted just now
  if (submittedResult) {
    return (
      <div
        onClick={handleGoHome}
        className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)] font-sans cursor-pointer"
        title="Click anywhere to return to home page"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="card-organic max-w-xl w-full p-6 sm:p-8 text-center space-y-6 rounded-[2.5rem] animate-fadeIn cursor-default shadow-2xl border border-[var(--border-light)] overflow-hidden"
        >
          <div className="h-18 w-18 rounded-[1.75rem] flex items-center justify-center mx-auto bg-[var(--moss-dim)]">
            <CheckCircle2 className="h-10 w-10 text-[var(--moss)]" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full bg-[var(--moss-dim)] text-[var(--moss)] mb-2">
              <ShieldCheck className="h-3.5 w-3.5" /> Legally Binding Signature Recorded
            </span>
            <h2 className="font-display font-bold text-2xl text-[var(--fg)]">
              Thank You, {recipient.name}!
            </h2>
            <p className="text-xs text-[var(--fg-muted)] mt-2 leading-relaxed">
              {submittedResult.message}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[var(--bg-stone)] border border-[var(--border-light)] text-xs text-left space-y-2">
            <div className="font-bold text-[var(--fg)]">{doc.title}</div>
            <p className="text-[11px] text-[var(--fg-muted)]">
              {submittedResult.allComplete
                ? 'All parties have signed! A sealed copy with the complete audit trail has been archived.'
                : 'The next signer in sequence has been notified to complete their signature.'}
            </p>
          </div>

          <div className={`grid grid-cols-1 ${context.pdfBlob ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2.5 pt-1 w-full`}>
            <button
              onClick={() => {
                setSubmittedResult(null);
                setIsReopening(true);
                setCanvasMountedVersion((v) => v + 1);
              }}
              className="btn-outline w-full !px-2.5 sm:!px-3 !h-11 text-xs flex items-center justify-center gap-1.5 cursor-pointer min-w-0"
              title="Edit or adjust your signature"
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate whitespace-nowrap">Edit / Re-sign</span>
            </button>

            {context.pdfBlob && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadSignedPdf();
                }}
                disabled={isExporting}
                className="btn-outline w-full !px-2.5 sm:!px-3 !h-11 text-xs flex items-center justify-center gap-1.5 cursor-pointer min-w-0"
                title="Download a copy of the signed PDF"
              >
                {isExporting ? (
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-[var(--moss)] border-t-transparent" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate whitespace-nowrap">{isExporting ? 'Generating...' : 'Download Signed PDF'}</span>
              </button>
            )}

            <button
              onClick={handleGoHome}
              className="btn-primary w-full !px-2.5 sm:!px-3 !h-11 text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer min-w-0"
              style={{ background: 'var(--moss)' }}
              title="Return to the home page"
            >
              <Home className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate whitespace-nowrap">Back to Home</span>
            </button>
          </div>

          <p className="text-[11px] text-[var(--fg-muted)] opacity-70">
            Click anywhere outside or the button above to return to the home page
          </p>
        </div>
      </div>
    );
  }

  // Determine which fields belong to this recipient
  const isMyField = (field: SignatureField) => {
    // 1. Explicit owner field (signerOrder === 0) belongs to sender/owner, never to recipient
    if (field.signerOrder === 0) {
      return false;
    }

    // 2. Explicit sender email match belongs to sender/owner
    if (doc?.senderEmail && field.signerEmail && field.signerEmail.toLowerCase() === doc.senderEmail.toLowerCase()) {
      return false;
    }

    // 3. Explicit signer order (> 0)
    if (typeof field.signerOrder === 'number' && field.signerOrder > 0) {
      return field.signerOrder === recipient.signingOrder;
    }

    // 4. Explicit signer email
    if (field.signerEmail) {
      return field.signerEmail.toLowerCase() === recipient.email.toLowerCase();
    }

    // 5. Explicit signer ID
    if (field.signerId) {
      return field.signerId === recipient.id;
    }

    // 6. If the field was signed/filled by this recipient in this browser session
    if (fieldValues[field.id]?.value) {
      return true;
    }

    // 7. Unassigned field that ALREADY has a value from the document
    // (signed by the document creator/owner prior to sending) -> cannot be claimed or overwritten by recipient
    if (field.value) {
      return false;
    }

    // 8. Otherwise, an empty unassigned placeholder can be filled by this recipient
    return true;
  };

  const myFields = fields.filter(isMyField);
  const myRequiredFields = myFields.filter((f) => f.required);
  const myPendingFields = myRequiredFields.filter((f) => !fieldValues[f.id]?.value && !f.value);
  const filledCount = myFields.filter((f) => !!(fieldValues[f.id]?.value || f.value)).length;
  // If pre-assigned fields exist, require them all; if 0 pre-assigned, require at least 1 placed signature
  const isAllFilled = myRequiredFields.length > 0
    ? filledCount >= myRequiredFields.length
    : filledCount > 0;
  const nextPendingField = myPendingFields[0];



  const getVisiblePlacement = () => {
    let targetX = 35;
    let targetY = 55;

    if (scrollContainerRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const scrollRect = scrollContainerRef.current.getBoundingClientRect();

      if (containerRect.height > 0 && containerRect.width > 0) {
        const visibleTop = Math.max(containerRect.top, scrollRect.top);
        const visibleBottom = Math.min(containerRect.bottom, scrollRect.bottom);
        const visibleLeft = Math.max(containerRect.left, scrollRect.left);
        const visibleRight = Math.min(containerRect.right, scrollRect.right);

        if (visibleBottom > visibleTop) {
          const centerY = (visibleTop + visibleBottom) / 2 - containerRect.top;
          targetY = Math.max(8, Math.min(82, (centerY / containerRect.height) * 100));
        }
        if (visibleRight > visibleLeft) {
          const centerX = (visibleLeft + visibleRight) / 2 - containerRect.left;
          targetX = Math.max(10, Math.min(70, (centerX / containerRect.width) * 100));
        }
      }
    } else {
      targetX = 30 + (fields.length * 3) % 30;
      targetY = 35 + (fields.length * 5) % 35;
    }

    return {
      x: Math.round(targetX * 10) / 10,
      y: Math.round(targetY * 10) / 10,
    };
  };

  const handleOpenSigModal = (fieldId: string) => {
    setActiveSigFieldId(fieldId);
    setPendingAddCoords(null);
    setIsSigModalOpen(true);
  };

  const handleStartAddSignature = (coords?: { x: number; y: number }) => {
    setPendingAddCoords(coords || null);
    setActiveSigFieldId(null);
    setIsSigModalOpen(true);
  };

  const handleSelectSignature = (dataUrl: string, targetFieldId?: string) => {
    // Only treat targetFieldId or activeSigFieldId as a field ID if it matches an actual existing field.
    // Note: SignaturePadModal passes its label (e.g. "Drawn Signature", "Uploaded Signature")
    // as the 2nd argument. We MUST NOT mistake that label for a field ID!
    const currentFields = fieldsRef.current || fields;
    const isRealField = (id?: string | null) =>
      Boolean(id && typeof id === 'string' && currentFields.some((f) => f.id === id));

    const fieldToFill = isRealField(targetFieldId)
      ? targetFieldId!
      : isRealField(activeSigFieldId)
      ? activeSigFieldId!
      : null;

    if (fieldToFill) {
      setFieldValues((prev) => ({
        ...prev,
        [fieldToFill]: { value: dataUrl },
      }));
      setFields((prev) =>
        prev.map((f) => (f.id === fieldToFill ? { ...f, value: dataUrl } : f))
      );
      setSelectedFieldId(fieldToFill);
      useToastStore.getState().showToast('Signature placed', 'success');
    } else {
      const newFieldId = `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const { x: placeX, y: placeY } = getVisiblePlacement();
      const posX = pendingAddCoords ? pendingAddCoords.x : placeX;
      const posY = pendingAddCoords ? pendingAddCoords.y : placeY;

      const newField: SignatureField = {
        id: newFieldId,
        documentId: doc.id,
        pageNumber: currentPage,
        x: Math.round(posX * 10) / 10,
        y: Math.round(posY * 10) / 10,
        width: 32,
        height: 8,
        fieldType: 'signature',
        value: dataUrl,
        required: true,
        signerId: recipient.id,
        signerEmail: recipient.email,
        signerOrder: recipient.signingOrder,
        signerName: recipient.name,
      };

      setFields((prev) => [...prev, newField]);
      setFieldValues((prev) => ({
        ...prev,
        [newFieldId]: { value: dataUrl },
      }));
      setSelectedFieldId(newFieldId);
      useToastStore.getState().showToast('Signature placed! Drag to position, drag corner to resize.', 'success');
    }

    // Keep recent signature fresh
    const sigs = getSavedSignatures();
    setRecentSignature(getDefaultSignature() || sigs[0] || null);

    setIsSigModalOpen(false);
    setActiveSigFieldId(null);
    setPendingAddCoords(null);
  };

  const handleAddDate = () => {
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const newFieldId = `date_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const { x, y } = getVisiblePlacement();

    const newField: SignatureField = {
      id: newFieldId,
      documentId: doc.id,
      pageNumber: currentPage,
      x,
      y,
      width: 24,
      height: 5,
      fieldType: 'date',
      value: today,
      required: true,
      signerId: recipient.id,
      signerEmail: recipient.email,
      signerOrder: recipient.signingOrder,
      signerName: recipient.name,
    };

    setFields((prev) => [...prev, newField]);
    setFieldValues((prev) => ({
      ...prev,
      [newFieldId]: { value: today },
    }));
    setSelectedFieldId(newFieldId);
    useToastStore.getState().showToast('Date placed! Drag to position.', 'success');
  };

  const handleAddText = () => {
    const newFieldId = `text_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const { x, y } = getVisiblePlacement();

    const newField: SignatureField = {
      id: newFieldId,
      documentId: doc.id,
      pageNumber: currentPage,
      x,
      y,
      width: 20,
      height: 5,
      fieldType: 'text',
      value: 'Text',
      fontFamily: 'Inter',
      required: false,
      signerId: recipient.id,
      signerEmail: recipient.email,
      signerOrder: recipient.signingOrder,
      signerName: recipient.name,
    };

    setFields((prev) => [...prev, newField]);
    setFieldValues((prev) => ({
      ...prev,
      [newFieldId]: { value: 'Text', fontFamily: 'Inter' },
    }));
    setSelectedFieldId(newFieldId);
    useToastStore.getState().showToast('Text field added! Click to edit, drag to position.', 'success');
  };

  const toolBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    shortLabel?: string
  ) => (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full text-[11px] sm:text-xs font-bold transition-all duration-200 whitespace-nowrap hover:scale-105 active:scale-95 cursor-pointer shadow-xs shrink-0"
      style={{
        background: 'rgba(93,112,82,0.10)',
        color: 'var(--moss)',
        border: '1px solid rgba(93,112,82,0.20)',
      }}
    >
      {icon}
      {shortLabel ? (
        <>
          <span className="inline sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );

  const handleRemoveField = (fieldId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    setFieldValues((prev) => {
      const copy = { ...prev };
      delete copy[fieldId];
      return copy;
    });
    setSelectedFieldId((prev) => (prev === fieldId ? null : prev));
    useToastStore.getState().showToast('Field removed', 'info');
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If clicking on an existing field, button, or dragging/resizing, ignore
    if (draggingFieldId || isResizing || hasDraggedRef.current || dragJustEndedRef.current) return;
    if ((e.target as HTMLElement).closest('.signature-field-box')) return;
    if ((e.target as HTMLElement).closest('button')) return;

    // If a field is currently selected, clicking outside on the canvas deselects it to see signature clearly!
    if (selectedFieldId) {
      setSelectedFieldId(null);
      return;
    }

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;

    const targetX = Math.max(2, Math.min(65, clickX - 17));
    const targetY = Math.max(2, Math.min(90, clickY - 4.5));

    handleStartAddSignature({ x: targetX, y: targetY });
  };

  const handleFinishSubmit = async () => {
    const myFilled = fields.filter((f) => isMyField(f) && (fieldValues[f.id]?.value || f.value));
    if (myFilled.length === 0) {
      useToastStore.getState().showToast('Please place your signature on the document before submitting', 'warning');
      handleStartAddSignature();
      return;
    }

    if (myRequiredFields.length > 0 && !isAllFilled) {
      useToastStore.getState().showToast('Please complete all your required fields before submitting', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const updates = myFilled.map((f) => ({
        fieldId: f.id,
        value: fieldValues[f.id]?.value || f.value || '',
        fontFamily: fieldValues[f.id]?.fontFamily || f.fontFamily,
        fieldMeta: {
          pageNumber: f.pageNumber,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          fieldType: f.fieldType,
        },
      }));

      const res = await deliveryService.submitSignerFields(token, updates);

      // Also flatten and store locally so immediate download is instant
      if (context?.pdfBlob) {
        try {
          const mergedFields: SignatureField[] = fields.map((f) => {
            const local = fieldValues[f.id];
            return {
              ...f,
              value: local?.value ?? f.value ?? '',
              fontFamily: local?.fontFamily ?? f.fontFamily,
            };
          });
          const rawBytes = new Uint8Array(await context.pdfBlob.arrayBuffer());
          const signedBytes = await flattenPdfSignatures(rawBytes, mergedFields, {
            signerName: recipient?.name,
            signerEmail: recipient?.email,
          });
          await storage.storeSignedPdfBytes(doc.id, signedBytes);
        } catch (flattenErr) {
          console.warn('Background signed PDF cache notice:', flattenErr);
        }
      }

      setSubmittedResult(res);
      useToastStore.getState().showToast('Signature recorded successfully!', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to submit signature', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentPageFields = fields.filter((f) => f.pageNumber === currentPage);

  return (
    <div className="h-[100dvh] max-h-[100dvh] min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)] font-sans overflow-hidden">
      {/* ── Top Minimal Nav Bar (Back to Inbox / App + Document Info) ────────── */}
      <div className="max-w-6xl mx-auto w-full px-2.5 sm:px-6 pt-2.5 sm:pt-3 pb-2 flex items-center justify-between gap-2 shrink-0">
        <button
          onClick={() => {
            if (onBack) onBack();
            else window.location.href = '/';
          }}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg-stone)] text-[var(--fg-muted)] hover:text-[var(--fg)] transition-all cursor-pointer shadow-xs shrink-0"
        >
          <ChevronLeft style={{ height: 14, width: 14 }} />
          <span>Back</span>
        </button>

        <div className="text-right flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="text-xs font-bold text-[var(--fg)] truncate max-w-[150px] xs:max-w-xs sm:max-w-md">
            {doc.title}
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold text-white shrink-0"
            style={{ background: getSignerColor(recipient.signingOrder) }}
          >
            <span className="hidden sm:inline">Signer #{recipient.signingOrder}: </span>{recipient.name}
          </span>
        </div>
      </div>

      {/* ── Reopen Alert Banner (when editing an already-signed document) ── */}
      {(isReopening || recipient.status === 'signed') && (
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 mb-2">
          <div className="p-2.5 sm:p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3 text-xs animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-[var(--fg)]">
                <strong>Editing Signed Document:</strong> You previously signed this document. You can drag, resize, or replace signatures, then click <strong>Submit</strong>.
              </span>
            </div>
            <button
              onClick={() => setIsReopening(false)}
              className="text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline shrink-0 cursor-pointer px-2 py-1 rounded-lg hover:bg-amber-500/10"
            >
              Back to Summary
            </button>
          </div>
        </div>
      )}

      {/* ── Main Organic Card (Matches PdfViewer.tsx exactly) ── */}
      <div className="max-w-6xl mx-auto w-full px-1.5 sm:px-6 pb-2 sm:pb-6 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div
          className="card-organic rounded-[1.5rem] sm:rounded-[2rem] overflow-hidden flex flex-col flex-1 relative h-full min-h-0"
          style={{
            border: '1px solid var(--border)',
          }}
        >
          {/* ── Sticky Top Bar (Identical styling to PdfViewer.tsx) ── */}
          <div
            className="glass px-2.5 sm:px-4 flex items-center justify-between gap-1.5 sm:gap-2 z-30 sticky top-0 shrink-0 overflow-visible"
            style={{
              height: 52,
              minHeight: 52,
              borderBottom: '1px solid var(--border-light)',
            }}
          >
            {/* Field count / status badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold"
                style={{
                  background: 'rgba(93,112,82,0.08)',
                  color: 'var(--moss)',
                  border: '1px solid rgba(93,112,82,0.15)',
                }}
              >
                <FileSignature style={{ height: 13, width: 13 }} />
                <span className="hidden xs:inline">
                  {filledCount} / {myRequiredFields.length || myFields.length || 1} {fields.length === 1 ? 'field' : 'fields'}
                </span>
                <span className="xs:hidden">
                  {filledCount}/{myRequiredFields.length || myFields.length || 1}
                </span>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Page navigation */}
              <div
                className="flex items-center gap-0.5 sm:gap-1 px-2 sm:px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}
              >
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                  className="hover:text-[var(--moss)] disabled:opacity-30 cursor-pointer p-0.5"
                >
                  <ChevronLeft style={{ height: 16, width: 16 }} />
                </button>
                <span className="font-bold px-0.5 sm:px-1 text-xs" style={{ color: 'var(--fg)' }}>{currentPage}</span>
                <span className="text-[11px]">/ {numPages}</span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                  disabled={currentPage >= numPages}
                  aria-label="Next page"
                  className="hover:text-[var(--moss)] disabled:opacity-30 cursor-pointer p-0.5"
                >
                  <ChevronRight style={{ height: 16, width: 16 }} />
                </button>
              </div>

              {/* Zoom */}
              <div
                className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs"
                style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid var(--border)' }}
              >
                <button
                  onClick={() => {
                    userZoomedRef.current = true;
                    setScale((s) => Math.max(0.35, Math.round((s - 0.15) * 100) / 100));
                  }}
                  style={{ color: 'var(--fg-muted)' }}
                  aria-label="Zoom out"
                  title="Zoom out"
                  className="hover:text-[var(--moss)] cursor-pointer p-0.5"
                >
                  <ZoomOut style={{ height: 14, width: 14 }} />
                </button>
                <button
                  onClick={() => {
                    userZoomedRef.current = false;
                    if (pdfDoc) {
                      pdfDoc.getPage(currentPage).then((page: any) => {
                        const unscaled = page.getViewport({ scale: 1.0 });
                        setScale(getContainerFitScale(unscaled.width, unscaled.height));
                      });
                    } else {
                      setScale(1.0);
                    }
                  }}
                  title="Click to fit screen"
                  className="font-mono font-bold text-[10px] sm:text-[11px] w-9 sm:w-12 text-center hover:text-[var(--moss)] transition-colors cursor-pointer"
                  style={{ color: 'var(--fg)' }}
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  onClick={() => {
                    userZoomedRef.current = true;
                    setScale((s) => Math.min(3.0, Math.round((s + 0.15) * 100) / 100));
                  }}
                  style={{ color: 'var(--fg-muted)' }}
                  aria-label="Zoom in"
                  title="Zoom in"
                  className="hover:text-[var(--moss)] cursor-pointer p-0.5"
                >
                  <ZoomIn style={{ height: 14, width: 14 }} />
                </button>
              </div>

              {/* Optional Export/Download Button if PDF blob available */}
              {context?.pdfBlob && (
                <button
                  type="button"
                  onClick={handleDownloadSignedPdf}
                  disabled={isExporting}
                  className="btn-outline btn-sm !px-2 sm:!px-3 flex items-center gap-1.5 cursor-pointer"
                  title="Download signed PDF with signatures and fields"
                >
                  {isExporting ? (
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-[var(--moss)] border-t-transparent" />
                  ) : (
                    <Download style={{ height: 13, width: 13 }} />
                  )}
                  <span className="hidden md:inline">{isExporting ? 'Exporting...' : 'Export'}</span>
                </button>
              )}

              {/* Submit Button */}
              <button
                type="button"
                onClick={handleFinishSubmit}
                disabled={!isAllFilled || isSubmitting}
                className="btn-primary btn-sm !px-2.5 sm:!px-4"
                title={!isAllFilled ? 'Please complete all required fields before submitting' : 'Submit signed document'}
              >
                {isSubmitting ? (
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                ) : (
                  <Send style={{ height: 13, width: 13 }} />
                )}
                <span className="hidden xs:inline">{isReopening || recipient.status === 'signed' ? 'Update & Resubmit' : 'Finish & Submit'}</span>
                <span className="xs:hidden">{isReopening || recipient.status === 'signed' ? 'Resubmit' : 'Submit'}</span>
              </button>
            </div>
          </div>

          {/* ── Main Canvas Viewport Area ── */}
          <div className="flex flex-1 overflow-hidden w-full max-w-full">
            {/* Page Thumbnails Sidebar */}
            {numPages > 1 && (
              <div
                className="w-16 hidden sm:flex flex-col gap-2 p-2 overflow-y-auto shrink-0"
                style={{ background: 'var(--bg-stone)', borderRight: '1px solid var(--border-light)' }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-center block" style={{ color: 'var(--fg-muted)' }}>
                  Pages
                </span>
                {Array.from({ length: numPages }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setCurrentPage(pg)}
                    className="text-xs font-bold py-2 rounded-xl transition-all duration-200"
                    style={{
                      background: currentPage === pg ? 'var(--moss)' : 'rgba(255,255,255,0.50)',
                      color: currentPage === pg ? '#F3F4F1' : 'var(--fg-muted)',
                      border: currentPage === pg ? 'none' : '1px solid var(--border)',
                      boxShadow: currentPage === pg ? '0 4px 12px rgba(93,112,82,0.25)' : 'none',
                    }}
                  >
                    {pg}
                  </button>
                ))}
              </div>
            )}

            {/* PDF Canvas Viewport */}
            <div
              ref={scrollContainerRef}
              onClick={() => setSelectedFieldId(null)}
              onTouchEnd={handleDocumentTouchEnd}
              className="flex-1 overflow-auto p-2 sm:p-8 select-none"
              style={{
                background: 'var(--bg)',
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--moss) rgba(0,0,0,0.06)',
                touchAction: 'pan-x pan-y',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <div className="min-w-full w-max min-h-full flex items-center justify-center m-auto pb-20 sm:pb-28">
                <div
                  ref={containerRef}
                  onClick={handleCanvasClick}
                  className="relative block shrink-0 m-auto cursor-crosshair bg-white rounded-sm"
                  style={{
                    boxShadow: '0 8px 48px rgba(44,44,36,0.12)',
                    width: canvasDimensions.width ? `${canvasDimensions.width}px` : undefined,
                    height: canvasDimensions.height ? `${canvasDimensions.height}px` : undefined,
                  }}
                  title="Click anywhere to place signature"
                >
                  <canvas
                    ref={setCanvasRef}
                    className="block pointer-events-auto"
                    style={{
                      width: canvasDimensions.width ? `${canvasDimensions.width}px` : undefined,
                      height: canvasDimensions.height ? `${canvasDimensions.height}px` : undefined,
                    }}
                  />

                  {/* Fields Layer */}
                  {currentPageFields.map((field) => {
                    const mine = isMyField(field);
                    const signerColor = getSignerColor(field.signerOrder);
                    const currentVal = fieldValues[field.id]?.value || field.value;
                    const isDraggingThis = draggingFieldId === field.id;
                    const isSelected = selectedFieldId === field.id;
                    const isHovered = hoveredFieldId === field.id;

                    let borderStyle = '2px solid transparent';
                    let backgroundStyle = 'transparent';
                    let boxShadowStyle = 'none';

                    if (mine) {
                      if (isDraggingThis || (isResizing && isSelected)) {
                        borderStyle = '2px solid var(--moss)';
                        backgroundStyle = 'rgba(255, 255, 255, 0.70)';
                        boxShadowStyle = '0 12px 28px rgba(0,0,0,0.18)';
                      } else if (isSelected) {
                        borderStyle = `2px solid ${signerColor}`;
                        backgroundStyle = currentVal ? 'rgba(255, 255, 255, 0.40)' : `${signerColor}18`;
                        boxShadowStyle = `0 0 0 3px ${signerColor}25, 0 4px 14px rgba(0,0,0,0.10)`;
                      } else if (!currentVal) {
                        borderStyle = `2px dashed ${signerColor}`;
                        backgroundStyle = `${signerColor}12`;
                        boxShadowStyle = `0 0 0 3px ${signerColor}15`;
                      } else if (isHovered) {
                        borderStyle = `1.5px dashed ${signerColor}90`;
                        backgroundStyle = 'rgba(255, 255, 255, 0.20)';
                      }
                    } else {
                      borderStyle = '1.5px dashed rgba(120,120,110,0.35)';
                      backgroundStyle = 'rgba(200,200,195,0.15)';
                    }

                    return (
                      <div
                        key={field.id}
                        onMouseEnter={() => setHoveredFieldId(field.id)}
                        onMouseLeave={() => setHoveredFieldId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (mine) {
                            setSelectedFieldId(field.id);
                          }
                        }}
                        onMouseDown={mine ? (e) => startDrag(field.id, e.clientX, e.clientY, e) : undefined}
                        onTouchStart={
                          mine
                            ? (e) => {
                                if (e.touches.length === 1) {
                                  startDrag(field.id, e.touches[0].clientX, e.touches[0].clientY, e);
                                }
                              }
                            : undefined
                        }
                        style={{
                          left: `${field.x}%`,
                          top: `${field.y}%`,
                          width: `${field.width}%`,
                          height: `${field.height}%`,
                          position: 'absolute',
                          zIndex: isDraggingThis || (isResizing && isSelected) ? 35 : isSelected ? 30 : mine ? 25 : 10,
                          border: borderStyle,
                          borderRadius: 10,
                          background: backgroundStyle,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          cursor: mine ? (isDraggingThis ? 'grabbing' : isSelected ? 'move' : 'pointer') : 'not-allowed',
                          boxShadow: boxShadowStyle,
                          touchAction: 'none',
                          transition: isDraggingThis || isResizing ? 'none' : 'box-shadow 0.15s ease, border-color 0.15s ease',
                        }}
                        className={`signature-field-box group ${mine && !currentVal ? 'animate-pulse' : ''}`}
                      >
                        {/* Signer Identification Badge */}
                        {(isSelected || !currentVal || isHovered) && (
                          <span
                            className="absolute -top-2.5 left-2 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white shadow-xs z-30 pointer-events-none truncate max-w-[140px]"
                            style={{ background: mine ? signerColor : field.signerOrder === 0 ? 'var(--moss)' : '#7A7A70' }}
                          >
                            {mine
                              ? 'You'
                              : field.signerOrder === 0 || (field.signerEmail && doc?.senderEmail && field.signerEmail.toLowerCase() === doc.senderEmail.toLowerCase()) || (field.value && !field.signerOrder)
                              ? (field.signerName || 'Sender / Owner')
                              : (field.signerName || `Signer ${field.signerOrder || ''}`)}
                          </span>
                        )}

                        {/* Remove Field Button */}
                        {mine && (isSelected || isHovered) && (
                          <button
                            onClick={(e) => handleRemoveField(field.id, e)}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="absolute -top-2.5 -right-2.5 h-6 w-6 rounded-full flex items-center justify-center transition-all duration-200 z-40 cursor-pointer"
                            style={{
                              background: '#A85448',
                              color: '#fff',
                              boxShadow: '0 2px 8px rgba(168,84,72,0.40)',
                            }}
                            title="Remove field"
                            aria-label="Remove field"
                          >
                            <Trash2 style={{ height: 11, width: 11 }} />
                          </button>
                        )}

                        {/* Floating Text/Date Customization Toolbar when field is selected */}
                        {mine && isSelected && (field.fieldType === 'text' || field.fieldType === 'name' || field.fieldType === 'date') && (
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute z-50 flex items-center gap-1.5 p-1 rounded-full animate-fadeIn whitespace-nowrap overflow-visible ${
                              field.y < 12 ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
                            } ${field.x > 40 ? 'right-0' : 'left-0'}`}
                            style={{
                              background: 'rgba(254, 254, 250, 0.98)',
                              backdropFilter: 'blur(16px)',
                              border: '1px solid var(--border)',
                              boxShadow: '0 8px 24px -4px rgba(44, 44, 36, 0.22), 0 2px 6px rgba(44, 44, 36, 0.08)',
                            }}
                          >
                            <div className="flex items-center gap-1 pl-1.5">
                              <span className="text-[10px] font-bold" style={{ color: 'var(--fg-muted)' }}>Font:</span>
                              <div className="w-28">
                                <Dropdown
                                  value={fieldValues[field.id]?.fontFamily || field.fontFamily || 'Inter'}
                                  onChange={(val) => {
                                    const font = String(val);
                                    setFieldValues((prev) => ({
                                      ...prev,
                                      [field.id]: {
                                        ...prev[field.id],
                                        value: prev[field.id]?.value ?? field.value ?? (field.fieldType === 'name' ? recipient.name : 'Text'),
                                        fontFamily: font,
                                      },
                                    }));
                                    setFields((prev) =>
                                      prev.map((f) => (f.id === field.id ? { ...f, fontFamily: font } : f))
                                    );
                                  }}
                                  options={TEXT_FONT_OPTIONS}
                                  buttonClassName="!h-7 !py-0 px-2 text-[11px] bg-white/90"
                                  menuClassName="min-w-[170px]"
                                />
                              </div>
                            </div>

                            <button
                              onClick={(e) => handleRemoveField(field.id, e)}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="p-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors cursor-pointer mr-1"
                              title="Delete field"
                              aria-label="Delete field"
                            >
                              <Trash2 style={{ height: 13, width: 13 }} />
                            </button>
                          </div>
                        )}

                        {/* Animated "Sign Here" beacon */}
                        {mine && !currentVal && (
                          <div
                            className="absolute -top-7 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-white shadow-md z-30 flex items-center gap-1 animate-bounce pointer-events-none whitespace-nowrap"
                            style={{ background: 'var(--terracotta)' }}
                          >
                            <span>Sign Here</span>
                            <span>↓</span>
                          </div>
                        )}

                        {/* Drag to Reposition Indicator & Change Button */}
                        {mine && currentVal && isSelected && (
                          <div className={`absolute ${field.y < 12 && (field.fieldType === 'text' || field.fieldType === 'name' || field.fieldType === 'date') ? 'top-[calc(100%+45px)]' : '-bottom-6'} left-2 flex items-center gap-1.5 z-40 whitespace-nowrap`}>
                            {field.fieldType === 'signature' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenSigModal(field.id);
                                }}
                                className="px-2 py-0.5 rounded-md bg-[var(--moss)] hover:bg-[var(--moss)]/90 text-white text-[9px] font-bold shadow-sm cursor-pointer flex items-center gap-1"
                                title="Change signature"
                              >
                                <Pencil className="h-2.5 w-2.5" />
                                <span>Change</span>
                              </button>
                            )}
                            <div className="px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[8px] font-semibold flex items-center gap-1 pointer-events-none shadow-sm">
                              <Move className="h-2 w-2" />
                              <span>Drag to move · Corner to resize</span>
                            </div>
                          </div>
                        )}

                        {/* Corner Resize Handle */}
                        {mine && isSelected && (
                          <div
                            onMouseDown={(e) => startResize(field.id, e.clientX, e.clientY, e)}
                            onTouchStart={(e) => {
                              if (e.touches.length === 1) {
                                startResize(field.id, e.touches[0].clientX, e.touches[0].clientY, e);
                              }
                            }}
                            className="absolute -bottom-3.5 -right-3.5 w-7 h-7 flex items-center justify-center cursor-se-resize z-40 touch-none"
                            title="Drag to resize signature"
                            aria-label="Resize signature"
                          >
                            <div
                              className="w-4 h-4 rounded-full flex items-center justify-center shadow-md transition-transform hover:scale-125"
                              style={{
                                background: 'var(--moss)',
                                border: '2px solid #ffffff',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                              }}
                            >
                              <div className="w-1 h-1 rounded-full bg-white" />
                            </div>
                          </div>
                        )}

                        {/* Field Content */}
                        {field.fieldType === 'signature' ? (
                          currentVal && currentVal.startsWith('data:image') ? (
                            mine ? (
                              <div
                                onClick={(e) => {
                                  if (!hasDraggedRef.current && !dragJustEndedRef.current) {
                                    e.stopPropagation();
                                    handleOpenSigModal(field.id);
                                  }
                                }}
                                className="relative w-full h-full flex items-center justify-center group/sig cursor-pointer select-none overflow-hidden"
                                title="Click to edit or redo signature"
                              >
                                <img
                                  src={currentVal}
                                  alt="Signature"
                                  className="h-full w-full object-contain pointer-events-none select-none"
                                />
                              </div>
                            ) : (
                              <img
                                src={currentVal}
                                alt="Signature"
                                className="h-full w-full object-contain pointer-events-none select-none"
                              />
                            )
                          ) : mine ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenSigModal(field.id);
                              }}
                              className="flex items-center gap-1.5 text-xs font-bold transition-transform hover:scale-105 cursor-pointer"
                              style={{ color: signerColor }}
                            >
                              <PenTool className="h-3.5 w-3.5" />
                              <span>Click to Sign</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-bold text-[var(--fg-muted)] opacity-60">
                              Signature Field
                            </span>
                          )
                        ) : field.fieldType === 'date' ? (
                          currentVal ? (
                            <span
                              className="font-bold text-xs truncate px-1 text-center select-none"
                              style={{
                                color: mine ? 'var(--fg)' : '#5A5A52',
                                fontFamily: fieldValues[field.id]?.fontFamily || field.fontFamily || 'Inter',
                              }}
                            >
                              {currentVal}
                            </span>
                          ) : mine ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const today = new Date().toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                });
                                setFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: {
                                    ...prev[field.id],
                                    value: today,
                                    fontFamily: prev[field.id]?.fontFamily || field.fontFamily || 'Inter',
                                  },
                                }));
                              }}
                              className="flex items-center gap-1.5 text-xs font-bold transition-transform hover:scale-105 cursor-pointer"
                              style={{ color: signerColor }}
                            >
                              <Calendar className="h-3.5 w-3.5" />
                              <span>Insert Date</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-bold text-[var(--fg-muted)] opacity-60">
                              Date Field
                            </span>
                          )
                        ) : (
                          /* Text or Name field */
                          mine && isSelected ? (
                            <FastTextInput
                              value={currentVal || ''}
                              fontFamily={fieldValues[field.id]?.fontFamily || field.fontFamily || 'Inter'}
                              onCommit={(newVal) => {
                                setFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: {
                                    ...prev[field.id],
                                    value: newVal,
                                    fontFamily: prev[field.id]?.fontFamily || field.fontFamily || 'Inter',
                                  },
                                }));
                                setFields((prev) =>
                                  prev.map((f) => (f.id === field.id ? { ...f, value: newVal } : f))
                                );
                              }}
                              onPressEnter={() => setSelectedFieldId(null)}
                              placeholder={field.fieldType === 'name' ? recipient.name : 'Enter text'}
                              autoFocus
                              className="text-xs font-bold px-1.5 py-0.5 rounded bg-white/95 dark:bg-card/95 border border-primary text-foreground outline-none w-full text-center shadow-xs"
                            />
                          ) : currentVal ? (
                            <span
                              className="font-bold text-xs truncate px-1 text-center select-none"
                              style={{
                                color: mine ? 'var(--fg)' : '#5A5A52',
                                fontFamily: fieldValues[field.id]?.fontFamily || field.fontFamily || 'Inter',
                              }}
                            >
                              {currentVal}
                            </span>
                          ) : mine ? (
                            <FastTextInput
                              value=""
                              fontFamily={fieldValues[field.id]?.fontFamily || field.fontFamily || 'Inter'}
                              onCommit={(newVal) => {
                                setFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: {
                                    ...prev[field.id],
                                    value: newVal,
                                    fontFamily: prev[field.id]?.fontFamily || field.fontFamily || 'Inter',
                                  },
                                }));
                                setFields((prev) =>
                                  prev.map((f) => (f.id === field.id ? { ...f, value: newVal } : f))
                                );
                              }}
                              onPressEnter={() => setSelectedFieldId(null)}
                              placeholder={field.fieldType === 'name' ? recipient.name : 'Enter text'}
                              className="text-xs font-bold px-1.5 py-0.5 rounded bg-white/90 border border-[var(--border-light)] text-foreground outline-none w-full text-center"
                            />
                          ) : (
                            <span className="text-[10px] font-bold text-[var(--fg-muted)] opacity-60">
                              {field.fieldType === 'name' ? 'Name Field' : 'Text Field'}
                            </span>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating Action Bar (EXACTLY like Picture 1 / PdfViewer.tsx!) ── */}
      <div
        className="fixed bottom-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))] inset-x-0 mx-auto w-fit z-40 flex items-center justify-center gap-1 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full glass select-none max-w-[calc(100vw-1.5rem)] overflow-x-auto no-scrollbar shadow-float transition-all duration-300"
        style={{
          left: 0,
          right: 0,
          marginLeft: 'auto',
          marginRight: 'auto',
          width: 'fit-content',
          background: 'rgba(254, 254, 250, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border)',
          boxShadow: '0 16px 40px -8px rgba(44,44,36,0.22), 0 0 0 1px rgba(93,112,82,0.12)',
        }}
        role="toolbar"
        aria-label="Document signature tools"
      >
        {/* + Signature Field */}
        {toolBtn(
          '+ Signature Field',
          <PenTool style={{ height: 13, width: 13 }} />,
          () => {
            if (nextPendingField && nextPendingField.pageNumber === currentPage) {
              handleOpenSigModal(nextPendingField.id);
            } else {
              handleStartAddSignature();
            }
          },
          '+ Sig'
        )}

        {/* Stamp My Sig Dropdown Menu */}
        <div className="relative z-50 overflow-visible" ref={sigDropdownRef}>
          <button
            type="button"
            onClick={() => {
              setSavedSignatures(getSavedSignatures());
              setIsSigDropdownOpen((prev) => !prev);
            }}
            className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full text-[11px] sm:text-xs font-bold transition-all duration-200 whitespace-nowrap hover:scale-105 active:scale-95 cursor-pointer shadow-xs shrink-0"
            style={{
              background: isSigDropdownOpen ? 'var(--moss)' : 'rgba(93,112,82,0.10)',
              color: isSigDropdownOpen ? '#F3F4F1' : 'var(--moss)',
              border: '1px solid rgba(93,112,82,0.20)',
            }}
            aria-label="Stamp saved signature"
            aria-haspopup="true"
            aria-expanded={isSigDropdownOpen}
            title="Stamp your saved signature directly"
          >
            <FileSignature style={{ height: 13, width: 13 }} />
            <span className="inline sm:hidden">Stamp</span>
            <span className="hidden sm:inline">Stamp My Sig</span>
            <ChevronDown
              style={{
                height: 11,
                width: 11,
                transform: isSigDropdownOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            />
          </button>

          {isSigDropdownOpen && (
            <div
              className="absolute bottom-full left-0 mb-3 w-72 rounded-[1.75rem] p-2.5 z-[100] animate-fadeIn"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 16px 40px -8px rgba(44,44,36,0.24), 0 0 0 1px rgba(93,112,82,0.12)',
              }}
            >
              <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--fg-muted)' }}>
                Your Signatures
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1 my-1 pr-1">
                {savedSignatures.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-center font-medium" style={{ color: 'var(--fg-muted)' }}>
                    No saved signatures found
                  </div>
                ) : (
                  savedSignatures.map((sig) => (
                    <button
                      key={sig.id}
                      type="button"
                      onClick={() => {
                        handleSelectSignature(sig.dataUrl);
                        setIsSigDropdownOpen(false);
                      }}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-2xl text-left transition-colors hover:bg-[var(--moss-dim)] group cursor-pointer"
                    >
                      <div className="h-8 w-28 flex items-center justify-center p-1 rounded-xl bg-white/90 border border-[var(--border-light)] shrink-0">
                        <img src={sig.dataUrl} alt={sig.label} className="h-full max-w-full object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-bold truncate block" style={{ color: 'var(--fg)' }}>
                          {sig.label || 'Saved Signature'}
                        </span>
                        {sig.isDefault && (
                          <span className="text-[10px] font-bold" style={{ color: 'var(--moss)' }}>Default</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="h-px my-1" style={{ background: 'var(--border-light)' }} />
              <button
                type="button"
                onClick={() => {
                  setIsSigDropdownOpen(false);
                  handleStartAddSignature();
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-xs font-bold transition-colors hover:bg-[var(--moss-dim)] cursor-pointer"
                style={{ color: 'var(--moss)' }}
              >
                <PlusCircle style={{ height: 16, width: 16 }} />
                <span>Add New Signature</span>
              </button>
            </div>
          )}
        </div>

        {/* + Date */}
        {toolBtn(
          '+ Date',
          <Calendar style={{ height: 13, width: 13 }} />,
          () => handleAddDate()
        )}

        {/* + Text */}
        {toolBtn(
          '+ Text',
          <Type style={{ height: 13, width: 13 }} />,
          () => handleAddText()
        )}
      </div>

      {/* ── Mobile Floating Zoom Controls ── */}
      <div
        className="fixed bottom-[4.75rem] right-3 z-40 sm:hidden flex items-center gap-1 p-1 rounded-full glass shadow-float border border-border"
        style={{
          background: 'rgba(254, 254, 250, 0.95)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 24px -4px rgba(44,44,36,0.22), 0 0 0 1px rgba(93,112,82,0.12)',
          touchAction: 'manipulation',
        }}
        aria-label="Mobile zoom controls"
      >
        <button
          type="button"
          onClick={() => {
            userZoomedRef.current = true;
            setScale((s) => Math.max(0.35, Math.round((s - 0.2) * 100) / 100));
          }}
          aria-label="Zoom out"
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-[var(--moss-dim)] active:bg-[var(--moss-dim)] text-[var(--fg-muted)] active:scale-90 transition-all cursor-pointer"
        >
          <ZoomOut style={{ height: 18, width: 18 }} />
        </button>
        <button
          type="button"
          onClick={() => {
            userZoomedRef.current = false;
            if (pdfDoc) {
              pdfDoc.getPage(currentPage).then((page: any) => {
                const unscaled = page.getViewport({ scale: 1.0 });
                setScale(getContainerFitScale(unscaled.width, unscaled.height));
              });
            } else {
              setScale(1.0);
            }
          }}
          className="h-9 px-2.5 flex items-center justify-center font-mono font-bold text-xs rounded-full hover:bg-[var(--moss-dim)] active:bg-[var(--moss-dim)] text-[var(--fg)] active:scale-95 transition-all cursor-pointer"
          title="Reset zoom to fit screen"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => {
            userZoomedRef.current = true;
            setScale((s) => Math.min(3.0, Math.round((s + 0.2) * 100) / 100));
          }}
          aria-label="Zoom in"
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-[var(--moss-dim)] active:bg-[var(--moss-dim)] text-[var(--fg-muted)] active:scale-90 transition-all cursor-pointer"
        >
          <ZoomIn style={{ height: 18, width: 18 }} />
        </button>
      </div>

      {/* Signature Modal */}
      <SignaturePadModal
        isOpen={isSigModalOpen}
        onClose={() => {
          setIsSigModalOpen(false);
          setActiveSigFieldId(null);
          setPendingAddCoords(null);
        }}
        onSelectSignature={(dataUrl) => {
          handleSelectSignature(dataUrl, activeSigFieldId || undefined);
        }}
        title={activeSigFieldId && (fieldValues[activeSigFieldId]?.value || fields.find((f) => f.id === activeSigFieldId)?.value) ? 'Edit / Redo Signature' : 'Create Signature'}
        initialSignature={activeSigFieldId ? (fieldValues[activeSigFieldId]?.value || fields.find((f) => f.id === activeSigFieldId)?.value) : undefined}
      />
    </div>
  );
};
