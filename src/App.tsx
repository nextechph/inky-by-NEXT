import React, { useState, useEffect, useRef } from 'react';
import { FoldableLayout } from './components/FoldableLayout';
import { Dashboard } from './components/Dashboard';
import { PdfViewer } from './components/PdfViewer';
import { MultiSignerPanel } from './components/MultiSignerPanel';
import { InboundPortal } from './components/InboundPortal';
import { SignerPortal } from './components/SignerPortal';
import { HistoryView } from './components/HistoryView';
import { LoginPage } from './components/LoginPage';
import Toast from './components/Toast';

// Modals
import { SignaturePadModal } from './components/modals/SignaturePadModal';
import { ShareInboxModal } from './components/modals/ShareInboxModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { AuthModal } from './components/modals/AuthModal';

// Stores & Services
import { useDocumentStore } from './store/useDocumentStore';
import { useSignatureStore } from './store/useSignatureStore';
import { useToastStore } from './store/useToastStore';
import { useFoldableStore } from './store/useFoldableStore';
import { useAuthStore } from './store/useAuthStore';
import { inboxService } from './services/inboxService';
import { realtimeService } from './services/realtimeService';
import { notificationService, SignedNotification } from './services/notificationService';
import { signingRequestService, PendingSigningRequest } from './services/signingRequestService';
import { SignerAuthGate } from './components/SignerAuthGate';
import { InboxLink } from './types';
import { formatDateTime } from './utils';

// Icons
import {
  PenTool, Trash2, ArrowLeft, PlusCircle,
  Inbox, Leaf, Copy, Check, Pencil, X,
  PenLine, CheckCircle2, FileCheck2, ChevronRight, BellOff,
  Share2, FileText, Clock,
} from 'lucide-react';

const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '::1');

export function App() {
  const {
    documents,
    selectedDoc,
    fields,
    activeTab,
    isSigningLoading,
    setActiveTab,
    setFields,
    fetchDocuments,
    selectDocument,
    uploadDocument,
    signAndExport,
    deleteDocument,
    clearSelection,
  } = useDocumentStore();

  const {
    signatures,
    isSigModalOpen,
    loadSignatures,
    openSignatureModal,
    closeSignatureModal,
    removeSignature,
    makeDefault,
    renameSignature,
  } = useSignatureStore();

  const { showToast } = useToastStore();
  const updateDimensions = useFoldableStore((s) => s.updateDimensions);
  const { user, isInitializing, isAuthModalOpen, closeAuthModal, initializeAuth } = useAuthStore();
  const [guestMode, setGuestMode] = useState(false);

  // Modals & Local UI state
  const [targetFieldId, setTargetFieldId] = useState<string | undefined>(undefined);
  const [isMultiSignerOpen, setIsMultiSignerOpen] = useState(false);
  const [isShareInboxOpen, setIsShareInboxOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteReq, setConfirmDeleteReq] = useState<PendingSigningRequest | null>(null);
  const [confirmDeleteNotif, setConfirmDeleteNotif] = useState<SignedNotification | null>(null);

  // Saved Signatures renaming state
  const [editingSigId, setEditingSigId] = useState<string | null>(null);
  const [editingSigLabel, setEditingSigLabel] = useState<string>('');

  const startRenamingSig = (sig: { id: string; label: string }) => {
    setEditingSigId(sig.id);
    setEditingSigLabel(sig.label || 'My Signature');
  };

  const handleSaveRenameSig = (id: string) => {
    if (editingSigLabel.trim()) {
      renameSignature(id, editingSigLabel.trim());
    }
    setEditingSigId(null);
  };

  const handleCancelRenameSig = () => {
    setEditingSigId(null);
  };

  // Path navigation & Route detection
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [currentSearch, setCurrentSearch] = useState(window.location.search);
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
      setCurrentSearch(window.location.search);
      setCurrentHash(window.location.hash);
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    setCurrentSearch(window.location.search);
    setCurrentHash(window.location.hash);
  };

  // Extract signToken from /sign/:token, ?sign=:token, or #/sign/:token
  const sanitizeToken = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const clean = decodeURIComponent(raw).split('?')[0].split('#')[0].replace(/\/+$/, '').trim();
    return clean.length > 0 ? clean : null;
  };

  const searchParams = new URLSearchParams(currentSearch);
  const querySignToken = sanitizeToken(searchParams.get('sign'));
  const queryInboxToken = sanitizeToken(searchParams.get('inbox'));

  const hashSignToken = sanitizeToken(currentHash.startsWith('#/sign/') ? currentHash.slice(7) : null);
  const hashInboxToken = sanitizeToken(currentHash.startsWith('#/inbox-submit/') ? currentHash.slice(14) : null);

  const pathSignToken = sanitizeToken(
    currentPath.startsWith('/sign/')
      ? currentPath.split('/sign/')[1]
      : null
  );
  const pathInboxToken = sanitizeToken(
    currentPath.startsWith('/inbox-submit/')
      ? currentPath.split('/inbox-submit/')[1]
      : null
  );

  const signToken = pathSignToken || querySignToken || hashSignToken;
  const isSignRoute = Boolean(signToken);

  const inboundToken = pathInboxToken || queryInboxToken || hashInboxToken;
  const isInboxRoute = Boolean(inboundToken);

  const isPublicRoute = isInboxRoute || isSignRoute;

  // Inbox links list
  const [inboxLinks, setInboxLinks] = useState<InboxLink[]>([]);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Signed notifications (sender's inbox)
  const [notifications, setNotifications] = useState<SignedNotification[]>([]);
  const [isNotifLoading, setIsNotifLoading] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Pending signing requests (receiver's inbox)
  const [pendingRequests, setPendingRequests] = useState<PendingSigningRequest[]>([]);
  const [isPendingLoading, setIsPendingLoading] = useState(false);
  const [inboxSubTab, setInboxSubTab] = useState<'to_sign' | 'signed_docs' | 'links'>('to_sign');

  const pendingToSignCount = pendingRequests.filter((r) => r.status === 'pending').length;
  const totalInboxBadge = unreadCount + pendingToSignCount;

  // Responsive / Foldable resize watcher
  useEffect(() => {
    const handleResize = () => updateDimensions(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateDimensions]);

  // Initial load
  useEffect(() => {
    initializeAuth();
    if (!isPublicRoute) {
      fetchDocuments();
      loadSignatures();
      loadInboxLinks();
      loadNotifications();
    }
  }, [isPublicRoute]);

  // Auto-redirect to home if authenticated user is on /login
  useEffect(() => {
    if (user && currentPath === '/login') {
      navigateTo('/');
    }
  }, [user, currentPath]);

  // Load pending signing requests whenever user email is known
  useEffect(() => {
    if (user?.email && !isPublicRoute) {
      loadPendingRequests();
    }
  }, [user?.email, isPublicRoute]);

  // Supabase Realtime Subscription (Live sync across devices & remote signers)
  useEffect(() => {
    const unsubscribe = realtimeService.subscribeToAll();
    // Refresh notification list & badge when a new signed_notification arrives
    realtimeService.onNewNotification(() => {
      loadNotifications();
    });
    // Refresh pending signing requests when a new document is dispatched to this user
    realtimeService.onNewSigningRequest(() => {
      loadPendingRequests();
    });
    return () => {
      unsubscribe();
    };
  }, [user?.email]);

  const loadPendingRequests = async () => {
    if (!user?.email) return;
    setIsPendingLoading(true);
    try {
      const list = await signingRequestService.listRequestsForUser(user.email);
      setPendingRequests(list);
    } catch (e) {
      console.error('Failed to load pending requests', e);
    } finally {
      setIsPendingLoading(false);
    }
  };

  const loadInboxLinks = async () => {
    try {
      const links = await inboxService.listLinks();
      setInboxLinks(links);
    } catch (e) {
      console.error('Failed to load inbox links', e);
    }
  };

  const loadNotifications = async () => {
    setIsNotifLoading(true);
    try {
      const list = await notificationService.listNotifications();
      setNotifications(list);
    } catch (e) {
      console.error('Failed to load notifications', e);
    } finally {
      setIsNotifLoading(false);
    }
  };

  const handleMarkNotifRead = async (id: string, docId: string) => {
    // Mark read in DB
    await notificationService.markRead(id);
    // Optimistic update
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    // Navigate to the document
    const doc = documents.find((d) => d.id === docId);
    if (doc) {
      selectDocument(doc);
    } else {
      // Doc may not be loaded yet — refetch first
      await fetchDocuments();
      const freshDoc = useDocumentStore.getState().documents.find((d) => d.id === docId);
      if (freshDoc) selectDocument(freshDoc);
    }
  };

  const handleMarkAllNotifRead = async () => {
    await notificationService.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleDeleteSigningRequest = async (req: PendingSigningRequest) => {
    try {
      await signingRequestService.deleteRequest(req.id, req.documentId, user?.email || undefined, req.token);
      setPendingRequests((prev) => prev.filter((r) => r.id !== req.id && (!req.token || r.token !== req.token)));
      showToast('Signing request removed from inbox', 'info');
    } catch {
      showToast('Failed to remove request', 'error');
    }
  };

  const handleDeleteNotification = async (notif: SignedNotification) => {
    try {
      await notificationService.deleteNotification(notif.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
      showToast('Signed document notification removed', 'info');
    } catch {
      showToast('Failed to remove notification', 'error');
    }
  };

  if (isInboxRoute && inboundToken) {
    return <InboundPortal token={inboundToken} />;
  }

  if (isSignRoute && signToken) {
    if (!user && !guestMode) {
      return (
        <>
          <SignerAuthGate
            token={signToken}
            onContinueAsGuest={() => setGuestMode(true)}
          />
          <Toast />
        </>
      );
    }
    return <SignerPortal token={signToken} onBack={() => navigateTo('/')} />;
  }

  // Initial auth check loading state
  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3">
          <img src="/inky-mark.png" alt="Inky" className="h-12 w-auto animate-pulse" />
          <span className="text-xs font-semibold text-[var(--fg-muted)]">Loading Inky…</span>
        </div>
      </div>
    );
  }

  // Show login page by default when running website unauthenticated
  // Note: Guest mode is ONLY permitted on localhost for local development with Antigravity
  const canUseGuest = isLocalhost && guestMode;
  if (!user && !canUseGuest) {
    return (
      <>
        <LoginPage
          onNavigateHome={() => {
            if (isLocalhost && !user) {
              setGuestMode(true);
            }
            navigateTo('/');
          }}
        />
        <Toast />
      </>
    );
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadDocument(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleOpenSigModal = (fieldId?: string) => {
    setTargetFieldId(fieldId);
    openSignatureModal(fieldId);
  };

  const handleSelectSignatureFromModal = (dataUrl: string) => {
    if (targetFieldId) {
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth / (img.naturalHeight || 1);
        const targetHeight = aspect < 2.0 ? 10.5 : 7.5;
        const targetWidth = Math.min(50, Math.max(14, targetHeight * 1.4 * aspect));
        setFields((prev) =>
          prev.map((f) =>
            f.id === targetFieldId
              ? {
                  ...f,
                  value: dataUrl,
                  width: Math.round(targetWidth * 10) / 10,
                  height: targetHeight,
                }
              : f
          )
        );
      };
      img.src = dataUrl;
    }
    closeSignatureModal();
    loadSignatures();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(text);
    showToast('Link copied to clipboard', 'success');
    setTimeout(() => setCopiedLink(null), 2500);
  };

  return (
    <FoldableLayout
      activeTab={activeTab}
      setActiveTab={(tab) => {
        if (tab === 'dashboard' && selectedDoc) clearSelection();
        setActiveTab(tab as any);
      }}
      onUploadClick={() => fileInputRef.current?.click()}
      onGenerateInboxClick={() => setIsShareInboxOpen(true)}
      onNavigateLogin={() => navigateTo('/login')}
      unreadNotificationCount={totalInboxBadge}
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="application/pdf"
        className="hidden"
      />

      {/* ── Dashboard Tab ──────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <Dashboard
          documents={documents}
          onSelectDocument={selectDocument}
          onUploadClick={() => fileInputRef.current?.click()}
          onGenerateInboxClick={() => setIsShareInboxOpen(true)}
          onDeleteDocument={(id) => setConfirmDeleteId(id)}
        />
      )}

      {/* ── Editor Tab ─────────────────────────────────────── */}
      {activeTab === 'editor' && selectedDoc && (
        <div className="flex flex-col h-full min-h-0 flex-1 space-y-1.5 sm:space-y-3">
          <div className="flex items-center justify-between pb-1.5 border-b border-border gap-2 shrink-0">
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-all shrink-0"
            >
              <ArrowLeft size={14} />
              <span className="hidden xs:inline">Back to Documents</span>
              <span className="xs:hidden">Back</span>
            </button>
            <div className="text-right min-w-0">
              <h2 className="text-xs sm:text-sm font-bold text-foreground truncate max-w-[200px] xs:max-w-xs sm:max-w-md">
                {selectedDoc.title}
              </h2>
              <span className="text-[10px] sm:text-[11px] text-muted-foreground font-mono">
                {selectedDoc.pageCount} page{selectedDoc.pageCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <PdfViewer
              documentId={selectedDoc.id}
              pdfUrl={selectedDoc.filePath}
              fields={fields}
              setFields={setFields as any}
              onOpenSignatureModal={handleOpenSigModal}
              onSignAndExport={() => signAndExport()}
              onSendClick={() => setIsMultiSignerOpen(true)}
              isSigningLoading={isSigningLoading}
            />
          </div>
        </div>
      )}

      {/* ── Signatures Tab ─────────────────────────────────── */}
      {activeTab === 'signatures' && (
        <div className="space-y-6 max-w-3xl mx-auto w-full animate-fadeIn pb-12">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display font-bold text-2xl text-foreground">
                Saved Signatures
              </h2>
              <p className="text-sm mt-0.5 text-muted-foreground">
                Stored locally on your device for one-tap placement
              </p>
            </div>
            <button onClick={() => handleOpenSigModal()} className="btn-primary">
              <PlusCircle size={15} />
              <span>New Signature</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {signatures.length === 0 ? (
              <div className="col-span-1 sm:col-span-2 card-organic rounded-[2.5rem] px-5 py-10 sm:p-12 text-center flex flex-col items-center justify-center space-y-5 w-full">
                <div className="relative h-14 w-14 rounded-[1.5rem] flex items-center justify-center bg-primary/10 text-primary">
                  <PenTool size={24} />
                </div>
                <div className="w-full text-center">
                  <h3 className="font-display font-bold text-lg text-foreground">
                    No Saved Signatures
                  </h3>
                  <p className="text-sm mt-1.5 max-w-sm mx-auto text-muted-foreground">
                    Draw, type, or upload your signature once. It's saved locally for instant placement across all documents.
                  </p>
                </div>
                <button onClick={() => handleOpenSigModal()} className="btn-primary">
                  <PlusCircle size={15} />
                  <span>Create First Signature</span>
                </button>
              </div>
            ) : (
              signatures.map((sig) => (
                <div key={sig.id} className="card-organic p-4 rounded-[2rem] flex flex-col gap-3">
                  <div className="h-24 rounded-[1.25rem] flex items-center justify-center p-3 bg-white/70 dark:bg-card/70 border border-dashed border-border">
                    <img src={sig.dataUrl} alt={sig.label} className="h-full max-w-full object-contain" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {editingSigId === sig.id ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingSigLabel}
                            onChange={(e) => setEditingSigLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRenameSig(sig.id);
                              if (e.key === 'Escape') handleCancelRenameSig();
                            }}
                            className="input-organic h-8 px-2.5 text-xs font-bold w-full max-w-[170px]"
                            autoFocus
                            placeholder="Signature name…"
                          />
                          <button
                            onClick={() => handleSaveRenameSig(sig.id)}
                            className="h-7 w-7 rounded-full flex items-center justify-center bg-[var(--moss)] text-white hover:scale-105 transition-transform shrink-0"
                            title="Save name"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={handleCancelRenameSig}
                            className="h-7 w-7 rounded-full flex items-center justify-center bg-[var(--bg-stone)] text-[var(--fg-muted)] hover:scale-105 transition-transform shrink-0"
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-1.5 group/edit cursor-pointer"
                          onClick={() => startRenamingSig(sig)}
                        >
                          <span className="text-xs font-bold truncate text-foreground group-hover/edit:text-[var(--moss)] transition-colors">
                            {sig.label}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startRenamingSig(sig);
                            }}
                            className="p-1 rounded-lg text-[var(--fg-muted)] hover:text-[var(--moss)] hover:bg-[var(--moss-dim)] transition-all"
                            title="Rename signature"
                            aria-label="Rename signature"
                          >
                            <Pencil size={12} />
                          </button>
                          {sig.isDefault && <span className="badge-moss text-[10px]">Default</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!sig.isDefault && (
                        <button
                          onClick={() => makeDefault(sig.id)}
                          className="px-2.5 py-1 rounded-full text-[10px] font-bold text-[var(--moss)] hover:bg-[var(--moss-dim)] transition-colors"
                          title="Set as default signature"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        onClick={() => removeSignature(sig.id)}
                        className="p-2 rounded-xl text-rose-500 hover:scale-110 transition-transform"
                        title="Delete signature"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Inbox Tab ─────────────────────────────────── */}
      {activeTab === 'inbox' && (
        <div className="space-y-6 max-w-3xl mx-auto w-full animate-fadeIn pb-12">

          {/* ── Header & Sub-tab navigation ── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground flex items-center gap-2.5">
                <Inbox style={{ height: 26, width: 26, color: 'var(--moss)' }} />
                Inbox
                {totalInboxBadge > 0 && (
                  <span
                    className="inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full text-xs font-bold text-white shadow-sm"
                    style={{ background: '#C18C5D' }}
                  >
                    {totalInboxBadge}
                  </span>
                )}
              </h1>
              <p className="text-xs sm:text-sm mt-1 text-muted-foreground">
                Review incoming requests to sign, documents signed by others, and upload links
              </p>
            </div>

            {/* Sub-tab pills */}
            <div className="flex items-center gap-1 p-1 rounded-full bg-muted/60 border border-border w-full sm:w-auto overflow-x-auto no-scrollbar shrink-0 self-start sm:self-center">
              <button
                onClick={() => setInboxSubTab('to_sign')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 whitespace-nowrap"
                style={{
                  background: inboxSubTab === 'to_sign' ? 'var(--moss)' : 'transparent',
                  color: inboxSubTab === 'to_sign' ? '#FFFFFF' : 'var(--fg-muted)',
                }}
              >
                <PenLine style={{ height: 13, width: 13 }} />
                <span>To Sign</span>
                {pendingToSignCount > 0 && (
                  <span
                    className="h-4 min-w-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                    style={{
                      background: '#C18C5D',
                      color: '#FFF',
                    }}
                  >
                    {pendingToSignCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setInboxSubTab('signed_docs')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 whitespace-nowrap"
                style={{
                  background: inboxSubTab === 'signed_docs' ? 'var(--moss)' : 'transparent',
                  color: inboxSubTab === 'signed_docs' ? '#FFFFFF' : 'var(--fg-muted)',
                }}
              >
                <CheckCircle2 style={{ height: 13, width: 13 }} />
                <span className="hidden xs:inline">Signed Documents</span>
                <span className="xs:hidden">Signed</span>
                {unreadCount > 0 && (
                  <span
                    className="h-4 min-w-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                    style={{
                      background: '#C18C5D',
                      color: '#FFF',
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setInboxSubTab('links')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 whitespace-nowrap"
                style={{
                  background: inboxSubTab === 'links' ? 'var(--moss)' : 'transparent',
                  color: inboxSubTab === 'links' ? '#FFFFFF' : 'var(--fg-muted)',
                }}
              >
                <Share2 style={{ height: 13, width: 13 }} />
                <span className="hidden xs:inline">Upload Links</span>
                <span className="xs:hidden">Links</span>
              </button>
            </div>
          </div>

          {/* ── Sub-tab 1: Documents Waiting for Your Signature (To Sign) ── */}
          {inboxSubTab === 'to_sign' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display font-bold text-xl text-foreground flex items-center gap-2">
                    <FileText style={{ height: 20, width: 20, color: '#C18C5D' }} />
                    Waiting for Your Signature
                    {pendingToSignCount > 0 && (
                      <span
                        className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold text-white"
                        style={{ background: '#C18C5D' }}
                      >
                        {pendingToSignCount}
                      </span>
                    )}
                  </h2>
                  <p className="text-sm mt-0.5 text-muted-foreground">
                    Documents sent directly to your email address that require your review or signature
                  </p>
                </div>
                <button
                  onClick={loadPendingRequests}
                  className="btn-ghost btn-sm text-xs"
                  title="Refresh list"
                >
                  Refresh
                </button>
              </div>

              <div className="space-y-3">
                {isPendingLoading ? (
                  <div className="card-organic rounded-[2.5rem] p-10 flex items-center justify-center">
                    <span className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--moss)] border-t-transparent" />
                  </div>
                ) : pendingRequests.length === 0 ? (
                  <div className="card-organic rounded-[2.5rem] px-5 py-10 sm:p-12 text-center space-y-4">
                    <div className="relative h-14 w-14 rounded-[1.5rem] flex items-center justify-center mx-auto" style={{ background: 'var(--moss-dim)' }}>
                      <FileCheck2 style={{ height: 24, width: 24, color: 'var(--moss)' }} />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-lg text-foreground">
                        No Documents Waiting for You
                      </h3>
                      <p className="text-sm mt-1.5 max-w-sm mx-auto text-muted-foreground">
                        You're all caught up! When someone sends a document to your email for signing, it will appear here immediately so you can sign it directly.
                      </p>
                    </div>
                  </div>
                ) : (
                  pendingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="card-organic rounded-[2rem] px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col xs:flex-row xs:items-center justify-between gap-3 transition-all duration-200 hover:shadow-md"
                      style={{
                        borderLeft: req.status === 'pending' ? '3px solid #C18C5D' : '3px solid var(--moss)',
                      }}
                    >
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div
                          className="h-10 w-10 sm:h-11 sm:w-11 rounded-2xl flex items-center justify-center shrink-0"
                          style={{
                            background: req.status === 'pending' ? 'rgba(193,140,93,0.12)' : 'var(--moss-dim)',
                          }}
                        >
                          {req.status === 'pending' ? (
                            <PenLine style={{ height: 18, width: 18, color: '#C18C5D' }} />
                          ) : (
                            <CheckCircle2 style={{ height: 18, width: 18, color: 'var(--moss)' }} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className="font-bold text-xs sm:text-sm truncate" style={{ color: 'var(--fg)' }}>
                              {req.documentTitle}
                            </span>
                            {req.status === 'pending' ? (
                              <span className="badge-clay text-[9px] sm:text-[10px]">Action Required</span>
                            ) : (
                              <span className="badge-moss text-[9px] sm:text-[10px]">Signed</span>
                            )}
                          </div>
                          <p className="text-[10px] sm:text-[11px] mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                            From <strong style={{ color: 'var(--fg)' }}>{req.senderName || 'Document Owner'}</strong>
                            {req.senderEmail && ` · ${req.senderEmail}`}
                            {' · '}
                            {formatDateTime(req.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end xs:self-center">
                        <button
                          onClick={() => navigateTo(`/sign/${req.token}`)}
                          className="btn-primary btn-sm flex items-center gap-1.5"
                          style={{
                            background: req.status === 'pending' ? 'var(--terracotta)' : 'var(--moss)',
                          }}
                        >
                          <span>{req.status === 'pending' ? 'Sign Now' : 'View'}</span>
                          <ChevronRight style={{ height: 13, width: 13 }} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteReq(req);
                          }}
                          className="p-1.5 sm:p-2 rounded-xl transition-all duration-200 hover:scale-110 cursor-pointer"
                          style={{ color: 'var(--fg-muted)' }}
                          aria-label="Delete signing request"
                          title="Delete from inbox"
                        >
                          <Trash2 style={{ height: 15, width: 15 }} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── Sub-tab 2: Signed Documents (Completed Signatures from Recipients) ── */}
          {inboxSubTab === 'signed_docs' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display font-bold text-xl text-foreground flex items-center gap-2">
                    <CheckCircle2 style={{ height: 20, width: 20, color: 'var(--moss)' }} />
                    Signed Documents
                    {unreadCount > 0 && (
                      <span
                        className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold text-white"
                        style={{ background: '#C18C5D' }}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </h2>
                  <p className="text-sm mt-0.5 text-muted-foreground">
                    Documents returned after signing by your recipients
                  </p>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllNotifRead}
                    className="btn-ghost btn-sm flex items-center gap-1.5 text-xs"
                    title="Mark all as read"
                  >
                    <BellOff style={{ height: 13, width: 13 }} />
                    <span className="hidden sm:inline">Mark all read</span>
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {isNotifLoading ? (
                  <div className="card-organic rounded-[2.5rem] p-10 flex items-center justify-center">
                    <span className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--moss)] border-t-transparent" />
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="card-organic rounded-[2.5rem] px-5 py-10 sm:p-12 text-center space-y-4">
                    <div className="relative h-14 w-14 rounded-[1.5rem] flex items-center justify-center mx-auto" style={{ background: 'var(--moss-dim)' }}>
                      <FileCheck2 style={{ height: 24, width: 24, color: 'var(--moss)' }} />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-lg text-foreground">
                        No Signed Documents Yet
                      </h3>
                      <p className="text-sm mt-1.5 max-w-sm mx-auto text-muted-foreground">
                        When a recipient finishes signing a document you sent, it will appear here instantly.
                      </p>
                    </div>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className="card-organic rounded-[2rem] px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col xs:flex-row xs:items-center justify-between gap-3 transition-all duration-200 hover:shadow-md"
                      style={{
                        borderLeft: notif.read ? undefined : `3px solid ${notif.allComplete ? 'var(--moss)' : '#C18C5D'}`,
                        opacity: notif.read ? 0.78 : 1,
                      }}
                    >
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div
                          className="h-10 w-10 sm:h-11 sm:w-11 rounded-2xl flex items-center justify-center shrink-0"
                          style={{ background: notif.allComplete ? 'var(--moss-dim)' : 'rgba(193,140,93,0.12)' }}
                        >
                          {notif.allComplete
                            ? <CheckCircle2 style={{ height: 18, width: 18, color: 'var(--moss)' }} />
                            : <PenLine style={{ height: 18, width: 18, color: '#C18C5D' }} />
                          }
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className="font-bold text-xs sm:text-sm truncate" style={{ color: 'var(--fg)' }}>
                              {notif.docTitle}
                            </span>
                            {notif.allComplete
                              ? <span className="badge-moss text-[9px] sm:text-[10px]">Fully Signed</span>
                              : <span className="badge-clay text-[9px] sm:text-[10px]">Partially Signed</span>
                            }
                            {!notif.read && (
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ background: '#C18C5D' }}
                              />
                            )}
                          </div>
                          <p className="text-[10px] sm:text-[11px] mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                            Signed by <strong style={{ color: 'var(--fg)' }}>{notif.signerName}</strong>
                            {' · '}
                            {notif.signerEmail}
                            {' · '}
                            {formatDateTime(notif.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end xs:self-center">
                        <button
                          onClick={() => handleMarkNotifRead(notif.id, notif.documentId)}
                          className="btn-primary btn-sm flex items-center gap-1.5"
                          title="Open document"
                        >
                          <span>View</span>
                          <ChevronRight style={{ height: 13, width: 13 }} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteNotif(notif);
                          }}
                          className="p-1.5 sm:p-2 rounded-xl transition-all duration-200 hover:scale-110 cursor-pointer"
                          style={{ color: 'var(--fg-muted)' }}
                          aria-label="Delete notification"
                          title="Delete notification"
                        >
                          <Trash2 style={{ height: 15, width: 15 }} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── Sub-tab 3: Inbox Upload Links ── */}
          {inboxSubTab === 'links' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display font-bold text-xl text-foreground flex items-center gap-2">
                    <Inbox style={{ height: 20, width: 20, color: 'var(--moss)' }} />
                    Inbox Upload Links
                  </h2>
                  <p className="text-sm mt-0.5 text-muted-foreground">
                    Shareable links for external senders to submit PDFs directly into your queue
                  </p>
                </div>
                <button onClick={() => setIsShareInboxOpen(true)} className="btn-primary btn-sm">
                  <PlusCircle style={{ height: 13, width: 13 }} />
                  <span>New Link</span>
                </button>
              </div>

              <div className="space-y-3">
                {inboxLinks.length === 0 ? (
                  <div className="card-organic rounded-[2.5rem] p-10 text-center space-y-4">
                    <div className="relative h-14 w-14 rounded-[1.5rem] flex items-center justify-center mx-auto" style={{ background: 'var(--moss-dim)' }}>
                      <Inbox style={{ height: 24, width: 24, color: 'var(--moss)' }} />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-base text-foreground">
                        No Active Links
                      </h3>
                      <p className="text-sm mt-1.5 max-w-xs mx-auto text-muted-foreground">
                        Create a shareable link so clients can submit PDFs directly into your signing queue.
                      </p>
                    </div>
                    <button onClick={() => setIsShareInboxOpen(true)} className="btn-primary btn-sm mx-auto">
                      <Leaf style={{ height: 13, width: 13 }} />
                      <span>Create First Link</span>
                    </button>
                  </div>
                ) : (
                  inboxLinks.map((link) => {
                    const url = `${window.location.origin}/inbox-submit/${link.token}`;
                    return (
                      <div key={link.id} className="card-organic rounded-[2rem] px-5 py-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm text-foreground">
                            {link.title || 'Inbox Upload Link'}
                          </h4>
                          <span className="badge-clay">
                            {link.currentUses} / {link.maxUses ?? '∞'} Uses
                          </span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full px-4 py-2 bg-muted/60 border border-border">
                          <span className="text-xs font-mono select-all truncate flex-1 text-muted-foreground">
                            {url}
                          </span>
                          <button
                            onClick={() => copyToClipboard(url)}
                            className="shrink-0 transition-transform hover:scale-110 text-muted-foreground hover:text-foreground"
                          >
                            {copiedLink === url ? <Check style={{ height: 14, width: 14, color: 'var(--moss)' }} /> : <Copy style={{ height: 14, width: 14 }} />}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

        </div>
      )}


      {/* ── History Tab ─────────────────────────────────────── */}
      {activeTab === 'history' && (
        <HistoryView
          documents={documents}
          onSelectDocument={selectDocument}
          onDeleteDocument={(id) => setConfirmDeleteId(id)}
          onGoToQueue={() => setActiveTab('dashboard')}
        />
      )}

      {/* ── Modals & Notifications ──────────────────────────── */}
      <SignaturePadModal
        isOpen={isSigModalOpen}
        onClose={closeSignatureModal}
        onSelectSignature={handleSelectSignatureFromModal}
      />

      {selectedDoc && (
        <MultiSignerPanel
          documentId={selectedDoc.id}
          isOpen={isMultiSignerOpen}
          onClose={() => setIsMultiSignerOpen(false)}
          onSuccess={fetchDocuments}
        />
      )}

      <ShareInboxModal
        isOpen={isShareInboxOpen}
        onClose={() => {
          setIsShareInboxOpen(false);
          loadInboxLinks();
        }}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDeleteId)}
        title="Delete Document"
        message="Are you sure you want to permanently delete this document? This action cannot be undone."
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={() => {
          if (confirmDeleteId) {
            deleteDocument(confirmDeleteId);
            setConfirmDeleteId(null);
          }
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDeleteReq)}
        title="Remove Signing Request"
        message={`Are you sure you want to remove "${confirmDeleteReq?.documentTitle || 'this document'}" from your inbox?`}
        confirmLabel="Remove"
        isDestructive={true}
        onConfirm={() => {
          if (confirmDeleteReq) {
            handleDeleteSigningRequest(confirmDeleteReq);
            setConfirmDeleteReq(null);
          }
        }}
        onCancel={() => setConfirmDeleteReq(null)}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDeleteNotif)}
        title="Remove Notification"
        message={`Are you sure you want to delete the notification for "${confirmDeleteNotif?.docTitle || 'this document'}"?`}
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={() => {
          if (confirmDeleteNotif) {
            handleDeleteNotification(confirmDeleteNotif);
            setConfirmDeleteNotif(null);
          }
        }}
        onCancel={() => setConfirmDeleteNotif(null)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={closeAuthModal}
      />

      <Toast />
    </FoldableLayout>
  );
}
