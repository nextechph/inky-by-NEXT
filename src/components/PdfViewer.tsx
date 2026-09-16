import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  PenTool,
  Calendar,
  Type,
  Trash2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Download,
  Send,
  ChevronDown,
  PlusCircle,
  Users,
  Lock,
  ShieldCheck,
  FileSignature,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import { SignatureField, FieldType, SavedSignature, Recipient } from '../types';
import { getDefaultSignature, getSavedSignatures } from '../lib/storage';
import { deliveryService } from '../services/deliveryService';
import { Dropdown } from './ui/Dropdown';
import { FastTextInput } from './ui/FastTextInput';
import { useDocumentStore } from '../store/useDocumentStore';
import { useToastStore } from '../store/useToastStore';
import { useAuthStore } from '../store/useAuthStore';

export const getSignerColor = (order?: number) => {
  if (order === 1) return '#C18C5D'; // Terracotta
  if (order === 2) return '#5D7052'; // Moss
  if (order === 3) return '#D99E4B'; // Ochre
  if (order === 4) return '#4E5F70'; // Slate
  return '#5D7052'; // Default
};

export const TEXT_FONT_OPTIONS = [
  { value: 'Inter',           label: 'Inter',           group: 'Professional Sans', fontFamily: 'Inter' },
  { value: 'Geist',           label: 'Geist',           group: 'Professional Sans', fontFamily: 'Geist' },
  { value: 'Arial',           label: 'Arial',           group: 'Professional Sans', fontFamily: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman', group: 'Professional Serif', fontFamily: 'Times New Roman' },
  { value: 'EB Garamond',     label: 'EB Garamond',     group: 'Professional Serif', fontFamily: 'EB Garamond' },
  { value: 'Dancing Script',  label: 'Dancing Script',  group: 'Handwriting Script', fontFamily: 'Dancing Script' },
  { value: 'Caveat',          label: 'Caveat',          group: 'Handwriting Script', fontFamily: 'Caveat' },
];

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface PdfViewerProps {
  documentId: string;
  pdfUrl: string;
  fields: SignatureField[];
  setFields: React.Dispatch<React.SetStateAction<SignatureField[]>>;
  onOpenSignatureModal: (
    fieldId?: string,
    initialSignature?: string,
    meta?: {
      rawSignature?: string;
      printedName?: string;
      printedNameScale?: number;
      printedNameSpacing?: number;
    }
  ) => void;
  onSignAndExport: () => void;
  onSendClick: () => void;
  isSigningLoading: boolean;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  documentId,
  pdfUrl,
  fields,
  setFields,
  onOpenSignatureModal,
  onSignAndExport,
  onSendClick,
  isSigningLoading,
}) => {
  const { user } = useAuthStore();
  const [pdfDoc, setPdfDoc]               = useState<any | null>(null);
  const [numPages, setNumPages]           = useState<number>(1);
  const [currentPage, setCurrentPage]     = useState<number>(1);
  const [scale, setScale]                 = useState<number>(1.2);
  const userZoomedRef                     = useRef<boolean>(false);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [hoveredFieldId, setHoveredFieldId]   = useState<string | null>(null);
  const [isDragging, setIsDragging]       = useState<boolean>(false);
  const [dragOffset, setDragOffset]       = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isResizing, setIsResizing]       = useState<boolean>(false);
  const [resizeStart, setResizeStart]     = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Signature dropdown state
  const [isSigDropdownOpen, setIsSigDropdownOpen] = useState<boolean>(false);
  const [savedSignatures, setSavedSignatures]     = useState<SavedSignature[]>([]);
  const sigDropdownRef = useRef<HTMLDivElement | null>(null);

  // Recipient list for field assignment
  const [recipients, setRecipients]               = useState<Recipient[]>([]);

  useEffect(() => {
    if (documentId) {
      const list = deliveryService.getRecipients(documentId);
      setRecipients(list);
    }
  }, [documentId]);

  const canvasRef          = useRef<HTMLCanvasElement | null>(null);
  const containerRef       = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Pan / Drag to move document state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const hasPannedRef = useRef<boolean>(false);
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
  // Track whether dragging or resizing is currently active so mouseup flushes save
  const dragActiveRef = useRef(false);
  dragActiveRef.current = isDragging || isResizing;
  // Track field drag start position and movement to distinguish click from drag
  const fieldDragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const hasDraggedFieldRef = useRef<boolean>(false);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragActiveRef.current) {
        useDocumentStore.getState().saveCurrentFields();
      }
      setIsDragging(false);
      setIsResizing(false);
      setIsPanning(false);
      fieldDragStartRef.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, []);

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

  useEffect(() => {
    let isMounted = true;
    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument(pdfUrl).promise;
        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          try {
            const firstPage = await doc.getPage(1);
            const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
            const fitScale = getContainerFitScale(unscaledViewport.width, unscaledViewport.height);
            setScale(fitScale);
          } catch (scaleErr) {
            console.warn('Error calculating container fit scale:', scaleErr);
          }
        }
      } catch (err) { console.error('Error loading PDF:', err); }
    };
    loadPdf();
    return () => { isMounted = false; };
  }, [pdfUrl, getContainerFitScale]);

  const currentRenderTaskRef = useRef<any>(null);

  useEffect(() => {
    if (!pdfDoc) return;
    let resizeTimer: any = null;
    const handleWindowResize = () => {
      if (window.innerWidth >= 640) return;
      if (userZoomedRef.current) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        pdfDoc.getPage(currentPage).then((page: any) => {
          const unscaledViewport = page.getViewport({ scale: 1.0 });
          const fitScale = getContainerFitScale(unscaledViewport.width, unscaledViewport.height);
          setScale((currentScale) => {
            if (Math.abs(currentScale - fitScale) > 0.03) {
              return fitScale;
            }
            return currentScale;
          });
        }).catch(() => {});
      }, 150);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [pdfDoc, currentPage, getContainerFitScale]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let isCancelled = false;

    const renderPage = async () => {
      if (currentRenderTaskRef.current) {
        try {
          currentRenderTaskRef.current.cancel();
        } catch {}
      }

      try {
        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || isCancelled) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        setCanvasDimensions((prev) => {
          if (prev.width === viewport.width && prev.height === viewport.height) {
            return prev;
          }
          return { width: viewport.width, height: viewport.height };
        });

        const task = page.render({ canvasContext: ctx, viewport });
        currentRenderTaskRef.current = task;
        await task.promise;
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('PDF render error:', err);
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (currentRenderTaskRef.current) {
        try {
          currentRenderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [pdfDoc, currentPage, scale]);

  // Mobile double-tap to zoom in / reset to fit
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  const handleDocumentTouchEnd = useCallback((e: React.TouchEvent) => {
    if (isPinchingRef.current || isDragging || isResizing) return;
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
  }, [pdfDoc, currentPage, scale, isDragging, isResizing, getContainerFitScale]);

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

        // Reset CSS transform
        containerRef.current.style.transform = '';
        containerRef.current.style.transformOrigin = '';
        containerRef.current.style.willChange = 'auto';

        // Adjust scroll position to maintain pinch center point
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

  const getVisiblePlacement = () => {
    let targetX = 35;
    let targetY = 40;

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

  const addField = (fieldType: FieldType) => {
    const nowStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    let initialValue = '';
    if (fieldType === 'date') initialValue = nowStr;
    if (fieldType === 'name') initialValue = 'Your Name';
    if (fieldType === 'text') initialValue = 'Text';

    const { x, y } = getVisiblePlacement();

    const newField: SignatureField = {
      id: `field_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      documentId,
      pageNumber: currentPage,
      x,
      y,
      width:  fieldType === 'signature' ? 24 : 20,
      height: fieldType === 'signature' ? 8 : 5,
      fieldType,
      value: initialValue,
      fontFamily: fieldType === 'text' || fieldType === 'date' || fieldType === 'name' ? 'Inter' : undefined,
      required: true,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedFieldId(newField.id);
  };

  const isFieldLocked = (field: SignatureField) => {
    // 1. Owner or unassigned fields are never locked — the user can always edit, move, or remove them
    if (!field.signerOrder && !field.signerEmail && !field.signerId) {
      return false;
    }
    if (field.signerOrder === 0) {
      return false;
    }

    // 2. Check if an external recipient is assigned to this field
    const assignedRec = recipients.find(
      (r) =>
        (field.signerId && r.id === field.signerId) ||
        (field.signerOrder && r.signingOrder === field.signerOrder) ||
        (field.signerEmail && r.email && r.email.toLowerCase() === field.signerEmail.toLowerCase())
    );

    // Only lock if the remote recipient actually completed signing their assigned field
    if (assignedRec && assignedRec.status === 'signed' && field.value) {
      return true;
    }

    // If recipient is known and hasn't signed yet, do not lock
    if (assignedRec && assignedRec.status !== 'signed') {
      return false;
    }

    // 3. Fallback for legacy / cloud-hydrated fields without full recipient records:
    // Only lock if assigned to an external signer order (>0) or external email, and has a value
    if (field.value && ((field.signerOrder && field.signerOrder > 0) || field.signerEmail)) {
      return true;
    }

    return false;
  };

  const removeField = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const field = fields.find((f) => f.id === id);
    if (field && isFieldLocked(field)) {
      useToastStore.getState().showToast('Cannot delete a signature that has already been signed by a recipient', 'warning');
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
  };

  const handleMouseDown = (fieldId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFieldId(fieldId);
    
    fieldDragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    hasDraggedFieldRef.current = false;

    const field = fields.find((f) => f.id === fieldId);
    if (!field || isFieldLocked(field)) return;

    setIsDragging(true);
    if (!containerRef.current) return;
    const rect  = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const fieldPixelX = (field.x / 100) * rect.width;
    const fieldPixelY = (field.y / 100) * rect.height;
    setDragOffset({
      x: clickX - fieldPixelX,
      y: clickY - fieldPixelY,
    });
  };

  const handleFieldTouchStart = (fieldId: string, e: React.TouchEvent) => {
    if (e.touches.length > 1) return;
    e.stopPropagation();
    setSelectedFieldId(fieldId);

    const touch = e.touches[0];
    fieldDragStartRef.current = { clientX: touch.clientX, clientY: touch.clientY };
    hasDraggedFieldRef.current = false;

    const field = fields.find((f) => f.id === fieldId);
    if (!field || isFieldLocked(field)) return;

    setIsDragging(true);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = touch.clientX - rect.left;
    const clickY = touch.clientY - rect.top;
    const fieldPixelX = (field.x / 100) * rect.width;
    const fieldPixelY = (field.y / 100) * rect.height;
    setDragOffset({
      x: clickX - fieldPixelX,
      y: clickY - fieldPixelY,
    });
  };

  const handleFieldTouchMove = (fieldId: string, e: React.TouchEvent) => {
    if (!isDragging || selectedFieldId !== fieldId || !containerRef.current) return;
    if (e.touches.length !== 1) return;
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    if (fieldDragStartRef.current) {
      const dist = Math.hypot(touch.clientX - fieldDragStartRef.current.clientX, touch.clientY - fieldDragStartRef.current.clientY);
      if (dist > 4) {
        hasDraggedFieldRef.current = true;
      }
    }

    if (hasDraggedFieldRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = touch.clientX - rect.left;
      const mouseY = touch.clientY - rect.top;
      const pctX = Math.max(0, Math.min(92, ((mouseX - dragOffset.x) / rect.width) * 100));
      const pctY = Math.max(0, Math.min(95, ((mouseY - dragOffset.y) / rect.height) * 100));
      setFields((prev) => prev.map((f) => (f.id === selectedFieldId ? { ...f, x: pctX, y: pctY } : f)));
    }
  };

  const handleResizeMouseDown = (fieldId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const field = fields.find((f) => f.id === fieldId);
    if (!field || isFieldLocked(field)) return;

    setSelectedFieldId(fieldId);
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: field.width,
      height: field.height,
    });
  };

  const handleResizeTouchStart = (fieldId: string, e: React.TouchEvent) => {
    e.stopPropagation();
    const field = fields.find((f) => f.id === fieldId);
    if (!field || isFieldLocked(field)) return;
    if (e.touches.length !== 1) return;

    setSelectedFieldId(fieldId);
    setIsResizing(true);
    const touch = e.touches[0];
    setResizeStart({
      x: touch.clientX,
      y: touch.clientY,
      width: field.width,
      height: field.height,
    });
  };

  const handleResizeTouchMove = (fieldId: string, e: React.TouchEvent) => {
    if (!isResizing || selectedFieldId !== fieldId || !containerRef.current) return;
    if (e.touches.length !== 1) return;
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = ((touch.clientX - resizeStart.x) / rect.width) * 100;
    const deltaY = ((touch.clientY - resizeStart.y) / rect.height) * 100;
    const field = fields.find((f) => f.id === selectedFieldId);
    if (!field) return;

    const newWidth = Math.max(8, Math.min(85, resizeStart.width + deltaX));
    const aspect = resizeStart.width / (resizeStart.height || 1);
    const newHeight = field.fieldType === 'signature'
      ? Math.max(3, Math.min(50, newWidth / aspect))
      : Math.max(3, Math.min(50, resizeStart.height + deltaY));

    setFields((prev) =>
      prev.map((f) => (f.id === selectedFieldId ? { ...f, width: newWidth, height: newHeight } : f))
    );
  };

  const handleScrollAreaMouseDown = (e: React.MouseEvent) => {
    // Only handle primary (left) button or middle button
    if (e.button !== 0 && e.button !== 1) return;
    if (!scrollContainerRef.current) return;

    setIsPanning(true);
    hasPannedRef.current = false;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollContainerRef.current.scrollLeft,
      scrollTop: scrollContainerRef.current.scrollTop,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && scrollContainerRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasPannedRef.current = true;
      }
      scrollContainerRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      scrollContainerRef.current.scrollTop  = panStartRef.current.scrollTop  - dy;
      return;
    }

    if (!selectedFieldId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (isDragging) {
      if (fieldDragStartRef.current) {
        const dist = Math.hypot(e.clientX - fieldDragStartRef.current.clientX, e.clientY - fieldDragStartRef.current.clientY);
        if (dist > 3) {
          hasDraggedFieldRef.current = true;
        }
      }
      if (hasDraggedFieldRef.current) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const pctX = Math.max(0, Math.min(92, ((mouseX - dragOffset.x) / rect.width) * 100));
        const pctY = Math.max(0, Math.min(95, ((mouseY - dragOffset.y) / rect.height) * 100));
        setFields((prev) => prev.map((f) => (f.id === selectedFieldId ? { ...f, x: pctX, y: pctY } : f)));
      }
    } else if (isResizing) {
      const deltaX = ((e.clientX - resizeStart.x) / rect.width) * 100;
      const deltaY = ((e.clientY - resizeStart.y) / rect.height) * 100;
      const field = fields.find((f) => f.id === selectedFieldId);
      if (!field) return;

      const newWidth = Math.max(8, Math.min(85, resizeStart.width + deltaX));
      const aspect = resizeStart.width / (resizeStart.height || 1);
      // For signature fields, preserve proportional aspect ratio
      const newHeight = field.fieldType === 'signature'
        ? Math.max(3, Math.min(50, newWidth / aspect))
        : Math.max(3, Math.min(50, resizeStart.height + deltaY));

      setFields((prev) =>
        prev.map((f) => (f.id === selectedFieldId ? { ...f, width: newWidth, height: newHeight } : f))
      );
    }
  };

  const handleMouseUp = () => {
    if (dragActiveRef.current && hasDraggedFieldRef.current) {
      useDocumentStore.getState().saveCurrentFields();
    }
    setIsDragging(false);
    setIsResizing(false);
    setIsPanning(false);
    fieldDragStartRef.current = null;
  };

  const currentPageFields = fields.filter((f) => f.pageNumber === currentPage);

  const handleSelectSavedSignature = (dataUrl: string) => {
    setIsSigDropdownOpen(false);
    const img = new Image();
    img.onload = () => {
      const naturalAspect = img.naturalWidth / (img.naturalHeight || 1);
      const defaultHeight = naturalAspect < 2.0 ? 10.5 : 7.5;
      const rect = containerRef.current?.getBoundingClientRect();
      const pageAspect = rect ? rect.height / rect.width : 1.4;
      const targetWidth = Math.min(48, Math.max(14, defaultHeight * pageAspect * naturalAspect));
      const { x, y } = getVisiblePlacement();

      const newField: SignatureField = {
        id: `field_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        documentId,
        pageNumber: currentPage,
        x,
        y,
        width: Math.round(targetWidth * 10) / 10,
        height: defaultHeight,
        fieldType: 'signature',
        value: dataUrl,
        required: true,
      };
      setFields((prev) => [...prev, newField]);
      setSelectedFieldId(newField.id);
    };
    img.src = dataUrl;
  };

  const handleAddNewSignature = () => {
    setIsSigDropdownOpen(false);
    const { x, y } = getVisiblePlacement();
    const newFieldId = `field_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newField: SignatureField = {
      id: newFieldId,
      documentId,
      pageNumber: currentPage,
      x,
      y,
      width: 24,
      height: 8,
      fieldType: 'signature',
      value: '',
      required: true,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedFieldId(newFieldId);
    onOpenSignatureModal(newFieldId);
  };

  const openFieldSigModal = (f: SignatureField) => {
    onOpenSignatureModal(f.id, f.value, {
      rawSignature: f.rawSignature,
      printedName: f.printedName,
      printedNameScale: f.printedNameScale,
      printedNameSpacing: f.printedNameSpacing,
    });
  };

  // Shared pill button for toolbar tools
  const toolBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    shortLabel?: string
  ) => (
    <button
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

  const signerOptions = [
    { value: '0', label: 'Assign: Me (Owner)' },
    { value: '-1', label: 'Assign: Anyone (Unassigned)' },
    ...recipients.map((r) => ({
      value: String(r.signingOrder),
      label: `Signer ${r.signingOrder}: ${r.name}`,
    })),
    { value: '__add__', label: '+ Add / Edit Signers...' },
  ];

  return (
    <>
      <div
        className="card-organic rounded-[1.5rem] sm:rounded-[2rem] overflow-hidden flex flex-col w-full max-w-full flex-1 min-h-0 h-full"
        style={{ minHeight: 0, flex: 1 }}
      >
      {/* ── Top Control Bar ─────────────────────────────── */}
      <div
        className="glass px-2.5 sm:px-4 flex items-center justify-between gap-1.5 sm:gap-2 z-30 sticky top-0 shrink-0 overflow-visible"
        style={{
          height: 52,
          minHeight: 52,
          borderBottom: '1px solid var(--border-light)',
        }}
      >
        {/* Document status / field count indicator */}
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
            <span className="hidden xs:inline">{fields.length} {fields.length === 1 ? 'field' : 'fields'}</span>
            <span className="xs:hidden">{fields.length}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Page nav */}
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

          {/* Send */}
          <button onClick={onSendClick} className="btn-outline btn-sm !px-2.5 sm:!px-3.5">
            <Send style={{ height: 13, width: 13 }} />
            <span className="hidden md:inline">Send</span>
          </button>

          {/* Sign & Export */}
          <button
            onClick={onSignAndExport}
            disabled={isSigningLoading || fields.length === 0}
            className="btn-primary btn-sm !px-2.5 sm:!px-3.5"
          >
            {isSigningLoading
              ? <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
              : <Download style={{ height: 13, width: 13 }} />
            }
            <span className="hidden xs:inline">Export</span>
          </button>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden w-full max-w-full">

        {/* Page thumbnail sidebar */}
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

        {/* PDF Canvas + Field Overlay */}
        <div
          ref={scrollContainerRef}
          className={`flex-1 overflow-auto p-2 sm:p-8 select-none ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            background: 'var(--bg)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--moss) rgba(0,0,0,0.06)',
            touchAction: 'pan-x pan-y',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
          onMouseDown={handleScrollAreaMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleDocumentTouchEnd}
          onClick={() => {
            if (hasPannedRef.current) return;
            setSelectedFieldId(null);
          }}
        >
          <div className="min-w-full w-max min-h-full flex items-center justify-center m-auto pb-20 sm:pb-28">
            <div
              ref={containerRef}
              className="relative block shrink-0 m-auto"
              style={{
                boxShadow: '0 8px 48px rgba(44,44,36,0.12)',
                width: canvasDimensions.width ? `${canvasDimensions.width}px` : undefined,
                height: canvasDimensions.height ? `${canvasDimensions.height}px` : undefined,
              }}
            >
              <canvas
                ref={canvasRef}
                className="block pointer-events-none"
                style={{
                  width: canvasDimensions.width ? `${canvasDimensions.width}px` : undefined,
                  height: canvasDimensions.height ? `${canvasDimensions.height}px` : undefined,
                }}
              />

            {/* Field Overlay */}
            {currentPageFields.map((field) => {
              const fieldSignerColor = getSignerColor(field.signerOrder);
              const isSelected = selectedFieldId === field.id;
              const isHovered  = hoveredFieldId === field.id;
              const hasValue   = Boolean(field.value);
              const locked     = isFieldLocked(field);

              const assignedRec = recipients.find(
                (r) =>
                  (field.signerId && r.id === field.signerId) ||
                  (field.signerOrder && r.signingOrder === field.signerOrder) ||
                  (field.signerEmail && r.email && r.email.toLowerCase() === field.signerEmail.toLowerCase())
              );

              let borderStyle = '2px dashed transparent';
              if (isSelected) {
                borderStyle = locked ? '2px solid var(--moss)' : `2px solid ${fieldSignerColor}`;
              } else if (!hasValue) {
                borderStyle = `2px dashed ${fieldSignerColor}99`;
              } else if (isHovered) {
                borderStyle = locked ? '1.5px dashed var(--moss)' : `2px dashed ${fieldSignerColor}80`;
              }

              return (
              <div
                key={field.id}
                onMouseEnter={() => setHoveredFieldId(field.id)}
                onMouseLeave={() => setHoveredFieldId(null)}
                onMouseDown={(e) => {
                  handleMouseDown(field.id, e);
                }}
                onTouchStart={(e) => handleFieldTouchStart(field.id, e)}
                onTouchMove={(e) => handleFieldTouchMove(field.id, e)}
                onTouchEnd={handleMouseUp}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasDraggedFieldRef.current) return;
                  if (field.fieldType === 'signature' && !locked) {
                    if (isSelected) {
                      // Already selected, clicking again opens modal to edit / redo!
                      openFieldSigModal(field);
                    } else {
                      setSelectedFieldId(field.id);
                    }
                  } else {
                    setSelectedFieldId(field.id);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (field.fieldType === 'signature' && !locked) {
                    setSelectedFieldId(field.id);
                    openFieldSigModal(field);
                  }
                }}
                style={{
                  left:     `${field.x}%`,
                  top:      `${field.y}%`,
                  width:    `${field.width}%`,
                  height:   `${field.height}%`,
                  position: 'absolute',
                  cursor:   locked ? 'default' : 'move',
                  touchAction: locked ? 'auto' : 'none',
                  zIndex:   isSelected ? 20 : 10,
                  border:   borderStyle,
                  borderRadius: 10,
                  background: isSelected
                    ? (locked ? 'rgba(93, 112, 82, 0.08)' : `${fieldSignerColor}0c`)
                    : (!hasValue ? (field.signerOrder ? `${fieldSignerColor}08` : 'rgba(93,112,82,0.04)') : 'transparent'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  transition: 'border-color 0.15s ease',
                }}
                className="group"
              >
                {/* Signer Tag Badge */}
                {(field.signerOrder !== undefined && field.signerOrder !== null) && (
                  <span
                    className={`absolute -top-2.5 left-2 px-2 py-0.5 rounded-full text-[9px] font-bold text-white shadow-xs z-30 pointer-events-none truncate max-w-[150px] flex items-center gap-1 transition-opacity duration-150 ${
                      isSelected || !hasValue ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    style={{ background: locked ? 'var(--moss)' : fieldSignerColor }}
                  >
                    {locked && <Lock style={{ height: 9, width: 9 }} />}
                    <span>{field.signerName ? `${field.signerName}${locked ? ' (Signed)' : ''}` : (field.signerOrder === 0 ? 'Me (Owner)' : `Signer ${field.signerOrder}`)}</span>
                  </span>
                )}
                {field.fieldType === 'signature' ? (
                  field.value?.startsWith('data:image') ? (
                    <div
                      className="relative w-full h-full flex items-center justify-center group/sig select-none overflow-hidden"
                      onClick={(e) => {
                        if (!hasDraggedFieldRef.current && !locked) {
                          e.stopPropagation();
                          setSelectedFieldId(field.id);
                          openFieldSigModal(field);
                        }
                      }}
                      title={locked ? undefined : 'Click to edit or redo signature'}
                    >
                      <img
                        src={field.value}
                        alt="Signature"
                        className="h-full w-full object-contain pointer-events-none select-none"
                      />
                    </div>
                  ) : (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        openFieldSigModal(field);
                      }}
                      className="flex items-center gap-1 text-xs font-bold cursor-pointer"
                      style={{ color: 'var(--moss)' }}
                    >
                      <PenTool style={{ height: 12, width: 12 }} />
                      <span>Sign</span>
                    </div>
                  )
                ) : isSelected && !locked ? (
                  <FastTextInput
                    value={field.value || ''}
                    fontFamily={field.fontFamily || 'Inter'}
                    onCommit={(val) => {
                      setFields((prev) =>
                        prev.map((f) => (f.id === field.id ? { ...f, value: val } : f))
                      );
                    }}
                    onPressEnter={() => setSelectedFieldId(null)}
                    placeholder={field.fieldType === 'name' ? 'Your Name' : 'Enter text'}
                    autoFocus
                    className="text-xs font-bold px-1.5 py-0.5 rounded bg-white/95 dark:bg-card/95 border border-primary text-foreground outline-none w-full text-center"
                  />
                ) : (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded pointer-events-none font-bold truncate select-none"
                    style={{
                      color: 'var(--fg)',
                      fontFamily: field.fontFamily ? `"${field.fontFamily}", cursive, sans-serif` : 'Inter, sans-serif',
                    }}
                  >
                    {field.value || (field.fieldType === 'name' ? 'Your Name' : 'Text')}
                  </span>
                )}

                {/* Floating Context Toolbar when field is selected */}
                {isSelected && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute z-40 flex items-center gap-1.5 p-1 rounded-full animate-fadeIn whitespace-nowrap overflow-visible ${
                      field.y < 12 ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
                    } ${field.x > 35 ? 'right-0' : 'left-0'}`}
                    style={{
                      background: locked ? 'rgba(240, 245, 238, 0.98)' : 'rgba(254, 254, 250, 0.96)',
                      backdropFilter: 'blur(16px)',
                      border: locked ? '1px solid var(--moss)' : '1px solid var(--border)',
                      boxShadow: '0 8px 24px -4px rgba(44, 44, 36, 0.20), 0 2px 6px rgba(44, 44, 36, 0.08)',
                    }}
                  >
                    {locked ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold" style={{ color: 'var(--moss)' }}>
                        <ShieldCheck style={{ height: 13, width: 13 }} />
                        <span>Locked Signature</span>
                        <span className="text-[10px] opacity-75 font-normal">
                          · {field.signerName || assignedRec?.name || 'Recipient'} ({field.signerEmail || assignedRec?.email || (field.signerOrder ? `Signer ${field.signerOrder}` : 'External Signer')})
                        </span>
                        <Lock style={{ height: 11, width: 11, marginLeft: 2 }} />
                      </div>
                    ) : (
                      <>
                        {/* Redo / Edit button for signature fields */}
                        {field.fieldType === 'signature' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFieldSigModal(field);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white shadow-xs transition-all duration-150 hover:brightness-110 active:scale-95 cursor-pointer shrink-0"
                            style={{ background: 'var(--moss)' }}
                            title="Edit or redo signature"
                          >
                            <RotateCcw style={{ height: 11, width: 11 }} />
                            <span>{field.value ? 'Redo Signature' : 'Sign'}</span>
                          </button>
                        )}

                        {/* Font selector for text/date fields */}
                        {(field.fieldType === 'text' || field.fieldType === 'date' || field.fieldType === 'name') && (
                          <div className="flex items-center gap-1 pl-1">
                            <span className="text-[10px] font-bold" style={{ color: 'var(--fg-muted)' }}>Font:</span>
                            <div className="w-28">
                              <Dropdown
                                value={field.fontFamily || 'Inter'}
                                onChange={(val) => {
                                  const font = String(val);
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
                        )}

                        {/* Signer assignment selector */}
                        <div className="flex items-center gap-1 pl-1">
                          <Users style={{ height: 11, width: 11, color: 'var(--fg-muted)' }} />
                          <div className="w-32 sm:w-36">
                            <Dropdown
                              value={String(field.signerOrder !== undefined && field.signerOrder !== null ? field.signerOrder : -1)}
                              onChange={(val) => {
                                if (val === '__add__') {
                                  onSendClick();
                                  return;
                                }
                                const order = Number(val);
                                if (order === 0) {
                                  setFields((prev) =>
                                    prev.map((f) =>
                                      f.id === field.id
                                        ? {
                                            ...f,
                                            signerOrder: 0,
                                            signerName: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Me (Owner)',
                                            signerEmail: user?.email || undefined,
                                            signerId: undefined,
                                          }
                                        : f
                                    )
                                  );
                                } else if (order === -1) {
                                  setFields((prev) =>
                                    prev.map((f) =>
                                      f.id === field.id
                                        ? {
                                            ...f,
                                            signerOrder: undefined,
                                            signerName: undefined,
                                            signerEmail: undefined,
                                            signerId: undefined,
                                          }
                                        : f
                                    )
                                  );
                                } else {
                                  const targetRec = recipients.find((r) => r.signingOrder === order);
                                  setFields((prev) =>
                                    prev.map((f) =>
                                      f.id === field.id
                                        ? {
                                            ...f,
                                            signerOrder: order,
                                            signerName: targetRec?.name,
                                            signerEmail: targetRec?.email,
                                            signerId: targetRec?.id,
                                            // Clear value if assigning to a recipient so owner's draft signature doesn't get assigned to them
                                            value: !isFieldLocked(f) ? '' : f.value,
                                          }
                                        : f
                                    )
                                  );
                                }
                              }}
                              options={signerOptions}
                              buttonClassName="!h-7 !py-0 px-2 text-[11px] bg-white/90"
                              align={field.x > 35 ? 'right' : 'left'}
                              menuClassName="min-w-[180px]"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Delete handle (only for unlocked fields) */}
                {!locked && (
                  <button
                    onClick={(e) => removeField(field.id, e)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`absolute -top-2.5 -right-2.5 h-6 w-6 rounded-full flex items-center justify-center transition-all duration-200 z-30 cursor-pointer ${
                      isSelected ? 'opacity-100 scale-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
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

                {/* Corner Resize handle (only for unlocked fields) */}
                {!locked && isSelected && (
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(field.id, e)}
                    onTouchStart={(e) => handleResizeTouchStart(field.id, e)}
                    onTouchMove={(e) => handleResizeTouchMove(field.id, e)}
                    onTouchEnd={handleMouseUp}
                    className="absolute -bottom-3.5 -right-3.5 w-9 h-9 flex items-center justify-center cursor-se-resize z-30 touch-none"
                    title="Drag to resize"
                    aria-label="Resize handle"
                  >
                    <span
                      className="w-4 h-4 rounded-full block transition-transform hover:scale-125 shadow-sm"
                      style={{
                        background: 'var(--moss)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.30)',
                        border: '2px solid #ffffff',
                      }}
                    />
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  </div>

    {/* ── Floating Action Bar (Follows user as they scroll) ─────── */}
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
        () => addField('signature'),
        '+ Sig'
      )}

      {/* Stamp My Sig Dropdown Menu */}
      <div className="relative z-50 overflow-visible" ref={sigDropdownRef}>
        <button
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
                    onClick={() => handleSelectSavedSignature(sig.dataUrl)}
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
              onClick={handleAddNewSignature}
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
        () => addField('date')
      )}

      {/* + Text */}
      {toolBtn(
        '+ Text',
        <Type style={{ height: 13, width: 13 }} />,
        () => addField('text')
      )}
    </div>

    {/* ── Mobile Floating Zoom Controls ── */}
    <div
      className="fixed bottom-[4.75rem] right-3 z-40 sm:hidden flex items-center gap-1 px-2 py-1.5 rounded-full glass shadow-float border border-border"
      style={{
        background: 'rgba(254, 254, 250, 0.92)',
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
  </>
  );
};
