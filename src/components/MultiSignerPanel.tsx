import React, { useState } from 'react';
import { X, Send, UserPlus, Trash2, Users, CheckCircle2, Mail, Share2, Copy, Check, ExternalLink, CloudOff, Info, RotateCw, Loader2 } from 'lucide-react';
import { deliveryService, DispatchedRecipient } from '../services/deliveryService';
import { useToastStore } from '../store/useToastStore';
import { isSupabaseConfigured } from '../lib/supabase';

interface MultiSignerPanelProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const MultiSignerPanel: React.FC<MultiSignerPanelProps> = ({
  documentId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [recipients, setRecipients] = useState([{ email: '', name: '', signingOrder: 1 }]);
  const [isLoading, setIsLoading]   = useState(false);
  const [sentResult, setSentResult] = useState<any | null>(null);
  const [copiedIdx, setCopiedIdx]   = useState<number | null>(null);
  const [resendingIdx, setResendingIdx] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleSend = async () => {
    const valid = recipients.filter((r) => r.email.trim() && r.name.trim());
    if (!valid.length) { 
        useToastStore.getState().showToast('Add at least one recipient with name and email.', 'warning');
        return; 
    }
    setIsLoading(true);
    try {
      await deliveryService.setRecipients(documentId, valid);
      const res = await deliveryService.sendDocument(documentId);
      setSentResult(res);
      const allSent = res.recipients?.every((r) => r.emailSent);
      if (allSent) {
        useToastStore.getState().showToast('Document sent & email invitations dispatched!', 'success');
      } else {
        useToastStore.getState().showToast('Document dispatched & links generated!', 'success');
      }
      onSuccess();
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to send document', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendEmail = async (item: DispatchedRecipient, index: number) => {
    setResendingIdx(index);
    try {
      const res = await deliveryService.resendSignerEmail(item);
      if (res.success) {
        useToastStore.getState().showToast(`Email invitation sent to ${item.email}!`, 'success');
        setSentResult((prev: any) => {
          if (!prev) return prev;
          const updated = [...prev.recipients];
          updated[index] = { ...updated[index], emailSent: true, emailError: undefined };
          return { ...prev, recipients: updated };
        });
      } else {
        useToastStore.getState().showToast(res.error || 'Failed to deliver email via Gmail SMTP', 'error');
      }
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Error resending email', 'error');
    } finally {
      setResendingIdx(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 animate-fadeIn"
      style={{ background: 'rgba(44,44,36,0.50)', backdropFilter: 'blur(10px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card-organic max-w-md w-full max-h-[92vh] flex flex-col overflow-hidden animate-slideUp rounded-[1.75rem] sm:rounded-[2.5rem]"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-light)' }}
        >
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div
              className="h-8 sm:h-9 w-8 sm:w-9 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--clay-dim)' }}
            >
              <Users style={{ height: 16, width: 16, color: 'var(--terracotta)' }} />
            </div>
            <h3 className="font-display font-bold text-base sm:text-lg" style={{ color: 'var(--fg)' }}>
              Send to Signers
            </h3>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
            style={{ background: 'var(--bg-stone)', color: 'var(--fg-muted)' }}
            aria-label="Close"
          >
            <X style={{ height: 15, width: 15 }} />
          </button>
        </div>

        {/* Body */}
        <div className="p-3.5 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {!sentResult ? (
            <>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                Add recipients in signing order. Each person receives a unique, secure signing link.
              </p>

              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {recipients.map((r, i) => (
                  <div
                    key={i}
                    className="p-3 sm:p-4 rounded-[1.25rem] sm:rounded-[1.5rem] space-y-3"
                    style={{
                      background: 'var(--bg-stone)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{ background: 'var(--terracotta)', color: '#fff' }}
                        >
                          {i + 1}
                        </span>
                        <span className="text-xs font-bold" style={{ color: 'var(--fg-muted)' }}>
                          Signer
                        </span>
                      </div>
                      {recipients.length > 1 && (
                        <button
                          onClick={() => setRecipients((p) => p.filter((_, idx) => idx !== i))}
                          className="p-1 rounded-lg transition-all hover:scale-110"
                          style={{ color: '#A85448' }}
                          aria-label="Remove signer"
                        >
                          <Trash2 style={{ height: 14, width: 14 }} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Full Name"
                        value={r.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRecipients((p) => p.map((item, idx) => idx === i ? { ...item, name: v } : item));
                        }}
                        className="input-organic h-10 text-xs"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={r.email}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRecipients((p) => p.map((item, idx) => idx === i ? { ...item, email: v } : item));
                        }}
                        className="input-organic h-10 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setRecipients((p) => [...p, { email: '', name: '', signingOrder: p.length + 1 }])}
                className="w-full py-2.5 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 transition-all duration-200 hover:scale-[1.02]"
                style={{
                  background: 'var(--clay-dim)',
                  color: 'var(--terracotta)',
                  border: '1px solid rgba(193,140,93,0.25)',
                }}
              >
                <UserPlus style={{ height: 14, width: 14 }} />
                <span>Add Another Signer</span>
              </button>
            </>
          ) : (
            <div className="text-center py-4 space-y-4 animate-fadeIn">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: 'var(--moss-dim)' }}
              >
                <CheckCircle2 style={{ height: 28, width: 28, color: 'var(--moss)' }} />
              </div>
              <div>
                <h4 className="font-display font-bold text-lg" style={{ color: 'var(--fg)' }}>
                  Signing Invitations Dispatched!
                </h4>
                <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
                  Invitations are delivered automatically via your Gmail SMTP, or you can copy individual links below.
                </p>
              </div>

              {!isSupabaseConfigured() && (
                <div
                  className="p-3 rounded-2xl text-[11px] text-left flex items-start gap-2"
                  style={{ background: 'rgba(217, 158, 75, 0.12)', border: '1px solid rgba(217, 158, 75, 0.3)', color: '#8C5E1A' }}
                >
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Offline / Local Mode:</strong> Because cloud sync (Supabase) is not configured, this link works in this browser. To send documents across different devices/phones, add your Supabase project keys to Vercel Environment Variables.
                  </span>
                </div>
              )}
              <div className="space-y-3 text-left max-h-60 overflow-y-auto pr-1">
                {sentResult.recipients?.map((item: any, i: number) => (
                  <div
                    key={i}
                    className="p-3.5 rounded-[1.25rem] text-xs space-y-2.5"
                    style={{ background: 'var(--bg-stone)', border: '1px solid var(--border-light)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: 'var(--terracotta)', color: '#fff' }}
                        >
                          {i + 1}
                        </span>
                        <span className="font-bold" style={{ color: 'var(--fg)' }}>
                          {item.name}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        {item.emailSent ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1"
                            style={{ background: 'var(--moss-dim)', color: 'var(--moss)' }}
                          >
                            <Check style={{ height: 10, width: 10 }} />
                            Sent via Gmail
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1"
                            style={{ background: 'rgba(217, 158, 75, 0.15)', color: '#8C5E1A' }}
                            title={item.emailError || 'Email delivery available'}
                          >
                            <Info style={{ height: 10, width: 10 }} />
                            Link Ready
                          </span>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                          {item.email}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      {/* 1. Automated Resend / Send via Gmail SMTP */}
                      <button
                        onClick={() => handleResendEmail(item, i)}
                        disabled={resendingIdx === i}
                        className="flex-1 py-2 px-3 rounded-full text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all duration-200 hover:scale-[1.02] disabled:opacity-50"
                        style={{
                          background: item.emailSent ? 'var(--bg-paper)' : 'var(--terracotta)',
                          color: item.emailSent ? 'var(--fg)' : '#fff',
                          border: item.emailSent ? '1px solid var(--border-light)' : 'none',
                        }}
                        title={item.emailSent ? 'Resend automated invitation email' : 'Send invitation email via Gmail'}
                      >
                        {resendingIdx === i ? (
                          <Loader2 className="animate-spin" style={{ height: 13, width: 13 }} />
                        ) : item.emailSent ? (
                          <RotateCw style={{ height: 13, width: 13 }} />
                        ) : (
                          <Mail style={{ height: 13, width: 13 }} />
                        )}
                        <span>
                          {resendingIdx === i
                            ? 'Sending...'
                            : item.emailSent
                            ? 'Resend Email'
                            : 'Send Email'}
                        </span>
                      </button>

                      {/* 2. Direct Web Gmail Compose Fallback */}
                      <a
                        href={item.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-full transition-all duration-200 hover:scale-110"
                        style={{
                          background: 'var(--bg-paper)',
                          color: 'var(--fg-muted)',
                          border: '1px solid var(--border-light)',
                        }}
                        title="Open composed draft directly in Gmail Web"
                        aria-label="Open composed draft in Gmail Web"
                      >
                        <Mail style={{ height: 13, width: 13 }} />
                      </a>

                      {/* 3. Default Desktop Mail Client (mailto:) */}
                      <a
                        href={item.mailtoUrl}
                        className="p-2 rounded-full transition-all duration-200 hover:scale-110"
                        style={{
                          background: 'var(--bg-paper)',
                          color: 'var(--fg-muted)',
                          border: '1px solid var(--border-light)',
                        }}
                        title="Open in default desktop Mail app (Outlook / Apple Mail)"
                        aria-label="Open in default desktop Mail app"
                      >
                        <ExternalLink style={{ height: 13, width: 13 }} />
                      </a>

                      {/* 3. Device Share (WhatsApp/Slack/Messages) */}
                      {typeof navigator !== 'undefined' && !!navigator.share && (
                        <button
                          onClick={() => {
                            deliveryService.shareViaDevice(
                              'Signature Request',
                              `Hi ${item.name}, please sign this document on Inky:`,
                              item.signingUrl
                            );
                          }}
                          className="p-2 rounded-full transition-all duration-200 hover:scale-110"
                          style={{
                            background: 'var(--clay-dim)',
                            color: 'var(--terracotta)',
                            border: '1px solid rgba(193,140,93,0.25)',
                          }}
                          title="Share via device (WhatsApp, Slack, Messages)"
                          aria-label="Share via device"
                        >
                          <Share2 style={{ height: 13, width: 13 }} />
                        </button>
                      )}

                      {/* 3. Copy Link */}
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(item.signingUrl);
                          setCopiedIdx(i);
                          useToastStore.getState().showToast(`Copied signing link for ${item.name}`, 'success');
                          setTimeout(() => setCopiedIdx(null), 2500);
                        }}
                        className="p-2 rounded-full transition-all duration-200 hover:scale-110"
                        style={{
                          background: copiedIdx === i ? 'var(--moss-dim)' : 'var(--bg-paper)',
                          color: copiedIdx === i ? 'var(--moss)' : 'var(--fg-muted)',
                          border: '1px solid var(--border-light)',
                        }}
                        title="Copy signing link"
                        aria-label="Copy signing link"
                      >
                        {copiedIdx === i ? (
                          <Check style={{ height: 14, width: 14 }} />
                        ) : (
                          <Copy style={{ height: 14, width: 14 }} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 pb-5 pt-1 flex items-center justify-end gap-3"
        >
          {!sentResult ? (
            <>
              <button
                onClick={onClose}
                className="btn-ghost"
                style={{ color: 'var(--fg-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={isLoading}
                className="btn-secondary"
              >
                {isLoading
                  ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  : <Send style={{ height: 14, width: 14 }} />
                }
                <span>Send Out</span>
              </button>
            </>
          ) : (
            <button onClick={onClose} className="btn-primary">Done</button>
          )}
        </div>
      </div>
    </div>
  );
};
